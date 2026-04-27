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
const FIELD_TYPES = ['radio', 'checkbox', 'boolean', 'text', 'plate', 'datetime', 'date', 'time']
const FIELD_TYPE_LABEL = {
  radio: 'radio（單選按鈕）',
  checkbox: 'checkbox（多選）',
  boolean: 'boolean（單一勾選，如：報名三皈依）',
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
function FieldRow({ field, onChange, onRemove, allFields, index, onDragStart, onDragOver, onDrop, isDragOver }) {
  const options = field.options || []

  function handleLabelChange(label) {
    onChange({ ...field, field_label: label })
  }

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

  const showIfKey = field.show_if ? Object.keys(field.show_if)[0] ?? '' : ''
  const showIfVal = field.show_if ? Object.values(field.show_if)[0] ?? '' : ''
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
    <div
      draggable
      onDragStart={() => onDragStart(index)}
      onDragOver={e => { e.preventDefault(); onDragOver(index) }}
      onDrop={() => onDrop(index)}
      onDragEnd={() => onDragOver(null)}
      className={`border rounded-xl p-4 bg-gray-50 space-y-3 transition-all ${
        isDragOver ? 'border-amber-400 bg-amber-50 scale-[1.01]' : 'border-gray-200'
      }`}
    >
      <div className="flex items-center gap-2 -mb-1">
        <span
          className="cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 select-none text-base leading-none px-0.5"
          title="拖曳調整順序"
        >
          ⠿
        </span>
        <span className="text-xs text-gray-400">拖曳調整順序</span>
      </div>
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

// ── 欄位值格式化 ────────────────────────────────────────────
function formatFieldValue(field, val) {
  if (val === undefined || val === null || val === '') return '-'
  if (field.field_type === 'boolean') return val === true ? '✓ 是' : '✗ 否'
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

// ── 顯示名稱（學員或訪客）────────────────────────────────────
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
  const [tab, setTab] = useState('info')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [form, setForm] = useState({})

  // 欄位拖曳排序
  const [dragIndex, setDragIndex] = useState(null)
  const [dragOverIndex, setDragOverIndex] = useState(null)

  function handleFieldDrop(toIndex) {
    if (dragIndex === null || dragIndex === toIndex) { setDragIndex(null); return }
    const next = [...fields]
    const [moved] = next.splice(dragIndex, 1)
    next.splice(toIndex, 0, moved)
    setFields(next)
    setDragIndex(null)
    setDragOverIndex(null)
  }

  // 訪客報名 modal
  const [guestModal, setGuestModal] = useState(false)
  const [guestName, setGuestName] = useState('')
  const [guestAnswers, setGuestAnswers] = useState({})
  const [guestSaving, setGuestSaving] = useState(false)
  const [guestRegId, setGuestRegId] = useState(null)

  // 補看 QR code modal（單張）
  const [qrModal, setQrModal] = useState(null) // null | { registrationId, name }

  // 批次列印
  const [selectedGuestIds, setSelectedGuestIds] = useState(new Set())
  const [batchPrintOpen, setBatchPrintOpen] = useState(false)

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
    setSelectedGuestIds(new Set()) // 重新載入後清除選取
    setLoading(false)
  }, [id, navigate])

  useEffect(() => { load() }, [load])

  // 批次列印相關衍生狀態
  const guestRegistrations = registrations.filter(r => !r.student_id)
  const hasGuests = guestRegistrations.length > 0
  const allGuestsSelected = hasGuests && guestRegistrations.every(r => selectedGuestIds.has(r.registration_id))
  const selectedGuestRegs = guestRegistrations.filter(r => selectedGuestIds.has(r.registration_id))

  function toggleGuestSelect(regId) {
    setSelectedGuestIds(prev => {
      const next = new Set(prev)
      if (next.has(regId)) next.delete(regId)
      else next.add(regId)
      return next
    })
  }

  function toggleSelectAllGuests() {
    if (allGuestsSelected) {
      setSelectedGuestIds(new Set())
    } else {
      setSelectedGuestIds(new Set(guestRegistrations.map(r => r.registration_id)))
    }
  }

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
    const msg = success ? '✅ 欄位已儲存' : `❌ 儲存失敗：${error}`
    setSaveMsg(msg)
    if (success) setTimeout(() => setSaveMsg(''), 3000)
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
    await load()
  }

  async function handleDeleteRegistration(registrationId, studentName) {
    if (!window.confirm(`確定要取消「${studentName}」的報名嗎？此動作無法復原。`)) return
    const { success, error } = await deleteRegistration(registrationId)
    if (!success) { alert(`取消失敗：${error}`); return }
    setRegistrations(prev => prev.filter(r => r.registration_id !== registrationId))
    setSelectedGuestIds(prev => {
      const next = new Set(prev)
      next.delete(registrationId)
      return next
    })
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
      {/* ── 批次列印 Modal ── */}
      {batchPrintOpen && (
        <>
          <style>{`
            @page { size: A4 portrait; margin: 3mm; }
            @media print {
              body * { visibility: hidden !important; }
              .batch-print-cards, .batch-print-cards * { visibility: visible !important; }
              .batch-print-overlay {
                position: static !important;
                background: transparent !important;
                overflow: visible !important;
                display: block !important;
                height: auto !important;
              }
              .batch-print-toolbar { display: none !important; }
              .batch-print-preview {
                overflow: visible !important;
                padding: 0 !important;
                flex: none !important;
              }
              .batch-print-cards {
                display: grid !important;
                grid-template-columns: repeat(3, 1fr) !important;
                gap: 3mm !important;
                max-width: none !important;
                margin: 0 !important;
                width: 100% !important;
              }
              .batch-print-card {
                break-inside: avoid !important;
                page-break-inside: avoid !important;
              }
            }
          `}</style>
          <div className="batch-print-overlay fixed inset-0 z-50 flex flex-col bg-gray-100">
            {/* 頂部工具列 */}
            <div className="batch-print-toolbar bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-4 shrink-0 shadow-sm">
              <div>
                <h3 className="text-base font-bold text-gray-800">批次列印訪客通行證</h3>
                <p className="text-xs text-gray-400">共 {selectedGuestRegs.length} 張・一張 A4 可印 12 張（3 欄 × 4 列）・列印後沿虛線剪開，每人一張</p>
              </div>
              <div className="ml-auto flex gap-3">
                <button
                  onClick={() => window.print()}
                  className="bg-amber-700 hover:bg-amber-800 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
                >
                  🖨️ 列印
                </button>
                <button
                  onClick={() => setBatchPrintOpen(false)}
                  className="border border-gray-300 text-gray-600 hover:bg-gray-50 text-sm font-medium px-5 py-2 rounded-lg transition-colors"
                >
                  關閉
                </button>
              </div>
            </div>

            {/* 卡片預覽區 */}
            <div className="batch-print-preview flex-1 overflow-auto p-6">
              <div
                className="batch-print-cards"
                style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', maxWidth: '800px', margin: '0 auto' }}
              >
                {selectedGuestRegs.map(r => (
                  <div
                    key={r.registration_id}
                    className="batch-print-card"
                    style={{
                      border: '1px dashed #d1d5db',
                      borderRadius: '6px',
                      padding: '8px 10px',
                      textAlign: 'center',
                      background: 'white',
                      breakInside: 'avoid',
                      pageBreakInside: 'avoid',
                    }}
                  >
                    <p style={{ fontSize: '8px', color: '#9ca3af', letterSpacing: '3px', marginBottom: '5px', fontWeight: '600' }}>
                      普宜精舍
                    </p>
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '5px' }}>
                      <QRCodeSVG value={r.registration_id} size={70} />
                    </div>
                    <p style={{ fontSize: '13px', fontWeight: 'bold', color: '#1f2937', margin: '0 0 2px' }}>
                      {getDisplayName(r)}
                    </p>
                    <p style={{ fontSize: '10px', color: '#4b5563', margin: '0 0 1px' }}>{event.name}</p>
                    {event.date_start && (
                      <p style={{ fontSize: '9px', color: '#6b7280', margin: 0 }}>{formatEventDate(event)}</p>
                    )}
                    <p style={{ fontSize: '7px', color: '#d1d5db', marginTop: '5px' }}>
                      掃描此 QR code 即可報到
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── 補看 QR code Modal（單張）── */}
      {qrModal && (
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
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 text-center">
              <p className="text-sm text-gray-400 mb-4">截圖或列印後交給訪客，報到時掃描即可</p>
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
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto p-6">
            {guestRegId ? (
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
              index={i}
              field={f}
              allFields={fields.filter((_, j) => j !== i)}
              onChange={updated => setFields(prev => prev.map((x, j) => j === i ? updated : x))}
              onRemove={() => setFields(prev => prev.filter((_, j) => j !== i))}
              onDragStart={setDragIndex}
              onDragOver={setDragOverIndex}
              onDrop={handleFieldDrop}
              isDragOver={dragOverIndex === i}
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
          {/* 工具列 */}
          <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
            <div className="flex items-center gap-3">
              <p className="text-sm text-gray-500">共 {registrations.length} 筆報名</p>
              {hasGuests && selectedGuestIds.size > 0 && (
                <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                  已選 {selectedGuestIds.size} 位訪客
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {/* 批次列印按鈕（有選取時才顯示）*/}
              {selectedGuestIds.size > 0 && (
                <button
                  onClick={() => setBatchPrintOpen(true)}
                  className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                >
                  🖨️ 批次列印（{selectedGuestIds.size}）
                </button>
              )}
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
            <div className="w-full bg-white rounded-xl border border-gray-200 overflow-x-auto">
              <table className="w-full min-w-max text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    {/* 訪客 checkbox 欄（有訪客才顯示） */}
                    {hasGuests && (
                      <th className="px-3 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={allGuestsSelected}
                          onChange={toggleSelectAllGuests}
                          title="全選訪客"
                          className="accent-amber-600 cursor-pointer w-4 h-4"
                        />
                      </th>
                    )}
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
                  {registrations.map(r => {
                    const isGuest = !r.student_id
                    const isSelected = isGuest && selectedGuestIds.has(r.registration_id)
                    return (
                      <tr
                        key={r.registration_id}
                        className={`border-b border-gray-50 transition-colors ${
                          isSelected ? 'bg-blue-50' : 'hover:bg-amber-50/30'
                        }`}
                      >
                        {/* Checkbox（有訪客才顯示此欄） */}
                        {hasGuests && (
                          <td className="px-3 py-3 text-center">
                            {isGuest && (
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleGuestSelect(r.registration_id)}
                                className="accent-amber-600 cursor-pointer w-4 h-4"
                              />
                            )}
                          </td>
                        )}
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
                            {isGuest && (
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
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </AdminLayout>
  )
}
