import { dirLabel, getName, fieldKeysFor } from '../../lib/carrangeHelpers'
import { preceptBadgeProps } from '../../lib/registrationHelpers'

// 小車配對：司機/乘客自動配對群組＋孤兒乘客手動指定＋法師／提前出發／延後回程
export default function SmallCarList({
  direction, finalSmallGroups, orphans, unassignedOrphans, orphanAssignments, setOrphanAssignments,
  allMonks, smallCarMonks, unassignMonkAllCars, assignMonkToSmallCar,
  smallPreDeparts, smallLateReturns, toggleSmallPreDepart, toggleSmallLateReturn,
  handleSelectMainDriver, driverPickerBusy, smallOverrides, onMoveBackToLarge,
}) {
  return (
    <section>
      <h2 className="text-base font-bold text-gray-700 mb-2">
        🚗 小車配對
        <span className="text-sm font-normal text-gray-500 ml-2">{dirLabel(direction)}</span>
      </h2>
      <p className="text-xs text-gray-400 mb-4">
        依報名填寫的「共乘者姓名」自動配對司機與乘客。找不到司機的乘客可用下拉選單手動指定搭哪台小車。
      </p>
      <div className="space-y-2">
        {/* 有配對的小車群組 */}
        {finalSmallGroups.map((g, idx) => (
          <div key={g.key} className={`bg-white rounded-xl shadow-sm overflow-hidden border ${g.needsDriverChoice ? 'border-2 border-red-400 ring-2 ring-red-100' : ''}`}>
            {g.needsDriverChoice && (
              <div className="px-4 py-2 bg-red-50 text-red-700 text-xs font-medium border-b border-red-200 flex items-center gap-2">
                <span className="animate-pulse">⚠️</span>
                <span>同車號有多位填了車號的「自行開車」乘客，請從下方下拉選單指定誰是主司機</span>
              </div>
            )}
            <div className="flex items-center gap-2 px-4 py-3 border-b bg-gray-50 text-sm font-semibold text-gray-700">
              <span className="text-green-700 bg-green-100 rounded-full px-2 py-0.5 text-xs">
                小車 {idx + 1}
              </span>
              {g.needsDriverChoice ? (
                <>
                  <span className="text-red-700 bg-red-100 rounded-full px-2 py-0.5 text-xs">⚠️ 司機未指定</span>
                  {g.plate && <span className="text-gray-400 text-xs font-normal">{g.plate}</span>}
                  <select
                    value=""
                    onChange={e => {
                      const rid = e.target.value
                      if (rid) handleSelectMainDriver(g, rid)
                    }}
                    disabled={driverPickerBusy === g.key}
                    className="text-xs border rounded px-1.5 py-0.5 bg-white focus:outline-none focus:ring-1 focus:ring-red-400"
                  >
                    <option value="">請選擇主司機 ▾</option>
                    {g.candidates.map(c => (
                      <option key={c.registration_id} value={c.registration_id}>
                        {getName(c)}
                      </option>
                    ))}
                  </select>
                </>
              ) : (
                <>
                  <span>司機：{g.driverName}</span>
                  {g.plate && <span className="text-gray-400 text-xs font-normal">{g.plate}</span>}
                </>
              )}
              <span className="text-xs text-gray-400 font-normal ml-auto">{g.allMembers.length} 人</span>
            </div>
            <div className="divide-y">
              {g.allMembers.map((r, mi) => {
                const cls       = (r.students?.student_classes ?? []).map(c => c.class_name).join('/')
                const isAnchor      = r.registration_id === g.key
                const isOtherDriver = !isAnchor && g.candidateIds?.has(r.registration_id)
                const carpoolNm = r.answers?.[fieldKeysFor(direction).carpool] ?? ''
                const isOrphan  = orphans.some(o => o.registration_id === r.registration_id)
                const isOverride = smallOverrides?.[r.registration_id] === g.key
                const memBadges = preceptBadgeProps(r)
                return (
                  <div key={r.registration_id} className={`flex items-center gap-2 px-4 py-2 text-sm ${isOrphan ? 'bg-orange-50' : ''} ${isOverride ? 'bg-purple-50' : ''}`}>
                    <span className="shrink-0 inline-flex items-center justify-center min-w-6 h-6 px-1.5 rounded-full bg-gray-100 text-gray-500 text-xs font-mono tabular-nums">
                      {mi + 1}
                    </span>
                    <span className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap">
                      <span className="font-medium">{getName(r)}</span>
                      {memBadges.map((b, i) => (
                        <span key={i} className={b.className} title={b.title}>
                          {b.children}
                        </span>
                      ))}
                      {isOverride && (
                        <span className="text-xs text-purple-600 bg-purple-100 rounded px-1.5 shrink-0">從大車移入</span>
                      )}
                    </span>
                    {cls && <span className="text-xs text-gray-400">{cls}</span>}
                    <span className="text-xs text-gray-300">
                      {isAnchor && !g.needsDriverChoice
                        ? '（司機）'
                        : isOtherDriver
                          ? '（共乘・同車號）'
                          : carpoolNm
                            ? `→ ${carpoolNm}`
                            : ''}
                    </span>
                    {/* 從大車移入的人：可移回大車 */}
                    {isOverride && (
                      <button
                        onClick={() => onMoveBackToLarge(r.registration_id)}
                        className="text-xs text-purple-600 hover:text-purple-800 hover:underline shrink-0"
                      >
                        ↩ 移回大車
                      </button>
                    )}
                    {/* 孤兒乘客可改指定到其他小車 */}
                    {isOrphan && (
                      <select
                        value={g.key}
                        onChange={e => setOrphanAssignments(prev => ({
                          ...prev,
                          [r.registration_id]: e.target.value || undefined,
                        }))}
                        className="text-xs border rounded px-1.5 py-0.5 bg-white focus:outline-none focus:ring-1 focus:ring-amber-400"
                      >
                        {finalSmallGroups.map((fg, fi) => (
                          <option key={fg.key} value={fg.key}>小車 {fi + 1}・{fg.driverName}</option>
                        ))}
                      </select>
                    )}
                  </div>
                )
              })}
            </div>

            {/* 小車法師選擇 + 提前出發／延後回程 */}
            <div className="px-4 py-2.5 bg-gray-50 border-t border-gray-100 flex items-center gap-3 flex-wrap">
              {allMonks.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs text-purple-600 font-medium shrink-0">🏯 法師：</span>
                  {allMonks.map(monk => {
                    const isHere = (smallCarMonks[g.key] ?? []).includes(monk.id)
                    const smallKey = Object.keys(smallCarMonks ?? {}).find(
                      k => (smallCarMonks[k] ?? []).includes(monk.id)
                    )
                    const smallIdx = smallKey ? finalSmallGroups.findIndex(fg => fg.key === smallKey) : -1
                    const inOtherSmall = !!smallKey && smallKey !== g.key
                    return (
                      <button
                        key={monk.id}
                        onClick={() => {
                          if (isHere) unassignMonkAllCars(monk.id)
                          else assignMonkToSmallCar(g.key, monk.id)
                        }}
                        title={inOtherSmall ? `目前在小車 ${smallIdx + 1}，點選搬過來` : ''}
                        className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                          isHere
                            ? 'bg-purple-600 text-white border-purple-600'
                            : inOtherSmall
                            ? 'bg-gray-100 text-gray-400 border-gray-200 line-through hover:bg-purple-50 hover:text-purple-500 hover:border-purple-300 hover:no-underline'
                            : 'bg-white text-gray-600 border-gray-300 hover:border-purple-400 hover:text-purple-600'
                        }`}
                      >
                        {isHere && '✓ '}
                        {inOtherSmall && `（小車 ${smallIdx + 1}）`}
                        {monk.name}
                      </button>
                    )
                  })}
                </div>
              )}
              {direction === 'up' ? (
                <label className="flex items-center gap-1 cursor-pointer ml-auto" title="勾選後整車視為提前出發，看板應到不計入">
                  <input
                    type="checkbox"
                    checked={!!smallPreDeparts[g.key]}
                    onChange={() => toggleSmallPreDepart(g.key)}
                    className="accent-teal-600 w-3.5 h-3.5"
                  />
                  <span className={`text-xs ${smallPreDeparts[g.key] ? 'text-teal-700 font-semibold' : 'text-gray-400'}`}>
                    🚀 提前出發
                  </span>
                </label>
              ) : (
                <label className="flex items-center gap-1 cursor-pointer ml-auto" title="勾選後整車視為延後回程，看板應到不計入">
                  <input
                    type="checkbox"
                    checked={!!smallLateReturns[g.key]}
                    onChange={() => toggleSmallLateReturn(g.key)}
                    className="accent-amber-600 w-3.5 h-3.5"
                  />
                  <span className={`text-xs ${smallLateReturns[g.key] ? 'text-amber-700 font-semibold' : 'text-gray-400'}`}>
                    🕓 延後回程
                  </span>
                </label>
              )}
            </div>
          </div>
        ))}

        {/* 找不到司機、尚未指定小車的乘客 */}
        {unassignedOrphans.length > 0 && (
          <div className="bg-orange-50 border border-orange-300 rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-orange-100 border-b border-orange-200 text-sm font-semibold text-orange-800">
              ⚠️ 找不到司機（{unassignedOrphans.length} 人）— 請手動指定搭哪台小車
            </div>
            <div className="divide-y">
              {unassignedOrphans.map(r => {
                const cls       = (r.students?.student_classes ?? []).map(c => c.class_name).join('/')
                const carpoolNm = r.answers?.[fieldKeysFor(direction).carpool] ?? ''
                const orpBadges = preceptBadgeProps(r)
                return (
                  <div key={r.registration_id} className="flex items-center gap-2 px-4 py-2 text-sm">
                    <span className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap">
                      <span className="font-medium">{getName(r)}</span>
                      {orpBadges.map((b, i) => (
                        <span key={i} className={b.className} title={b.title}>
                          {b.children}
                        </span>
                      ))}
                    </span>
                    {cls && <span className="text-xs text-gray-400">{cls}</span>}
                    {carpoolNm && <span className="text-xs text-gray-400">→ {carpoolNm}</span>}
                    <select
                      value={orphanAssignments[r.registration_id] ?? ''}
                      onChange={e => setOrphanAssignments(prev => ({
                        ...prev,
                        [r.registration_id]: e.target.value || undefined,
                      }))}
                      className="text-xs border rounded px-1.5 py-0.5 bg-white focus:outline-none focus:ring-1 focus:ring-amber-400"
                    >
                      <option value="">（未指定）</option>
                      {finalSmallGroups.map((g, gi) => (
                        <option key={g.key} value={g.key}>小車 {gi + 1}・{g.driverName}</option>
                      ))}
                    </select>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* 沒有任何小車資料 */}
        {finalSmallGroups.length === 0 && unassignedOrphans.length === 0 && (
          <div className="text-sm text-gray-400 py-6 text-center border rounded-xl">沒有小車報名資料</div>
        )}
      </div>
    </section>
  )
}
