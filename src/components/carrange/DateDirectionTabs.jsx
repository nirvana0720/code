import { DIRECTIONS, keyFor } from '../../lib/carrangeHelpers'
import { formatDateWithWeekday } from '../../lib/attendDateHelpers'

// 多日回山排車的日期籤（只有 multi_day_transport 活動才顯示）＋ 既有去程/回程籤
export default function DateDirectionTabs({ dates, selectedDate, setSelectedDate, direction, setDirection, carsByDir }) {
  return (
    <div className="space-y-2">
      {dates.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {dates.map(d => (
            <button
              key={d}
              onClick={() => setSelectedDate(d)}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors ${
                selectedDate === d
                  ? 'bg-teal-600 text-white border-teal-600'
                  : 'bg-white text-gray-600 border-gray-300 hover:border-teal-400'
              }`}
            >
              📅 {formatDateWithWeekday(d)}
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-2 border-b">
        {DIRECTIONS.map(d => {
          const active = direction === d.key
          const dk = keyFor(selectedDate, d.key)
          const carCnt = (carsByDir[dk] ?? []).length
          return (
            <button
              key={d.key}
              onClick={() => setDirection(d.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                active
                  ? 'border-amber-500 text-amber-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {d.emoji} {d.label}
              {carCnt > 0 && (
                <span className="ml-2 text-xs text-gray-400">（{carCnt} 台）</span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
