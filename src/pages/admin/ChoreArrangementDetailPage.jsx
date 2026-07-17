import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import * as XLSX from '@e965/xlsx'
import AdminLayout from '../../components/AdminLayout'
import { getAllEvents } from '../../lib/supabase'
import {
  getChoresByEventSession,
  getChoreMembersByEventSession,
  getEventMembersWithGender,
  autoAssignChores,
  batchAssignMembers,
  removeMember,
} from '../../lib/choreAssignment'
import ChoreImportModal from '../../components/ChoreImportModal'
import { saveWorkbookWithBorders } from '../../lib/xlsxBorders'

const SESSIONS = [
  { key: '上午', label: '上午', emoji: '🌅' },
  { key: '下午', label: '下午', emoji: '🌇' },
]

const genderLabel = g => g === 'male' ? '男' : g === 'female' ? '女' : '未知'
const telHref = phone => `tel:${String(phone).replace(/[\s-]/g, '')}`

// 排坡流程步驟指引：純視覺提示，不做流程鎖定，各步驟按鈕維持現況可自由點擊
const STEPS = [
  { num: 1, label: '排車', hint: '建議先完成' },
  { num: 2, label: '匯入坡務表', hint: '必須先做' },
  { num: 3, label: '排坡', hint: '自動或手動' },
  { num: 4, label: '匯出', hint: '名單／總表' },
]
const STEP_CIRCLE_CLASS = {
  1: 'bg-gray-200 text-gray-500',
  2: 'bg-amber-500 text-white',
  3: 'bg-gray-200 text-gray-500',
  4: 'bg-gray-200 text-gray-500',
}

// 小圓形編號徽章，掛在既有按鈕/標題旁提示對應步驟，樣式比照步驟條圓圈但縮小
function StepBadge({ num }) {
  return (
    <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold shrink-0 ${STEP_CIRCLE_CLASS[num]}`}>
      {num}
    </span>
  )
}

function StepGuide({ importIncomplete }) {
  return (
    <div className="bg-white border rounded-xl px-4 py-3">
      <div className="flex items-start">
        {STEPS.map((step, i) => {
          const attention = step.num === 2 && importIncomplete
          return (
            <div key={step.num} className="flex items-start flex-1">
              <div className="flex flex-col items-center text-center w-24 shrink-0">
                <div
                  className={`flex items-center justify-center w-7 h-7 rounded-full text-sm font-semibold ${
                    attention ? 'bg-amber-500 text-white ring-2 ring-amber-300 animate-pulse' : STEP_CIRCLE_CLASS[step.num]
                  }`}
                >
                  {step.num}
                </div>
                <div className={`mt-1 text-xs font-medium ${step.num === 2 ? 'text-amber-700' : 'text-gray-600'}`}>
                  {step.label}
                </div>
                <div className="text-[10px] text-gray-400">{attention ? '尚未完成' : step.hint}</div>
              </div>
              {i < STEPS.length - 1 && <div className="flex-1 h-px bg-gray-300 mt-3.5 mx-1" />}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// 依車次分組（未排車的人歸「未排車」），車次依自然排序（1車、2車、10車…）
function groupMembersByCar(mems) {
  const groups = new Map()
  for (const m of mems) {
    const key = m.car_name || '未排車'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(m.name)
  }
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], 'zh-Hant', { numeric: true }))
}

// 匯出總表：一個坡務一列，車次欄列不重複車次、組員欄依車次分組換行顯示
// 例如「1車：王大明、王小明\n2車：李新添、王翠花」
const ROSTER_COLS = [
  { wch: 5 }, { wch: 10 }, { wch: 10 }, { wch: 6 }, { wch: 5 }, { wch: 5 },
  { wch: 12 }, { wch: 16 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 32 },
]
const ROSTER_HIGHLIGHT_CELLS = ['A1', 'B1', 'C1']
const ROSTER_LABEL_CELLS = [
  'A3', 'B3', 'C3', 'D3', 'A4', 'A5',
  ...['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'].flatMap(col => [`${col}7`, `${col}8`]),
]

function buildRosterAoa(title, chores, membersBySession, event) {
  const aoa = [
    [title],
    [],
    ['出坡時間', '', '報到時間', ''],
    ['上午', event?.chore_am_work_time || '', event?.chore_am_checkin_time || '', ''],
    ['下午', event?.chore_pm_work_time || '', event?.chore_pm_checkin_time || '', ''],
    [],
    ['序', '精舍', '日期', '時段', '人數', '', '單位', '負責法師', '坡務內容', '集合地點', '精舍小組長', '車次', '組員'],
    ['', '', '', '', '男', '女', '', '', '', '', '', '', ''],
  ]
  chores.forEach((chore, i) => {
    const mems = (membersBySession[chore.session] || []).filter(m => m.chore_id === chore.chore_id)
    const groups = groupMembersByCar(mems)
    const carText = groups.map(([car]) => car).join('、')
    const memberText = groups.map(([car, names]) => `${car}：${names.join('、')}`).join('\n')
    aoa.push([
      i + 1,
      chore.temple || '',
      chore.chore_date || '',
      chore.session,
      chore.quota_male || 0,
      chore.quota_female || 0,
      chore.unit || '',
      chore.supervising_monk || '',
      chore.work_content || '',
      chore.location || '',
      chore.leader_name || '',
      carText,
      memberText,
    ])
  })
  return aoa
}

function buildRosterSheet(title, chores, membersBySession, event) {
  const ws = XLSX.utils.aoa_to_sheet(buildRosterAoa(title, chores, membersBySession, event))
  ws['!cols'] = ROSTER_COLS
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 2 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: 1 } },
    { s: { r: 2, c: 2 }, e: { r: 2, c: 3 } },
    { s: { r: 6, c: 0 }, e: { r: 7, c: 0 } },
    { s: { r: 6, c: 1 }, e: { r: 7, c: 1 } },
    { s: { r: 6, c: 2 }, e: { r: 7, c: 2 } },
    { s: { r: 6, c: 3 }, e: { r: 7, c: 3 } },
    { s: { r: 6, c: 4 }, e: { r: 6, c: 5 } },
    { s: { r: 6, c: 6 }, e: { r: 7, c: 6 } },
    { s: { r: 6, c: 7 }, e: { r: 7, c: 7 } },
    { s: { r: 6, c: 8 }, e: { r: 7, c: 8 } },
    { s: { r: 6, c: 9 }, e: { r: 7, c: 9 } },
    { s: { r: 6, c: 10 }, e: { r: 7, c: 10 } },
    { s: { r: 6, c: 11 }, e: { r: 7, c: 11 } },
    { s: { r: 6, c: 12 }, e: { r: 7, c: 12 } },
  ]
  return ws
}

export default function ChoreArrangementDetailPage() {
  const { eventId } = useParams()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [event, setEvent]     = useState(null)
  const [sessionTab, setSessionTab] = useState('上午')

  const [choresBySession, setChoresBySession]   = useState({ 上午: [], 下午: [] })
  const [membersBySession, setMembersBySession] = useState({ 上午: [], 下午: [] })
  const [upCars, setUpCars] = useState([])

  const [importOpen, setImportOpen] = useState(false)
  const [autoAssigning, setAutoAssigning] = useState(false)
  const [lastSummaryBySession, setLastSummaryBySession] = useState({ 上午: null, 下午: null })
  const [expandedIds, setExpandedIds] = useState(new Set())
  const [copyMsg, setCopyMsg] = useState('')

  const [selectedRegIds, setSelectedRegIds] = useState(new Set())
  const [targetChoreId, setTargetChoreId] = useState(null)
  const [poolSearch, setPoolSearch] = useState('')
  const [poolCarFilter, setPoolCarFilter] = useState('')
  const [poolGenderFilter, setPoolGenderFilter] = useState('all')

  useEffect(() => { load() }, [eventId])

  // 切換時段時，先前的勾選與指派目標已不對應這個時段的坡務，一併清空
  useEffect(() => {
    setSelectedRegIds(new Set())
    setTargetChoreId(null)
  }, [sessionTab])

  async function load() {
    setLoading(true)
    const [{ events }, up, down, upMembers, downMembers, allMembersRes] = await Promise.all([
      getAllEvents({ excludeCanary: true }),
      getChoresByEventSession(eventId, '上午'),
      getChoresByEventSession(eventId, '下午'),
      getChoreMembersByEventSession(eventId, '上午'),
      getChoreMembersByEventSession(eventId, '下午'),
      getEventMembersWithGender(eventId),
    ])
    setEvent(events.find(e => e.event_id === eventId) ?? null)
    setChoresBySession({ 上午: up.chores, 下午: down.chores })
    setMembersBySession({ 上午: upMembers.members, 下午: downMembers.members })
    setUpCars(allMembersRes.members ?? [])
    setLoading(false)
  }

  const chores  = choresBySession[sessionTab] ?? []
  const members = membersBySession[sessionTab] ?? []

  const membersByChore = useMemo(() => {
    const m = {}
    for (const mem of members) {
      if (!m[mem.chore_id]) m[mem.chore_id] = []
      m[mem.chore_id].push(mem)
    }
    return m
  }, [members])

  const assignedRegIdsInSession = useMemo(() => new Set(members.map(m => m.registration_id)), [members])
  // upCars 現在是 getEventMembersWithGender 回傳的扁平名單（每人已帶 car_name，沒排大車的人是「自行前往」），不用再 flatMap
  const allUpMembers = upCars
  const availableToAssign = useMemo(
    () => allUpMembers.filter(m => !assignedRegIdsInSession.has(m.registration_id)),
    [allUpMembers, assignedRegIdsInSession]
  )

  // 即時計算「目前尚未排入這個時段任何坡務」的人，取代自動排坡當下的靜態快照，
  // 這樣手動加人/移除之後這份清單也會跟著即時更新，不會停留在上次自動排坡的結果
  const unassignedLive = useMemo(
    () => availableToAssign.map(m => ({
      ...m,
      reason: m.gender === 'unknown' ? '無性別資訊' : '尚未排入',
    })),
    [availableToAssign]
  )

  const summary = lastSummaryBySession[sessionTab]

  const carOptions = useMemo(() => [...new Set(upCars.map(m => m.car_name).filter(Boolean))], [upCars])

  const filteredPool = useMemo(() => {
    const kw = poolSearch.trim()
    return unassignedLive.filter(m => {
      if (kw && !m.name?.includes(kw) && !m.car_name?.includes(kw)) return false
      if (poolCarFilter && m.car_name !== poolCarFilter) return false
      if (poolGenderFilter !== 'all' && m.gender !== poolGenderFilter) return false
      return true
    })
  }, [unassignedLive, poolSearch, poolCarFilter, poolGenderFilter])

  const allFilteredSelected = filteredPool.length > 0 && filteredPool.every(m => selectedRegIds.has(m.registration_id))

  const targetChore = chores.find(c => c.chore_id === targetChoreId)
  const targetChoreName = targetChore ? (targetChore.unit || targetChore.work_content || '（未命名坡務）') : ''

  function toggleRegSelect(registrationId) {
    setSelectedRegIds(prev => {
      const next = new Set(prev)
      if (next.has(registrationId)) next.delete(registrationId)
      else next.add(registrationId)
      return next
    })
  }

  function toggleSelectAllFiltered(checked) {
    setSelectedRegIds(prev => {
      const next = new Set(prev)
      for (const m of filteredPool) {
        if (checked) next.add(m.registration_id)
        else next.delete(m.registration_id)
      }
      return next
    })
  }

  function toggleExpand(choreId) {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(choreId)) next.delete(choreId)
      else next.add(choreId)
      return next
    })
  }

  async function handleAutoAssign() {
    if (chores.length === 0) { alert('此時段尚無坡務資料，請先匯入坡務表'); return }
    if (!window.confirm(`這會清空目前「${sessionTab}」時段的排坡結果重新分配，確定要繼續嗎？`)) return
    setAutoAssigning(true)
    const { success, summary: s, unassigned, error } = await autoAssignChores(eventId, sessionTab)
    setAutoAssigning(false)
    if (!success) { alert('自動排坡失敗：' + error); return }
    setLastSummaryBySession(prev => ({ ...prev, [sessionTab]: { summary: s, unassigned } }))
    await load()
  }

  async function handleBatchAssign() {
    if (selectedRegIds.size === 0 || !targetChoreId) return
    const registrationIds = [...selectedRegIds]
    const { success, rows, error } = await batchAssignMembers(targetChoreId, registrationIds)
    if (!success) { alert('指派失敗：' + error); return }

    const regMap = Object.fromEntries(allUpMembers.map(m => [m.registration_id, m]))
    const newMembers = rows.map(row => {
      const src = regMap[row.registration_id] || {}
      return {
        id: row.id,
        chore_id: row.chore_id,
        registration_id: row.registration_id,
        name: src.name,
        gender: src.gender,
        phone: src.phone || '',
        car_name: src.car_name,
      }
    })
    const assignedIds = new Set(registrationIds)
    setMembersBySession(prev => ({
      ...prev,
      [sessionTab]: [...(prev[sessionTab] || []).filter(m => !assignedIds.has(m.registration_id)), ...newMembers],
    }))
    setSelectedRegIds(new Set())
  }

  async function handleRemove(memberId) {
    const { success, error } = await removeMember(memberId)
    if (!success) { alert('移除失敗：' + error); return }
    setMembersBySession(prev => ({
      ...prev,
      [sessionTab]: (prev[sessionTab] || []).filter(m => m.id !== memberId),
    }))
  }

  function copyLink(token) {
    const url = `${window.location.origin}/chore-checkin/${token}`
    navigator.clipboard.writeText(url).then(() => {
      setCopyMsg('小組長連結已複製')
      setTimeout(() => setCopyMsg(''), 2500)
    })
  }

  // 每張分坡工作表版面固定：左欄 5 項（A/B 欄）、右欄 4 項（D/E 欄，C 欄留空隔開）、
  // 空一列後接學員名單標題列（A7~E7）。標籤儲存格座標對所有 sheet 都一樣。
  const CHORE_SHEET_LABEL_CELLS = ['A1', 'A2', 'A3', 'A4', 'A5', 'D1', 'D2', 'D3', 'D4', 'A7', 'B7', 'C7', 'D7', 'E7']

  function handleExport() {
    const allChores = [...(choresBySession['上午'] || []), ...(choresBySession['下午'] || [])]
    if (allChores.length === 0) { alert('沒有坡務資料可匯出'); return }
    const safeSheetName = name => String(name || '坡務').replace(/[:\\/?*[\]]/g, '').slice(0, 31)

    const wb = XLSX.utils.book_new()
    const usedNames = new Set()
    for (const chore of allChores) {
      const mems = (membersBySession[chore.session] || []).filter(m => m.chore_id === chore.chore_id)
      const workTime    = (chore.session === '上午' ? event?.chore_am_work_time : event?.chore_pm_work_time) || ''
      const checkinTime = (chore.session === '上午' ? event?.chore_am_checkin_time : event?.chore_pm_checkin_time) || ''

      // 左欄（A/B）5 項、右欄（D/E）4 項，C 欄留空隔開
      const leftItems = [
        ['報到時間', checkinTime],
        ['出坡時間', workTime],
        ['單位', chore.unit || ''],
        ['精舍小組長', chore.leader_name || ''],
        ['小組長電話', chore.leader_phone || ''],
      ]
      const rightItems = [
        ['坡務內容', chore.work_content || ''],
        ['集合地點', chore.location || ''],
        ['負責法師', chore.supervising_monk || ''],
        ['負責法師電話', chore.supervising_monk_phone || ''],
      ]
      const infoRows = []
      for (let i = 0; i < Math.max(leftItems.length, rightItems.length); i++) {
        const row = []
        if (leftItems[i]) { row[0] = leftItems[i][0]; row[1] = leftItems[i][1] }
        if (rightItems[i]) { row[3] = rightItems[i][0]; row[4] = rightItems[i][1] }
        infoRows.push(row)
      }
      infoRows.push([])
      infoRows.push(['序號', '姓名', '電話', '性別', '上山車次'])
      mems.forEach((m, i) => infoRows.push([i + 1, m.name, m.phone || '', genderLabel(m.gender), m.car_name || '']))

      const ws = XLSX.utils.aoa_to_sheet(infoRows)
      ws['!cols'] = [
        { wch: 14 }, // 序號 / 標籤欄
        { wch: 20 }, // 姓名 / 集合地點、坡務內容等內容欄
        { wch: 14 }, // 電話
        { wch: 8 },  // 性別
        { wch: 16 }, // 上山車次
      ]
      let base = safeSheetName(`${chore.session}${chore.unit || chore.work_content || '坡務'}`)
      let name = base, n = 1
      while (usedNames.has(name)) { name = safeSheetName(`${base}${n++}`) }
      usedNames.add(name)
      XLSX.utils.book_append_sheet(wb, ws, name)
    }
    saveWorkbookWithBorders(wb, `${event?.name ?? '活動'}_分坡名單.xlsx`, CHORE_SHEET_LABEL_CELLS)
  }

  // 匯出總表：小組長分頁（各自負責的坡務）+ 總領隊分頁（全部坡務彙整）
  function handleExportRoster() {
    const allChores = [...(choresBySession['上午'] || []), ...(choresBySession['下午'] || [])]
    if (allChores.length === 0) { alert('沒有坡務資料可匯出'); return }
    const safeSheetName = name => String(name || '分頁').replace(/[:\\/?*[\]]/g, '').slice(0, 31)

    const wb = XLSX.utils.book_new()
    const usedNames = new Set()
    const addSheet = (title, chores) => {
      const ws = buildRosterSheet(title, chores, membersBySession, event)
      let base = safeSheetName(title), name = base, n = 1
      while (usedNames.has(name)) { name = safeSheetName(`${base}${n++}`) }
      usedNames.add(name)
      XLSX.utils.book_append_sheet(wb, ws, name)
    }

    const leaderNames = [...new Set(allChores.map(c => c.leader_name).filter(Boolean))]
    for (const leaderName of leaderNames) {
      addSheet(`小組長 ${leaderName}`, allChores.filter(c => c.leader_name === leaderName))
    }
    addSheet('總領隊總表', allChores)

    saveWorkbookWithBorders(wb, `${event?.name ?? '活動'}_坡務總表.xlsx`, {
      labelCells: ROSTER_LABEL_CELLS,
      highlightCells: ROSTER_HIGHLIGHT_CELLS,
    })
  }

  if (loading) return <AdminLayout><div className="text-center py-20 text-gray-400">載入中…</div></AdminLayout>

  return (
    <AdminLayout>
      <div className="space-y-6 pb-24">

        {/* 頁首 */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <button
              onClick={() => navigate('/admin/chore-arrangement')}
              className="text-sm text-amber-700 hover:underline mb-1 block"
            >
              ← 返回活動列表
            </button>
            <h1 className="text-xl font-bold text-gray-800">{event?.name ?? '載入中…'}</h1>
            <p className="text-sm text-gray-400">排坡系統</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5">
              <StepBadge num={2} />
              <button
                onClick={() => setImportOpen(true)}
                className="px-3 py-2 text-sm border rounded-lg hover:bg-gray-100 transition-colors"
              >
                📤 匯入坡務表
              </button>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <StepBadge num={4} />
              <button
                onClick={handleExport}
                disabled={chores.length === 0 && (choresBySession['上午'].length === 0 && choresBySession['下午'].length === 0)}
                className="px-3 py-2 text-sm border rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-40"
              >
                📥 匯出分坡名單
              </button>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <StepBadge num={4} />
              <button
                onClick={handleExportRoster}
                disabled={choresBySession['上午'].length === 0 && choresBySession['下午'].length === 0}
                className="px-3 py-2 text-sm border rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-40"
              >
                📊 匯出總表
              </button>
            </span>
          </div>
        </div>

        {/* 排坡流程步驟指引 */}
        <StepGuide importIncomplete={chores.length === 0} />

        {/* 時段 Tab */}
        <div className="flex gap-2 border-b">
          {SESSIONS.map(s => {
            const active = sessionTab === s.key
            const cnt = choresBySession[s.key]?.length ?? 0
            return (
              <button
                key={s.key}
                onClick={() => setSessionTab(s.key)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                  active ? 'border-amber-500 text-amber-700' : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {s.emoji} {s.label}
                {cnt > 0 && <span className="ml-2 text-xs text-gray-400">（{cnt} 項坡務）</span>}
              </button>
            )
          })}
        </div>

        {/* 出坡時間／報到時間（依目前選中的時段顯示，沒有資料就不顯示） */}
        {(() => {
          const work = sessionTab === '上午' ? event?.chore_am_work_time : event?.chore_pm_work_time
          const checkin = sessionTab === '上午' ? event?.chore_am_checkin_time : event?.chore_pm_checkin_time
          if (!work && !checkin) return null
          return (
            <div className="text-sm text-gray-600">
              🕐 {work && <>出坡時間 {work}</>}{work && checkin && '　'}{checkin && <>報到時間 {checkin}</>}
            </div>
          )
        })()}

        {/* 自動排坡列 */}
        <div className="flex items-center gap-3 flex-wrap">
          <span className="inline-flex items-center gap-1.5">
            <StepBadge num={3} />
            <button
              onClick={handleAutoAssign}
              disabled={autoAssigning}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50"
            >
              {autoAssigning ? '排坡中…' : '✨ 自動排坡'}
            </button>
          </span>
          <span className="text-xs text-gray-400">
            依上山車輛順序，儘量讓同車的人排進同一坡務，滿了才換下一個（男女配額分開計算；重排前會先清空此時段目前的分配）
          </span>
        </div>

        {/* 自動排坡結果摘要 */}
        {summary && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm">
            <div className="font-semibold text-blue-800 mb-1.5">自動排坡完成</div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-blue-700 text-xs">
              {summary.summary.map(s => (
                <span key={s.chore_id}>
                  {s.unit || s.work_content || '（未命名坡務）'}：男 {s.assigned_male}/{s.quota_male ?? 0}、女 {s.assigned_female}/{s.quota_female ?? 0}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* 批次勾選面板 + 坡務卡片 */}
        <div className="flex flex-col lg:flex-row gap-4 items-start">

          {/* 左側：未排入名單，批次勾選面板 */}
          <div className="w-full lg:w-96 lg:shrink-0 bg-white border rounded-xl shadow-sm overflow-hidden flex flex-col" style={{ maxHeight: 640 }}>
            <div className="px-3 py-2.5 border-b bg-gray-50 space-y-2">
              <div className="flex items-center gap-1.5 font-semibold text-sm text-gray-700">
                <StepBadge num={3} />
                未排入名單（{unassignedLive.length} 人）
              </div>
              <input
                type="text"
                value={poolSearch}
                onChange={e => setPoolSearch(e.target.value)}
                placeholder="搜尋姓名或車次"
                className="w-full text-sm border rounded-lg px-2 py-1.5"
              />
              <div className="flex gap-2">
                <select
                  value={poolCarFilter}
                  onChange={e => setPoolCarFilter(e.target.value)}
                  className="flex-1 min-w-0 text-xs border rounded-lg px-1.5 py-1"
                >
                  <option value="">全部車次</option>
                  {carOptions.map(car => <option key={car} value={car}>{car}</option>)}
                </select>
                <div className="flex border rounded-lg overflow-hidden text-xs shrink-0">
                  {[['all', '全部'], ['male', '男'], ['female', '女']].map(([val, label]) => (
                    <button
                      key={val}
                      onClick={() => setPoolGenderFilter(val)}
                      className={`px-2 py-1 transition-colors ${poolGenderFilter === val ? 'bg-amber-500 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allFilteredSelected}
                  onChange={e => toggleSelectAllFiltered(e.target.checked)}
                />
                全選（目前篩選結果 {filteredPool.length} 人）
              </label>
            </div>

            <div className="flex-1 overflow-y-auto divide-y">
              {filteredPool.length === 0 ? (
                <div className="px-3 py-6 text-xs text-gray-400 text-center">沒有符合條件的人員</div>
              ) : (
                filteredPool.map(m => (
                  <label key={m.registration_id} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-amber-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedRegIds.has(m.registration_id)}
                      onChange={() => toggleRegSelect(m.registration_id)}
                    />
                    <span className="flex-1 min-w-0 truncate">{m.name}</span>
                    <span className="text-xs text-gray-400 shrink-0">{genderLabel(m.gender)}・{m.car_name}</span>
                  </label>
                ))
              )}
            </div>

            <div className="px-3 py-2.5 border-t bg-gray-50 space-y-1.5">
              <div className="text-xs text-gray-600">
                已勾選 <span className="font-semibold text-amber-700">{selectedRegIds.size}</span> 人 → 指派到：
                <span className="font-medium text-gray-800">{targetChoreName || '（請選擇坡務）'}</span>
              </div>
              <select
                value={targetChoreId || ''}
                onChange={e => setTargetChoreId(e.target.value || null)}
                className="w-full text-xs border rounded-lg px-2 py-1.5"
              >
                <option value="">選擇目標坡務…</option>
                {chores.map(c => (
                  <option key={c.chore_id} value={c.chore_id}>{c.unit || c.work_content || '（未命名坡務）'}</option>
                ))}
              </select>
              <button
                onClick={handleBatchAssign}
                disabled={selectedRegIds.size === 0 || !targetChoreId}
                className="w-full px-3 py-1.5 bg-amber-600 text-white text-sm rounded-lg hover:bg-amber-700 transition-colors font-medium disabled:opacity-40 disabled:cursor-not-allowed"
              >
                指派
              </button>
            </div>
          </div>

          {/* 右側：坡務卡片 */}
          <div className="flex-1 min-w-0 w-full">
            <div className="flex items-center gap-1.5 mb-2">
              <StepBadge num={3} />
              <h2 className="text-sm font-semibold text-gray-700">坡務卡片</h2>
            </div>
            {chores.length === 0 ? (
              <div className="text-sm text-gray-400 py-10 text-center border-2 border-dashed rounded-xl">
                尚未匯入坡務表，請點「📤 匯入坡務表」
              </div>
            ) : (
              <div className="space-y-3">
                {chores.map(chore => {
                  const mems = membersByChore[chore.chore_id] ?? []
                  const maleCount   = mems.filter(m => m.gender === 'male').length
                  const femaleCount = mems.filter(m => m.gender === 'female').length
                  const otherCount  = mems.length - maleCount - femaleCount
                  const maleOver   = maleCount > (chore.quota_male ?? 0)
                  const femaleOver = femaleCount > (chore.quota_female ?? 0)
                  const expanded = expandedIds.has(chore.chore_id)
                  const isTarget = targetChoreId === chore.chore_id
                  return (
                    <div
                      key={chore.chore_id}
                      onClick={() => setTargetChoreId(chore.chore_id)}
                      className={`bg-white border rounded-xl shadow-sm overflow-hidden cursor-pointer transition-shadow ${
                        isTarget ? 'ring-2 ring-amber-500' : 'hover:shadow-md'
                      }`}
                    >
                      <div className="px-4 py-3 bg-amber-50 border-b border-amber-200">
                        <div className="flex items-center gap-2 flex-wrap">
                          {isTarget && (
                            <span className="text-xs bg-amber-500 text-white rounded-full px-2 py-0.5 shrink-0">指派目標</span>
                          )}
                          <span className="font-semibold text-gray-800">{chore.unit || '（未填單位）'}</span>
                          <span className="text-sm text-gray-600">{chore.work_content}</span>
                          <span className="ml-auto text-xs">
                            <span className={maleOver ? 'text-red-600 font-bold' : 'text-gray-500'}>
                              男 {maleCount}/{chore.quota_male ?? 0}
                            </span>
                            <span className="mx-1.5 text-gray-300">|</span>
                            <span className={femaleOver ? 'text-red-600 font-bold' : 'text-gray-500'}>
                              女 {femaleCount}/{chore.quota_female ?? 0}
                            </span>
                            {otherCount > 0 && <span className="ml-1.5 text-gray-400">（另 {otherCount} 人無性別資訊）</span>}
                          </span>
                          {chore.access_token && (
                            <button
                              onClick={e => { e.stopPropagation(); copyLink(chore.access_token) }}
                              className="text-xs text-blue-600 hover:text-blue-800 hover:underline px-2 py-1 rounded hover:bg-blue-50 transition-colors shrink-0"
                            >
                              🔗 複製小組長連結
                            </button>
                          )}
                        </div>
                        <div className="mt-1.5 text-xs text-gray-500 flex flex-wrap gap-x-4 gap-y-0.5">
                          {chore.location && <span>📍 {chore.location}</span>}
                          {(chore.supervising_monk || chore.supervising_monk_phone) && (
                            <span>
                              🛕 負責法師：{chore.supervising_monk}
                              {chore.supervising_monk_phone && (
                                <> ・<a href={telHref(chore.supervising_monk_phone)} onClick={e => e.stopPropagation()} className="text-blue-600 hover:underline">{chore.supervising_monk_phone}</a></>
                              )}
                            </span>
                          )}
                          {(chore.leader_name || chore.leader_phone) && (
                            <span>
                              👤 小組長：{chore.leader_name}
                              {chore.leader_phone && (
                                <>（<a href={telHref(chore.leader_phone)} onClick={e => e.stopPropagation()} className="text-blue-600 hover:underline">{chore.leader_phone}</a>）</>
                              )}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="px-4 py-2.5 flex items-center gap-3 flex-wrap border-b bg-gray-50">
                        <button
                          onClick={e => { e.stopPropagation(); toggleExpand(chore.chore_id) }}
                          className="text-xs text-gray-500 hover:text-gray-700"
                        >
                          {expanded ? '▲ 收合名單' : `▼ 展開名單（${mems.length} 人）`}
                        </button>
                      </div>

                      {expanded && (
                        <div className="divide-y">
                          {mems.length === 0 ? (
                            <div className="px-4 py-3 text-xs text-gray-400">（尚無人員分配）</div>
                          ) : (
                            mems.map(m => (
                              <div key={m.id} className="flex items-center gap-2 px-4 py-2 text-sm">
                                <span className="flex-1 min-w-0 font-medium">{m.name}</span>
                                {m.phone && (
                                  <a href={telHref(m.phone)} onClick={e => e.stopPropagation()} className="text-xs text-blue-600 hover:underline shrink-0">{m.phone}</a>
                                )}
                                <span className="text-xs text-gray-400">{genderLabel(m.gender)}</span>
                                <span className="text-xs text-gray-400">{m.car_name}</span>
                                <button
                                  onClick={e => { e.stopPropagation(); handleRemove(m.id) }}
                                  className="text-red-400 hover:text-red-600 text-xs px-2"
                                >
                                  移除
                                </button>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {copyMsg && (
          <div className="fixed bottom-20 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-sm px-4 py-2 rounded-lg shadow-lg whitespace-nowrap z-50">
            ✓ {copyMsg}
          </div>
        )}
      </div>

      {importOpen && (
        <ChoreImportModal
          eventId={eventId}
          onImported={async () => {
            setImportOpen(false)
            await load()
          }}
          onClose={() => setImportOpen(false)}
        />
      )}
    </AdminLayout>
  )
}
