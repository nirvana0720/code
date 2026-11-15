/**
 * AutoLockSetting — 活動設定「🔒 停止異動」區塊裡的「自動停止異動時間（選填）」
 * - form.auto_lock_at 存 datetime-local 輸入值（台北時間 'YYYY-MM-DDTHH:mm'，空字串＝不自動鎖定）
 *   EventDetailPage 載入時用 isoToTaipeiInput 轉入、handleSaveInfo 用 taipeiInputToIso 轉出
 * - 時間早於現在：這裡顯示紅字提醒；真正的「跳提醒並不儲存」在 handleSaveInfo
 * - 到時間由資料庫 pg_cron（auto_lock_events）自動鎖定，效果與手動按「停止異動」相同
 */
import { taipeiInputToIso, formatTaipeiLabel, isTaipeiInputPast } from '../lib/autoLockTime'

export default function AutoLockSetting({ form, setForm, locked }) {
  const value = form.auto_lock_at ?? ''
  const past = isTaipeiInputPast(value)

  return (
    <div className="mt-3">
      <label className="block text-xs font-medium text-gray-600 mb-1">自動停止異動時間（選填，台北時間）</label>
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="datetime-local"
          value={value}
          onChange={e => setForm(f => ({ ...f, auto_lock_at: e.target.value }))}
          className="border border-gray-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
        />
        {value && (
          <button
            type="button"
            onClick={() => setForm(f => ({ ...f, auto_lock_at: '' }))}
            className="text-xs text-gray-500 hover:text-gray-700 border border-gray-200 px-2 py-1 rounded"
          >
            清除
          </button>
        )}
      </div>
      {value && past && (
        <p className="text-xs text-red-600 mt-1">⚠️ 這個時間已經過了，請改成之後的時間或按「清除」，否則無法儲存設定</p>
      )}
      {value && !past && !locked && (
        <p className="text-xs text-gray-500 mt-1">
          將於 {formatTaipeiLabel(taipeiInputToIso(value))} 自動停止異動（設定後請按頂部「💾 儲存設定」）
        </p>
      )}
    </div>
  )
}
