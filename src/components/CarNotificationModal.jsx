// 「發送乘車通知」預覽/編輯彈窗
import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { buildCarMessage, buildMemberExtra, sendCarNotifications } from '../lib/carNotify'

const DIRECTION_LABEL = { up: '去程', down: '回程' }

export default function CarNotificationModal({ eventId, direction, cars, defaultNoticeText, registrations, choreLocations, isChoreEvent, eventName, eventDateLabel, onClose }) {
  const [texts, setTexts] = useState(() =>
    Object.fromEntries(cars.map(c => [c.car_id, c.notice_text ?? defaultNoticeText ?? '']))
  )
  const [sending, setSending] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [error, setError] = useState('')
  const [results, setResults] = useState(null) // [{ car_id, car_name, sent, skipped, failed, skipped_members, failed_members }]
  const [includeDormitory, setIncludeDormitory] = useState(false)
  const [includeChore, setIncludeChore] = useState(false)
  // 記住上次發送組好的訊息內容，重新發送失敗名單時不用重新輸入
  const [sentCars, setSentCars] = useState(null)
  const [sentMemberExtras, setSentMemberExtras] = useState(null)

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
        message_text: buildCarMessage(c.car_name, direction, texts[c.car_id], eventName, eventDateLabel),
      }))
      const memberExtras = {}
      for (const r of (registrations ?? [])) {
        const extra = buildMemberExtra(r.dormitory_room, choreLocations?.[r.registration_id], { includeDormitory, includeChore })
        if (extra) memberExtras[r.registration_id] = extra
      }
      const { success, results: res, error: sendErr } = await sendCarNotifications({ eventId, direction, cars: payloadCars, memberExtras })
      if (!success) {
        setError('發送失敗：' + sendErr)
        setSending(false)
        return
      }
      setResults(res)
      setSentCars(payloadCars)
      setSentMemberExtras(memberExtras)
    } catch (err) {
      setError('發送失敗：' + (err?.message ?? String(err)))
    }
    setSending(false)
  }

  // 只重發上次結果裡「發送失敗」的人（未綁定 LINE 的人重發也沒用，不列入），
  // 重用原本組好的 message_text / member_extras，發送完只更新對應車輛的結果，不動其他車輛
  async function handleRetryFailed() {
    const failedCars = results.filter(r => r.failed_members?.length > 0)
    if (failedCars.length === 0) return
    const onlyRegistrationIds = Object.fromEntries(
      failedCars.map(r => [r.car_id, r.failed_members.map(m => m.registration_id)])
    )
    const retryCarIds = new Set(failedCars.map(r => r.car_id))
    const retryCars = (sentCars ?? []).filter(c => retryCarIds.has(c.car_id))

    setRetrying(true)
    setError('')
    try {
      const { success, results: res, error: sendErr } = await sendCarNotifications({
        eventId,
        direction,
        cars: retryCars,
        memberExtras: sentMemberExtras ?? {},
        onlyRegistrationIds,
      })
      if (!success) {
        setError('重新發送失敗：' + sendErr)
        setRetrying(false)
        return
      }
      const resultMap = Object.fromEntries(res.map(r => [r.car_id, r]))
      setResults(prev => prev.map(r => resultMap[r.car_id] ?? r))
    } catch (err) {
      setError('重新發送失敗：' + (err?.message ?? String(err)))
    }
    setRetrying(false)
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
                  {(r.failed_members?.length > 0 || r.skipped_members?.length > 0) && (
                    <details className="mt-1.5 text-xs text-gray-500">
                      <summary className="cursor-pointer select-none hover:text-gray-700">查看名單</summary>
                      <div className="mt-1 space-y-0.5 pl-2">
                        {r.skipped_members?.length > 0 && (
                          <p>⬜ 未綁定 LINE：{r.skipped_members.map(m => m.name || m.registration_id).join('、')}</p>
                        )}
                        {r.failed_members?.length > 0 && (
                          <p className="text-red-600">❌ 發送失敗：{r.failed_members.map(m => m.name || m.registration_id).join('、')}</p>
                        )}
                      </div>
                    </details>
                  )}
                </div>
              ))}
              {results.some(r => r.failed_members?.length > 0) && (
                <button
                  onClick={handleRetryFailed}
                  disabled={retrying}
                  className="w-full px-4 py-2 text-sm bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-lg transition-colors disabled:opacity-50"
                >
                  {retrying ? '重新發送中…' : '🔁 重新發送失敗名單'}
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border border-gray-200 rounded-lg px-4 py-3 bg-gray-50">
                <label className="flex items-center gap-1.5 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={includeDormitory}
                    onChange={e => setIncludeDormitory(e.target.checked)}
                  />
                  包含寮號
                </label>
                {isChoreEvent && (
                  <label className="flex items-center gap-1.5 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={includeChore}
                      onChange={e => setIncludeChore(e.target.checked)}
                    />
                    包含坡務
                  </label>
                )}
                <span className="text-xs text-gray-400">沒有寮號／沒排坡務的人，那一行會自動省略</span>
              </div>
              {cars.map(c => (
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
              ))}
            </>
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
