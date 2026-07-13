// 山上資料匯入：批次寫入邏輯（安單寮號 / 義工組別）
// 比照 importStudents 的分批寫法，但 registrations 每列目標值不同，改用分批 Promise.all 逐列 update
// （不用 upsert：registrations 有其他 NOT NULL 欄位，只帶部分欄位 upsert 會在候選插入列檢查階段報錯）
import { supabase } from './supabase'

const chunk = (arr, n) => {
  const out = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

/**
 * 批次寫入安單寮號
 * stay_overnight 是動態欄位（存在 answers JSONB 裡，非 registrations 實際欄位），
 * 呼叫端需先合併好含 stay_overnight:true 的完整 answers 物件再傳入，比照 updateVolunteerGroups 的做法
 * @param {string} eventId
 * @param {Array<{ registration_id: string, dormitory_room: string, answers: object }>} matches
 */
export async function updateDormitoryRooms(eventId, matches) {
  if (!matches || matches.length === 0) {
    return { success: false, updated: 0, error: '沒有可寫入的資料' }
  }
  let updated = 0
  for (const batch of chunk(matches, 20)) {
    const results = await Promise.all(batch.map(m =>
      supabase
        .from('registrations')
        .update({ dormitory_room: m.dormitory_room, answers: m.answers })
        .eq('registration_id', m.registration_id)
        .eq('event_id', eventId)
    ))
    const failed = results.find(r => r.error)
    if (failed) return { success: false, updated, error: failed.error.message }
    updated += batch.length
  }
  return { success: true, updated, error: null }
}

/**
 * 批次寫入義工組別（answers.volunteer_group）
 * matches 的 answers 需由呼叫端先合併好完整物件（避免覆蓋掉其他既有欄位）
 * @param {string} eventId
 * @param {Array<{ registration_id: string, answers: object }>} matches
 */
export async function updateVolunteerGroups(eventId, matches) {
  if (!matches || matches.length === 0) {
    return { success: false, updated: 0, error: '沒有可寫入的資料' }
  }
  let updated = 0
  for (const batch of chunk(matches, 20)) {
    const results = await Promise.all(batch.map(m =>
      supabase
        .from('registrations')
        .update({ answers: m.answers })
        .eq('registration_id', m.registration_id)
        .eq('event_id', eventId)
    ))
    const failed = results.find(r => r.error)
    if (failed) return { success: false, updated, error: failed.error.message }
    updated += batch.length
  }
  return { success: true, updated, error: null }
}
