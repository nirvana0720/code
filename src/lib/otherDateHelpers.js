// 職責單一：判斷報名者是否該被歸進「其他日期」分頁（提前掛單回山 / 延後回家），
// 以及跨分頁手動 override 的疊加邏輯

import { isOtherTransport, genId } from './carrangeHelpers'
import { isInSlot } from './attendDateHelpers'

// 純判斷：這個人是否因為掛單日期超出活動官方範圍，該被自動歸進其他日期
// 回傳 { up: boolean, down: boolean }
// - up: 掛單開始日期嚴格早於 event.date_start（相等不算）
// - down: 掛單結束日期嚴格晚於 event.date_end（相等不算）
// - 活動沒有 stay_start/stay_end 欄位資料（answers 裡完全沒有這兩個 key）→ 都回傳 false
// - isOtherTransport(對應 registration, direction) 為 true（交通方式選「其他交通」）
//   的方向強制回傳 false，不管掛單日期怎麼樣（這些人不用系統排車）
export function resolveOtherDateSlots(registration, event) {
  const answers = registration?.answers ?? {}
  const stayStart = answers.stay_start
  const stayEnd = answers.stay_end
  const result = { up: false, down: false }
  if (stayStart && event?.date_start && stayStart < event.date_start) {
    result.up = !isOtherTransport(registration, 'up')
  }
  if (stayEnd && event?.date_end && stayEnd > event.date_end) {
    result.down = !isOtherTransport(registration, 'down')
  }
  return result
}

// 疊加手動 override：overridesMap 是 { [registration_id]: { up: overrideRow, down: overrideRow } }
// 由呼叫端一次查好整個活動的 registration_bucket_overrides 再傳進來，避免每人一次 query
// 回傳 { bucket: 'other' | dateString | null, isStale: boolean }
// bucket 為 null 代表「正常自動判斷，沒有落在其他日期」，交給既有 resolveAttendSlots 處理
export function resolveFinalBucket(registration, direction, event, overridesMap) {
  const overrideRow = overridesMap?.[registration.registration_id]?.[direction]
  if (overrideRow) {
    const answers = registration?.answers ?? {}
    const isStale =
      (overrideRow.source_stay_start ?? null) !== (answers.stay_start ?? null) ||
      (overrideRow.source_stay_end   ?? null) !== (answers.stay_end   ?? null) ||
      (overrideRow.source_transport  ?? null) !== (answers[direction === 'up' ? 'transport_up' : 'transport_down'] ?? null)
    return { bucket: overrideRow.target_bucket, isStale }
  }
  const auto = resolveOtherDateSlots(registration, event)
  return { bucket: auto[direction] ? 'other' : null, isStale: false }
}

// 排車頁「某個日期＋方向該顯示的人」清單過濾器：先用 resolveFinalBucket 算出這個人的
// bucket，bucket === 'other' 就算 isInSlot 判斷是 true 也要排除（已被歸進其他日期分頁）；
// bucket 是某個日期字串（override 指定回某個正常日期）則用這個日期取代 isInSlot 原本
// 用 answers 反推出來的日期做比對。不修改 isInSlot 本身，只在外面多包一層判斷。
export function filterByFinalBucket(registrations, selectedDate, direction, selectedTimeSlot, event, overridesMap) {
  return registrations.filter(r => {
    const { bucket } = resolveFinalBucket(r, direction, event, overridesMap)
    if (bucket === 'other') return false
    if (bucket) return bucket === selectedDate
    return isInSlot(r.answers, selectedDate, direction, selectedTimeSlot)
  })
}

// 「待處理」清單：bucket==='other'（自動判斷或手動 override 都算），但還沒被排進任何
// 其他日期分頁車輛（car_members）的人。即時衍生，不持久化。
// assignedRegIds：目前這個方向所有其他日期車輛 car_members 的 registration_id 集合
// （Set 或陣列皆可），由呼叫端從 otherDateCarsByDir 算好傳入
export function pendingOtherDateRegs(registrations, direction, event, overridesMap, assignedRegIds) {
  const assigned = assignedRegIds instanceof Set ? assignedRegIds : new Set(assignedRegIds ?? [])
  return registrations.filter(r =>
    resolveFinalBucket(r, direction, event, overridesMap).bucket === 'other' && !assigned.has(r.registration_id)
  )
}

// 其他日期分頁「建議共乘分組」：從 computeSmallGroups 的 matchedGroups 其中一組，
// 一次建立一台其他日期車輛物件（司機＋乘客都已加入 members），車輛命名優先用司機姓名，
// 司機姓名缺失（理論上不會）才退回車牌或「其他車」。純資料轉換，不觸碰 state／DB。
export function buildOtherDateCarFromGroup(group) {
  return {
    tempId: genId(),
    car_name: group.driverName ? `${group.driverName}的車` : (group.plate || '其他車'),
    note: '',
    car_type: 'small',
    members: group.members.map(r => r.registration_id),
  }
}
