// 職責：山上審核的資料存取（批次改審核狀態）＋「刷卡是否該擋」判斷。
// 分批沿用 supabase.js 的 chunk（每批 200 筆，避免 .in() 網址過長）。

import { supabase, chunk } from './supabase'
import { APPROVAL_STATUS, isValidApprovalStatus } from './approvalConstants'

const BATCH_SIZE = 200

/**
 * 批次設定報名的審核狀態
 * 同時寫入 approval_updated_at（現在時間）、approval_updated_by（目前登入者 email）
 * @param {string[]} regIds registration_id 陣列
 * @param {'registered'|'ctis_registered'|'approved'|'rejected'} status
 * @returns {{ success: boolean, updated: number, error: string|null }}
 */
export async function setApprovalStatus(regIds, status) {
  if (!isValidApprovalStatus(status)) {
    return { success: false, updated: 0, error: `不明的審核狀態：${status}` }
  }
  const ids = [...new Set((regIds || []).filter(Boolean))]
  if (ids.length === 0) return { success: true, updated: 0, error: null }

  const { data: userData } = await supabase.auth.getUser()
  const email = userData?.user?.email ?? null

  const patch = {
    approval_status: status,
    approval_updated_at: new Date().toISOString(),
    approval_updated_by: email,
  }

  let updated = 0
  for (const batch of chunk(ids, BATCH_SIZE)) {
    const { error } = await supabase
      .from('registrations')
      .update(patch)
      .in('registration_id', batch)
    if (error) return { success: false, updated, error: error.message }
    updated += batch.length
  }
  return { success: true, updated, error: null }
}

/**
 * 這筆報名在這場活動是否該被審核擋下（刷卡報到前呼叫）
 * 活動沒開「需山上審核」→ 一律不擋；有開 → 只有「核准」可以通過
 */
export function isBlockedByApproval(event, registration) {
  if (!event?.needs_mountain_approval) return false
  return registration?.approval_status !== APPROVAL_STATUS.APPROVED
}
