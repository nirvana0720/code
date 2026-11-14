/**
 * StudentApprovalNote — 學員頁（KioskPage）顯示山上審核狀態的說明文字
 * - registered／ctis_registered：已收到報名，尚待山上審核
 * - approved：已核准，歡喜參加
 * - rejected：活動設定的未核准文字（預設「歡迎報名下次禪七」）
 * 只在 event.needs_mountain_approval 為 true 時顯示（呼叫端不用自己判斷）。
 *
 * ApprovalRejectedChip：未核准時取代「✓ 已報名」狀態框用。
 */
import { APPROVAL_STATUS, normalizeApprovalStatus, getRejectedText } from '../../lib/approvalConstants'

export function isApprovalRejected(event, reg) {
  return !!event?.needs_mountain_approval && !!reg && reg.approval_status === APPROVAL_STATUS.REJECTED
}

export default function StudentApprovalNote({ event, reg, className = '' }) {
  if (!event?.needs_mountain_approval || !reg) return null
  const s = normalizeApprovalStatus(reg.approval_status)

  if (s === APPROVAL_STATUS.APPROVED) {
    return (
      <p className={`mt-2 text-kiosk-sm font-semibold text-green-700 ${className}`}>
        🙏 已核准，歡喜參加
      </p>
    )
  }
  if (s === APPROVAL_STATUS.REJECTED) {
    return (
      <p className={`mt-2 text-kiosk-sm font-semibold text-gray-600 ${className}`}>
        {getRejectedText(event)}
      </p>
    )
  }
  return (
    <p className={`mt-2 text-kiosk-sm font-medium text-amber-700 ${className}`}>
      ⏳ 已收到報名，尚待山上審核
    </p>
  )
}

export function ApprovalRejectedChip() {
  return (
    <span className="px-4 py-2 border-2 border-gray-300 text-gray-500 rounded-xl text-kiosk-sm font-medium bg-gray-50 inline-block text-center">
      未核准
    </span>
  )
}
