// 功德主通知：組訊息文字 + 呼叫 send-donor-notification Edge Function
import { supabase } from './supabase'

/**
 * 組出單一功德主會收到的個人通知訊息文字
 * 車次／合影波次／午齋桌次任一沒有值就整行省略；備註沒有就整段（含標題）省略
 */
export function buildDonorMessage({ eventName, eventDateLabel, donorName, carName, photoWave, lunchTable, note }) {
  const header = `【${eventName}通知】${eventDateLabel ? `${eventDateLabel} ` : ''}${eventName}\n${donorName} 您好`

  const infoLines = []
  if (carName) infoLines.push(`🚌 車次：${carName}`)
  if (photoWave) infoLines.push(`📷 合影波次：${photoWave}`)
  if (lunchTable) infoLines.push(`🍱 午齋桌次：${lunchTable}`)

  const parts = [header]
  if (infoLines.length > 0) parts.push(infoLines.join('\n'))

  const noteText = (note ?? '').trim()
  if (noteText) parts.push(`【重要備註】\n${noteText}`)

  return parts.join('\n\n')
}

/**
 * 桌長專屬：全桌名單（含桌長自己）
 * 開頭明講「您是本桌桌長」，避免收到的人不知道自己被指定為桌長
 */
export function buildTableRosterMessage({ eventName, lunchTable, names }) {
  return `【${eventName}】您是 ${lunchTable} 桌桌長\n本桌名單：${names.join('、')}（共 ${names.length} 位）`
}

/**
 * 呼叫 Edge Function 發送功德主通知
 * @param {{ eventId: string, items: Array<{ donor_id: string, student_id: string|null, name: string, message_text: string }> }} params
 *   items：一位功德主可能出現兩筆（個人通知 + 桌長額外的全桌名單通知）
 * @returns {{ success: boolean, results: Array<{ donor_id: string, name: string, sent: boolean, skipped: boolean, failed: boolean }>, error: string|null }}
 */
export async function sendDonorNotifications({ eventId, items }) {
  const { data, error } = await supabase.functions.invoke('send-donor-notification', {
    body: { event_id: eventId, items },
  })
  if (error) return { success: false, results: [], error: error.message }
  return { success: true, results: data?.results ?? [], error: null }
}
