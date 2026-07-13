import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import * as XLSX from '@e965/xlsx'
import AdminLayout from '../../components/AdminLayout'
import SearchableSelect from '../../components/SearchableSelect'
import { getAllEvents } from '../../lib/supabase'
import {
  getChoresByEventSession,
  getChoreMembersByEventSession,
  getUpCarMembersWithGender,
  autoAssignChores,
  manualAssignMember,
  removeMember,
} from '../../lib/choreAssignment'
import ChoreImportModal from '../../components/ChoreImportModal'

const SESSIONS = [
  { key: '上午', label: '上午', emoji: '🌅' },
  { key: '下午', label: '下午', emoji: '🌇' },
]

const genderLabel = g => g === 'male' ? '男' : g === 'female' ? '女' : '未知'
const telHref = phone => `tel:${String(phone).replace(/[\s-]/g, '')}`

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

  useEffect(() => { load() }, [eventId])

  async function load() {
    setLoading(true)
    const [{ events }, up, down, upMembers, downMembers, cars] = await Promise.all([
      getAllEvents(),
      getChoresByEventSession(eventId, '上午'),
      getChoresByEventSession(eventId, '下午'),
      getChoreMembersByEventSession(eventId, '上午'),
      getChoreMembersByEventSession(eventId, '下午'),
      getUpCarMembersWithGender(eventId),
    ])
    setEvent(events.find(e => e.event_id === eventId) ?? null)
    setChoresBySession({ 上午: up.chores, 下午: down.chores })
    setMembersBySession({ 上午: upMembers.members, 下午: downMembers.members })
    setUpCars(cars.cars ?? [])
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
  const allUpMembers = useMemo(() => upCars.flatMap(c => c.members.map(m => ({ ...m, car_name: c.car_name }))), [upCars])
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

  async function handleManualAssign(choreId, registrationId) {
    if (!registrationId) return
    const { success, error } = await manualAssignMember(choreId, registrationId)
    if (!success) { alert('加入失敗：' + error); return }
    await load()
  }

  async function handleRemove(memberId) {
    const { success, error } = await removeMember(memberId)
    if (!success) { alert('移除失敗：' + error); return }
    await load()
  }

  function copyLink(token) {
    const url = `${window.location.origin}/chore-checkin/${token}`
    navigator.clipboard.writeText(url).then(() => {
      setCopyMsg('小組長連結已複製')
      setTimeout(() => setCopyMsg(''), 2500)
    })
  }

  function handleExport() {
    const allChores = [...(choresBySession['上午'] || []), ...(choresBySession['下午'] || [])]
    if (allChores.length === 0) { alert('沒有坡務資料可匯出'); return }
    const safeSheetName = name => String(name || '坡務').replace(/[:\\/?*[\]]/g, '').slice(0, 31)

    const wb = XLSX.utils.book_new()
    const usedNames = new Set()
    for (const chore of allChores) {
      const mems = (membersBySession[chore.session] || []).filter(m => m.chore_id === chore.chore_id)
      const infoRows = [
        ['時段', chore.session],
        ['單位', chore.unit || ''],
        ['坡務內容', chore.work_content || ''],
        ['集合地點', chore.location || ''],
        ['負責法師', chore.supervising_monk || ''],
        ['負責法師電話', chore.supervising_monk_phone || ''],
        ['精舍小組長', chore.leader_name || ''],
        ['精舍小組長電話', chore.leader_phone || ''],
        [],
        ['序號', '姓名', '電話', '性別', '上山車次'],
      ]
      mems.forEach((m, i) => infoRows.push([i + 1, m.name, m.phone || '', genderLabel(m.gender), m.car_name || '']))
      const ws = XLSX.utils.aoa_to_sheet(infoRows)
      let base = safeSheetName(`${chore.session}${chore.unit || chore.work_content || '坡務'}`)
      let name = base, n = 1
      while (usedNames.has(name)) { name = safeSheetName(`${base}${n++}`) }
      usedNames.add(name)
      XLSX.utils.book_append_sheet(wb, ws, name)
    }
    XLSX.writeFile(wb, `${event?.name ?? '活動'}_分坡名單.xlsx`)
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
            <button
              onClick={() => setImportOpen(true)}
              className="px-3 py-2 text-sm border rounded-lg hover:bg-gray-100 transition-colors"
            >
              📤 匯入坡務表
            </button>
            <button
              onClick={handleExport}
              disabled={chores.length === 0 && (choresBySession['上午'].length === 0 && choresBySession['下午'].length === 0)}
              className="px-3 py-2 text-sm border rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-40"
            >
              📥 匯出分坡名單
            </button>
          </div>
        </div>

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

        {/* 自動排坡列 */}
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={handleAutoAssign}
            disabled={autoAssigning}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50"
          >
            {autoAssigning ? '排坡中…' : '✨ 自動排坡'}
          </button>
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

        {/* 即時未排入名單：不只自動排坡後才顯示，手動加人/移除後也會跟著更新 */}
        {unassignedLive.length > 0 && (
          <div className="bg-red-50 border border-red-300 rounded-lg px-3 py-2 text-sm">
            <div className="font-semibold text-red-700 text-xs mb-1">⚠️ 未排入（{unassignedLive.length} 人），請手動處理：</div>
            <div className="flex flex-wrap gap-1.5">
              {unassignedLive.map(m => (
                <span key={m.registration_id} className="text-xs bg-white border border-red-200 text-red-700 rounded-full px-2 py-0.5">
                  {m.name}（{m.car_name}・{m.reason}）
                </span>
              ))}
            </div>
          </div>
        )}

        {/* 坡務卡片 */}
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
              return (
                <div key={chore.chore_id} className="bg-white border rounded-xl shadow-sm overflow-hidden">
                  <div className="px-4 py-3 bg-amber-50 border-b border-amber-200">
                    <div className="flex items-center gap-2 flex-wrap">
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
                          onClick={() => copyLink(chore.access_token)}
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
                            <> ・<a href={telHref(chore.supervising_monk_phone)} className="text-blue-600 hover:underline">{chore.supervising_monk_phone}</a></>
                          )}
                        </span>
                      )}
                      {(chore.leader_name || chore.leader_phone) && (
                        <span>
                          👤 小組長：{chore.leader_name}
                          {chore.leader_phone && (
                            <>（<a href={telHref(chore.leader_phone)} className="text-blue-600 hover:underline">{chore.leader_phone}</a>）</>
                          )}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="px-4 py-2.5 flex items-center gap-3 flex-wrap border-b bg-gray-50">
                    <button
                      onClick={() => toggleExpand(chore.chore_id)}
                      className="text-xs text-gray-500 hover:text-gray-700"
                    >
                      {expanded ? '▲ 收合名單' : `▼ 展開名單（${mems.length} 人）`}
                    </button>
                    <div className="ml-auto w-full sm:w-64">
                      <SearchableSelect
                        value=""
                        onChange={rid => handleManualAssign(chore.chore_id, rid)}
                        placeholder="＋ 加入學員"
                        options={availableToAssign.map(m => ({
                          value: m.registration_id,
                          label: m.name,
                          sublabel: `${genderLabel(m.gender)}・${m.car_name}`,
                          searchText: `${m.name} ${m.car_name}`,
                        }))}
                      />
                    </div>
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
                              <a href={telHref(m.phone)} className="text-xs text-blue-600 hover:underline shrink-0">{m.phone}</a>
                            )}
                            <span className="text-xs text-gray-400">{genderLabel(m.gender)}</span>
                            <span className="text-xs text-gray-400">{m.car_name}</span>
                            <button
                              onClick={() => handleRemove(m.id)}
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
