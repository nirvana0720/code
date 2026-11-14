/**
 * ApprovalPasteModal — 貼上山上錄取名單 → 比對報名者 → 預覽 → 確認才寫入
 * 比對規則在 lib/approvalMatch.js；寫入用 lib/approvalApi.setApprovalStatus。
 * 預覽分四區：核准／未核准／需手動處理（同名或前後矛盾，逐一選擇）／找不到（只列出）。
 * 沒有段落標題的貼法（打七表）提供「其餘 CTIS已報名者標未核准」切換。
 * 也可「上傳 PDF」：lib/approvalPdf.js 在瀏覽器本機讀出文字填入文字框（不上傳、不記 log），再按比對。
 */
import { useState } from 'react'
import { matchApprovalList } from '../../lib/approvalMatch'
import { extractPdfText } from '../../lib/approvalPdf'
import { setApprovalStatus } from '../../lib/approvalApi'
import { APPROVAL_STATUS } from '../../lib/approvalConstants'
import { getDisplayName } from '../../lib/eventDetailHelpers'
import ApprovalBadge from './ApprovalBadge'

function NameList({ regs }) {
  if (regs.length === 0) return <p className="text-xs text-gray-400">（無）</p>
  return (
    <div className="flex flex-wrap gap-1.5">
      {regs.map(r => (
        <span key={r.registration_id} className="text-xs bg-white border border-gray-200 rounded px-1.5 py-0.5">
          {getDisplayName(r)}{r.student_id ? <span className="text-gray-400 ml-1">{r.student_id}</span> : null}
        </span>
      ))}
    </div>
  )
}

export default function ApprovalPasteModal({ registrations, onClose, onApplied }) {
  const [text, setText] = useState('')
  const [result, setResult] = useState(null)
  const [choices, setChoices] = useState({}) // 需手動處理：regId → 'skip' | 'approved' | 'rejected'
  const [restRejected, setRestRejected] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pdfState, setPdfState] = useState({ loading: false, msg: '' })

  // 上傳 PDF：本機讀出文字填入文字框，使用者可檢視／修改後再按「比對」
  async function handlePdfFile(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // 同一個檔案可以再選一次
    if (!file) return
    setPdfState({ loading: true, msg: '' })
    try {
      const { text: pdfText, pageCount, hasText } = await extractPdfText(file)
      if (!hasText) {
        setPdfState({ loading: false, msg: '⚠️ 這份 PDF 沒有文字（可能是掃描圖片），請改用貼上，或在名單上手動勾選' })
        return
      }
      setText(pdfText)
      setPdfState({ loading: false, msg: `✅ 已讀出 ${pageCount} 頁文字，請確認內容後按「比對」` })
    } catch {
      // 不把錯誤物件印到 console（可能含檔案內容），只顯示通用訊息
      setPdfState({ loading: false, msg: '❌ 讀取 PDF 失敗，檔案可能損毀或有密碼保護，請改用貼上' })
    }
  }

  function runMatch() {
    setResult(matchApprovalList(text, registrations, { displayNameOf: r => getDisplayName(r) }))
    setChoices({})
    setRestRejected(false)
    setError('')
  }

  const restCtis = result && !result.hasSections
    ? result.unmatched.filter(r => r.approval_status === APPROVAL_STATUS.CTIS_REGISTERED)
    : []

  const regById = new Map(registrations.map(r => [r.registration_id, r]))
  const chosen = st => Object.entries(choices).filter(([, v]) => v === st).map(([id]) => regById.get(id)).filter(Boolean)
  const approvedFinal = result ? [...result.approved, ...chosen('approved')] : []
  const rejectedFinal = result ? [...result.rejected, ...chosen('rejected'), ...(restRejected ? restCtis : [])] : []

  async function apply() {
    setBusy(true); setError('')
    const updates = []
    for (const [regs, status] of [[approvedFinal, APPROVAL_STATUS.APPROVED], [rejectedFinal, APPROVAL_STATUS.REJECTED]]) {
      const ids = regs.map(r => r.registration_id)
      if (ids.length === 0) continue
      const { success, error: err } = await setApprovalStatus(ids, status)
      if (!success) { setBusy(false); setError(err || '寫入失敗'); if (updates.length) onApplied(updates); return }
      updates.push({ ids, status })
    }
    setBusy(false)
    onApplied(updates)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-800">📋 貼上山上錄取名單</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
        </div>

        {!result ? (
          <>
            <p className="text-sm text-gray-500">
              直接從 PDF 複製整張表貼上，或按「上傳 PDF」自動讀出文字。有「錄取名單／不錄取名單」標題會分段判斷；沒有標題（打七表）就全部視為錄取。
              <span className="block text-xs text-gray-400 mt-0.5">檔案只在本機讀取，不會上傳</span>
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <label className={`text-sm border border-indigo-300 text-indigo-700 px-3 py-1.5 rounded-lg ${pdfState.loading ? 'opacity-50 cursor-wait' : 'cursor-pointer hover:bg-indigo-50'}`}>
                {pdfState.loading ? '讀取中…' : '📄 上傳 PDF'}
                <input type="file" accept=".pdf,application/pdf" className="hidden" disabled={pdfState.loading} onChange={handlePdfFile} />
              </label>
              {pdfState.msg && <span className="text-xs text-gray-600">{pdfState.msg}</span>}
            </div>
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              rows={12}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-400"
              placeholder="貼上名單文字…"
            />
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="text-sm border border-gray-200 px-4 py-2 rounded-lg text-gray-600">取消</button>
              <button
                disabled={!text.trim()}
                onClick={runMatch}
                className="text-sm bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white px-4 py-2 rounded-lg font-medium"
              >比對</button>
            </div>
          </>
        ) : (
          <>
            <div className="bg-green-50 border border-green-200 rounded-lg p-3">
              <p className="text-sm font-semibold text-green-800 mb-2">核准（{approvedFinal.length}）</p>
              <NameList regs={approvedFinal} />
            </div>

            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm font-semibold text-red-800 mb-2">未核准（{rejectedFinal.length}）</p>
              <NameList regs={rejectedFinal} />
              {!result.hasSections && (
                <button
                  onClick={() => setRestRejected(v => !v)}
                  disabled={restCtis.length === 0}
                  className={`mt-2 text-xs px-3 py-1.5 rounded-lg border disabled:opacity-40 ${
                    restRejected ? 'bg-red-600 text-white border-red-600' : 'bg-white text-red-700 border-red-300'
                  }`}
                >
                  {restRejected ? '✓ ' : ''}其餘 CTIS已報名者標未核准（{restCtis.length} 人）
                </button>
              )}
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-sm font-semibold text-amber-800 mb-2">需手動處理（{result.ambiguous.length}）</p>
              {result.ambiguous.length === 0 && <p className="text-xs text-gray-400">（無）</p>}
              <div className="space-y-2">
                {result.ambiguous.map((a, i) => (
                  <div key={i} className="bg-white border border-amber-200 rounded p-2 text-xs space-y-1">
                    <p className="font-medium text-amber-900">
                      {a.name}：{a.reason === 'conflict' ? '同時出現在錄取與不錄取' : '系統內有同名報名'}
                    </p>
                    <p className="text-gray-400 truncate">名單原文：{a.lines.join('／')}</p>
                    {a.candidates.map(({ reg, displayName }) => (
                      <div key={reg.registration_id} className="flex items-center gap-2 flex-wrap">
                        <span>{displayName}</span>
                        <span className="text-gray-400">{reg.student_id ?? '訪客'}</span>
                        <ApprovalBadge status={reg.approval_status} />
                        <select
                          value={choices[reg.registration_id] ?? 'skip'}
                          onChange={e => setChoices(c => ({ ...c, [reg.registration_id]: e.target.value }))}
                          className="border border-gray-300 rounded px-1 py-0.5"
                        >
                          <option value="skip">不處理</option>
                          <option value="approved">核准</option>
                          <option value="rejected">未核准</option>
                        </select>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
              <p className="text-sm font-semibold text-gray-700 mb-2">找不到報名者（{result.notFound.length}）</p>
              {result.notFound.length === 0 && <p className="text-xs text-gray-400">（無）</p>}
              <ul className="text-xs text-gray-600 space-y-0.5">
                {result.notFound.map((n, i) => (
                  <li key={i}>{n.section === 'rejected' ? '［不錄取］' : '［錄取］'} {n.line}</li>
                ))}
              </ul>
            </div>

            {error && <p className="text-sm text-red-600">❌ {error}</p>}

            <div className="flex justify-end gap-2">
              <button onClick={() => setResult(null)} className="text-sm border border-gray-200 px-4 py-2 rounded-lg text-gray-600">返回修改</button>
              <button
                disabled={busy || (approvedFinal.length === 0 && rejectedFinal.length === 0)}
                onClick={apply}
                className="text-sm bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white px-4 py-2 rounded-lg font-medium"
              >
                {busy ? '套用中…' : `確認套用（核准 ${approvedFinal.length}、未核准 ${rejectedFinal.length}）`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
