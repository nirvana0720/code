import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import AdminLayout from '../../components/AdminLayout'
import DynamicForm from '../../components/DynamicForm'
import {
  getAllEvents,
  updateEvent,
  getEventFields,
  saveEventFields,
  getRegistrationsWithStudents,
  deleteRegistration,
  createGuestRegistration,
} from '../../lib/supabase'

const STATUS_LABEL = { draft: '草稿', active: '進行中', closed: '已關閉' }
const FIELD_TYPES = ['radio', 'checkbox', 'text', 'plate', 'datetime', 'date', 'time']
const FIELD_TYPE_LABEL = {
  radio: 'radio（單選按鈕）',
  checkbox: 'checkbox（多選）',
  text: 'text（文字輸入）',
  plate: 'plate（車牌號碼）',
  datetime: 'datetime（日期時間）',
  date: 'date（日期）',
  time: 'time（時間）',
}

// ── 預設報名模板 ────────────────────────────────────────────
const DEFAULT_TEMPLATE_FIELDS = [
  {
    field_key: 'identity',
    field_label: '身分別',
    field_type: 'radio',
    options: ['義工', '信眾'],
    show_if: null,
    required: true,
  },
  {
    field_key: 'transport',
    field_label: '交通方式',
    field_type: 'radio',
    options: ['精舍共乘', '自行開車', '其他'],
    show_if: null,
    required: true,
  },
  {
    field_key: 'plate_no',
    field_label: '車牌號碼',
    field_type: 'plate',
    options: [],
    show_if: { transport: '自行開車' },
    required: true,
  },
  {
    field_key: 'arrive_time',
    field_label: '預計到達山上時間',
    field_type: 'datetime',
    options: [],
    show_if: { identity: '義工' },
    required: true,
  },
  {
    field_key: 'leave_time',
    field_label: '預計離開山上時間',
    field_type: 'datetime',
    options: [],
    show_if: { identity: '義工' },
    required: true,
  },
  {
    field_key: 'volunteer_group',
    field_label: '發心組別',
    field_type: 'radio',
    options: ['交通組', '行堂組', '茶水間', '大寮', '客寮', '機動組', '環保組', '大會安排', '其他'],
    show_if: { identity: '義工' },
    required: true,
  },
]

// ── 動態欄位編輯列 ─────────────────────────────────────────
function FieldRow({ field, onChange, onRemove, allFields }) {
  const options = field.options || []

  // 顯示名稱改變時，只更新 label（不在打字過程中動 field_key，避免抓到注音中間狀態）
  function handleLabelChange(label) {
    onChange({ ...field, field_label: label })
  }

  // 離開顯示名稱欄位時，若程式識別碼還是空的才自動帶入
  function handleLabelBlur(label) {
    if (!field.field_key && label) {
      onChange({ ...field, field_label: label, field_key: label })
    }
  }

  function setOption(i, val) {
    const next = [...options]
    next[i] = val
    onChange({ ...field, options: next })
  }

  function addOption() {
    onChange({ ...field, options: [...options, ''] })
  }

  function removeOption(i) {
    onChange({ ...field, options: options.filter((_, j) => j !== i) })
  }

  // 條件顯示
  const showIfKey = field.show_if ? Object.keys(field.show_if)[0] ?? '' : ''
  const showIfVal = field.show_if ? Object.values(field.show_if)[0] ?? '' : ''

  // 找到目前選中的父欄位，取其選項
  const parentField = allFields.find(f => f.field_key === showIfKey)
  const parentOptions = parentField?.options || []

  function updateShowIf(key, val) {
    if (!key) {
      onChange({ ...field, show_if: null })
    } else {
      onChange({ ...field, show_if: { [key]: val } })
    }
  }

  return (
    <div className="border border-gray-200 rounded-xl p-4 bg-gray-50 space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">顯示名稱</label>
          <input
            value={field.field_label}
            onChange={e => handleLabelChange(e.target.value)}
            onBlur={e => handleLabelBlur(e.target.value)}
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
            placeholder="身分別"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">
            程式識別碼
            <span className="text-gray-400 font-normal ml-1">（自動填入，通常不需更改）</span>
          </label>
          <input
            value={field.field_key}
            onChange={e => onChange({ ...field, field_key: e.target.value })}
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm text-gray-400 focus:outline-none focus:ring-1 focus:ring-amber-400"
            placeholder="自動填入"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">欄位類型</label>
          <select
            value={field.field_type}
            onChange={e => onChange({ ...field, field_type: e.target.value })}
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
          >
            {FIELD_TYPES.map(t => <option key={t} value={t}>{FIELD_TYPE_LABEL[t] ?? t}</option>)}
          </select>
        </div>
        <div className="flex items-end gap-2">
          <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer mb-1">
            <input
              type="checkbox"
              checked={field.required ?? true}
              onChange={e => onChange({ ...field, required: e.target.checked })}
              className="accent-amber-600"
            />
            必填
          </label>
          <button
            onClick={onRemove}
            className="ml-auto text-red-400 hover:text-red-600 text-sm px-2 py-1 rounded transition-colors"
          >
            刪除
          </button>
        </div>
      </div>

      {/* 選項列表：每項獨立輸入框 */}
      {(field.field_type === 'radio' || field.field_type === 'checkbox') && (
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-2">選項</label>
          <div className="space-y-2">
            {options.map((opt, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-xs text-gray-400 w-4 text-right">{i + 1}.</span>
                <input
                  value={opt}
                  onChange={e => setOption(i, e.target.value)}
                  className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
                  placeholder={`選項 ${i + 1}`}
                />
                <button
                  onClick={() => removeOption(i)}
                  className="text-gray-300 hover:text-red-400 text-lg leading-none px-1 transition-colors"
                  title="刪除此選項"
                >
                  ×
                </button>
              </div>
            ))}
            <button
              onClick={addOption}
              className="text-sm text-amber-700 hover:text-amber-900 border border-dashed border-amber-300 hover:border-amber-500 px-3 py-1 rounded transition-colors"
            >
              ＋ 新增選項
            </button>
          </div>
        </div>
      )}

      {/* 條件顯示：下拉選單，不需手打程式識別碼 */}
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">
          條件顯示（當某欄位選了特定值才出現；不需要請選「不設條件」）
        </label>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-400">當</span>
          <select
            value={showIfKey}
            onChange={e => updateShowIf(e.target.value, '')}
            className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
          >
            <option value="">不設條件</option>
            {allFields.filter(f => f.field_label).map((f, i) => (
              <option key={f.field_key || i} value={f.field_key}>
                {f.field_label}
              </option>
            ))}
          </select>

          {showIfKey && (
            <>
              <span className="text-xs text-gray-400">選了</span>
              {parentOptions.length > 0 ? (
                <select
                  value={showIfVal}
                  onChange={e => updateShowIf(showIfKey, e.target.value)}
                  className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
                >
                  <option value="">請選擇</option>
                  {parentOptions.map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              ) : (
                <input
                  value={showIfVal}
                  onChange={e => updateShowIf(showIfKey, e.target.value)}
                  className="w-28 border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
                  placeholder="輸入值"
                />
              )}
              <span className="text-xs text-gray-400">時顯示</span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── 欄位值顯示格式化 ────────────────────────────────────────
// datetime-local 回傳格式 "2026-04-25T08:00" → "2026/04/25 08:00"
function formatFieldValue(field, val) {
  if (val === undefined || val === null || val === '') return '-'
  if (Array.isArray(val)) return val.join('、')
  if (field.field_type === 'datetime' && typeof val === 'string' && val.includes('T')) {
    const [date, time] = val.split('T')
    return `${date.replaceAll('-', '/')} ${time.slice(0, 5)}`
  }
  return val
}

// ── 活動日期格式化 ──────────────────────────────────────────
function formatEventDate(ev) {
  if (!ev?.date_start) return ''
  const fmt = d => d.replaceAll('-', '/')
  if (!ev.date_end || ev.date_end === ev.date_start) return fmt(ev.date_start)
  return `${fmt(ev.date_start)} ～ ${fmt(ev.date_end)}`
}

// ── 取得顯示名稱（學員或訪客）────────────────────────────────
function getDisplayName(r) {
  if (r.students?.name) return r.students.name
  if (r.answers?.guest_name) return r.answers.guest_name
  return '-'
}

// ── CSV 匯出 ───────────────────────────────────────────────
function exportCSV(registrations, fields) {
  const answerHeaders = fields.map(f => f.field_label)
  const header = ['學員編號', '姓名', '報名時間', '報到時間', ...answerHeaders]

  const rows = registrations.map(r => {
    const name = getDisplayName(r)
    const regAt = r.registered_at ? new Date(r.registered_at).toLocaleString('zh-TW') : ''
    const checkinAt = r.checked_in_at ? new Date(r.checked_in_at).toLocaleString('zh-TW') : ''
    const answerCols = fields.map(f => {
      const val = r.answers?.[f.field_key]
      const formatted = formatFieldValue(f, val)
      return formatted === '-' ? '' : formatted
    })
    return [r.student_id ?? '訪客', name, regAt, checkinAt, ...answerCols]
  })

  const csv = [header, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n')

  const bom = '\uFEFF'
  const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `報名紀錄_${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ── 主頁面 ─────────────────────────────────────────────────
export default function EventDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [event, setEvent] = useState(null)
  const [fields, setFields] = useState([])
  const [registrations, setRegistrations] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('info') // info | fields | registrations
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

  // 活動基本資料（編輯用）
  const [form, setForm] = useState({})

  // 訪客報名 modal
  const [guestModal, setGuestModal] = useState(false)
  const [guestName, setGuestName] = useState('')
  const [guestAnswers, setGuestAnswers] = useState({})
  const [guestSaving, setGuestSaving] = useState(false)
  const [guestRegId, setGuestRegId] = useState(null) // 新增成功後的 registration_id

  // 補看 QR code modal（訪客用）
  const [qrModal, setQrModal] = useState(null) // null | { registrationId, name }

  const load = useCallback(async () => {
    setLoading(true)
    const [{ events }, { fields: f }, { registrations: r }] = await Promise.all([
      getAllEvents(),
      getEventFields(id),
      getRegistrationsWithStudents(id),
    ])
    const ev = events.find(e => e.event_id === id)
    if (!ev) { navigate('/admin/events'); return }
    setEvent(ev)
    setForm({
      name: ev.name,
      date_start: ev.date_start ?? '',
      date_end: ev.date_end ?? '',
      location: ev.location ?? '',
      status: ev.status,
    })
    setFields(f)
    setRegistrations(r)
    setLoading(false)
  }, [id, navigate])

  useEffect(() => { load() }, [load])

  // 儲存活動基本資料
  async function handleSaveInfo(e) {
    e.preventDefault()
    setSaving(true)
    const { success, error } = await updateEvent(id, {
      name: form.name,
      date_start: form.date_start || null,
      date_end: form.date_end || null,
      location: form.location,
      status: form.status,
    })
    setSaving(false)
    setSaveMsg(success ? '✅ 已儲存' : `❌ ${error}`)
    setTimeout(() => setSaveMsg(''), 3000)
    if (success) setEvent(ev => ({ ...ev, ...form }))
  }

  // 儲存動態欄位
  async function handleSaveFields() {
    setSaving(true)
    const { success, error } = await saveEventFields(id, fields)
    setSaving(false)
    setSaveMsg(success ? '✅ 欄位已儲存' : `❌ ${error}`)
    setTimeout(() => setSaveMsg(''), 3000)
  }

  function openGuestModal() {
    setGuestName('')
    setGuestAnswers({})
    setGuestRegId(null)
    setGuestModal(true)
  }

  function closeGuestModal() {
    setGuestModal(false)
    setGuestRegId(null)
  }

  async function handleGuestSubmit(e) {
    e.preventDefault()
    if (!guestName.trim()) return
    setGuestSaving(true)
    const { registrationId, error } = await createGuestRegistration(id, guestName.trim(), guestAnswers)
    setGuestSaving(false)
    if (error) { alert(`新增失敗：${error}`); return }
    setGuestRegId(registrationId)
    await load() // 重新載入報名名單
  }

  async function handleDeleteRegistration(registrationId, studentName) {
    if (!window.confirm(`確定要取消「${studentName}」的報名嗎？此動作無法復原。`)) return
    const { success, error } = await deleteRegistration(registrationId)
    if (!success) { alert(`取消失敗：${error}`); return }
    setRegistrations(prev => prev.filter(r => r.registration_id !== registrationId))
  }

  function addField() {
    setFields(prev => [...prev, {
      field_key: '',
      field_label: '',
      field_type: 'radio',
      options: [],
      show_if: null,
      required: true,
    }])
  }

  if (loading) {
    return (
      <AdminLayout>
        <p className="text-gray-400 text-sm py-16 text-center">載入中…</p>
      </AdminLayout>
    )
  }

  return (
    <AdminLayout>
      {/* ── 補看 QR code Modal ── */}
      {qrModal && (
        <>
          {/* 列印時只顯示卡片，隱藏其他所有內容 */}
          <style>{`
            @media print {
              body * { visibility: hidden; }
              .qr-print-card, .qr-print-card * { visibility: visible; }
              .qr-print-card {
                position: fixed;
                top: 50%; left: 50%;
                transform: translate(-50%, -50%);
              }
            }
          `}</style>
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 text-center">
              <p className="text-sm text-gray-400 mb-4">截圖或列印後交給訪客，報到時掃描即可</p>

              {/* 可列印卡片 */}
              <div className="qr-print-card border-2 border-gray-200 rounded-xl p-5 mb-4 bg-white">
                <p className="text-sm font-semibold text-gray-400 tracking-widest mb-3">普宜精舍</p>
                <div className="flex justify-center mb-4">
                  <QRCodeSVG value={qrModal.registrationId} size={160} />
                </div>
                <p className="text-2xl font-bold text-gray-800 mb-1">{qrModal.name}</p>
                <p className="text-sm text-gray-600">{event.name}</p>
                {event.date_start && (
                  <p className="text-sm text-gray-500 mt-0.5">{formatEventDate(event)}</p>
                )}
                <p className="text-xs text-gray-300 mt-3">掃描此 QR code 即可報到</p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => window.print()}
                  className="flex-1 border-2 border-amber-400 text-amber-700 hover:bg-amber-50 font-medium py-2.5 rounded-xl transition-colors"
                >
                  🖨️ 列印
                </button>
                <button
                  onClick={() => setQrModal(null)}
                  className="flex-1 bg-amber-700 hover:bg-amber-800 text-white font-medium py-2.5 rounded-xl transition-colors"
                >
                  關閉
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── 訪客報名 Modal ── */}
      {guestModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            {guestRegId ? (
              /* 新增成功：顯示可列印 QR code 卡片 */
              <>
                <style>{`
                  @media print {
                    body * { visibility: hidden; }
                    .qr-print-card, .qr-print-card * { visibility: visible; }
                    .qr-print-card {
                      position: fixed;
                      top: 50%; left: 50%;
                      transform: translate(-50%, -50%);
                    }
                  }
                `}</style>
                <div className="text-center">
                  <div className="text-3xl mb-2">✅</div>
                  <p className="text-sm text-gray-400 mb-4">截圖或列印後交給訪客，報到時掃描即可</p>
                  <div className="qr-print-card border-2 border-gray-200 rounded-xl p-5 mb-4 bg-white">
                    <p className="text-sm font-semibold text-gray-400 tracking-widest mb-3">普宜精舍</p>
                    <div className="flex justify-center mb-4">
                      <QRCodeSVG value={guestRegId} size={160} />
                    </div>
                    <p className="text-2xl font-bold text-gray-800 mb-1">{guestName}</p>
                    <p className="text-sm text-gray-600">{event.name}</p>
                    {event.date_start && (
                      <p className="text-sm text-gray-500 mt-0.5">{formatEventDate(event)}</p>
                    )}
                    <p className="text-xs text-gray-300 mt-3">掃描此 QR code 即可報到</p>
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={() => window.print()}
                      className="flex-1 border-2 border-amber-400 text-amber-700 hover:bg-amber-50 font-medium py-2.5 rounded-xl transition-colors"
                    >
                      🖨️ 列印
                    </button>
                    <button
                      onClick={closeGuestModal}
                      className="flex-1 bg-amber-700 hover:bg-amber-800 text-white font-medium py-2.5 rounded-xl transition-colors"
                    >
                      關閉
                    </button>
                  </div>
                </div>
              </>
            ) : (
              /* 填寫訪客資料 */
              <form onSubmit={handleGuestSubmit}>
                <h3 className="text-lg font-bold text-gray-800 mb-4">新增訪客報名</h3>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-600 mb-1">
                    姓名 <span className="text-red-500">*</span>
                  </label>
                  <input
                    required
                    value={guestName}
                    onChange={e => setGuestName(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                    placeholder="請輸入姓名"
                  />
                </div>
                {fields.length > 0 && (
                  <div className="mb-4">
                    <DynamicForm fields={fields} answers={guestAnswers} onChange={setGuestAnswers} />
                  </div>
                )}
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={closeGuestModal}
                    className="flex-1 border border-gray-300 text-gray-600 hover:bg-gray-50 font-medium py-2.5 rounded-xl transition-colors"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={guestSaving}
                    className="flex-1 bg-amber-700 hover:bg-amber-800 text-white font-medium py-2.5 rounded-xl transition-colors disabled:opacity-50"
                  >
                    {guestSaving ? '新增中…' : '確認報名'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
      {/* 麵包屑 */}
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
        <Link to="/admin/events" className="hover:text-amber-700">活動管理</Link>
        <span>/</span>
        <span className="text-gray-800 font-medium">{event.name}</span>
      </div>

      {/* 標題列 */}
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-xl font-bold text-gray-800">{event.name}</h2>
        <Link
          to={`/admin/events/${id}/checkin`}
          className="bg-green-600 hover:bg-green-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          📋 現場報到
        </Link>
      </div>

      {/* Tab 切換 */}
      <div className="flex gap-1 border-b border-gray-200 mb-6">
        {[
          { key: 'info', label: '活動設定' },
          { key: 'fields', label: `動態欄位（${fields.length}）` },
          { key: 'registrations', label: `報名名單（${registrations.length}）` },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key
                ? 'border-amber-600 text-amber-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 儲存訊息 */}
      {saveMsg && (
        <p className="text-sm mb-4 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg">{saveMsg}</p>
      )}

      {/* ── Tab: 活動設定 ── */}
      {tab === 'info' && (
        <form onSubmit={handleSaveInfo} className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-600 mb-1">活動名稱 *</label>
              <input
                required
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">開始日期</label>
              <input type="date" value={form.date_start}
                onChange={e => setForm(f => ({ ...f, date_start: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">結束日期</label>
              <input type="date" value={form.date_end}
                onChange={e => setForm(f => ({ ...f, date_end: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">地點</label>
              <input value={form.location}
                onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">狀態</label>
              <select value={form.status}
                onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              >
                <option value="draft">草稿</option>
                <option value="active">進行中</option>
                <option value="closed">已關閉</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end">
            <button type="submit" disabled={saving}
              className="bg-amber-700 hover:bg-amber-800 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors disabled:opacity-50"
            >
              {saving ? '儲存中…' : '儲存設定'}
            </button>
          </div>
        </form>
      )}

      {/* ── Tab: 動態欄位 ── */}
      {tab === 'fields' && (
        <div className="space-y-4">
          {fields.length === 0 && (
            <p className="text-gray-400 text-sm text-center py-6">尚無欄位，點下方按鈕新增</p>
          )}
          {fields.map((f, i) => (
            <FieldRow
              key={i}
              field={f}
              allFields={fields.filter((_, j) => j !== i)}
              onChange={updated => setFields(prev => prev.map((x, j) => j === i ? updated : x))}
              onRemove={() => setFields(prev => prev.filter((_, j) => j !== i))}
            />
          ))}
          <div className="flex flex-wrap gap-3 pt-2">
            <button
              onClick={addField}
              className="border border-dashed border-amber-400 text-amber-700 hover:bg-amber-50 text-sm px-4 py-2 rounded-lg transition-colors"
            >
              ＋ 新增欄位
            </button>
            <button
              onClick={() => {
                if (
                  fields.length === 0 ||
                  window.confirm('套用預設模板後，目前設定的欄位將全部被取代。確定要繼續嗎？')
                ) {
                  setFields(DEFAULT_TEMPLATE_FIELDS.map(f => ({ ...f })))
                }
              }}
              className="border border-dashed border-gray-300 text-gray-500 hover:bg-gray-50 text-sm px-4 py-2 rounded-lg transition-colors"
            >
              📋 套用預設模板
            </button>
            <button
              onClick={handleSaveFields}
              disabled={saving}
              className="bg-amber-700 hover:bg-amber-800 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors disabled:opacity-50 ml-auto"
            >
              {saving ? '儲存中…' : '儲存欄位'}
            </button>
          </div>
        </div>
      )}

      {/* ── Tab: 報名名單 ── */}
      {tab === 'registrations' && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <p className="text-sm text-gray-500">共 {registrations.length} 筆報名</p>
            <div className="flex gap-2">
              <button
                onClick={openGuestModal}
                className="bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                ＋ 新增訪客
              </button>
              {registrations.length > 0 && (
                <button
                  onClick={() => exportCSV(registrations, fields)}
                  className="bg-green-600 hover:bg-green-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                >
                  ⬇️ 匯出 CSV
                </button>
              )}
            </div>
          </div>

          {registrations.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-12">尚無報名紀錄</p>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">學員編號</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">姓名</th>
                    {fields.map(f => (
                      <th key={f.field_id} className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">
                        {f.field_label}
                      </th>
                    ))}
                    <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">報到</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">報名時間</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {registrations.map(r => (
                    <tr key={r.registration_id} className="border-b border-gray-50 hover:bg-amber-50/30">
                      <td className="px-4 py-3 font-mono text-xs text-gray-500">
                        {r.student_id ?? <span className="text-amber-600 font-sans">訪客</span>}
                      </td>
                      <td className="px-4 py-3 font-medium">{getDisplayName(r)}</td>
                      {fields.map(f => (
                        <td key={f.field_id} className="px-4 py-3 text-gray-700">
                          {formatFieldValue(f, r.answers?.[f.field_key])}
                        </td>
                      ))}
                      <td className="px-4 py-3">
                        {r.checked_in_at
                          ? <span className="text-green-600 text-xs font-medium">✓ 已報到</span>
                          : <span className="text-gray-300 text-xs">—</span>
                        }
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                        {r.registered_at
                          ? new Date(r.registered_at).toLocaleString('zh-TW', { hour12: false })
                          : '-'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex gap-2 justify-end">
                          {!r.student_id && (
                            <button
                              onClick={() => setQrModal({ registrationId: r.registration_id, name: getDisplayName(r) })}
                              className="text-xs text-amber-600 hover:text-amber-800 border border-amber-200 hover:border-amber-400 px-2 py-1 rounded transition-colors"
                            >
                              QR code
                            </button>
                          )}
                          <button
                            onClick={() => handleDeleteRegistration(r.registration_id, getDisplayName(r))}
                            className="text-xs text-red-400 hover:text-red-600 border border-red-200 hover:border-red-400 px-2 py-1 rounded transition-colors"
                          >
                            取消報名
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </AdminLayout>
  )
}
