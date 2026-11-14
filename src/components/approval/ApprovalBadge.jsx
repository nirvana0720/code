/**
 * ApprovalBadge — 依 approval_status 顯示審核狀態標籤（已報名／CTIS已報名／核准／未核准）
 */
import { APPROVAL_COLOR, approvalLabel, normalizeApprovalStatus } from '../../lib/approvalConstants'

export default function ApprovalBadge({ status, className = '' }) {
  const s = normalizeApprovalStatus(status)
  return (
    <span
      className={`inline-block text-xs border px-1.5 py-0.5 rounded-full font-normal leading-none whitespace-nowrap ${APPROVAL_COLOR[s]} ${className}`}
    >
      {approvalLabel(s)}
    </span>
  )
}
