/**
 * DynamicForm — 根據 event_fields 動態渲染表單
 *
 * field_type 支援：radio / checkbox / boolean / text / plate / datetime
 *   boolean  — 單一勾選項目（點一下打勾，再點取消）
 *   plate    — 車牌號碼，自動大寫、置中大字
 *   datetime — 日期時間選取器（datetime-local），放大顯示
 * show_if 邏輯：{ field_key: value } — 當對應欄位的答案等於指定值時才顯示
 */

export default function DynamicForm({ fields, answers, onChange }) {
  // 判斷欄位是否應顯示
  function isVisible(field) {
    if (!field.show_if) return true
    return Object.entries(field.show_if).every(
      ([key, val]) => answers[key] === val
    )
  }

  function handleChange(fieldKey, value) {
    const next = { ...answers, [fieldKey]: value }

    // 當父欄位改變，清掉依賴它的子欄位答案（避免送出隱藏欄位的舊答案）
    fields.forEach(f => {
      if (f.show_if && f.show_if[fieldKey] !== undefined && f.show_if[fieldKey] !== value) {
        delete next[f.field_key]
      }
    })

    // 車牌自動帶入：當某個 plate 欄位剛因本次選擇而出現，且目前沒有值，
    // 自動複製畫面上另一個已填的 plate 欄位的值（例如上山選自行開車後帶入下山車牌）
    fields.forEach(f => {
      if (
        f.field_type === 'plate' &&
        f.show_if && f.show_if[fieldKey] === value &&
        !next[f.field_key]
      ) {
        const donor = fields.find(
          pf => pf.field_type === 'plate' && pf.field_key !== f.field_key && next[pf.field_key]
        )
        if (donor) next[f.field_key] = next[donor.field_key]
      }
    })

    onChange(next)
  }

  const visibleFields = fields.filter(isVisible)

  return (
    <div className="space-y-6">
      {visibleFields.map(field => (
        <div key={field.field_id}>
          <p className="text-kiosk-base font-semibold text-gray-800 mb-3">
            {field.field_label}
            {field.required && <span className="text-red-500 ml-1">*</span>}
          </p>

          {field.field_type === 'radio' && (
            <div className="flex flex-wrap gap-3">
              {(field.options || []).map(opt => {
                const selected = answers[field.field_key] === opt
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => handleChange(field.field_key, opt)}
                    className={`
                      px-6 py-3 rounded-xl text-kiosk-base font-medium border-2 transition-all
                      ${selected
                        ? 'bg-blue-600 text-white border-blue-600 shadow-md'
                        : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'
                      }
                    `}
                  >
                    {opt}
                  </button>
                )
              })}
            </div>
          )}

          {field.field_type === 'checkbox' && (
            <div className="flex flex-wrap gap-3">
              {(field.options || []).map(opt => {
                const current = answers[field.field_key] || []
                const selected = current.includes(opt)
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => {
                      const next = selected
                        ? current.filter(v => v !== opt)
                        : [...current, opt]
                      handleChange(field.field_key, next)
                    }}
                    className={`
                      px-6 py-3 rounded-xl text-kiosk-base font-medium border-2 transition-all
                      ${selected
                        ? 'bg-green-600 text-white border-green-600 shadow-md'
                        : 'bg-white text-gray-700 border-gray-300 hover:border-green-400'
                      }
                    `}
                  >
                    {selected ? '✓ ' : ''}{opt}
                  </button>
                )
              })}
            </div>
          )}

          {/* 單一是／否 — 兩個大按鈕並排，選中後明顯反色 */}
          {field.field_type === 'boolean' && (
            <div className="flex gap-4">
              {[{ label: '是', value: true }, { label: '否', value: false }].map(({ label, value }) => {
                const selected = answers[field.field_key] === value
                const isYes = value === true
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => handleChange(field.field_key, value)}
                    className={`
                      flex-1 py-4 rounded-xl text-kiosk-lg font-semibold border-2 transition-all
                      ${selected
                        ? isYes
                          ? 'bg-green-600 text-white border-green-600 shadow-md'
                          : 'bg-red-500 text-white border-red-500 shadow-md'
                        : 'bg-white text-gray-700 border-gray-300 hover:border-gray-400'
                      }
                    `}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          )}

          {field.field_type === 'text' && (
            <input
              type="text"
              value={answers[field.field_key] || ''}
              onChange={e => handleChange(field.field_key, e.target.value)}
              className="w-full border-2 border-gray-300 rounded-xl px-4 py-3 text-kiosk-base focus:outline-none focus:border-blue-500"
              placeholder={`請輸入${field.field_label}`}
            />
          )}

          {/* 車牌號碼 — 自動大寫、置中、追蹤間距 */}
          {field.field_type === 'plate' && (
            <div>
              <input
                type="text"
                inputMode="text"
                value={answers[field.field_key] || ''}
                onChange={e => handleChange(field.field_key, e.target.value.toUpperCase())}
                className="w-full border-2 border-gray-300 rounded-xl px-4 py-4 text-kiosk-base font-bold tracking-widest text-center uppercase focus:outline-none focus:border-blue-500"
                placeholder="ABC-1234"
                maxLength={10}
              />
              <p className="text-sm text-gray-400 mt-2 text-center">請輸入車牌號碼，英文會自動轉大寫</p>
            </div>
          )}

          {/* 日期時間 — 拆成日期 + 時間兩個輸入框，確保 24 小時制 */}
          {field.field_type === 'datetime' && (() => {
            const raw = answers[field.field_key] || ''
            const [datePart, timePart] = raw.includes('T') ? raw.split('T') : [raw, '']
            function onDateChange(d) {
              handleChange(field.field_key, d ? `${d}T${timePart || ''}` : '')
            }
            function onTimeChange(t) {
              handleChange(field.field_key, datePart ? `${datePart}T${t}` : '')
            }
            return (
              <div>
                <div className="flex gap-3">
                  <input
                    type="date"
                    value={datePart}
                    onChange={e => onDateChange(e.target.value)}
                    className="flex-1 border-2 border-gray-300 rounded-xl px-4 py-4 text-kiosk-base focus:outline-none focus:border-blue-500"
                  />
                  <input
                    type="time"
                    value={timePart}
                    onChange={e => onTimeChange(e.target.value)}
                    className="w-36 border-2 border-gray-300 rounded-xl px-4 py-4 text-kiosk-base focus:outline-none focus:border-blue-500"
                  />
                </div>
                <p className="text-sm text-gray-400 mt-2">請選擇日期與時間（年 / 月 / 日　時 : 分）</p>
              </div>
            )
          })()}
        </div>
      ))}
    </div>
  )
}
