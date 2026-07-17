// 安單寮號匯入：上傳「普宜_精舍安單總表.pdf」（全部頁數）或「精舍排寮」Excel → 依姓名比對本活動報名紀錄 → 預覽 → 確認寫入
import { useState } from 'react'
import { extractPdfLines } from '../lib/pdfTextExtract'
import { updateDormitoryRooms, parseDormitoryExcel } from '../lib/mountainDataImport'

const SOURCES = [
  { key: 'pdf', label: '安單總表 PDF' },
  { key: 'excel', label: '精舍排寮 Excel' },
]

// PDF 每列格式範例：「1 張景瑞 男 普賢寮B1 04-1 大博 2026/7/3 2026/7/5」
// 只取序號後的姓名、性別，再取性別後第一個 token 當寮房號碼
function parseDormitoryLine(line) {
  const m = line.match(/^\d+\s+([一-鿿]{2,8})\s+[男女]\s+(\S+)/)
  if (!m) return null
  return { name: m[1], room: m[2] }
}

function regDisplayName(r) {
  return r.students?.name ?? r.answers?.guest_name ?? '訪客'
}
function regClassLabel(r) {
  const classes = r.students?.student_classes ?? []
  if (classes.length === 0) return r.student_id ? '' : '訪客'
  return classes.map(c => c.class_name + (c.group_name ? ' ' + c.group_name : '')).join('/')
}

// 依姓名建立本活動報名紀錄索引
function buildNameIndex(registrations) {
  const index = new Map()
  for (const r of registrations) {
    const name = regDisplayName(r)
    if (!index.has(name)) index.set(name, [])
    index.get(name).push(r)
  }
  return index
}

export default function DormitoryImportPanel({ eventId, registrations, onImported }) {
  const [source, setSource] = useState('pdf')
  const [parsing, setParsing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [resultMsg, setResultMsg] = useState('')
  const [rows, setRows] = useState([]) // 全部解析出的列（含未找到）

  const matchedRows   = rows.filter(r => r.status !== 'notfound')
  const notFoundRows  = rows.filter(r => r.status === 'notfound')
  const matchedCount  = rows.filter(r => r.status === 'matched').length
  const duplicateCount = rows.filter(r => r.status === 'duplicate').length

  function switchSource(next) {
    setSource(next)
    setRows([])
    setError('')
    setResultMsg('')
  }

  async function handleFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setParsing(true)
    setError('')
    setResultMsg('')
    try {
      let parsed
      if (source === 'excel') {
        parsed = await parseDormitoryExcel(file)
      } else {
        const pages = await extractPdfLines(file)
        const lines = pages.flatMap(p => p.lines)
        parsed = lines.map(parseDormitoryLine).filter(Boolean)
      }
      if (parsed.length === 0) {
        setError('沒有解析出任何資料，請確認檔案格式是否正確')
        setRows([])
        setParsing(false)
        return
      }
      const index = buildNameIndex(registrations)
      const built = parsed.map((p, i) => {
        const candidates = index.get(p.name) ?? []
        if (candidates.length === 0) {
          return { key: i, name: p.name, room: p.room, status: 'notfound', registrationId: '', candidates: [], included: false }
        }
        if (candidates.length === 1) {
          return { key: i, name: p.name, room: p.room, status: 'matched', registrationId: candidates[0].registration_id, candidates, included: true }
        }
        return { key: i, name: p.name, room: p.room, status: 'duplicate', registrationId: '', candidates, included: false }
      })
      setRows(built)
    } catch (err) {
      setError((source === 'excel' ? 'Excel' : 'PDF') + '解析失敗：' + err.message)
      setRows([])
    }
    setParsing(false)
  }

  function toggleIncluded(key, included) {
    setRows(prev => prev.map(r => r.key === key ? { ...r, included } : r))
  }

  function pickCandidate(key, registrationId) {
    setRows(prev => prev.map(r => r.key === key
      ? { ...r, registrationId, included: !!registrationId }
      : r))
  }

  async function handleConfirm() {
    const matches = rows
      .filter(r => r.included && r.registrationId)
      .map(r => {
        const reg = r.candidates.find(c => c.registration_id === r.registrationId)
        return {
          registration_id: r.registrationId,
          dormitory_room: r.room,
          answers: { ...(reg?.answers ?? {}), stay_overnight: true },
        }
      })
    if (matches.length === 0) {
      setError('沒有勾選任何要寫入的資料')
      return
    }
    setSaving(true)
    setError('')
    const { success, updated, error: err } = await updateDormitoryRooms(eventId, matches)
    setSaving(false)
    if (!success) {
      setError('寫入失敗：' + err)
      return
    }
    setResultMsg(`✅ 已寫入 ${updated} 筆寮號資料`)
    setRows([])
    onImported?.()
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div>
          <h3 className="font-bold text-gray-800">🏨 安單寮號匯入</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {source === 'pdf' ? '上傳「安單總表」PDF，比對後寫入 registrations.dormitory_room' : '上傳「精舍排寮」Excel，比對後寫入 registrations.dormitory_room'}
          </p>
        </div>
        <label className="shrink-0 inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg cursor-pointer transition-colors">
          {parsing ? '解析中…' : source === 'pdf' ? '📄 上傳安單 PDF' : '📊 上傳排寮 Excel'}
          <input
            type="file"
            accept={source === 'pdf' ? '.pdf' : '.xlsx,.xls'}
            onChange={handleFile}
            disabled={parsing}
            className="hidden"
          />
        </label>
      </div>

      <div className="flex gap-2 mb-3">
        {SOURCES.map(s => (
          <button
            key={s.key}
            onClick={() => switchSource(s.key)}
            className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
              source === s.key
                ? 'bg-amber-50 text-amber-700 border-amber-300'
                : 'border-gray-300 text-gray-600 hover:bg-gray-100'
            }`}
          >
            {s.label}
          </button>
        ))}
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
                  <th className="px-3 py-2 text-left">寮房號碼</th>
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
                    <td className="px-3 py-2">{r.room}</td>
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
                    {r.name}（{r.room}）
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
