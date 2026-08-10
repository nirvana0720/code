import { useEffect, useRef, useState } from 'react'
import { formatDateWithWeekday } from '../../lib/attendDateHelpers'

// 跨分頁手動 override 用的「移到...」小按鈕：列出「其他日期」＋活動全部官方日期，
// 選一個後呼叫 onMove(targetBucket)（'other' 或 'YYYY-MM-DD'）。isStale 時額外顯示提示。
export default function MoveToButton({ dates, onMove, isStale, staleDetail }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) return
    function onClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  return (
    <span ref={wrapRef} className="relative inline-block shrink-0">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="text-xs text-blue-600 hover:text-blue-800 hover:underline px-1"
      >
        移到...
      </button>
      {isStale && (
        <span
          className="text-xs text-orange-600 ml-1 cursor-help"
          title={staleDetail || '答案已異動，請確認目前分類是否仍正確'}
        >
          ⚠️ 可能異動，請確認
        </span>
      )}
      {open && (
        <div className="absolute z-30 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden text-sm whitespace-nowrap">
          <button
            type="button"
            onClick={() => { onMove('other'); setOpen(false) }}
            className="block w-full text-left px-3 py-1.5 hover:bg-amber-50"
          >
            🗓️ 其他日期
          </button>
          {dates.map(d => (
            <button
              key={d}
              type="button"
              onClick={() => { onMove(d); setOpen(false) }}
              className="block w-full text-left px-3 py-1.5 hover:bg-amber-50"
            >
              📅 {formatDateWithWeekday(d)}
            </button>
          ))}
        </div>
      )}
    </span>
  )
}
