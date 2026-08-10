import { useState } from 'react'
import { dirLabel, getName, sortedMembersForDisplay } from '../../lib/carrangeHelpers'
import PersonRow from '../PersonRow'
import SmallCarPickerModal from './SmallCarPickerModal'

// 大車排車：設定列＋警示＋即時看板＋車輛卡片（含多選移到小車）＋未分配
export default function LargeCarList({
  direction, cars, carCount, setCarCount, seatsPerCar, setSeatsPerCar,
  groupPrecept, setGroupPrecept, handleAutoArrange, handleCopyToOtherDir, setCars,
  regMap, guestInfoMap, guestsNeedFollowup, autoArrangeWarnings, setAutoArrangeWarnings,
  allMonks, smallCarMonks, finalSmallGroups, unassigned,
  movePerson, toggleLeader, unassignMonkAllCars, assignMonkToLargeCar, updateCarName,
  onMoveManyToSmall, copyLink,
  dates, onMoveToBucket, bucketInfoByReg,
}) {
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [pickerOpen, setPickerOpen] = useState(false)

  function toggleSelect(regId) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(regId)) next.delete(regId)
      else next.add(regId)
      return next
    })
  }

  function handleConfirmMove(groupKey) {
    onMoveManyToSmall([...selectedIds], groupKey)
    setSelectedIds(new Set())
    setPickerOpen(false)
  }

  return (
    <section>
      <h2 className="text-base font-bold text-gray-700 mb-4">
        🚌 大車排車
        <span className="text-sm font-normal text-gray-500 ml-2">{dirLabel(direction)}</span>
      </h2>

      {/* 設定列 */}
      <div className="flex items-end gap-3 mb-4 flex-wrap">
        <label className="flex flex-col gap-1 text-sm text-gray-600">
          車輛數
          <input
            type="number" min="1" max="15"
            value={carCount}
            onChange={e => setCarCount(e.target.value)}
            className="w-20 border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-gray-600">
          每車座位
          <input
            type="number" min="1" max="60"
            value={seatsPerCar}
            onChange={e => setSeatsPerCar(e.target.value)}
            className="w-20 border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-emerald-800 bg-emerald-50 border border-emerald-300 rounded-lg px-3 py-2 self-end cursor-pointer select-none">
          <input
            type="checkbox"
            checked={groupPrecept}
            onChange={e => setGroupPrecept(e.target.checked)}
            className="accent-emerald-600"
          />
          <span>優先將三皈五戒學員及其親友編入同一車</span>
          <span className="text-xs text-emerald-600">（行程獨立，不自動補位）</span>
        </label>
        <button
          onClick={handleAutoArrange}
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors font-medium self-end"
        >
          ✨ 自動排車
        </button>
        {cars.length > 0 && (
          <>
            <button
              onClick={handleCopyToOtherDir}
              className="px-3 py-2 text-sm border border-amber-300 text-amber-700 rounded-lg hover:bg-amber-50 self-end font-medium"
              title={`複製目前的排法到「${dirLabel(direction === 'up' ? 'down' : 'up')}」（會依報名資料自動篩選大車人員）`}
            >
              📋 複製到{direction === 'up' ? '回程' : '去程'}
            </button>
            <button
              onClick={() => { if (window.confirm(`確定清除「${dirLabel(direction)}」所有排車結果？`)) setCars([]) }}
              className="px-3 py-2 text-sm border rounded-lg text-gray-500 hover:bg-gray-100 self-end"
            >
              清除
            </button>
          </>
        )}
      </div>

      {/* 提示 */}
      <div className="text-xs text-gray-500 mb-3 leading-relaxed space-y-1">
        <p>
          <span className="font-semibold text-gray-600">・自動排車邏輯：</span>
          首先將具備關係連結的成員，以及訪客與其邀請學員視為整體進行同車分派。接著，系統以班級為單位進行作業，確保整班成員同車；若班級中已有成員預先配置於某車次，則該班其餘成員將自動歸併至該車。當車位不足以容納完整班級時，系統將自動篩選人數最少的小組，將其整組移撥至其他車次。
        </p>
        <p>
          <span className="font-semibold text-gray-600">・手動微調：</span>
          可透過每位成員右側的下拉選單手動調整車次，並依需求勾選「領隊」方框，完成當車負責人的標記與指派；也可勾選多人後點「移到小車」整批移動。
        </p>
      </div>

      {/* 需詢問訪客警示 */}
      {guestsNeedFollowup.length > 0 && (
        <div className="mb-4 bg-red-50 border border-red-300 rounded-xl px-4 py-3">
          <div className="font-semibold text-red-700 text-sm mb-2">
            ❗ 以下訪客坐大車，備註欄未填或找不到對應學員，排車前請先確認
          </div>
          <ul className="space-y-1">
            {guestsNeedFollowup.map(r => {
              const info = guestInfoMap[r.registration_id]
              return (
                <li key={r.registration_id} className="flex items-center gap-2 text-sm text-red-800">
                  <span className="font-medium">・{getName(r)}</span>
                  {info?.note
                    ? <span className="text-orange-600">備註：「{info.note}」（找不到對應學員）</span>
                    : <span className="text-red-500">（未填備註，不知道跟誰同車）</span>
                  }
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* 自動排車警示 */}
      {autoArrangeWarnings.length > 0 && (
        <div className="mb-3 bg-orange-50 border-2 border-orange-400 rounded-lg px-3 py-2 text-sm">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className="font-bold text-orange-700">⚠️ 自動排車提醒（{autoArrangeWarnings.length} 項）</span>
            <button
              onClick={() => setAutoArrangeWarnings([])}
              className="text-xs text-orange-600 hover:text-orange-900 underline shrink-0"
            >
              關閉
            </button>
          </div>
          <ul className="text-orange-800 list-disc pl-5 space-y-0.5">
            {autoArrangeWarnings.map((w, i) => (
              <li key={i}>{w.message}</li>
            ))}
          </ul>
          <div className="text-xs text-orange-600 mt-1.5">
            說明：自動排車不會自動拆散「同組成員」或「學員與其親友」。若群組過大或所有車已滿，會列在這裡，請手動拖移或加開車次處理。
          </div>
        </div>
      )}

      {/* 已選人數 + 移到小車 */}
      {selectedIds.size > 0 && (
        <div className="mb-3 sticky top-0 z-20 bg-purple-50 border-2 border-purple-300 rounded-lg px-4 py-2.5 flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-purple-800">已選 {selectedIds.size} 人</span>
          <div className="flex gap-2">
            <button
              onClick={() => setSelectedIds(new Set())}
              className="text-xs text-purple-600 hover:text-purple-800 px-2 py-1"
            >
              取消選取
            </button>
            <button
              onClick={() => setPickerOpen(true)}
              disabled={finalSmallGroups.length === 0}
              className="text-sm font-medium bg-purple-600 hover:bg-purple-700 text-white rounded-lg px-3 py-1.5 disabled:opacity-40 transition-colors"
              title={finalSmallGroups.length === 0 ? '此方向目前沒有小車可選' : ''}
            >
              🚗 移到小車
            </button>
          </div>
        </div>
      )}

      {/* 即時看板 */}
      {cars.length > 0 && (() => {
        const overflows = cars.map((car, idx) => {
          const total = car.members.length + (car.monks ?? []).length
          return { idx, name: car.car_name, total, seats: car.seats, over: total - car.seats, tempId: car.tempId }
        }).filter(x => x.over > 0)
        const totalPeople = cars.reduce((s, c) => s + c.members.length + (c.monks ?? []).length, 0)
        const totalMonks  = cars.reduce((s, c) => s + (c.monks ?? []).length, 0)
        const totalSeats  = cars.reduce((s, c) => s + c.seats, 0)
        return (
          <div className="sticky top-0 z-10 -mx-4 px-4 py-2 mb-3 bg-white/95 backdrop-blur border-b border-gray-200 shadow-sm">
            <div className="text-xs text-gray-500 mb-1.5 flex items-center gap-2 flex-wrap">
              <span className="font-medium text-gray-700">
                本方向已排 <strong className="text-blue-700">{totalPeople}</strong> 人
                <span className="text-gray-400">／{totalSeats} 座</span>
              </span>
              {totalMonks > 0 && (
                <span className="bg-purple-50 text-purple-700 border border-purple-200 rounded-full px-2 py-0.5">
                  含法師 {totalMonks} 人
                </span>
              )}
            </div>
            {overflows.length > 0 && (
              <div className="mb-2 bg-red-100 border-2 border-red-500 rounded-lg px-3 py-2 text-sm flex items-center gap-2 animate-pulse">
                <span className="font-bold text-red-700 shrink-0">⚠️ 超額警示</span>
                <span className="text-red-700">
                  {overflows.map((o, i) => (
                    <span key={o.tempId}>
                      {i > 0 && '、'}
                      <button
                        onClick={() => document.getElementById(`car-${o.tempId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                        className="underline hover:text-red-900 font-medium"
                      >
                        {o.name}（已排 {o.total} 人／{o.seats}，超額 {o.over} 人）
                      </button>
                    </span>
                  ))}
                </span>
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
              {cars.map((car) => {
                const monkCount  = (car.monks ?? []).length
                const totalInCar = car.members.length + monkCount
                const overflow   = totalInCar - car.seats
                const remaining  = car.seats - totalInCar
                const pct        = car.seats > 0 ? (totalInCar / car.seats) * 100 : 0
                return (
                  <button
                    key={car.tempId}
                    onClick={() => document.getElementById(`car-${car.tempId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                    className={`text-left border rounded-lg p-2.5 text-sm hover:shadow transition-shadow ${
                      overflow > 0
                        ? 'bg-red-50 border-red-400'
                        : remaining === 0
                        ? 'bg-gray-100 border-gray-300'
                        : 'bg-blue-50 border-blue-200'
                    }`}
                  >
                    <div className="flex items-center justify-between font-semibold">
                      <span className="truncate text-gray-800">{car.car_name}</span>
                      {overflow > 0 ? (
                        <span className="text-red-600 font-bold whitespace-nowrap">超額 {overflow} 人</span>
                      ) : remaining === 0 ? (
                        <span className="text-gray-500 whitespace-nowrap">已滿</span>
                      ) : (
                        <span className="text-blue-700 whitespace-nowrap">尚餘 {remaining} 人</span>
                      )}
                    </div>
                    <div className="text-gray-700 mt-1 text-xs">
                      已排 <strong className={overflow > 0 ? 'text-red-600' : ''}>{totalInCar}</strong> 人
                      <span className="text-gray-400">／{car.seats}</span>
                      {monkCount > 0 && (
                        <span className="text-purple-600 ml-2">含法師 {monkCount} 人</span>
                      )}
                    </div>
                    <div className="bg-white/80 rounded h-1.5 mt-1.5 overflow-hidden">
                      <div
                        className={`h-full transition-all ${overflow > 0 ? 'bg-red-500' : 'bg-blue-500'}`}
                        style={{ width: `${Math.min(100, pct)}%` }}
                      />
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )
      })()}

      {/* 車輛卡片 */}
      {cars.length === 0 ? (
        <div className="text-sm text-gray-400 py-10 text-center border-2 border-dashed rounded-xl">
          尚未排車，請設定車輛數後點「✨ 自動排車」
        </div>
      ) : (
        <div className="space-y-3">
          {cars.map((car, ci) => {
            const monkCount   = (car.monks ?? []).length
            const totalInCar  = car.members.length + monkCount
            const overflow    = totalInCar - car.seats
            return (
            <div key={car.tempId} id={`car-${car.tempId}`} className="bg-white border rounded-xl shadow-sm overflow-hidden scroll-mt-4">
              {/* 車次標題 */}
              <div className="flex items-center gap-3 px-4 py-3 bg-amber-100 border-b-2 border-amber-300">
                <input
                  value={car.car_name}
                  onChange={e => updateCarName(ci, e.target.value)}
                  className="font-semibold text-sm text-amber-900 bg-transparent border-b border-transparent hover:border-amber-400 focus:border-amber-600 focus:outline-none px-1 py-0.5 w-28"
                />
                <span className="text-xs text-amber-900/80">
                  座位數：<strong>{car.seats}</strong>
                  <span className="mx-2 text-amber-400">|</span>
                  已排入：<strong className={overflow > 0 ? 'text-red-600' : ''}>{totalInCar}</strong>
                  {monkCount > 0 && (
                    <span className="ml-1 text-purple-700">（含法師 {monkCount}）</span>
                  )}
                </span>
                {overflow > 0 && (
                  <span className="text-xs font-bold text-white bg-red-600 rounded-full px-2.5 py-0.5 animate-pulse">
                    ⚠️ 超額 +{overflow}
                  </span>
                )}
                {overflow === 0 && totalInCar === car.seats && (
                  <span className="text-xs text-gray-500 bg-gray-100 border border-gray-200 rounded-full px-2 py-0.5">已滿</span>
                )}
                {car.leaders.length > 0 && (
                  <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                    領隊：{car.leaders.map(lid => regMap[lid] ? getName(regMap[lid]) : '?').join('、')}
                  </span>
                )}
                {(car.monks ?? []).length > 0 && (
                  <span className="text-xs text-purple-700 bg-purple-50 border border-purple-200 rounded-full px-2 py-0.5">
                    法師：{(car.monks ?? []).map(mid => allMonks.find(m => m.id === mid)?.name ?? '').filter(Boolean).join('、')}
                  </span>
                )}
                <div className="ml-auto shrink-0">
                  {car.access_token ? (
                    <button
                      onClick={() => copyLink(car.access_token, `${dirLabel(direction)}・${car.car_name}`)}
                      className="text-xs text-blue-600 hover:text-blue-800 hover:underline px-2 py-1 rounded hover:bg-blue-50 transition-colors"
                      title={`複製 ${car.car_name} 領隊連結`}
                    >
                      🔗 複製連結
                    </button>
                  ) : (
                    <span className="text-xs text-gray-300">（儲存後可複製）</span>
                  )}
                </div>
              </div>
              {/* 成員列表 */}
              <div className="divide-y">
                {car.members.length === 0 ? (
                  <div className="px-4 py-3 text-xs text-gray-400">（此車目前無人）</div>
                ) : (
                  sortedMembersForDisplay(car.members, regMap).map((regId, mi) => (
                    <div key={regId} className="flex items-center">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(regId)}
                        onChange={() => toggleSelect(regId)}
                        className="ml-3 accent-purple-600 shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <PersonRow
                          reg={regMap[regId]}
                          carIdx={ci}
                          cars={cars}
                          smallGroups={finalSmallGroups}
                          onMove={movePerson}
                          onToggleLeader={toggleLeader}
                          guestInfo={guestInfoMap[regId]}
                          seq={mi + 1}
                          dates={dates} onMoveToBucket={onMoveToBucket} bucketInfo={bucketInfoByReg?.[regId]}
                        />
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* 法師指派 */}
              {allMonks.length > 0 && (
                <div className="px-4 py-3 bg-purple-50 border-t border-purple-100">
                  <div className="text-xs font-medium text-purple-600 mb-2">🏯 搭乘法師（可選）</div>
                  <div className="flex flex-wrap gap-2">
                    {allMonks.map(monk => {
                      const largeIdx       = cars.findIndex(c => (c.monks ?? []).includes(monk.id))
                      const smallKey       = Object.keys(smallCarMonks ?? {}).find(
                        k => (smallCarMonks[k] ?? []).includes(monk.id)
                      )
                      const smallIdx       = smallKey ? finalSmallGroups.findIndex(fg => fg.key === smallKey) : -1
                      const assignedHere   = largeIdx === ci
                      const inOtherLarge   = largeIdx >= 0 && largeIdx !== ci
                      const inSmall        = !!smallKey
                      const elsewhereLabel = inOtherLarge
                        ? cars[largeIdx].car_name
                        : (smallIdx >= 0 ? `小車 ${smallIdx + 1}` : '')
                      const assignedElsewhere = inOtherLarge || inSmall
                      return (
                        <button
                          key={monk.id}
                          onClick={() => {
                            if (assignedHere) unassignMonkAllCars(monk.id)
                            else assignMonkToLargeCar(ci, monk.id)
                          }}
                          title={assignedElsewhere ? `目前在 ${elsewhereLabel}，點選會搬過來` : ''}
                          className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                            assignedHere
                              ? 'bg-purple-600 text-white border-purple-600'
                              : assignedElsewhere
                              ? 'bg-gray-100 text-gray-400 border-gray-200 line-through hover:bg-purple-50 hover:text-purple-500 hover:border-purple-300 hover:no-underline'
                              : 'bg-white text-gray-600 border-gray-300 hover:border-purple-400 hover:text-purple-600'
                          }`}
                        >
                          {assignedHere && '✓ '}
                          {assignedElsewhere && `（${elsewhereLabel}）`}
                          {monk.name}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
            )
          })}
        </div>
      )}

      {/* 未分配 */}
      {unassigned.length > 0 && (
        <div className="mt-3 bg-yellow-50 border border-yellow-300 rounded-xl overflow-hidden">
          <div className="px-4 py-3 bg-yellow-100 border-b border-yellow-200">
            <span className="font-semibold text-yellow-800 text-sm">⚠️ 未分配（{unassigned.length} 人）</span>
            <span className="text-xs text-yellow-600 ml-2">— 座位已滿，無法分配</span>
          </div>
          <div className="divide-y">
            {unassigned.map(r => (
              <div key={r.registration_id} className="flex items-center">
                <input
                  type="checkbox"
                  checked={selectedIds.has(r.registration_id)}
                  onChange={() => toggleSelect(r.registration_id)}
                  className="ml-3 accent-purple-600 shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <PersonRow
                    reg={r}
                    carIdx={-1}
                    cars={cars}
                    smallGroups={finalSmallGroups}
                    onMove={movePerson}
                    onToggleLeader={() => {}}
                    guestInfo={guestInfoMap[r.registration_id]}
                    dates={dates} onMoveToBucket={onMoveToBucket} bucketInfo={bucketInfoByReg?.[r.registration_id]}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {pickerOpen && (
        <SmallCarPickerModal
          groups={finalSmallGroups}
          selectedCount={selectedIds.size}
          onConfirm={handleConfirmMove}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </section>
  )
}
