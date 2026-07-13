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
 * 呼叫 Edge Function 發送車次通知
 * @param {{ eventId: string, direction: 'up'|'down', cars: Array<{ car_id: string, car_name: string, message_text: string }> }} params
 */
export async function sendCarNotifications({ eventId, direction, cars }) {
  const { data, error } = await supabase.functions.invoke('send-car-notification', {
    body: { event_id: eventId, direction, cars },
  })
  if (error) return { success: false, results: [], error: error.message }
  return { success: true, results: data?.results ?? [], error: null }
}
