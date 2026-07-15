// 領隊報到頁「寮區」「坡務」頁籤共用的分組排序邏輯（唯讀顯示，不含報到互動）
import { getMemberName, getMemberClasses } from './checkinHelpers'
import { deriveGenderFromClasses } from './choreAssignment'

const byNameZhTW = (a, b) => getMemberName(a).localeCompare(getMemberName(b), 'zh-TW', { numeric: true })

/**
 * 依 registrations.dormitory_room 分組：同寮房排在一起，組標題「房號（人數）」，
 * 組內依姓名排序；沒有寮房資料的人獨立歸一組「未分配」放最後。
 * 回傳：[{ key, label, members }]，依房號排序（未分配固定最後）
 */
export function groupMembersByDormitory(members) {
  const byRoom = new Map()
  const unassigned = []

  for (const m of members) {
    const room = m.registrations?.dormitory_room?.trim()
    if (!room) { unassigned.push(m); continue }
    if (!byRoom.has(room)) byRoom.set(room, [])
    byRoom.get(room).push(m)
  }

  const result = [...byRoom.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'zh-TW', { numeric: true }))
    .map(([room, list]) => ({
      key: room,
      label: `${room}（${list.length}人）`,
      members: [...list].sort(byNameZhTW),
    }))

  if (unassigned.length > 0) {
    result.push({
      key: '__unassigned__',
      label: `未分配（${unassigned.length}人）`,
      members: [...unassigned].sort(byNameZhTW),
    })
  }

  return result
}

const SESSION_ORDER = ['上午', '下午']

/**
 * 依「時段＋坡務」分組（上午在前、下午在後；一人可能同時出現在上午組與下午組），
 * 組標題「時段・坡務內容・地點」，並附「X男Y女」（unknown 不計入但仍列在名單內）；
 * 組內依姓名排序；完全沒被排到坡務的人獨立歸一組「未排入坡務」放最後。
 * @param members 成員陣列（car_members 格式）
 * @param choreLocations getChoreLocationsByEvent 回傳的 { [registration_id]: { 上午, 下午 } }
 * 回傳：[{ key, label, genderLabel, members }]
 */
export function groupMembersByChore(members, choreLocations) {
  const groups = new Map()
  const unassigned = []

  for (const m of members) {
    const sessions = choreLocations?.[m.registration_id]
    let assigned = false
    for (const session of SESSION_ORDER) {
      const chore = sessions?.[session]
      if (!chore) continue
      assigned = true
      const key = `${session}::${chore.chore_id}`
      if (!groups.has(key)) {
        groups.set(key, {
          session,
          sortOrder: chore.sort_order ?? 0,
          label: `${session}・${chore.work_content || chore.unit || '坡務'}・${chore.location || '未定地點'}`,
          members: [],
        })
      }
      groups.get(key).members.push(m)
    }
    if (!assigned) unassigned.push(m)
  }

  const sorted = [...groups.values()].sort((a, b) =>
    SESSION_ORDER.indexOf(a.session) - SESSION_ORDER.indexOf(b.session) || a.sortOrder - b.sortOrder
  )

  const result = sorted.map(g => {
    const sortedMembers = [...g.members].sort(byNameZhTW)
    let male = 0, female = 0
    for (const m of sortedMembers) {
      const gender = deriveGenderFromClasses(getMemberClasses(m))
      if (gender === 'male') male += 1
      else if (gender === 'female') female += 1
    }
    return {
      key: g.session + '::' + g.label,
      label: g.label,
      genderLabel: `${male}男${female}女`,
      members: sortedMembers,
    }
  })

  if (unassigned.length > 0) {
    result.push({
      key: '__unassigned__',
      label: `未排入坡務（${unassigned.length}人）`,
      genderLabel: null,
      members: [...unassigned].sort(byNameZhTW),
    })
  }

  return result
}
