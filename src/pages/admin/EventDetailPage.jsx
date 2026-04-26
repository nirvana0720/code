import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import AdminLayout from '../../components/AdminLayout'
import {
  getAllEvents,
  updateEvent,
  getEventFields,
  saveEventFields,
  getRegistrationsWithStudents,
} from '../../lib/supabase'

const STATUS_LABEL = { draft: '草稿', active: '進行中', closed: '已關閉' }
const FIELD_TYPES = ['radio', 'checkbox', 'text', 'date', 'time']

// ── 動態欄位編輯列 ─────────────────────────────────────────
function FieldRow({ field, onChange, onRemove }) {
  const options = field.options || []

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

  // 條件顯示：用兩個獨立輸入框取代 JSON 手打
  const showIfKey = field.show_if ? Object.keys(field.show_if)[0] ?? '' : ''
  const showIfVal = field.show_if ? Object.values(field.show_if)[0] ?? '' : ''

  function updateShowIf(key, val) {
    if (!key && !val) {
      onChange({ ...field, show_if: null })
    } else {
      onChange({ ...field, show_if: { [key]: val } })
    }
  }

  return (
    <div className="border border-gray-200 rounded-xl p-4 bg-gray-50 space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">程式識別碼</label>
          <input
            value={field.field_key}
            onChange={e => onChange({ ...field, field_key: e.target.value })}
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
            placeholder="identity"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">顯示名稱</label>
          <input
            value={field.field_label}
            onChange={e => onChange({ ...field, field_label: e.target.value })}
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
            placeholder="身分別"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">欄位類型</label>
          <select
            value={field.field_type}
            onChange={e => onChange({ ...field, field_type: e.target.value })}
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
          >
            {FIELD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
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

      {/* 條件顯示：兩個獨立欄位，不用手打 JSON */}
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">
          條件顯示（當某欄位選了特定值才出現，不需要請留空）
        </label>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">當</span>
          <input
            value={showIfKey}
            onChange={e => updateShowIf(e.target.value, showIfVal)}
            className="w-36 border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
            placeholder="程式識別碼"
          />
          <span className="text-xs text-gray-400">選了</span>
          <input
            value={showIfVal}
            onChange={e => updateShowIf(showIfKey, e.target.value)}
            className="w-28 border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
            placeholder="選項名稱"
          />
          <span className="text-xs text-gray-400">時顯示</span>
        </div>
        <p className="text-xs text-gray-400 mt-1">
          例：程式識別碼填 <code className="bg-gray-100 px-1 rounded">identity</code>，選項名稱填 <code className="bg-gray-100 px-1 rounded">義工</code>
        </p>
      </div>
    </div>
  )
}

// ── CSV 匯出 ───────────────────────────────────────────────
function exportCSV(registrations, fields) {
  const answerHeaders = fields.map(f => f.field_label)
  const header = ['學員編號', '姓名', '報名時間', '報到時間', ...answerHeaders]

  const rows = registrations.map(r => {
    const name = r.students?.name ?? ''
    const regAt = r.registered_at ? new Date(r.registered_at).toLocaleString('zh-TW') : ''
    const checkinAt = r.checked_in_at ? new Date(r.checked_in_at).toLocaleString('zh-TW') : ''
    const answerCols = fields.map(f => {
      const val = r.answers?.[f.field_key]
      if (Array.isArray(val)) return val.join('、')
      return val ?? ''
    })
    return [r.student_id, name, regAt, checkinAt, ...answerCols]
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
              onChange={updated => setFields(prev => prev.map((x, j) => j === i ? updated : x))}
              onRemove={() => setFields(prev => prev.filter((_, j) => j !== i))}
            />
          ))}
          <div className="flex gap-3 pt-2">
            <button
              onClick={addField}
              className="border border-dashed border-amber-400 text-amber-700 hover:bg-amber-50 text-sm px-4 py-2 rounded-lg transition-colors"
            >
              ＋ 新增欄位
            </button>
            <button
              onClick={handleSaveFields}
              disabled={saving}
              className="bg-amber-700 hover:bg-amber-800 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors disabled:opacity-50"
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
            {registrations.length > 0 && (
              <button
                onClick={() => exportCSV(registrations, fields)}
                className="bg-green-600 hover:bg-green-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                ⬇️ 匯出 CSV
              </button>
            )}
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
                  </tr>
                </thead>
                <tbody>
                  {registrations.map(r => (
                    <tr key={r.registration_id} className="border-b border-gray-50 hover:bg-amber-50/30">
                      <td className="px-4 py-3 font-mono text-xs text-gray-500">{r.student_id}</td>
                      <td className="px-4 py-3 font-medium">{r.students?.name ?? '-'}</td>
                      {fields.map(f => {
                        const val = r.answers?.[f.field_key]
                        return (
                          <td key={f.field_id} className="px-4 py-3 text-gray-700">
                            {Array.isArray(val) ? val.join('、') : (val ?? '-')}
                          </td>
                        )
                      })}
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
