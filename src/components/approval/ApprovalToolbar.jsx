/**
 * ApprovalToolbar — 報名名單（EventRegistrationsTab）的山上審核工具列
 * - 所有人：依審核狀態篩選
 * - 僅管理員（isAdmin）：勾選後批次改狀態（常用：標記 CTIS已報名）、貼上錄取名單、匯出名單
 * 勾選狀態由呼叫端保管（selectedIds / setSelectedIds），寫入成功後呼叫 onApplied 更新畫面。
 */
import { useState } from 'react'
import { APPROVAL_STATUS, APPROVAL_STATUSES, APPROVAL_LABEL, normalizeApprovalStatus } from '../../lib/approvalConstants'
import { setApprovalStatus } from '../../lib/approvalApi'
import { exportApprovalCSV } from '../../lib/approvalExport'
import ApprovalPasteModal from './ApprovalPasteModal'

export default function ApprovalToolbar({ event, registrations, fields, visibleRegs, filter, setFilter, selectedIds, setSelectedIds, isAdmin, onApplied }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [pasteOpen, setPasteOpen] = useState(false)
  const [batchTarget, setBatchTarget] = useState(APPROVAL_STATUS.CTIS_REGISTERED)

  const counts = {}
  for (const s of APPROVAL_STATUSES) counts[s] = 0
  for (const r of registrations) counts[normalizeApprovalStatus(r.approval_status)]++

  const allVisibleSelected = visibleRegs.length > 0 && visibleRegs.every(r => selectedIds.has(r.registration_id))

  function toggleAllVisible() {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (allVisibleSelected) visibleRegs.forEach(r => next.delete(r.registration_id))
      else visibleRegs.forEach(r => next.add(r.registration_id))
      return next
    })
  }

  async function applyBatch(ids, status) {
    if (ids.length === 0) return
    setBusy(true); setMsg('')
    const { success, updated, error } = await setApprovalStatus(ids, status)
    setBusy(false)
    if (!success) { setMsg(`❌ 更新失敗（已更新 ${updated} 筆）：${error}`); return }
    onApplied([{ ids, status }])
    setSelectedIds(new Set())
    setMsg(`✅ 已將 ${updated} 筆標記為「${APPROVAL_LABEL[status]}」`)
  }

  return (
    <div className="mb-3 px-4 py-3 bg-indigo-50 border border-indigo-200 rounded-xl flex flex-wrap items-center gap-2 text-sm">
      <span className="font-semibold text-indigo-800">🏔️ 山上審核</span>
      <select
        value={filter}
        onChange={e => setFilter(e.target.value)}
        className="border border-indigo-200 rounded-lg px-2 py-1 text-sm bg-white"
      >
        <option value="all">全部狀態（{registrations.length}）</option>
        {APPROVAL_STATUSES.map(s => (
          <option key={s} value={s}>{APPROVAL_LABEL[s]}（{counts[s]}）</option>
        ))}
      </select>

      {isAdmin && (
        <>
          <button
            onClick={toggleAllVisible}
            className="text-xs px-2 py-1 rounded border border-indigo-200 bg-white text-indigo-700 hover:bg-indigo-100"
          >
            {allVisibleSelected ? '取消全選' : `全選目前列表（${visibleRegs.length}）`}
          </button>
          <span className="text-xs text-indigo-700">已勾選 {selectedIds.size} 筆，改為</span>
          <select
            value={batchTarget}
            onChange={e => setBatchTarget(e.target.value)}
            className="border border-indigo-200 rounded-lg px-2 py-1 text-sm bg-white"
          >
            {APPROVAL_STATUSES.map(s => <option key={s} value={s}>{APPROVAL_LABEL[s]}</option>)}
          </select>
          <button
            disabled={busy || selectedIds.size === 0}
            onClick={() => applyBatch([...selectedIds], batchTarget)}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-xs font-medium px-3 py-1.5 rounded-lg"
          >
            {busy ? '更新中…' : '套用'}
          </button>
          <span className="flex-1" />
          <button
            onClick={() => setPasteOpen(true)}
            className="bg-white border border-indigo-300 text-indigo-700 hover:bg-indigo-100 text-xs font-medium px-3 py-1.5 rounded-lg"
          >
            📋 貼上錄取名單
          </button>
          <button
            onClick={() => exportApprovalCSV(visibleRegs, fields, event)}
            className="bg-white border border-green-300 text-green-700 hover:bg-green-50 text-xs font-medium px-3 py-1.5 rounded-lg"
          >
            ⬇️ 匯出名單（{visibleRegs.length}）
          </button>
        </>
      )}

      {msg && <p className="w-full text-xs text-gray-700">{msg}</p>}

      {pasteOpen && (
        <ApprovalPasteModal
          registrations={registrations}
          onClose={() => setPasteOpen(false)}
          onApplied={updates => { onApplied(updates); setPasteOpen(false); setMsg('✅ 已套用錄取名單') }}
        />
      )}
    </div>
  )
}
