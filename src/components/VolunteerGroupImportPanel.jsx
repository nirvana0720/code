// 義工組別修正匯入：上傳「71_普宜_報到總表.pdf」全頁 → 依姓名比對本活動報名紀錄 → 預覽「原組別→新組別」→ 確認寫入
import { useState } from 'react'
import { extractPdfLines } from '../lib/pdfTextExtract'
import { updateVolunteerGroups } from '../lib/mountainDataImport'

// 用完整欄位結構鎖定「真正的報到總表資料列」，避免說明文字段落被誤判、
// 也不再要求組別一定要以「組」字結尾（例如「文教中心」「大寮煮飯區」這類命名以前會被漏掉）
// 資料列格式：序號 抵寺時 姓名 法名 性別 手機 組別 發心起日期 發心起時間 發心迄日期 發心迄時間
// 例：「4 10:00 黃馨慧 傳斯 女 0986-553430 文教中心 8/22 14:00 8/23 17:30」
const ROW_RE = /^\d{1,3}\s+\d{1,2}:\d{2}\s+([一-鿿]{2,6})\s+[一-鿿]{1,6}\s+[男女]\s+\d{4}-\d{4,6}\s+(.+?)\s+\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2}/

function parseVolunteerLine(line) {
  const m = line.match(ROW_RE)
  if (!m) return null
  return { name: m[1], group: m[2].trim() }
}

function regDisplayName(r) {
  return r.students?.name ?? r.answers?.guest_name ?? '訪客'
}
function regClassLabel(r) {
  const classes = r.students?.student_classes ?? []
  if (classes.length === 0) return r.student_id ? '' : '訪客'
  return classes.map(c => c.class_name + (c.group_name ? ' ' + c.group_name : '')).join('/')
}

function buildNameIndex(registrations) {
  const index = new Map()
  for (const r of registrations) {
    const name = regDisplayName(r)
    if (!index.has(name)) index.set(name, [])
    index.get(name).push(r)
  }
  return index
}

export default function VolunteerGroupImportPanel({ eventId, registrations, onImported }) {
  const [parsing, setParsing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [resultMsg, setResultMsg] = useState('')
  const [rows, setRows] = useState([])

  const matchedRows    = rows.filter(r => r.status !== 'notfound')
  const notFoundRows   = rows.filter(r => r.status === 'notfound')
  const matchedCount   = rows.filter(r => r.status === 'matched').length
  const duplicateCount = rows.filter(r => r.status === 'duplicate').length

  async function handleFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setParsing(true)
    setError('')
    setResultMsg('')
    try {
      const allPages = await extractPdfLines(file)
      const lines = allPages.flatMap(p => p.lines)
      const parsed = lines.map(parseVolunteerLine).filter(Boolean)
      if (parsed.length === 0) {
        setError('沒有解析出任何資料，請確認 PDF 格式是否正確')
        setRows([])
        setParsing(false)
        return
      }
      const index = buildNameIndex(registrations)
      const built = parsed.map((p, i) => {
        const candidates = index.get(p.name) ?? []
        if (candidates.length === 0) {
          return { key: i, name: p.name, group: p.group, status: 'notfound', registrationId: '', candidates: [], included: false }
        }
        if (candidates.length === 1) {
          return {
            key: i, name: p.name, group: p.group, status: 'matched',
            registrationId: candidates[0].registration_id, candidates, included: true,
            oldGroup: candidates[0].answers?.volunteer_group ?? '',
          }
        }
        return { key: i, name: p.name, group: p.group, status: 'duplicate', registrationId: '', candidates, included: false, oldGroup: '' }
      })
      setRows(built)
    } catch (err) {
      setError('PDF 解析失敗：' + err.message)
      setRows([])
    }
    setParsing(false)
  }

  function toggleIncluded(key, included) {
    setRows(prev => prev.map(r => r.key === key ? { ...r, included } : r))
  }

  function pickCandidate(key, registrationId) {
    setRows(prev => prev.map(r => {
      if (r.key !== key) return r
      const cand = r.candidates.find(c => c.registration_id === registrationId)
      return { ...r, registrationId, included: !!registrationId, oldGroup: cand?.answers?.volunteer_group ?? '' }
    }))
  }

  async function handleConfirm() {
    const matches = rows
      .filter(r => r.included && r.registrationId)
      .map(r => {
        const reg = r.candidates.find(c => c.registration_id === r.registrationId)
        return {
          registration_id: r.registrationId,
          answers: { ...(reg?.answers ?? {}), volunteer_group: r.group },
        }
      })
    if (matches.length === 0) {
      setError('沒有勾選任何要寫入的資料')
      return
    }
    setSaving(true)
    setError('')
    const { success, updated, error: err } = await updateVolunteerGroups(eventId, matches)
    setSaving(false)
    if (!success) {
      setError('寫入失敗：' + err)
      return
    }
    setResultMsg(`✅ 已寫入 ${updated} 筆義工組別`)
    setRows([])
    onImported?.()
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div>
          <h3 className="font-bold text-gray-800">🛠 義工組別修正</h3>
          <p className="text-xs text-gray-500 mt-0.5">上傳「報到總表」PDF，比對後寫入 answers.volunteer_group（原始值，不限預設選項）</p>
        </div>
        <label className="shrink-0 inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg cursor-pointer transition-colors">
          {parsing ? '解析中…' : '📄 上傳報到總表 PDF'}
          <input type="file" accept=".pdf" onChange={handleFile} disabled={parsing} className="hidden" />
        </label>
      </div>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
      {resultMsg && <p className="text-sm text-green-700 mb-3">{resultMsg}</p>}

      {rows.length > 0 && (
        <>
          <div className="flex gap-4 text-sm mb-3 flex-wrap">
            <span className="text-green-700">✅ 匹配 {matchedCount} 筆</span>
            <span className="text-amber-700">⚠️ 重複姓名 {duplicateCount} 筆</span>
            <span className="text-gray-500">❌ 未找到 {notFoundRows.length} 筆</span>
          </div>

          <div className="overflow-x-auto border border-gray-200 rounded-lg mb-4">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-3 py-2 text-left w-10">納入</th>
                  <th className="px-3 py-2 text-left">狀態</th>
                  <th className="px-3 py-2 text-left">姓名</th>
                  <th className="px-3 py-2 text-left">原組別 → 新組別</th>
                  <th className="px-3 py-2 text-left">對應報名紀錄</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {matchedRows.map(r => (
                  <tr key={r.key} className={r.status === 'duplicate' ? 'bg-amber-50/50' : ''}>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={r.included}
                        disabled={r.status === 'duplicate' && !r.registrationId}
                        onChange={e => toggleIncluded(r.key, e.target.checked)}
                        className="w-4 h-4 accent-blue-600"
                      />
                    </td>
                    <td className="px-3 py-2">
                      {r.status === 'matched' ? '✅' : '⚠️ 重複姓名'}
                    </td>
                    <td className="px-3 py-2">{r.name}</td>
                    <td className="px-3 py-2">
                      <span className="text-gray-400">{r.oldGroup || '（無）'}</span>
                      <span className="mx-1 text-gray-300">→</span>
                      <span className="font-medium text-gray-800">{r.group}</span>
                    </td>
                    <td className="px-3 py-2">
                      {r.status === 'matched' ? (
                        <span className="text-gray-600">
                          {r.candidates[0]?.student_id ?? ''} {regClassLabel(r.candidates[0])}
                        </span>
                      ) : (
                        <select
                          value={r.registrationId}
                          onChange={e => pickCandidate(r.key, e.target.value)}
                          className="border border-amber-300 rounded px-2 py-1 text-sm"
                        >
                          <option value="">請選擇…</option>
                          {r.candidates.map(c => (
                            <option key={c.registration_id} value={c.registration_id}>
                              {c.student_id ?? '訪客'}　{regClassLabel(c)}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {notFoundRows.length > 0 && (
            <div className="mb-4">
              <p className="text-xs text-gray-500 mb-1">❌ 未找到（不在本活動報名紀錄中，不會寫入）</p>
              <div className="flex flex-wrap gap-2">
                {notFoundRows.map(r => (
                  <span key={r.key} className="text-xs bg-gray-100 text-gray-500 rounded-full px-2 py-1">
                    {r.name}（{r.group}）
                  </span>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={handleConfirm}
            disabled={saving}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-5 py-2 rounded-lg transition-colors disabled:opacity-50"
          >
            {saving ? '寫入中…' : '確認匯入'}
          </button>
        </>
      )}
    </div>
  )
}
