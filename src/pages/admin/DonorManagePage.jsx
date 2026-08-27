import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import * as XLSX from '@e965/xlsx'
import AdminLayout from '../../components/AdminLayout'
import SearchableSelect from '../../components/SearchableSelect'
import {
  getAllEvents,
  getAllStudents,
  listEventDonors,
  addEventDonor,
  updateEventDonor,
  deleteEventDonor,
  bulkUpsertEventDonors,
  listEventDonorFields,
  saveEventDonorFields,
  getRegistrationsWithStudents,
  updateEvent,
  listEventDonorsForDayOf,
} from '../../lib/supabase'
import { buildDonorMessage, sendDonorNotifications } from '../../lib/donorNotify'

// 預設欄位（跟 migration 的 backfill 用同一組 key/label/順序）
const DEFAULT_DONOR_FIELDS = [
  { field_key: 'donor_item', field_label: '功德項目' },
  { field_key: 'seat',       field_label: '座位' },
  { field_key: 'corsage',    field_label: '胸花' },
  { field_key: 'offering',   field_label: '供具' },
  { field_key: 'donor_note', field_label: '備註' },
]

// ── 欄位映射：Excel 表頭比對，依目前欄位設定動態產生別名 ────
// 只用目前的 field_label 當唯一比對依據，避免使用者改名／互換欄位時別名重疊衝突
function buildColAliases(fields) {
  return {
    student_id: ['學員編號', '編號', 'student_id', 'StudentID'],
    name:       ['姓名', 'name', 'Name'],
    ...Object.fromEntries(fields.map(f => [f.field_key, [f.field_label]])),
  }
}

function mapRow(rawRow, colAliases) {
  const keys = Object.keys(rawRow)
  const row = {}
  for (const [field, aliases] of Object.entries(colAliases)) {
    const key = keys.find(k => aliases.includes(k.trim()))
    row[field] = key ? String(rawRow[key] ?? '').trim() : ''
  }
  return row
}

function downloadTemplate(fields) {
  // 只有表頭，沒有範例資料（師父反映範例會誤導）
  const header = ['學員編號', '姓名', ...fields.map(f => f.field_label)]
  const ws = XLSX.utils.aoa_to_sheet([header])
  ws['!cols'] = header.map((h, i) => ({ wch: i === 0 ? 12 : i === 1 ? 10 : 14 }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '功德主名單')
  XLSX.writeFile(wb, '功德主匯入模板.xlsx')
}

// ── 比對 students：依 student_id 或 姓名（含多筆同名處理）────
function matchToStudents(rows, students, fields) {
  // 建 lookup
  const byId   = new Map() // student_id → student
  const byName = new Map() // name → [student, ...]
  for (const s of students) {
    byId.set(s.student_id, s)
    const arr = byName.get(s.name) ?? []
    arr.push(s)
    byName.set(s.name, arr)
  }

  return rows.map((r, idx) => {
    const sid  = (r.student_id || '').trim()
    const name = (r.name       || '').trim()
    let matchType  = 'guest'        // 'student' | 'guest' | 'ambiguous'
    let resolvedId = null
    let candidates = []

    if (sid && byId.has(sid)) {
      matchType  = 'student'
      resolvedId = sid
    } else if (!sid && name) {
      const list = byName.get(name) ?? []
      if (list.length === 1) {
        matchType  = 'student'
        resolvedId = list[0].student_id
      } else if (list.length > 1) {
        matchType  = 'ambiguous'
        candidates = list
      } else {
        matchType  = 'guest'
      }
    } else if (sid && !byId.has(sid)) {
      // 學員編號填了但找不到 → 標 ambiguous，預設訪客
      matchType  = 'unknown_id'
      candidates = []
    }

    const answers = {}
    for (const f of fields) answers[f.field_key] = r[f.field_key] || ''

    return {
      idx,
      raw: r,
      name,
      student_id_input: sid,
      matchType,
      resolvedStudentId: resolvedId,
      candidates,
      answers,
    }
  })
}

const MATCH_BADGE = {
  student:    { label: '學員',          cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  guest:      { label: '訪客',          cls: 'bg-blue-100 text-blue-700 border-blue-200' },
  ambiguous:  { label: '⚠️ 同名待選',    cls: 'bg-amber-100 text-amber-800 border-amber-300' },
  unknown_id: { label: '⚠️ 編號找不到', cls: 'bg-red-100 text-red-700 border-red-200' },
}

// ── 比對本場法會報名紀錄：建立 student_id / 訪客姓名 查找集合 ──
function buildRegistrationLookup(registrations) {
  const studentIds = new Set()
  const guestNames = new Set()
  for (const r of registrations) {
    if (r.student_id) studentIds.add(r.student_id)
    const guestName = (r.answers?.guest_name || '').trim()
    if (guestName) guestNames.add(guestName)
  }
  return { studentIds, guestNames }
}

// 依目前比對結果（學員型看 resolvedStudentId／訪客型看姓名）判斷是否查無本場報名紀錄
function checkNoRegistration(row, regLookup) {
  if (row.matchType === 'student') {
    return !regLookup.studentIds.has(row.resolvedStudentId)
  }
  if (row.matchType === 'guest') {
    return !regLookup.guestNames.has(row.name.trim())
  }
  return false // 同名待選／編號找不到尚未定案，待使用者選定後才判斷
}

// ── 主頁面 ──────────────────────────────────────────────────
export default function DonorManagePage() {
  const { id } = useParams()
  const [eventName, setEventName] = useState('')
  const [eventInfo, setEventInfo] = useState(null) // 完整活動資料（判斷 has_donor_notify、組訊息用日期）
  const [ticketCopies, setTicketCopies] = useState(1) // 出單機預設列印份數

  // 發送功德主通知（法會前先發一次；has_donor_notify 活動才顯示）
  const [sendModalOpen, setSendModalOpen] = useState(false)
  const [sendLoading, setSendLoading] = useState(false)
  const [sendCandidates, setSendCandidates] = useState([]) // 已綁定 LINE 的功德主
  const [sendChecked, setSendChecked] = useState(new Set())
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState(null)
  const [donors, setDonors]       = useState([])
  const [students, setStudents]   = useState([])
  const [fields, setFields]       = useState([]) // event_donor_fields（有序）
  const [loading, setLoading]     = useState(true)
  const [msg, setMsg]             = useState('')

  // 匯入流程
  const [parseError, setParseError] = useState('')
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewRows, setPreviewRows] = useState([])
  const [importing, setImporting]     = useState(false)
  const [importResult, setImportResult] = useState(null)
  const [regLookup, setRegLookup] = useState({ studentIds: new Set(), guestNames: new Set() })
  const fileInputRef = useRef(null)
  // 匯入撞名處理：nameConflicts 為 null 代表 modal 關閉，否則是 bulkUpsertEventDonors
  // 回傳的 conflicts 陣列（同一批訪客型資料裡姓名重複、無法自動判斷是否同一人）
  const [nameConflicts, setNameConflicts] = useState(null)
  const [resolvingConflicts, setResolvingConflicts] = useState(false)
  const [conflictResult, setConflictResult] = useState(null)

  // 單筆新增 / 編輯
  const [formOpen, setFormOpen]   = useState(false)
  const [editingDonor, setEditingDonor] = useState(null)

  // 欄位設定
  const [fieldSettingsOpen, setFieldSettingsOpen] = useState(false)
  const [fieldDrafts, setFieldDrafts] = useState([]) // 編輯中的草稿
  const [savingFields, setSavingFields] = useState(false)

  // 篩選
  const [search, setSearch] = useState('')

  // 載入
  const load = useCallback(async () => {
    setLoading(true)
    const [donorsRes, studentsRes, eventsRes, fieldsRes] = await Promise.all([
      listEventDonors(id),
      getAllStudents(''),
      getAllEvents({ excludeCanary: true }),
      listEventDonorFields(id),
    ])
    setDonors(donorsRes.donors || [])
    setStudents(studentsRes.students || [])
    const ev = (eventsRes.events || []).find(e => e.event_id === id)
    setEventName(ev?.name ?? '')
    setEventInfo(ev || null)
    setTicketCopies(ev?.donor_ticket_default_copies ?? 1)

    let currentFields = fieldsRes.fields || []
    // 該活動從沒設定過欄位 → 自動補建 5 個預設欄位，確保任何法會第一次打開都有東西可用
    if (currentFields.length === 0) {
      await saveEventDonorFields(id, DEFAULT_DONOR_FIELDS)
      const refetched = await listEventDonorFields(id)
      currentFields = refetched.fields || []
    }
    setFields(currentFields)
    setFieldDrafts(currentFields.map(f => ({ field_key: f.field_key, field_label: f.field_label })))
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  // 顯示訊息（自動消失）
  function flash(text) {
    setMsg(text)
    setTimeout(() => setMsg(''), 3000)
  }

  // ── 欄位設定 ────────────────────────────────────────────────
  function updateFieldDraftLabel(i, label) {
    setFieldDrafts(ds => ds.map((d, idx) => idx === i
      ? { ...d, field_label: label }
      : d
    ))
  }
  // 比照 FieldRow.jsx：離開輸入框時才把顯示名稱定案為程式識別碼（只在還沒定過 key 時）
  function blurFieldDraftLabel(i, label) {
    setFieldDrafts(ds => ds.map((d, idx) => (idx === i && !d.field_key)
      ? { ...d, field_key: label }
      : d
    ))
  }
  function addFieldDraft() {
    setFieldDrafts(ds => [...ds, { field_key: '', field_label: '' }])
  }
  function removeFieldDraft(i) {
    setFieldDrafts(ds => ds.filter((_, idx) => idx !== i))
  }
  function moveFieldDraft(i, dir) {
    setFieldDrafts(ds => {
      const j = i + dir
      if (j < 0 || j >= ds.length) return ds
      const next = [...ds]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }
  async function handleSaveFields() {
    const cleaned = fieldDrafts
      .map(d => ({ field_key: (d.field_key || d.field_label).trim(), field_label: d.field_label.trim() }))
      .filter(d => d.field_label)
    if (cleaned.length === 0) { flash('❌ 至少需要一個欄位'); return }
    setSavingFields(true)
    const { success, error } = await saveEventDonorFields(id, cleaned)
    await updateEvent(id, { donor_ticket_default_copies: ticketCopies })
    setSavingFields(false)
    if (!success) { flash(`❌ 儲存欄位失敗：${error}`); return }
    await load()
    flash('✅ 欄位設定已儲存')
  }

  // ── 匯入：選檔解析 ─────────────────────────────────────────
  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setParseError('')
    setImportResult(null)

    try {
      const [buffer, regRes] = await Promise.all([
        file.arrayBuffer(),
        getRegistrationsWithStudents(id),
      ])
      const wb    = XLSX.read(buffer, { type: 'array' })
      const sheet = wb.Sheets[wb.SheetNames[0]]
      const raw   = XLSX.utils.sheet_to_json(sheet, { defval: '' })
      if (raw.length === 0) { setParseError('檔案是空的，請確認格式正確'); return }

      const colAliases = buildColAliases(fields)
      const rows = raw.map(r => mapRow(r, colAliases)).filter(r => r.name) // 必須有姓名
      if (rows.length === 0) {
        setParseError('找不到有效資料，請確認有「姓名」欄位（學員編號可空白）')
        return
      }

      setRegLookup(buildRegistrationLookup(regRes.registrations || []))
      const matched = matchToStudents(rows, students, fields)
      setPreviewRows(matched)
      setPreviewOpen(true)
    } catch (err) {
      setParseError(`解析失敗：${err.message}`)
    }
    e.target.value = ''
  }

  // ── 匯入：在 preview 中修改單筆比對結果 ─────────────────────
  function updatePreviewRow(idx, patch) {
    setPreviewRows(rows => rows.map(r => r.idx === idx ? { ...r, ...patch } : r))
  }

  // 「同名待選」項：師父挑哪一位
  function pickCandidate(idx, studentId) {
    updatePreviewRow(idx, {
      resolvedStudentId: studentId || null,
      matchType: studentId ? 'student' : 'guest',
    })
  }

  // 「編號找不到」項：選擇放棄編號改為訪客
  function fallbackToGuest(idx) {
    updatePreviewRow(idx, {
      resolvedStudentId: null,
      student_id_input: '',
      matchType: 'guest',
    })
  }

  // 全部「同名待選」一鍵改為訪客
  function allAmbiguousToGuest() {
    setPreviewRows(rows => rows.map(r =>
      (r.matchType === 'ambiguous' || r.matchType === 'unknown_id')
        ? { ...r, matchType: 'guest', resolvedStudentId: null, student_id_input: '' }
        : r
    ))
  }

  // ── 匯入：執行 ───────────────────────────────────────────
  async function handleConfirmImport() {
    setImporting(true)
    // 查無本場法會報名紀錄的列直接排除，不寫入
    const skipped   = previewRows.filter(r => checkNoRegistration(r, regLookup))
    const toImport  = previewRows.filter(r => !checkNoRegistration(r, regLookup))
    const payload = toImport.map(r => ({
      student_id: r.matchType === 'student' ? r.resolvedStudentId : null,
      name:       r.name,
      answers:    r.answers,
    }))
    const res = await bulkUpsertEventDonors(id, payload)
    setImporting(false)
    setImportResult(res)
    await load()
    if (res.conflicts && res.conflicts.length > 0) {
      // 有姓名重複、無法自動判斷是否同一人，其餘沒問題的資料已經正常匯入了，
      // 關閉預覽 modal、改開撞名處理 modal 讓師父逐一確認
      setPreviewOpen(false)
      setNameConflicts(res.conflicts)
      return
    }
    if (res.success) {
      setPreviewOpen(false)
      const base = `✅ 已匯入 ${payload.length} 筆`
      const skipMsg = skipped.length > 0
        ? `，${skipped.length} 筆因查無本場法會報名紀錄未匯入：${skipped.map(r => r.name).join('、')}⋯請先幫他們完成報名後再重新匯入這幾筆。`
        : ''
      flash(base + skipMsg)
    }
  }

  // ── 撞名處理：師父逐一選完之後，重新送出這批已經改好名字／挑好合併對象的資料 ──
  async function handleResolveConflicts(resolvedPayload) {
    setResolvingConflicts(true)
    const res = await bulkUpsertEventDonors(id, resolvedPayload)
    setResolvingConflicts(false)
    setConflictResult(res)
    await load()
    if (res.conflicts && res.conflicts.length > 0) {
      // 理論上少見（例如改的新名字又剛好跟另一組撞到），照樣跳出來讓師父再選一次
      setNameConflicts(res.conflicts)
      return
    }
    if (res.success) {
      setNameConflicts(null)
      setConflictResult(null)
      flash(`✅ 已處理姓名重複，共匯入 ${resolvedPayload.length} 筆`)
    }
  }

  // ── 單筆新增 / 編輯 ─────────────────────────────────────────
  function openCreate() {
    setEditingDonor(null)
    setFormOpen(true)
  }
  function openEdit(donor) {
    setEditingDonor(donor)
    setFormOpen(true)
  }
  async function handleDeleteDonor(donor) {
    if (!confirm(`確定刪除「${donor.name}」的功德主紀錄？`)) return
    const { success, error } = await deleteEventDonor(donor.donor_id)
    if (!success) { flash(`❌ 刪除失敗：${error}`); return }
    await load()
    flash('✅ 已刪除')
  }

  // ── 發送功德主通知（法會前先發一次）────────────────────────
  async function openSendModal() {
    setSendModalOpen(true)
    setSendResult(null)
    setSendLoading(true)
    const { donors: d } = await listEventDonorsForDayOf(id)
    const eligible = (d || []).filter(x => x.lineBound)
    setSendCandidates(eligible)
    setSendChecked(new Set(eligible.map(x => x.donor_id)))
    setSendLoading(false)
  }
  function toggleSendChecked(donorId) {
    setSendChecked(prev => {
      const next = new Set(prev)
      if (next.has(donorId)) next.delete(donorId)
      else next.add(donorId)
      return next
    })
  }
  async function handleSendNotifications() {
    setSending(true)
    const eName = eventInfo?.name || ''
    const dateLabel = eventInfo?.date_start
      ? (eventInfo.date_end && eventInfo.date_end !== eventInfo.date_start
          ? `${eventInfo.date_start} ～ ${eventInfo.date_end}`
          : eventInfo.date_start)
      : ''
    const items = sendCandidates
      .filter(d => sendChecked.has(d.donor_id))
      .map(d => ({
        donor_id: d.donor_id,
        student_id: d.student_id,
        name: d.name,
        message_text: buildDonorMessage({
          eventName: eName,
          eventDateLabel: dateLabel,
          donorName: d.name,
          carName: d.carName,
          photoWave: d.answers?.photo_wave,
          lunchTable: undefined,
          note: d.answers?.donor_note,
        }),
      }))
    const res = await sendDonorNotifications({ eventId: id, items })
    setSending(false)
    setSendResult(res)
  }

  // ── 篩選清單 ────────────────────────────────────────────────
  const filteredDonors = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return donors
    return donors.filter(d => {
      const answerTxt = fields.map(f => d.answers?.[f.field_key] ?? '').join(' ')
      const txt = `${d.name} ${d.student_id ?? ''} ${answerTxt}`.toLowerCase()
      return txt.includes(q)
    })
  }, [donors, search, fields])

  // ── students option（給單筆新增的下拉用）─────────────────────
  const studentOptions = useMemo(() => students.map(s => ({
    value: s.student_id,
    label: s.name,
    sublabel: s.student_id + (s.student_classes?.length
      ? '・' + s.student_classes.map(c => c.class_name + (c.group_name ? ' ' + c.group_name : '')).join('／')
      : ''),
  })), [students])

  return (
    <AdminLayout>
      {/* 麵包屑 */}
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
        <Link to="/admin/events" className="hover:text-purple-700">活動管理</Link>
        <span>/</span>
        <Link to={`/admin/events/${id}`} className="hover:text-purple-700">{eventName || '活動'}</Link>
        <span>/</span>
        <span className="text-gray-800 font-medium">🪷 功德主管理</span>
      </div>

      {/* 標題列 */}
      <div className="flex items-center justify-between mb-5 gap-3">
        <h2 className="text-xl font-bold text-gray-800">🪷 功德主管理</h2>
        <div className="flex items-center gap-3 shrink-0">
          {eventInfo?.has_donor_notify && (
            <button
              onClick={openSendModal}
              className="bg-orange-600 hover:bg-orange-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              📨 發送功德主通知
            </button>
          )}
          <Link
            to={`/admin/events/${id}`}
            className="text-sm text-gray-500 hover:text-purple-700"
          >← 返回活動</Link>
        </div>
      </div>

      {/* 訊息列 */}
      {msg && (
        <p className="text-sm mb-4 px-3 py-2 bg-purple-50 border border-purple-200 rounded-lg">{msg}</p>
      )}

      {/* 欄位設定摺疊區塊 */}
      <div className="bg-white border border-gray-200 rounded-xl mb-5">
        <button
          onClick={() => setFieldSettingsOpen(o => !o)}
          className="w-full flex items-center justify-between px-5 py-3 text-left"
        >
          <p className="text-sm font-semibold text-gray-700">⚙️ 欄位設定</p>
          <span className="text-gray-400 text-sm">{fieldSettingsOpen ? '收合 ▲' : '展開 ▼'}</span>
        </button>
        {fieldSettingsOpen && (
          <div className="px-5 pb-5 border-t border-gray-100 pt-4">
            <div className="space-y-2">
              {fieldDrafts.map((d, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 w-4 text-right">{i + 1}.</span>
                  <input
                    value={d.field_label}
                    onChange={e => updateFieldDraftLabel(i, e.target.value)}
                    onBlur={e => blurFieldDraftLabel(i, e.target.value)}
                    placeholder="顯示名稱（例：牌位）"
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
                  />
                  <input
                    value={d.field_key}
                    readOnly
                    className="w-40 border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-400 bg-gray-50"
                  />
                  <button
                    type="button"
                    onClick={() => moveFieldDraft(i, -1)}
                    disabled={i === 0}
                    className="text-gray-400 hover:text-gray-700 disabled:opacity-30 px-1"
                    title="上移"
                  >▲</button>
                  <button
                    type="button"
                    onClick={() => moveFieldDraft(i, 1)}
                    disabled={i === fieldDrafts.length - 1}
                    className="text-gray-400 hover:text-gray-700 disabled:opacity-30 px-1"
                    title="下移"
                  >▼</button>
                  <button
                    type="button"
                    onClick={() => removeFieldDraft(i)}
                    className="text-red-400 hover:text-red-600 text-sm px-1"
                  >✕ 刪除</button>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 mt-4 pt-4 border-t border-gray-100">
              <label className="text-sm text-gray-600">出單機預設列印份數</label>
              <input
                type="number"
                min={1}
                max={10}
                value={ticketCopies}
                onChange={e => setTicketCopies(Math.min(10, Math.max(1, parseInt(e.target.value, 10) || 1)))}
                className="w-20 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
              />
            </div>
            <div className="flex items-center gap-3 mt-4">
              <button
                type="button"
                onClick={addFieldDraft}
                className="text-sm text-purple-700 hover:text-purple-900 border border-dashed border-purple-300 hover:border-purple-500 px-3 py-1.5 rounded-lg"
              >＋ 新增欄位</button>
              <button
                type="button"
                onClick={handleSaveFields}
                disabled={savingFields}
                className="ml-auto px-4 py-1.5 text-sm bg-purple-600 hover:bg-purple-700 text-white rounded-lg disabled:opacity-50"
              >
                {savingFields ? '儲存中…' : '💾 儲存欄位設定'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 操作區：模板下載 / 匯入 / 單筆新增 */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-5">
        <p className="text-sm font-semibold text-gray-700 mb-3">📁 名單管理</p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => downloadTemplate(fields)}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-white border-2 border-purple-300 text-purple-700 rounded-lg text-sm font-medium hover:bg-purple-50 transition-colors"
          >
            📥 下載 Excel 模板
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            📤 上傳 Excel 匯入
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={handleFileChange}
          />
          <span className="text-gray-300">|</span>
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-white border-2 border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            ＋ 單筆新增
          </button>
        </div>
        {parseError && (
          <p className="text-sm text-red-600 mt-3 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            ❌ {parseError}
          </p>
        )}
        <p className="text-xs text-gray-500 mt-3">
          欄位：學員編號（可空白）、姓名、{fields.map(f => f.field_label).join('、')} — 顯示時空白欄位不會出現
        </p>
      </div>

      {/* 功德主清單 */}
      <div className="bg-white border border-gray-200 rounded-xl">
        <div className="px-5 py-3 border-b border-gray-200 flex items-center gap-3">
          <p className="text-sm font-semibold text-gray-700">
            功德主名單（{filteredDonors.length}/{donors.length} 筆）
          </p>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜尋姓名／編號／欄位內容…"
            className="ml-auto w-64 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-300"
          />
        </div>
        <div className="overflow-x-auto">
          {loading ? (
            <p className="text-center text-gray-400 py-12 text-sm">載入中…</p>
          ) : filteredDonors.length === 0 ? (
            <p className="text-center text-gray-400 py-12 text-sm">
              {donors.length === 0 ? '尚無功德主名單，請匯入或新增' : '無符合的搜尋結果'}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="text-left px-3 py-2 font-medium whitespace-nowrap">姓名</th>
                  <th className="text-left px-3 py-2 font-medium whitespace-nowrap">編號</th>
                  {fields.map(f => (
                    <th key={f.field_key} className="text-left px-3 py-2 font-medium whitespace-nowrap">{f.field_label}</th>
                  ))}
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredDonors.map(d => (
                  <tr key={d.donor_id} className="hover:bg-purple-50/30">
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className="font-semibold text-gray-800">{d.name}</span>
                      {!d.student_id && (
                        <span className="ml-1 text-[10px] bg-blue-100 text-blue-600 rounded-full px-1.5 py-0.5">訪客</span>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-gray-600 text-xs tabular-nums">
                      {d.student_id || '—'}
                    </td>
                    {fields.map(f => (
                      <td key={f.field_key} className="px-3 py-2 whitespace-nowrap">
                        {d.answers?.[f.field_key] || <span className="text-gray-300">—</span>}
                      </td>
                    ))}
                    <td className="px-3 py-2 whitespace-nowrap text-right">
                      <button
                        onClick={() => openEdit(d)}
                        className="text-xs text-purple-600 hover:text-purple-800 mr-2"
                      >編輯</button>
                      <button
                        onClick={() => handleDeleteDonor(d)}
                        className="text-xs text-red-500 hover:text-red-700"
                      >✕ 刪除</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* 匯入 preview modal */}
      {previewOpen && (
        <ImportPreviewModal
          rows={previewRows}
          fields={fields}
          regLookup={regLookup}
          importing={importing}
          importResult={importResult}
          onClose={() => { setPreviewOpen(false); setImportResult(null) }}
          onPick={pickCandidate}
          onFallback={fallbackToGuest}
          onAllToGuest={allAmbiguousToGuest}
          onConfirm={handleConfirmImport}
        />
      )}

      {/* 匯入撞名處理 modal */}
      {nameConflicts && (
        <NameConflictModal
          conflicts={nameConflicts}
          fields={fields}
          resolving={resolvingConflicts}
          result={conflictResult}
          onClose={() => { setNameConflicts(null); setConflictResult(null) }}
          onConfirm={handleResolveConflicts}
        />
      )}

      {/* 發送功德主通知 modal */}
      {sendModalOpen && (
        <SendNotifyModal
          loading={sendLoading}
          candidates={sendCandidates}
          checked={sendChecked}
          onToggle={toggleSendChecked}
          sending={sending}
          sendResult={sendResult}
          onClose={() => setSendModalOpen(false)}
          onConfirm={handleSendNotifications}
        />
      )}

      {/* 單筆新增 / 編輯 modal */}
      {formOpen && (
        <DonorFormModal
          eventId={id}
          fields={fields}
          editingDonor={editingDonor}
          studentOptions={studentOptions}
          onClose={() => setFormOpen(false)}
          onSaved={async () => { setFormOpen(false); await load(); flash('✅ 已儲存') }}
        />
      )}
    </AdminLayout>
  )
}


// ── 匯入 preview modal ─────────────────────────────────────
function ImportPreviewModal({ rows, fields, regLookup, importing, importResult, onClose, onPick, onFallback, onAllToGuest, onConfirm }) {
  const stats = useMemo(() => {
    const s = { student: 0, guest: 0, ambiguous: 0, unknown_id: 0, noRegistration: 0 }
    rows.forEach(r => {
      s[r.matchType] = (s[r.matchType] || 0) + 1
      if (checkNoRegistration(r, regLookup)) s.noRegistration += 1
    })
    return s
  }, [rows, regLookup])

  const hasPending  = stats.ambiguous > 0 || stats.unknown_id > 0
  const importCount = rows.length - stats.noRegistration

  return (
    <div className="fixed inset-0 z-40 bg-black/50 flex items-start sm:items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="bg-white w-full max-w-4xl rounded-2xl shadow-xl flex flex-col max-h-[92vh]">
        <div className="px-5 pt-5 pb-3 border-b">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-bold text-gray-800">📤 匯入功德主名單預覽（{rows.length} 筆）</h3>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-3 text-xs">
            <span className="px-2 py-0.5 rounded-full border bg-emerald-100 text-emerald-700 border-emerald-200">學員 {stats.student}</span>
            <span className="px-2 py-0.5 rounded-full border bg-blue-100 text-blue-700 border-blue-200">訪客 {stats.guest}</span>
            {stats.ambiguous > 0 && (
              <span className="px-2 py-0.5 rounded-full border bg-amber-100 text-amber-800 border-amber-300">⚠️ 同名待選 {stats.ambiguous}</span>
            )}
            {stats.unknown_id > 0 && (
              <span className="px-2 py-0.5 rounded-full border bg-red-100 text-red-700 border-red-200">⚠️ 編號找不到 {stats.unknown_id}</span>
            )}
            {stats.noRegistration > 0 && (
              <span className="px-2 py-0.5 rounded-full border bg-red-100 text-red-700 border-red-200">🚫 查無報名 {stats.noRegistration}</span>
            )}
            {hasPending && (
              <button
                onClick={onAllToGuest}
                className="ml-auto text-xs px-2 py-1 rounded-md border border-gray-300 hover:bg-gray-50 text-gray-700"
              >
                把所有「同名待選 / 編號找不到」全部改為訪客
              </button>
            )}
          </div>
          {hasPending && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3">
              下方有 {stats.ambiguous + stats.unknown_id} 筆無法自動比對學員，請逐筆選擇或一鍵改為訪客
            </p>
          )}
          {stats.noRegistration > 0 && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-3">
              下方紅色標記的 {stats.noRegistration} 筆查無本場法會報名紀錄，確認匯入時將自動排除、不會寫入名單
            </p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 sticky top-0">
              <tr>
                <th className="text-left px-2 py-2 font-medium whitespace-nowrap">姓名</th>
                <th className="text-left px-2 py-2 font-medium whitespace-nowrap">編號（Excel）</th>
                <th className="text-left px-2 py-2 font-medium whitespace-nowrap">比對狀態</th>
                {fields.map(f => (
                  <th key={f.field_key} className="text-left px-2 py-2 font-medium whitespace-nowrap">{f.field_label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map(r => {
                const badge = MATCH_BADGE[r.matchType]
                const noRegistration = checkNoRegistration(r, regLookup)
                return (
                  <tr key={r.idx} className={`align-top ${noRegistration ? 'bg-red-50' : ''}`}>
                    <td className="px-2 py-2 whitespace-nowrap font-semibold text-gray-800">
                      {r.name}
                      {noRegistration && (
                        <span className="ml-1.5 text-[11px] text-red-600 font-normal">（查無報名）</span>
                      )}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap text-xs text-gray-600 tabular-nums">{r.student_id_input || '—'}</td>
                    <td className="px-2 py-2 whitespace-nowrap">
                      <span className={`text-[11px] border rounded-full px-2 py-0.5 ${badge.cls}`}>{badge.label}</span>
                      {r.matchType === 'student' && r.resolvedStudentId && (
                        <span className="ml-2 text-[11px] text-gray-500 tabular-nums">{r.resolvedStudentId}</span>
                      )}
                      {r.matchType === 'ambiguous' && (
                        <div className="mt-1">
                          <select
                            defaultValue=""
                            onChange={e => onPick(r.idx, e.target.value)}
                            className="text-xs border border-amber-300 rounded px-1.5 py-1 bg-white"
                          >
                            <option value="">請選哪一位…</option>
                            {r.candidates.map(c => (
                              <option key={c.student_id} value={c.student_id}>
                                {c.name}（{c.student_id}）
                              </option>
                            ))}
                            <option value="">（都不是 → 視為訪客）</option>
                          </select>
                        </div>
                      )}
                      {r.matchType === 'unknown_id' && (
                        <button
                          onClick={() => onFallback(r.idx)}
                          className="ml-2 text-[11px] underline text-red-600 hover:text-red-800"
                        >改為訪客</button>
                      )}
                    </td>
                    {fields.map(f => (
                      <td key={f.field_key} className="px-2 py-2 text-xs">{r.answers[f.field_key] || '—'}</td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {importResult && importResult.errors?.length > 0 && (
          <div className="px-5 py-3 bg-red-50 border-t border-red-200">
            <p className="text-sm text-red-700 font-semibold mb-1">❌ 匯入過程有 {importResult.errors.length} 筆失敗：</p>
            <ul className="text-xs text-red-600 space-y-1 max-h-32 overflow-y-auto">
              {importResult.errors.slice(0, 10).map((e, i) => (
                <li key={i}>{e.row?.name ?? '(無名)'}：{e.message}</li>
              ))}
              {importResult.errors.length > 10 && <li>… 還有 {importResult.errors.length - 10} 筆未列出</li>}
            </ul>
          </div>
        )}

        <div className="px-5 py-3 border-t flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
          >取消</button>
          <button
            disabled={importing}
            onClick={onConfirm}
            className="px-5 py-2 text-sm bg-purple-600 hover:bg-purple-700 text-white rounded-lg disabled:opacity-50"
          >
            {importing ? '匯入中…' : `確認匯入 ${importCount} 筆`}
          </button>
        </div>
      </div>
    </div>
  )
}


// ── 匯入撞名處理 modal：同一批「訪客型」新增資料裡，有姓名完全相同、被
// uq_event_donors_guest 擋下的人，讓師父決定「是同一人合併」或「不同人各自改名」
function NameConflictModal({ conflicts, fields, resolving, result, onClose, onConfirm }) {
  // resolutions[groupIdx] = { mode: 'merge'|'separate', selectedIdx: number|null, names: string[] }
  const [resolutions, setResolutions] = useState(() =>
    conflicts.map(g => ({
      mode: 'merge',
      selectedIdx: 0,
      names: g.rows.map(r => r.name),
    }))
  )

  function setMode(gi, mode) {
    setResolutions(prev => prev.map((r, i) => i === gi
      ? { ...r, mode, selectedIdx: mode === 'merge' ? 0 : null }
      : r
    ))
  }
  function setSelected(gi, idx) {
    setResolutions(prev => prev.map((r, i) => i === gi ? { ...r, selectedIdx: idx } : r))
  }
  function setName(gi, ri, value) {
    setResolutions(prev => prev.map((r, i) =>
      i === gi ? { ...r, names: r.names.map((n, j) => j === ri ? value : n) } : r
    ))
  }

  const allResolved = resolutions.every(r => {
    if (r.mode === 'merge') return r.selectedIdx !== null
    const trimmed = r.names.map(n => n.trim())
    if (trimmed.some(n => !n)) return false
    return new Set(trimmed).size === trimmed.length
  })

  function handleConfirm() {
    const resolvedPayload = []
    conflicts.forEach((g, gi) => {
      const r = resolutions[gi]
      if (r.mode === 'merge') {
        resolvedPayload.push(g.rows[r.selectedIdx])
      } else {
        g.rows.forEach((row, ri) => {
          resolvedPayload.push({ ...row, name: r.names[ri].trim() })
        })
      }
    })
    onConfirm(resolvedPayload)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start sm:items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="bg-white w-full max-w-3xl rounded-2xl shadow-xl flex flex-col max-h-[92vh]">
        <div className="px-5 pt-5 pb-3 border-b">
          <h3 className="text-lg font-bold text-gray-800">⚠️ 有 {conflicts.length} 個姓名重複，請確認</h3>
          <p className="text-xs text-gray-500 mt-1">
            這幾個姓名在這批匯入資料裡出現不只一次，系統不確定是同一人填了多筆（例如多天法會分開登記），
            還是剛好兩個不同人同名，請逐一確認。其餘沒有撞名的資料已經正常匯入。
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-4">
          {conflicts.map((g, gi) => {
            const r = resolutions[gi]
            return (
              <div key={g.name + gi} className="border rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-200 flex items-center justify-between gap-3 flex-wrap">
                  <span className="font-semibold text-amber-900">「{g.name}」出現 {g.rows.length} 次</span>
                  <div className="flex gap-3 text-xs">
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input type="radio" checked={r.mode === 'merge'} onChange={() => setMode(gi, 'merge')} />
                      是同一人，合併成一筆
                    </label>
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input type="radio" checked={r.mode === 'separate'} onChange={() => setMode(gi, 'separate')} />
                      不同人，各自保留並改名
                    </label>
                  </div>
                </div>
                <div className="divide-y">
                  {g.rows.map((row, ri) => (
                    <div key={ri} className="px-4 py-2.5 flex items-start gap-3">
                      {r.mode === 'merge' ? (
                        <input
                          type="radio"
                          className="mt-1"
                          checked={r.selectedIdx === ri}
                          onChange={() => setSelected(gi, ri)}
                        />
                      ) : (
                        <input
                          value={r.names[ri]}
                          onChange={e => setName(gi, ri, e.target.value)}
                          placeholder="輸入不重複的姓名"
                          className="text-sm border border-gray-300 rounded px-2 py-1 w-32 shrink-0"
                        />
                      )}
                      <div className="text-xs text-gray-600 flex-1 flex flex-wrap gap-x-4 gap-y-0.5">
                        {fields.map(f => (
                          <span key={f.field_key}>
                            {f.field_label}：{row.answers?.[f.field_key] || '—'}
                          </span>
                        ))}
                        {fields.every(f => !row.answers?.[f.field_key]) && (
                          <span className="text-gray-300">（無其他資料）</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>

        {result && result.errors?.length > 0 && (
          <div className="px-5 py-3 bg-red-50 border-t border-red-200">
            <p className="text-sm text-red-700 font-semibold mb-1">❌ 處理過程有 {result.errors.length} 筆失敗：</p>
            <ul className="text-xs text-red-600 space-y-1 max-h-32 overflow-y-auto">
              {result.errors.map((e, i) => (
                <li key={i}>{e.row?.name ?? '(無名)'}：{e.message}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="px-5 py-3 border-t flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
          >稍後再處理</button>
          <button
            disabled={resolving || !allResolved}
            onClick={handleConfirm}
            className="px-5 py-2 text-sm bg-purple-600 hover:bg-purple-700 text-white rounded-lg disabled:opacity-50"
          >
            {resolving ? '處理中…' : '確認送出'}
          </button>
        </div>
      </div>
    </div>
  )
}


// ── 單筆新增 / 編輯 modal ──────────────────────────────────
function DonorFormModal({ eventId, fields, editingDonor, studentOptions, onClose, onSaved }) {
  const isEdit = !!editingDonor
  const [form, setForm] = useState({
    student_id: editingDonor?.student_id ?? '',
    name:       editingDonor?.name       ?? '',
    answers:    Object.fromEntries(fields.map(f => [f.field_key, editingDonor?.answers?.[f.field_key] ?? ''])),
  })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  // 從學員下拉選 → 自動帶入 student_id 與 name
  function pickStudent(value) {
    if (!value) {
      setForm(f => ({ ...f, student_id: '' }))
      return
    }
    const s = studentOptions.find(o => o.value === value)
    setForm(f => ({
      ...f,
      student_id: value,
      name: s?.label || f.name,
    }))
  }

  function setAnswer(key, value) {
    setForm(f => ({ ...f, answers: { ...f.answers, [key]: value } }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!form.name.trim()) { setError('姓名不可為空'); return }
    setSaving(true)
    const fn = isEdit
      ? () => updateEventDonor(editingDonor.donor_id, form)
      : () => addEventDonor(eventId, form)
    const { donor, error: err } = await fn()
    setSaving(false)
    if (err) {
      setError(err.includes('uq_event_donors')
        ? '此活動已有同一學員／同名訪客的功德主紀錄'
        : err)
      return
    }
    onSaved(donor)
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/50 flex items-start sm:items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <form
        onSubmit={handleSubmit}
        className="bg-white w-full max-w-lg rounded-2xl shadow-xl"
      >
        <div className="px-5 pt-5 pb-3 border-b flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-800">
            {isEdit ? '✏️ 編輯功德主' : '＋ 新增功德主'}
          </h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">從學員清單選（選填 → 自動帶入姓名與編號）</label>
            <SearchableSelect
              value={form.student_id}
              onChange={pickStudent}
              options={studentOptions}
              placeholder="（訪客或手動輸入姓名 → 留空即可）"
              searchPlaceholder="搜尋姓名／編號…"
              className="w-full"
              clearable
            />
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">姓名 *</label>
              <input
                required
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
              />
            </div>
            {fields.map(f => (
              <div key={f.field_key} className="sm:col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">{f.field_label}</label>
                <input
                  value={form.answers[f.field_key] ?? ''}
                  onChange={e => setAnswer(f.field_key, e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
                />
              </div>
            ))}
          </div>
          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
          <p className="text-xs text-gray-400">提示：空白欄位不會顯示在報到頁</p>
        </div>
        <div className="px-5 py-3 border-t flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
          >取消</button>
          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2 text-sm bg-purple-600 hover:bg-purple-700 text-white rounded-lg disabled:opacity-50"
          >{saving ? '儲存中…' : (isEdit ? '儲存修改' : '新增')}</button>
        </div>
      </form>
    </div>
  )
}


// ── 發送功德主通知 modal（法會前先發一次，全發＋可勾掉不想發的人）──
function SendNotifyModal({ loading, candidates, checked, onToggle, sending, sendResult, onClose, onConfirm }) {
  const checkedCount = candidates.filter(c => checked.has(c.donor_id)).length

  return (
    <div className="fixed inset-0 z-40 bg-black/50 flex items-start sm:items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-xl flex flex-col max-h-[92vh]">
        <div className="px-5 pt-5 pb-3 border-b flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-800">📨 發送功德主通知</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
        </div>

        {!sendResult ? (
          <>
            <div className="flex-1 overflow-y-auto px-5 py-3">
              {loading ? (
                <p className="text-center text-gray-400 py-8 text-sm">載入中…</p>
              ) : candidates.length === 0 ? (
                <p className="text-center text-gray-400 py-8 text-sm">目前沒有已綁定 LINE 的功德主，無法發送</p>
              ) : (
                <>
                  <p className="text-xs text-gray-500 mb-2">已勾選 {checkedCount} / {candidates.length} 位（僅列出已綁定 LINE 的功德主）</p>
                  <ul className="space-y-1">
                    {candidates.map(c => (
                      <li key={c.donor_id}>
                        <label className="flex items-center gap-3 cursor-pointer hover:bg-gray-50 rounded px-2 py-1.5">
                          <input
                            type="checkbox"
                            checked={checked.has(c.donor_id)}
                            onChange={() => onToggle(c.donor_id)}
                            className="w-4 h-4 accent-orange-600 flex-shrink-0"
                          />
                          <span className="text-sm text-gray-700">{c.name}</span>
                          {c.carName && <span className="text-xs text-emerald-600 ml-1">🚌 {c.carName}</span>}
                        </label>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
            <div className="px-5 py-3 border-t flex justify-end gap-3">
              <button onClick={onClose} className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50">取消</button>
              <button
                onClick={onConfirm}
                disabled={sending || checkedCount === 0}
                className="px-5 py-2 text-sm bg-orange-600 hover:bg-orange-700 text-white rounded-lg disabled:opacity-50"
              >
                {sending ? '發送中…' : `發送（${checkedCount} 位）`}
              </button>
            </div>
          </>
        ) : (
          <div className="px-5 py-4">
            {!sendResult.success ? (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">❌ 發送失敗：{sendResult.error}</p>
            ) : (() => {
              const results = sendResult.results || []
              const sentCount = results.filter(r => r.sent).length
              const skippedCount = results.filter(r => r.skipped).length
              const failedCount = results.filter(r => r.failed).length
              const failedNames = results.filter(r => r.failed).map(r => r.name)
              return (
                <div>
                  <p className="text-sm text-gray-700">
                    ✅ 成功 {sentCount} 位　⬜ 未綁定跳過 {skippedCount} 位
                    {failedCount > 0 && <span className="text-red-600">　❌ 失敗 {failedCount} 位</span>}
                  </p>
                  {failedNames.length > 0 && (
                    <p className="text-sm text-red-600 mt-2">失敗名單：{failedNames.join('、')}</p>
                  )}
                </div>
              )
            })()}
            <div className="mt-4 flex justify-end">
              <button onClick={onClose} className="px-5 py-2 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg">關閉</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
