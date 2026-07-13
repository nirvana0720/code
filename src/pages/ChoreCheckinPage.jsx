// 坡務小組長免登入查詢頁（純顯示，不需登入，用 token 驗身）
import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { getChoreByToken } from '../lib/supabase'
import { formatDate } from '../lib/checkinHelpers'

function genderOf(groupName) {
  if (!groupName) return '未知'
  if (groupName.includes('女')) return '女'
  if (groupName.includes('男')) return '男'
  return '未知'
}

export default function ChoreCheckinPage() {
  const { token } = useParams()
  const [loading, setLoading] = useState(true)
  const [chore, setChore]     = useState(null)

  useEffect(() => {
    getChoreByToken(token).then(({ chore }) => {
      setChore(chore)
      setLoading(false)
    })
  }, [token])

  if (loading) return (
    <div className="min-h-screen bg-amber-50 flex items-center justify-center">
      <div className="text-amber-700 text-xl animate-pulse">載入中…</div>
    </div>
  )

  if (!chore) return (
    <div className="min-h-screen bg-amber-50 flex items-center justify-center p-8">
      <div className="text-center">
        <div className="text-5xl mb-4">🔒</div>
        <div className="text-xl font-semibold text-gray-700 mb-2">連結無效或已過期</div>
        <div className="text-gray-500 text-sm">請向師父索取正確的坡務連結</div>
      </div>
    </div>
  )

  const members   = chore.members ?? []
  const eventName = chore.events?.name ?? ''
  const eventDate = formatDate(chore.events?.date_start)

  return (
    <div className="min-h-screen bg-amber-50 pb-16">
      {/* Header */}
      <div className="bg-amber-700 text-white px-4 py-5 shadow-md">
        <div className="max-w-lg mx-auto">
          <div className="text-xs opacity-75 mb-0.5">{eventName}　{eventDate}</div>
          <div className="text-xl font-bold flex items-center gap-2 flex-wrap">
            <span>{chore.session === '上午' ? '🌅' : '🌇'} {chore.session}・{chore.unit || '坡務'}</span>
          </div>
          {chore.work_content && <div className="text-sm opacity-90 mt-1">{chore.work_content}</div>}
        </div>
      </div>

      <div className="px-4 pt-4 max-w-lg mx-auto space-y-3">
        {/* 坡務基本資訊 */}
        <div className="bg-white rounded-xl shadow-sm border px-4 py-3 text-sm space-y-1.5">
          {chore.location && <div>📍 集合地點：<strong>{chore.location}</strong></div>}
          {chore.supervising_monk && <div>🛕 負責法師：{chore.supervising_monk}</div>}
          {(chore.leader_name || chore.leader_phone) && (
            <div>👤 精舍小組長：{chore.leader_name}{chore.leader_phone ? `（${chore.leader_phone}）` : ''}</div>
          )}
        </div>

        {/* 學員名單 */}
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <div className="px-4 py-2.5 bg-gray-50 border-b text-sm font-semibold text-gray-700">
            出坡學員名單（{members.length} 人）
          </div>
          <div className="divide-y">
            {members.length === 0 ? (
              <div className="px-4 py-6 text-sm text-gray-400 text-center">尚無人員分配</div>
            ) : (
              members.map(m => (
                <div key={m.registration_id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="flex-1 min-w-0 font-medium text-gray-800">{m.name}</span>
                  <span className="text-xs text-gray-400 shrink-0">{genderOf(m.group_name)}</span>
                  <span className="text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-2 py-0.5 shrink-0">
                    {m.car_name || '（未排車）'}
                  </span>
                </div>
              ))
            )}
          </div>
          <div className="px-4 py-2 text-xs text-gray-400 bg-gray-50 border-t">
            出坡結束後請協助帶回上方標示的車次
          </div>
        </div>
      </div>
    </div>
  )
}
