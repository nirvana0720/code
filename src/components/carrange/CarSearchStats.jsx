import { useMemo, useState } from 'react'
import { getName } from '../../lib/carrangeHelpers'

// 大量排車操作優化：搜尋框（車輛名稱／乘客姓名即時篩選定位）＋ 統計列（總車數／已排滿／未排人數）
export default function CarSearchStats({ cars, regMap, unassignedCount }) {
  const [query, setQuery] = useState('')

  const totalCars  = cars.length
  const filledCars = cars.filter(c => {
    const total = c.members.length + (c.monks ?? []).length
    return c.seats > 0 && total >= c.seats
  }).length

  const matches = useMemo(() => {
    const q = query.trim()
    if (!q) return []
    const out = []
    for (const c of cars) {
      const carNameHit = c.car_name.includes(q)
      const memberHits = c.members
        .map(id => regMap[id])
        .filter(Boolean)
        .filter(r => getName(r).includes(q))
      if (carNameHit || memberHits.length > 0) out.push({ car: c, memberHits })
    }
    return out.slice(0, 20)
  }, [query, cars, regMap])

  function scrollToCar(tempId) {
    document.getElementById(`car-${tempId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="flex items-center gap-3 flex-wrap bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
      <div className="relative flex-1 min-w-[220px] max-w-xs">
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="🔍 搜尋車輛名稱或乘客姓名"
          className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
        />
        {query.trim() && (
          <div className="absolute z-30 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-y-auto">
            {matches.length === 0 ? (
              <div className="px-3 py-2 text-xs text-gray-400">查無符合的車輛或乘客</div>
            ) : matches.map(({ car, memberHits }) => (
              <button
                key={car.tempId}
                type="button"
                onClick={() => { scrollToCar(car.tempId); setQuery('') }}
                className="block w-full text-left px-3 py-2 text-sm hover:bg-amber-50 border-b last:border-b-0"
              >
                <span className="font-medium text-gray-800">{car.car_name}</span>
                {memberHits.length > 0 && (
                  <span className="text-xs text-gray-400 ml-2">
                    {memberHits.slice(0, 3).map(getName).join('、')}
                    {memberHits.length > 3 ? ` 等 ${memberHits.length} 人` : ''}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="text-xs text-gray-500 flex items-center gap-3">
        <span>總車數 <strong className="text-gray-700">{totalCars}</strong></span>
        <span>已排滿 <strong className="text-green-700">{filledCars}</strong></span>
        <span>未排 <strong className="text-red-600">{unassignedCount}</strong></span>
      </div>
    </div>
  )
}
