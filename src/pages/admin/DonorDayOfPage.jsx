import { useEffect, useMemo, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import AdminLayout from '../../components/AdminLayout'
import { getAllEvents, listEventDonorsForDayOf, updateEventDonorsDayOf } from '../../lib/supabase'
import { buildDonorMessage, buildTableRosterMessage, sendDonorNotifications } from '../../lib/donorNotify'

function eventDateLabel(ev) {
  if (!ev?.date_start) return ''
  if (ev.date_end && ev.date_end !== ev.date_start) return `${ev.date_start} ～ ${ev.date_end}`
  return ev.date_start
}

export default function DonorDayOfPage() {
  const { id } = useParams()
  const [event, setEvent] = useState(null)
  const [donors, setDonors] = useState([])
  const [loading, setLoading] = useState(true)

  // 每人是否勾選發送（預設：已綁定 LINE 的人預設勾選）
  const [selected, setSelected] = useState(new Set())
  // 本地編輯中的午齋桌次 / 桌長標記（donor_id → value）
  const [lunchDraft, setLunchDraft] = useState({})
  const [leaderDraft, setLeaderDraft] = useState({})

  const [view, setView] = useState('list') // 'list' | 'confirm' | 'result'
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState(null) // { success, results }

  const load = useCallback(async () => {
    setLoading(true)
    const [{ events }, { donors: d }] = await Promise.all([
      getAllEvents({ excludeCanary: true }),
      listEventDonorsForDayOf(id),
    ])
    const ev = (events || []).find(e => e.event_id === id)
    setEvent(ev || null)
    setDonors(d || [])
    setSelected(new Set((d || []).filter(x => x.lineBound).map(x => x.donor_id)))
    setLunchDraft(Object.fromEntries((d || []).map(x => [x.donor_id, x.lunch_table || ''])))
    setLeaderDraft(Object.fromEntries((d || []).map(x => [x.donor_id, !!x.is_table_leader])))
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  const lineBoundCount = donors.filter(d => d.lineBound).length
  const selectedCount = [...selected].filter(donorId => donors.find(d => d.donor_id === donorId)?.lineBound).length

  function toggleSelected(donorId, lineBound) {
    if (!lineBound) return
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(donorId)) {
        next.delete(donorId)
      } else {
        next.add(donorId)
      }
      return next
    })
  }

  function setLunch(donorId, value) {
    setLunchDraft(prev => ({ ...prev, [donorId]: value }))
  }

  function toggleLeader(donorId) {
    setLeaderDraft(prev => ({ ...prev, [donorId]: !prev[donorId] }))
  }

  // 依 lunch_table 分組——不論有沒有綁定 LINE、有沒有勾選發送都要算進桌次名單，
  // 因為桌長需要知道「全桌」有誰，未綁定 LINE 的人一樣要能被排進某一桌，
  // 只是他們自己收不到個人通知（那個限制在 handleConfirmSend 裡處理）
  const { groups, unassigned } = useMemo(() => {
    const g = new Map() // lunchTable → donor[]
    const un = []
    for (const d of donors) {
      const table = (lunchDraft[d.donor_id] || '').trim()
      if (!table) { un.push(d); continue }
      const arr = g.get(table) || []
      arr.push(d)
      g.set(table, arr)
    }
    return { groups: [...g.entries()], unassigned: un }
  }, [donors, lunchDraft])

  async function handleGoConfirm() {
    setSaving(true)
    const updates = donors.map(d => ({
      donor_id: d.donor_id,
      lunch_table: lunchDraft[d.donor_id] || '',
      is_table_leader: !!leaderDraft[d.donor_id],
    }))
    await updateEventDonorsDayOf(updates)
    setSaving(false)
    setView('confirm')
  }

  async function handleConfirmSend() {
    setSending(true)
    const eventName = event?.name || ''
    const dateLabel = eventDateLabel(event)
    const items = []

    for (const [table, members] of groups) {
      // 全桌名單（給桌長看的）要含全部人，不論有沒有綁定 LINE
      const names = members.map(m => m.name)
      for (const d of members) {
        // 個人通知／桌長名單都只能發給「已綁定 LINE 且勾選發送」的人，
        // 未綁定 LINE 的人只會出現在 names 名單裡，自己收不到任何訊息
        const canReceive = d.lineBound && selected.has(d.donor_id)
        if (!canReceive) continue

        const personalMsg = buildDonorMessage({
          eventName,
          eventDateLabel: dateLabel,
          donorName: d.name,
          carName: d.carName,
          photoWave: d.answers?.photo_wave,
          lunchTable: table,
          note: d.answers?.donor_note,
        })
        items.push({ donor_id: d.donor_id, student_id: d.student_id, name: d.name, message_text: personalMsg })

        if (leaderDraft[d.donor_id]) {
          const rosterMsg = buildTableRosterMessage({ eventName, lunchTable: table, names })
          items.push({ donor_id: d.donor_id, student_id: d.student_id, name: d.name, message_text: rosterMsg })
        }
      }
    }

    const res = await sendDonorNotifications({ eventId: id, items })
    setSending(false)
    setSendResult(res)
    setView('result')
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
        <Link to="/admin/events" className="hover:text-orange-700">活動管理</Link>
        <span>/</span>
        <Link to={`/admin/events/${id}`} className="hover:text-orange-700">{event?.name || '活動'}</Link>
        <span>/</span>
        <span className="text-gray-800 font-medium">📅 當天資訊管理</span>
      </div>

      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-gray-800">📅 當天資訊管理</h2>
        <Link to={`/admin/events/${id}`} className="text-sm text-gray-500 hover:text-orange-700">← 返回活動</Link>
      </div>

      {view === 'list' && (
        <>
          <div className="bg-orange-50 border border-orange-200 rounded-xl px-4 py-3 mb-4 text-sm text-orange-800 sticky top-0 z-10">
            已勾選發送 <span className="font-bold">{selectedCount}</span> / 已綁定 LINE <span className="font-bold">{lineBoundCount}</span> 位
          </div>

          {donors.length === 0 ? (
            <p className="text-center text-gray-400 py-12 text-sm">尚無功德主名單，請先到「功德主管理」新增或匯入</p>
          ) : (
            <div className="space-y-3 pb-28">
              {donors.map(d => {
                const isSelected = selected.has(d.donor_id)
                const disabled = !d.lineBound
                return (
                  <div
                    key={d.donor_id}
                    className={`rounded-2xl border p-4 shadow-sm transition-colors ${
                      disabled ? 'bg-gray-50 border-gray-200' : 'bg-white border-orange-200'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <label className={`flex items-start gap-3 min-w-0 flex-1 ${disabled ? '' : 'cursor-pointer'}`}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          disabled={disabled}
                          onChange={() => toggleSelected(d.donor_id, d.lineBound)}
                          className="w-5 h-5 mt-0.5 accent-orange-600 shrink-0"
                        />
                        <div className={`min-w-0 ${disabled ? 'opacity-60' : ''}`}>
                          <p className="text-base font-bold text-gray-800 truncate">
                            {d.name}
                            {!d.lineBound && (
                              <span className="ml-2 text-xs font-normal text-gray-400">（未綁定 LINE，僅記錄桌次，本人收不到通知）</span>
                            )}
                          </p>
                          {d.answers?.photo_wave && (
                            <span className="inline-block mt-1 text-xs bg-blue-100 text-blue-700 rounded-full px-2 py-0.5">
                              📷 合影波次：{d.answers.photo_wave}
                            </span>
                          )}
                        </div>
                      </label>
                      {d.carName && (
                        <span className="shrink-0 text-xs bg-emerald-100 text-emerald-700 rounded-full px-2 py-1 whitespace-nowrap">
                          🚌 {d.carName}
                        </span>
                      )}
                    </div>

                    <div className="mt-3 pl-8 space-y-2">
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">午齋桌次</label>
                        <input
                          value={lunchDraft[d.donor_id] ?? ''}
                          onChange={e => setLunch(d.donor_id, e.target.value)}
                          placeholder="例：3 桌"
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-orange-300"
                        />
                      </div>
                      <label className={`inline-flex items-center gap-2 text-sm ${isSelected ? 'text-gray-700 cursor-pointer' : 'text-gray-300'}`}>
                        <input
                          type="checkbox"
                          checked={!!leaderDraft[d.donor_id]}
                          disabled={!isSelected}
                          onChange={() => toggleLeader(d.donor_id)}
                          className="w-4 h-4 accent-orange-600"
                        />
                        設為此桌桌長（另發全桌名單）
                      </label>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {donors.length > 0 && (
            <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-3 shadow-[0_-2px_8px_rgba(0,0,0,0.06)]">
              <button
                onClick={handleGoConfirm}
                disabled={saving || selectedCount === 0}
                className="w-full bg-orange-600 hover:bg-orange-700 text-white text-base font-semibold py-3 rounded-xl transition-colors disabled:opacity-50"
              >
                {saving ? '處理中…' : `發送當天通知（已勾選 ${selectedCount} 位）`}
              </button>
            </div>
          )}
        </>
      )}

      {view === 'confirm' && (
        <div className="pb-28">
          <p className="text-sm text-gray-600 mb-4">請確認以下發送內容，確認後才會真正送出：</p>

          {groups.length === 0 && (
            <p className="text-center text-gray-400 py-8 text-sm">目前沒有「已填桌次」的功德主，請返回修改</p>
          )}

          <div className="space-y-3">
            {groups.map(([table, members]) => {
              const leaders = members.filter(m => leaderDraft[m.donor_id]).map(m => m.name)
              // 只有「已綁定 LINE 且勾選發送」的人才會收到自己的個人通知，這裡預覽的是他們各自會收到的內容
              const recipients = members.filter(m => m.lineBound && selected.has(m.donor_id))
              const allNames = members.map(m => m.name)
              return (
                <div key={table} className="bg-white border border-orange-200 rounded-2xl p-4">
                  <div className="space-y-2">
                    {recipients.map(m => (
                      <div key={m.donor_id} className="text-sm text-gray-700 border-b border-gray-100 last:border-0 pb-2 last:pb-0">
                        <p className="font-medium text-gray-800">{m.name}</p>
                        {m.carName && <p className="text-gray-500">🚌 車次：{m.carName}</p>}
                        {m.answers?.photo_wave && <p className="text-gray-500">📷 合影波次：{m.answers.photo_wave}</p>}
                        <p className="text-gray-500">🍱 午齋桌次：{table}</p>
                      </div>
                    ))}
                  </div>
                  <p className="text-sm text-gray-700 mt-2">
                    第 {table} 桌（{members.length} 位） {allNames.join('、')}
                  </p>
                  {leaders.length > 0 ? (
                    <p className="text-sm text-emerald-700 mt-2">桌長：{leaders.join('、')}</p>
                  ) : (
                    <p className="text-sm text-amber-600 mt-2">⚠️ 尚未指定桌長</p>
                  )}
                </div>
              )
            })}
          </div>

          {unassigned.length > 0 && (
            <div className="mt-4 bg-gray-50 border border-gray-200 rounded-2xl p-4">
              <p className="text-sm font-semibold text-gray-600 mb-1">已勾選但尚未填桌次（不會發送）</p>
              <p className="text-sm text-gray-500">{unassigned.map(m => m.name).join('、')}</p>
            </div>
          )}

          <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-3 shadow-[0_-2px_8px_rgba(0,0,0,0.06)] flex gap-3">
            <button
              onClick={() => setView('list')}
              className="flex-1 border border-gray-300 text-gray-700 text-base font-medium py-3 rounded-xl hover:bg-gray-50 transition-colors"
            >
              返回修改
            </button>
            <button
              onClick={handleConfirmSend}
              disabled={sending || groups.length === 0}
              className="flex-1 bg-orange-600 hover:bg-orange-700 text-white text-base font-semibold py-3 rounded-xl transition-colors disabled:opacity-50"
            >
              {sending ? '發送中…' : '確認發送'}
            </button>
          </div>
        </div>
      )}

      {view === 'result' && sendResult && (
        <div className="pb-8">
          {!sendResult.success ? (
            <p className="text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm">
              ❌ 發送失敗：{sendResult.error}
            </p>
          ) : (() => {
            const results = sendResult.results || []
            const sentCount = results.filter(r => r.sent).length
            const skippedCount = results.filter(r => r.skipped).length
            const failedCount = results.filter(r => r.failed).length
            const failedNames = results.filter(r => r.failed).map(r => r.name)
            return (
              <div className="bg-white border border-gray-200 rounded-2xl p-5">
                <p className="text-base font-bold text-gray-800 mb-3">發送結果</p>
                <p className="text-sm text-gray-700">
                  ✅ 成功 {sentCount} 則　⬜ 未綁定跳過 {skippedCount} 則
                  {failedCount > 0 && <span className="text-red-600">　❌ 失敗 {failedCount} 則</span>}
                </p>
                {failedNames.length > 0 && (
                  <p className="text-sm text-red-600 mt-2">失敗名單：{failedNames.join('、')}</p>
                )}
              </div>
            )
          })()}

          <button
            onClick={() => { setView('list'); load() }}
            className="mt-4 w-full border border-gray-300 text-gray-700 text-base font-medium py-3 rounded-xl hover:bg-gray-50 transition-colors"
          >
            返回列表
          </button>
        </div>
      )}
    </AdminLayout>
  )
}
