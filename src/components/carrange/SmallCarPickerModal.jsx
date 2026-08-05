import { useState } from 'react'

// 可搜尋選車視窗：把大車勾選的人一次性移到某台小車（用司機姓名或車號搜尋）
export default function SmallCarPickerModal({ groups, selectedCount, onConfirm, onClose }) {
  const [query, setQuery] = useState('')

  const q = query.trim()
  const filtered = q
    ? groups.filter(g => g.driverName.includes(q) || (g.plate ?? '').includes(q))
    : groups

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[80vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-800">🚗 選擇目標小車</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
        </div>
        <div className="px-6 pt-3 pb-2">
          <p className="text-xs text-gray-500 mb-2">已選 {selectedCount} 人，選擇要移入的小車：</p>
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="搜尋司機姓名或車號"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
          />
        </div>
        <div className="px-3 pb-4 overflow-y-auto flex-1">
          {filtered.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">查無符合的小車</p>
          ) : (
            <div className="space-y-1.5 px-3">
              {filtered.map((g, i) => (
                <button
                  key={g.key}
                  type="button"
                  onClick={() => onConfirm(g.key)}
                  className="w-full text-left flex items-center justify-between gap-2 border border-gray-200 rounded-lg px-3 py-2 text-sm hover:border-green-400 hover:bg-green-50 transition-colors"
                >
                  <span>
                    <span className="text-green-700 bg-green-100 rounded-full px-2 py-0.5 text-xs mr-2">小車 {i + 1}</span>
                    <span className="font-medium text-gray-800">{g.driverName}</span>
                    {g.plate && <span className="text-xs text-gray-400 ml-1">{g.plate}</span>}
                  </span>
                  <span className="text-xs text-gray-400 shrink-0">{g.allMembers.length} 人</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
