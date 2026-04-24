/**
 * DynamicForm — 根據 event_fields 動態渲染表單
 *
 * field_type 支援：radio / checkbox / text
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

          {field.field_type === 'text' && (
            <input
              type="text"
              value={answers[field.field_key] || ''}
              onChange={e => handleChange(field.field_key, e.target.value)}
              className="w-full border-2 border-gray-300 rounded-xl px-4 py-3 text-kiosk-base focus:outline-none focus:border-blue-500"
              placeholder={`請輸入${field.field_label}`}
            />
          )}
        </div>
      ))}
    </div>
  )
}
