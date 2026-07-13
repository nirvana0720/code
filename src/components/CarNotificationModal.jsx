// 「發送乘車通知」預覽/編輯彈窗
import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { buildCarMessage, sendCarNotifications } from '../lib/carNotify'

const DIRECTION_LABEL = { up: '去程', down: '回程' }

export default function CarNotificationModal({ eventId, direction, cars, defaultNoticeText, onClose }) {
  const [texts, setTexts] = useState(() =>
    Object.fromEntries(cars.map(c => [c.car_id, c.notice_text ?? defaultNoticeText ?? '']))
  )
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [results, setResults] = useState(null) // [{ car_id, car_name, sent, skipped, failed }]

  function setCarText(carId, value) {
    setTexts(prev => ({ ...prev, [carId]: value }))
  }

  function applyDefault(carId) {
    setCarText(carId, defaultNoticeText ?? '')
  }

  async function handleConfirm() {
    setSending(true)
    setError('')
    try {
      // 1. 把目前每台車的配合事項文字存回 car_assignments
      const saveResults = await Promise.all(
        cars.map(c => supabase.from('car_assignments').update({ notice_text: texts[c.car_id] ?? '' }).eq('car_id', c.car_id))
      )
      const saveFailed = saveResults.find(r => r.error)
      if (saveFailed) {
        setError('儲存配合事項失敗：' + saveFailed.error.message)
        setSending(false)
        return
      }

      // 2. 組訊息並發送
      const payloadCars = cars.map(c => ({
        car_id: c.car_id,
        car_name: c.car_name,
        message_text: buildCarMessage(c.car_name, direction, texts[c.car_id]),
      }))
      const { success, results: res, error: sendErr } = await sendCarNotifications({ eventId, direction, cars: payloadCars })
      if (!success) {
        setError('發送失敗：' + sendErr)
        setSending(false)
        return
      }
      setResults(res)
    } catch (err) {
      setError('發送失敗：' + (err?.message ?? String(err)))
    }
    setSending(false)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start sm:items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="bg-white w-full max-w-2xl rounded-2xl shadow-xl flex flex-col max-h-[90vh]">
        <div className="px-5 pt-5 pb-3 border-b flex items-center justify-between gap-3">
          <h3 className="text-lg font-bold text-gray-800">
            📨 發送乘車通知（{DIRECTION_LABEL[direction] ?? direction}）
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {error && <p className="text-sm text-red-600">{error}</p>}

          {results ? (
            <div className="space-y-2">
              <p className="text-sm text-gray-600 mb-2">發送結果：</p>
              {results.map(r => (
                <div key={r.car_id} className="border border-gray-200 rounded-lg px-4 py-3 text-sm">
                  <p className="font-semibold text-gray-800 mb-1">{r.car_name}</p>
                  <p className="text-gray-600">
                    ✅ 成功 {r.sent} 位　⬜ 未綁定跳過 {r.skipped} 位
                    {r.failed > 0 && <span className="text-red-600">　❌ 失敗 {r.failed} 位</span>}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            cars.map(c => (
              <div key={c.car_id} className="border border-gray-200 rounded-lg px-4 py-3">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <span className="font-semibold text-gray-800">{c.car_name}</span>
                  <button
                    onClick={() => applyDefault(c.car_id)}
                    className="text-xs text-blue-600 border border-blue-300 hover:bg-blue-50 px-2 py-1 rounded transition-colors"
                  >
                    套用預設
                  </button>
                </div>
                <textarea
                  value={texts[c.car_id] ?? ''}
                  onChange={e => setCarText(c.car_id, e.target.value)}
                  rows={4}
                  placeholder="配合事項全文（可留空，訊息只會含車次資訊）"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>
            ))
          )}
        </div>

        <div className="px-5 py-4 border-t flex justify-end gap-3">
          {results ? (
            <button
              onClick={onClose}
              className="px-5 py-2 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors"
            >
              關閉
            </button>
          ) : (
            <>
              <button
                onClick={onClose}
                disabled={sending}
                className="px-4 py-2 text-sm border border-gray-300 text-gray-600 hover:bg-gray-50 rounded-lg transition-colors disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={handleConfirm}
                disabled={sending || cars.length === 0}
                className="px-5 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors disabled:opacity-50"
              >
                {sending ? '發送中…' : '確認發送'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
