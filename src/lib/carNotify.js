// 車次通知：組訊息文字 + 呼叫 send-car-notification Edge Function
import { supabase } from './supabase'

const DIRECTION_LABEL = { up: '去程', down: '回程' }

/**
 * 組出單一學員會收到的訊息文字
 * @param {string} carName
 * @param {'up'|'down'} direction
 * @param {string} noticeText 配合事項全文（可為空字串）
 */
export function buildCarMessage(carName, direction, noticeText) {
  const dirLabel = DIRECTION_LABEL[direction] ?? direction
  const base = `【車次通知】您已排入：${carName}（${dirLabel}）`
  const notice = (noticeText ?? '').trim()
  return notice ? `${base}\n\n${notice}` : base
}

/**
 * 組出單一學員要接在車次訊息後面的個人加掛文字（寮號／坡務）
 * @param {string|null|undefined} dormitoryRoom
 * @param {{ 上午?: { chore_id: string, unit: string, work_content: string, location: string, sort_order: number }, 下午?: {...} }|undefined} choreSessions
 * @param {{ includeDormitory: boolean, includeChore: boolean }} opts
 */
export function buildMemberExtra(dormitoryRoom, choreSessions, { includeDormitory, includeChore }) {
  const lines = []
  if (includeDormitory && dormitoryRoom) {
    lines.push(`🛏 寮號：${dormitoryRoom}`)
  }
  if (includeChore) {
    for (const session of ['上午', '下午']) {
      const s = choreSessions?.[session]
      if (!s) continue
      const name = s.unit || s.work_content
      const loc = s.location ? `（${s.location}）` : ''
      lines.push(`🧹 坡務：${session} ${name}${loc}`)
    }
  }
  return lines.length ? `\n${lines.join('\n')}` : ''
}

/**
 * 呼叫 Edge Function 發送車次通知
 * @param {{ eventId: string, direction: 'up'|'down', cars: Array<{ car_id: string, car_name: string, message_text: string }>, memberExtras?: Record<string, string> }} params
 */
export async function sendCarNotifications({ eventId, direction, cars, memberExtras }) {
  const { data, error } = await supabase.functions.invoke('send-car-notification', {
    body: { event_id: eventId, direction, cars, member_extras: memberExtras ?? {} },
  })
  if (error) return { success: false, results: [], error: error.message }
  return { success: true, results: data?.results ?? [], error: null }
}
