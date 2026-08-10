import { dirLabel, getName, getClasses } from '../../lib/carrangeHelpers'
import { preceptBadgeProps } from '../../lib/registrationHelpers'
import SearchableSelect from '../SearchableSelect'
import MoveToButton from './MoveToButton'

// 「其他日期」分頁：安置不在正常班表的少數人（提前掛單回山／延後回家），
// 不分時段、不分大小車，車輛 car_type 固定沿用 'large'（僅 UI 不提供切換大小車選項）
export default function OtherDateCarList({
  direction, cars, regMap, searchableRegs,
  onUpdateCarName, onUpdateCarNote, onAddMember, onRemoveMember, onAddCar, onRemoveCar,
  dates, onMoveToBucket, bucketInfoByReg,
  pendingRegs = [],
}) {
  return (
    <section>
      <h2 className="text-base font-bold text-gray-700 mb-2">
        🗓️ 其他日期
        <span className="text-sm font-normal text-gray-500 ml-2">{dirLabel(direction)}</span>
      </h2>
      <p className="text-xs text-gray-400 mb-4">
        安置不在正常班表的少數人（提前掛單回山／延後回家），不受活動官方日期範圍限制，
        不分時段、不分大小車。可用下方「＋搜尋加人」把任何報名者手動加進車輛。
      </p>

      {pendingRegs.length > 0 && (
        <div className="mb-4 bg-orange-50 border border-orange-300 rounded-xl overflow-hidden">
          <div className="px-4 py-3 bg-orange-100 border-b border-orange-200 text-sm font-semibold text-orange-800">
            ⚠️ 待處理（{pendingRegs.length} 人）— 系統判斷該歸其他日期，但還沒被排進任何車輛
          </div>
          <div className="divide-y divide-orange-100">
            {pendingRegs.map(r => {
              const cls = getClasses(r).map(c => c.class_name).join('/')
              const badges = preceptBadgeProps(r)
              return (
                <div key={r.registration_id} className="flex items-center gap-2 px-4 py-2 text-sm">
                  <span className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap">
                    <span className="font-medium">{getName(r)}</span>
                    {badges.map((b, i) => (
                      <span key={i} className={b.className} title={b.title}>{b.children}</span>
                    ))}
                  </span>
                  {cls && <span className="text-xs text-gray-400">{cls}</span>}
                  {cars.length === 0 ? (
                    <span className="text-xs text-gray-400">請先「＋ 新增車輛」</span>
                  ) : (
                    <select
                      value=""
                      onChange={e => { const idx = e.target.value; if (idx !== '') onAddMember(Number(idx), r.registration_id) }}
                      className="text-xs border rounded px-1.5 py-0.5 bg-white focus:outline-none focus:ring-1 focus:ring-orange-400"
                    >
                      <option value="">+ 加入車輛</option>
                      {cars.map((c, ci) => (
                        <option key={c.tempId} value={ci}>{c.car_name}</option>
                      ))}
                    </select>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="space-y-3">
        {cars.length === 0 ? (
          <div className="text-sm text-gray-400 py-10 text-center border-2 border-dashed rounded-xl">
            尚未建立車輛，請點「＋ 新增車輛」
          </div>
        ) : (
          cars.map((car, ci) => (
            <div key={car.tempId} className="bg-white border rounded-xl shadow-sm overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3 bg-indigo-100 border-b-2 border-indigo-300">
                <input
                  value={car.car_name}
                  onChange={e => onUpdateCarName(ci, e.target.value)}
                  className="font-semibold text-sm text-indigo-900 bg-transparent border-b border-transparent hover:border-indigo-400 focus:border-indigo-600 focus:outline-none px-1 py-0.5 w-28"
                />
                <input
                  value={car.note ?? ''}
                  onChange={e => onUpdateCarNote(ci, e.target.value)}
                  placeholder="說明文字，例：8/14 提前到"
                  className="flex-1 min-w-0 text-xs text-indigo-800 bg-white/60 border border-indigo-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                />
                <span className="text-xs text-indigo-900/80 shrink-0">{car.members.length} 人</span>
                <button
                  onClick={() => { if (window.confirm(`確定移除「${car.car_name}」？`)) onRemoveCar(ci) }}
                  className="text-xs text-red-500 hover:text-red-700 shrink-0"
                >
                  🗑 移除車輛
                </button>
              </div>
              <div className="divide-y">
                {car.members.length === 0 ? (
                  <div className="px-4 py-3 text-xs text-gray-400">（此車目前無人）</div>
                ) : (
                  car.members.map((regId, mi) => {
                    const r = regMap[regId]
                    if (!r) return null
                    const cls = getClasses(r).map(c => c.class_name).join('/')
                    const badges = preceptBadgeProps(r)
                    return (
                      <div key={regId} className="flex items-center gap-2 px-4 py-2 text-sm">
                        <span className="shrink-0 inline-flex items-center justify-center min-w-6 h-6 px-1.5 rounded-full bg-gray-100 text-gray-500 text-xs font-mono tabular-nums">
                          {mi + 1}
                        </span>
                        <span className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap">
                          <span className="font-medium">{getName(r)}</span>
                          {badges.map((b, i) => (
                            <span key={i} className={b.className} title={b.title}>{b.children}</span>
                          ))}
                        </span>
                        {cls && <span className="text-xs text-gray-400">{cls}</span>}
                        <button
                          onClick={() => onRemoveMember(ci, regId)}
                          className="text-xs text-gray-400 hover:text-red-600 shrink-0"
                          title="從此車移除"
                        >
                          ✕
                        </button>
                        {dates && dates.length > 0 && onMoveToBucket && (
                          <MoveToButton
                            dates={dates}
                            onMove={target => onMoveToBucket(regId, target, ci)}
                            isStale={bucketInfoByReg?.[regId]?.isStale}
                          />
                        )}
                      </div>
                    )
                  })
                )}
              </div>
              <div className="px-4 py-2.5 bg-gray-50 border-t border-gray-100">
                <SearchableSelect
                  value=""
                  onChange={rid => { if (rid) onAddMember(ci, rid) }}
                  className="w-full max-w-xs"
                  placeholder="＋ 搜尋加人"
                  options={searchableRegs.map(r => {
                    const cls = getClasses(r).map(c => c.class_name).join('/')
                    return {
                      value: r.registration_id,
                      label: getName(r),
                      sublabel: cls,
                      searchText: `${getName(r)} ${cls}`,
                    }
                  })}
                />
              </div>
            </div>
          ))
        )}
      </div>

      <button
        onClick={onAddCar}
        className="mt-3 px-4 py-2 text-sm border border-indigo-300 text-indigo-700 rounded-lg hover:bg-indigo-50 font-medium"
      >
        ＋ 新增車輛
      </button>
    </section>
  )
}
