// 領隊報到頁「報到」頁籤共用成員列（取代大車／小車／總領隊看大車／總領隊看小車 4 處重複渲染）
// 業務邏輯（提前/延後/整車排除等判斷）仍留在呼叫端計算，這裡只負責畫面呈現
import { getMemberName, isGuest, formatMemberClasses } from '../../lib/checkinHelpers'

const telHref = phone => `tel:${String(phone).replace(/[\s-]/g, '')}`

export function PhoneBadge({ phone }) {
  if (!phone) return null
  return (
    <a
      href={telHref(phone)}
      className="text-xs bg-green-100 text-green-700 border border-green-200 rounded-full px-1.5 shrink-0"
    >
      📞 {phone}
    </a>
  )
}

export default function MemberCheckinRow({
  variant = 'row',        // 'card'（大車單台報到頁）| 'row'（小車／總領隊展開列表）
  paddingX = 'px-4',
  buttonTone = 'solid',   // 'solid'（綠底白字）| 'soft'（淺綠底綠字，小車領隊看板用）
  member,
  isLeader = false,
  checked = false,
  disabled = false,
  disabledLabel = '',
  disabledTitle = '',
  badgeLabel = null,
  badgeClassName = '',
  onToggle,
}) {
  const name  = getMemberName(member)
  const guest = isGuest(member)
  const cls   = formatMemberClasses(member)
  const phone = member.registrations?.students?.phone
  const isCard = variant === 'card'

  const wrapCls = isCard
    ? `flex items-center gap-3 bg-white rounded-xl ${paddingX} py-3 shadow-sm border transition-opacity ${checked ? 'border-green-200 opacity-60' : 'border-gray-200'}`
    : `flex items-center gap-3 ${paddingX} py-2.5 ${checked ? 'opacity-55' : ''}`

  const nameCls = isCard
    ? `font-medium truncate ${checked ? 'line-through text-gray-400' : 'text-gray-800'}`
    : `text-sm truncate ${checked ? 'line-through text-gray-400' : 'text-gray-700 font-medium'}`

  const clsCls = isCard
    ? 'text-xs text-gray-500 mt-0.5 truncate'
    : 'text-[11px] text-gray-500 mt-0.5 truncate'

  const btnCls = isCard
    ? 'shrink-0 px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors'
    : 'shrink-0 px-3 py-1 rounded-lg text-xs font-semibold transition-colors'

  const activeBtnCls = buttonTone === 'soft'
    ? 'bg-green-100 text-green-700 hover:bg-green-200'
    : `bg-green-600 text-white hover:bg-green-700${isCard ? ' active:bg-green-800' : ''}`

  const btnStateCls = disabled
    ? 'bg-gray-50 text-gray-300 cursor-not-allowed border border-gray-200'
    : checked
      ? 'bg-gray-100 text-gray-500 hover:bg-red-50 hover:text-red-500'
      : activeBtnCls

  return (
    <div className={wrapCls}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={nameCls}>{name}</span>
          {isLeader && (
            <span className="text-xs bg-amber-100 text-amber-700 border border-amber-200 rounded-full px-1.5 shrink-0">
              領隊
            </span>
          )}
          {guest && (
            <span className="text-xs bg-blue-100 text-blue-600 rounded-full px-1.5 shrink-0">訪客</span>
          )}
          <PhoneBadge phone={phone} />
          {badgeLabel && (
            <span className={`text-xs border rounded-full px-1.5 shrink-0 ${badgeClassName}`}>{badgeLabel}</span>
          )}
        </div>
        {cls && <div className={clsCls}>{cls}</div>}
      </div>
      <button
        onClick={() => !disabled && onToggle()}
        disabled={disabled}
        title={disabled ? disabledTitle : ''}
        className={`${btnCls} ${btnStateCls}`}
      >
        {disabled ? disabledLabel : checked ? '已到' : '報到'}
      </button>
    </div>
  )
}
