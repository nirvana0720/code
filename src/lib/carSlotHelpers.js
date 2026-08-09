// 職責單一：多日回山活動「分時段」（events.multi_slot_transport）排車頁專用邏輯
// 從 CarrangementDetailPage.jsx 搬出，避免主檔案繼續肥大

import { isSmallCar, computeSmallGroups, keyFor } from './carrangeHelpers'
import { isInSlot, isSlotBasedAnswers, resolveSlotBasedAttendSlots } from './attendDateHelpers'

// 分時段活動的時段選項：去程（up）上午/中午，回程（down）中午/下午
export function slotsForDirection(direction) {
  return direction === 'up' ? ['上午', '中午'] : ['中午', '下午']
}

// 給定活動與方向，回傳這個方向排車頁要跑的時段清單
// 非分時段活動 → [null]（維持現狀，迴圈跑一次，不影響既有單日/多日活動）
export function timeSlotsFor(event, direction) {
  return event?.multi_slot_transport ? slotsForDirection(direction) : [null]
}

// 走訪一個活動所有「日期 × 方向 × 時段」組合，回傳 [{ dateKey, direction, timeSlot, dirKey }]。
// dirKey 已經算好 keyFor(dateKey, direction, timeSlot)，呼叫端不用自己再算一次。
// CarrangementDetailPage 的 load()／handleSave() 原本各自手寫「for dateKey → for direction →
// for timeSlot」三層迴圈（超額檢查、法師檢查、savePromises、overrideRows、restore 各一份），
// 改用這支＋ .forEach/.map/.reduce 取代，迴圈骨架只在這裡維護一份。
export function allDateDirectionSlots(dateKeysAll, event) {
  const result = []
  for (const dateKey of dateKeysAll) {
    for (const direction of ['up', 'down']) {
      for (const timeSlot of timeSlotsFor(event, direction)) {
        result.push({ dateKey, direction, timeSlot, dirKey: keyFor(dateKey, direction, timeSlot) })
      }
    }
  }
  return result
}

// 還原單一「日期＋方向＋時段」的排車結果（從 DB savedCars + registrations）
// dateKey：這批車的 service_date（單日活動傳 null）；timeSlot：分時段活動的時段（非分時段活動傳 null）
export function restoreCarDirection(savedCars, registrations, dir, dateKey, timeSlot) {
  const out = { cars: [], carCount: 2, seats: 20, orphans: {}, smallCarMonks: {}, smallPreDeparts: {}, smallLateReturns: {} }
  if (!savedCars || savedCars.length === 0) return out

  const largeSaved = savedCars.filter(c => c.car_type === 'large')
  if (largeSaved.length > 0) {
    out.cars = largeSaved.map(c => ({
      tempId:       c.car_id,
      car_name:     c.car_name,
      seats:        c.seats,
      members:      (c.car_members ?? []).map(m => m.registration_id),
      leaders:      (c.car_leaders ?? []).map(l => l.registration_id),
      access_token: c.access_token ?? '',
      monks:        (c.car_monks ?? []).map(m => m.monk_id),
      preDepart:    c.pre_depart || false,
      notice_text:  c.notice_text ?? '',
    }))
    out.carCount = out.cars.length
    out.seats    = out.cars[0]?.seats ?? 20
  }

  const smallSaved = savedCars.filter(c => c.car_type === 'small')
  if (smallSaved.length > 0) {
    const smallRegs = registrations.filter(r => isSmallCar(r.answers, dir) && isInSlot(r.answers, dateKey, dir, timeSlot))
    const { matchedGroups: freshMatched } = computeSmallGroups(smallRegs, dir)
    for (const savedCar of smallSaved) {
      const groupKey   = savedCar.note   // 司機的 registration_id
      const freshGroup = freshMatched.find(g => g.key === groupKey)
      const originalIds = new Set((freshGroup?.members ?? []).map(m => m.registration_id))
      for (const member of (savedCar.car_members ?? [])) {
        if (originalIds.has(member.registration_id)) continue
        const reg = registrations.find(r => r.registration_id === member.registration_id)
        // 只還原「孤兒乘客手動指定小車」；大車移小車的人一律從 car_small_overrides 表載入，這裡不猜
        if (reg && isSmallCar(reg.answers, dir)) out.orphans[member.registration_id] = groupKey
      }
      const savedMonks = (savedCar.car_monks ?? []).map(m => m.monk_id)
      if (savedMonks.length > 0) out.smallCarMonks[groupKey] = savedMonks
      if (savedCar.pre_depart) out.smallPreDeparts[groupKey] = true
      if (savedCar.late_return) out.smallLateReturns[groupKey] = true
    }
  }
  return out
}

// 大車移小車持久化（car_small_overrides）的前端 state key：
// - 非分時段活動：跟舊行為一樣，用 keyFor(serviceDate, direction)
// - 分時段活動：car_small_overrides 表沒有 time_slot 欄位（一個人在某個 date+direction
//   只會落在唯一一個時段，答案本身是單選 radio），所以要用這個人自己的分時段答案
//   反推出他實際所在的時段，才能對應到含時段的 dirKey
export function overrideStateKey(reg, direction, serviceDate) {
  if (!isSlotBasedAnswers(reg?.answers)) return keyFor(serviceDate, direction)
  const slot = resolveSlotBasedAttendSlots(reg?.answers).find(s => s.direction === direction && s.date === serviceDate)
  return keyFor(serviceDate, direction, slot?.timeSlot ?? null)
}
