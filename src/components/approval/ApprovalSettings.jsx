/**
 * ApprovalSettings — 活動設定頁（EventInfoTab）的「需山上審核」開關＋未核准時學員頁文字
 * 與「自由刷卡參加」（walkin_mode）互斥：自由刷卡時不能打開；報名方式那邊也有對應防呆。
 */
import { DEFAULT_REJECTED_TEXT } from '../../lib/approvalConstants'

export default function ApprovalSettings({ form, setForm }) {
  const walkin = !!form.walkin_mode
  const on = !!form.needs_mountain_approval

  function toggle(checked) {
    if (checked && walkin) {
      window.alert('目前報名方式是「自由刷卡參加」，不能同時開啟山上審核。\n請先把報名方式改成其他選項。')
      return
    }
    setForm(f => ({ ...f, needs_mountain_approval: checked }))
  }

  return (
    <div className="sm:col-span-2 border border-indigo-200 bg-indigo-50/50 rounded-xl p-4 space-y-3">
      <label className="inline-flex items-start gap-2 text-sm text-gray-700 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={on}
          disabled={walkin && !on}
          onChange={e => toggle(e.target.checked)}
          className="w-4 h-4 accent-indigo-600 mt-0.5"
        />
        <span>
          需山上審核（禪七／護七等，需等山上錄取名單）
          <span className="block text-xs text-gray-500 mt-0.5">
            開啟後：報名名單出現審核狀態欄；報到頁只有「核准」的人能刷卡報到，且不開放現場報名
          </span>
          {walkin && (
            <span className="block text-xs text-red-600 mt-0.5">
              ⚠️ 目前是「自由刷卡參加」，不能同時開啟山上審核
            </span>
          )}
        </span>
      </label>

      {on && (
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">未核准時學員頁文字</label>
          <input
            value={form.approval_rejected_text ?? ''}
            onChange={e => setForm(f => ({ ...f, approval_rejected_text: e.target.value }))}
            placeholder={`空白時顯示：${DEFAULT_REJECTED_TEXT}`}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
        </div>
      )}
    </div>
  )
}
