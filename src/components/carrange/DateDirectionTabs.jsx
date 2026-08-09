import { DIRECTIONS, keyFor } from '../../lib/carrangeHelpers'
import { formatDateWithWeekday } from '../../lib/attendDateHelpers'
import { slotsForDirection } from '../../lib/carSlotHelpers'

// 多日回山排車的日期籤（只有 multi_day_transport 活動才顯示）＋ 既有去程/回程籤
// ＋ 分時段活動的時段籤（只有 multi_slot_transport 活動才顯示，依目前選中的方向決定顯示哪兩個時段）
export default function DateDirectionTabs({
  dates, selectedDate, setSelectedDate,
  direction, setDirection, carsByDir,
  multiSlot = false, selectedTimeSlot, setSelectedTimeSlot,
}) {
  const carCountFor = dir => {
    if (!multiSlot) return (carsByDir[keyFor(selectedDate, dir)] ?? []).length
    return slotsForDirection(dir).reduce((sum, slot) => sum + (carsByDir[keyFor(selectedDate, dir, slot)] ?? []).length, 0)
  }

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
          const carCnt = carCountFor(d.key)
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

      {multiSlot && (
        <div className="flex gap-2 flex-wrap">
          {slotsForDirection(direction).map(slot => (
            <button
              key={slot}
              onClick={() => setSelectedTimeSlot(slot)}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors ${
                selectedTimeSlot === slot
                  ? 'bg-purple-600 text-white border-purple-600'
                  : 'bg-white text-gray-600 border-gray-300 hover:border-purple-400'
              }`}
            >
              🕐 {slot}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
