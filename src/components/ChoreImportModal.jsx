// 匯入坡務表 Excel 彈窗：上傳 → 解析預覽（含日期核對）→ 確認寫入
// 一份 Excel 可能同時含上午/下午資料，依解析出的 session 欄位自動分流，不需使用者另外選
import { useState } from 'react'
import { parseChoreExcel, importChores } from '../lib/choreImport'

export default function ChoreImportModal({ eventId, onImported, onClose }) {
  const [parsing, setParsing] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')
  const [rows, setRows]       = useState([])

  const dates = [...new Set(rows.map(r => r.date_for_display).filter(Boolean))]
  const morningCount = rows.filter(r => r.session === '上午').length
  const afternoonCount = rows.filter(r => r.session === '下午').length

  async function handleFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setParsing(true)
    setError('')
    try {
      const parsed = await parseChoreExcel(file)
      if (parsed.length === 0) {
        setError('沒有解析出任何坡務資料，請確認 Excel 格式是否正確')
      }
      setRows(parsed)
    } catch (err) {
      setError('Excel 解析失敗：' + err.message)
      setRows([])
    }
    setParsing(false)
  }

  async function handleConfirm() {
    setSaving(true)
    setError('')
    const { success, imported, error: err } = await importChores(eventId, rows)
    setSaving(false)
    if (!success) {
      setError('寫入失敗：' + err)
      return
    }
    onImported?.(imported)
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[85vh] overflow-y-auto p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-gray-800">📤 匯入坡務表</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg">×</button>
        </div>

        <div className="mb-4">
          <label className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg cursor-pointer transition-colors">
            {parsing ? '解析中…' : '📄 上傳坡務表 Excel'}
            <input type="file" accept=".xlsx,.xls" onChange={handleFile} disabled={parsing} className="hidden" />
          </label>
          <p className="text-xs text-gray-400 mt-1.5">
            系統會自動判斷每一列屬於上午或下午，一次匯入即可同時建立兩個時段的坡務
          </p>
        </div>

        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

        {rows.length > 0 && (
          <>
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3 text-sm text-amber-800">
              解析出 <strong>{rows.length}</strong> 筆坡務（🌅 上午 {morningCount}／🌇 下午 {afternoonCount}）
              {dates.length > 0 && <span className="ml-2">・資料日期：{dates.join('、')}（請核對是否為本場活動）</span>}
            </div>

            <div className="overflow-x-auto border border-gray-200 rounded-lg mb-4">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-3 py-2 text-left">日期</th>
                    <th className="px-3 py-2 text-left">時段</th>
                    <th className="px-3 py-2 text-left">單位</th>
                    <th className="px-3 py-2 text-left">坡務內容</th>
                    <th className="px-3 py-2 text-left">集合地點</th>
                    <th className="px-3 py-2 text-left">負責法師</th>
                    <th className="px-3 py-2 text-left">精舍小組長</th>
                    <th className="px-3 py-2 text-right">男</th>
                    <th className="px-3 py-2 text-right">女</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2 text-gray-500">{r.date_for_display}</td>
                      <td className="px-3 py-2">{r.session}</td>
                      <td className="px-3 py-2">{r.unit}</td>
                      <td className="px-3 py-2">{r.work_content}</td>
                      <td className="px-3 py-2">{r.location}</td>
                      <td className="px-3 py-2">{r.supervising_monk}</td>
                      <td className="px-3 py-2">{r.leader_name}{r.leader_phone ? `／${r.leader_phone}` : ''}</td>
                      <td className="px-3 py-2 text-right">{r.quota_male}</td>
                      <td className="px-3 py-2 text-right">{r.quota_female}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button
              onClick={handleConfirm}
              disabled={saving}
              className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-5 py-2 rounded-lg transition-colors disabled:opacity-50"
            >
              {saving ? '匯入中…' : `確認匯入（共 ${rows.length} 筆）`}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
