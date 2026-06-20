import { useEffect, useState, useCallback, useRef } from 'react'
import * as XLSX from '@e965/xlsx'
import AdminLayout from '../../components/AdminLayout'
import { getAllStudents, importStudents, setStudentActive } from '../../lib/supabase'

// ── 下載模板 ─────────────────────────────────────────────────
function downloadTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([
    ['學員編號', '姓名', '班級', '組別'],
    ['115005662', '王大明', '初級日間班', '1 組'],
    ['115005663', '李小華', '中級夜間班', ''],
  ])
  ws['!cols'] = [{ wch: 14 }, { wch: 10 }, { wch: 16 }, { wch: 10 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '學員名單')
  XLSX.writeFile(wb, '學員匯入模板.xlsx')
}

// ── 欄位映射：支援多種中文表頭名稱 ────────────────────────────
const COL_ALIASES = {
  student_id: ['學員編號', '編號', 'student_id', 'StudentID'],
  name: ['姓名', 'name', 'Name'],
  class_name: ['班級', '班別', 'class_name', 'ClassName'],
  group_name: ['組別', 'group_name', 'GroupName'],
}

function mapRow(rawRow) {
  const keys = Object.keys(rawRow)
  const row = {}
  for (const [field, aliases] of Object.entries(COL_ALIASES)) {
    const key = keys.find(k => aliases.includes(k.trim()))
    row[field] = key ? String(rawRow[key] ?? '').trim() : ''
  }
  return row
}

// ── 匯出名單 ─────────────────────────────────────────────────
async function exportStudents() {
  const { students: all } = await getAllStudents('')
  const active = all.filter(s => s.active !== false)
  active.sort((a, b) => String(a.student_id).localeCompare(String(b.student_id)))

  const rows = [['學員編號', '姓名', '班級', '組別']]
  for (const s of active) {
    if (s.student_classes && s.student_classes.length > 0) {
      for (const c of s.student_classes) {
        rows.push([s.student_id, s.name, c.class_name || '', c.group_name || ''])
      }
    } else {
      rows.push([s.student_id, s.name, '', ''])
    }
  }

  const today = new Date()
  const ymd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`
  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [{ wch: 14 }, { wch: 10 }, { wch: 16 }, { wch: 10 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '學員主檔')
  XLSX.writeFile(wb, `學員主檔_匯出_${ymd}.xlsx`)
}

// ── 主頁面 ──────────────────────────────────────────────────
const EMPTY_FORM = { student_id: '', name: '', class_name: '', group_name: '' }

export default function StudentsPage() {
  const [students, setStudents] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [showInactive, setShowInactive] = useState(false)

  // 匯入狀態
  const [importModal, setImportModal] = useState(false)
  const [importRows, setImportRows] = useState([])
  const [parseError, setParseError] = useState('')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)
  const [classMode, setClassMode] = useState('replace')
  const [deactivateMissing, setDeactivateMissing] = useState(false)
  const fileInputRef = useRef(null)

  // 單筆新增狀態
  const [addModal, setAddModal] = useState(false)
  const [addForm, setAddForm] = useState(EMPTY_FORM)
  const [addError, setAddError] = useState('')
  const [addSaving, setAddSaving] = useState(false)
  const [addSuccess, setAddSuccess] = useState(false)

  // 單筆衝突詢問 modal
  const [conflictModal, setConflictModal] = useState(false)
  const [pendingAddRow, setPendingAddRow] = useState(null)

  const load = useCallback(async (q = '') => {
    setLoading(true)
    const { students: data } = await getAllStudents(q)
    setStudents(data)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const t = setTimeout(() => load(search), 300)
    return () => clearTimeout(t)
  }, [search, load])

  // ── 軟刪除操作 ──────────────────────────────────────────
  async function handleSetActive(student, active) {
    if (!active) {
      const ok = window.confirm(
        `確定將「${student.name}」標記為未在籍？\n資料會保留，QR 仍可查，只是不再列為在籍學員。`
      )
      if (!ok) return
    }
    await setStudentActive(student.student_id, active)
    await load(search)
  }

  // ── 選檔後解析 ──────────────────────────────────────────
  function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setParseError('')
    setImportResult(null)
    setClassMode('replace')
    setDeactivateMissing(false)

    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const workbook = XLSX.read(ev.target.result, { type: 'array' })
        const sheet = workbook.Sheets[workbook.SheetNames[0]]
        const raw = XLSX.utils.sheet_to_json(sheet, { defval: '' })

        if (raw.length === 0) {
          setParseError('檔案是空的，請確認格式正確')
          return
        }

        const rows = raw.map(mapRow).filter(r => r.student_id && r.name)

        if (rows.length === 0) {
          setParseError('找不到有效資料，請確認有「學員編號」和「姓名」欄位')
          return
        }

        setImportRows(rows)
        setImportModal(true)
      } catch (err) {
        setParseError(`解析失敗：${err.message}`)
      }
    }
    reader.readAsArrayBuffer(file)
    e.target.value = ''
  }

  // ── 確認匯入 ────────────────────────────────────────────
  async function handleImport() {
    setImporting(true)
    const { success, imported, error } = await importStudents(importRows, { classMode, deactivateMissing })
    setImporting(false)

    if (!success) {
      setParseError(`匯入失敗：${error}`)
      return
    }

    setImportResult({ imported })
    await load()
  }

  function closeImportModal() {
    setImportModal(false)
    setImportRows([])
    setParseError('')
    setImportResult(null)
    setClassMode('replace')
    setDeactivateMissing(false)
  }

  // ── 單筆新增 ──────────────────────────────────────────────
  function openAddModal() {
    setAddForm(EMPTY_FORM)
    setAddError('')
    setAddSuccess(false)
    setAddModal(true)
  }

  function closeAddModal() {
    setAddModal(false)
    setConflictModal(false)
    setPendingAddRow(null)
  }

  async function doAddStudent(row, mode) {
    setAddSaving(true)
    const { success, error } = await importStudents([row], { classMode: mode })
    setAddSaving(false)
    if (!success) return setAddError(`儲存失敗：${error}`)
    setAddSuccess(true)
    await load()
  }

  async function handleAddStudent(e) {
    e.preventDefault()
    const { student_id, name, class_name, group_name } = addForm
    if (!student_id.trim()) return setAddError('學員編號為必填')
    if (!name.trim()) return setAddError('姓名為必填')

    setAddError('')

    const row = {
      student_id: student_id.trim(),
      name: name.trim(),
      class_name: class_name.trim(),
      group_name: group_name.trim(),
    }

    // 判斷是否已有班級 → 詢問合併或覆蓋
    const existing = students.find(s => s.student_id === row.student_id)
    if (existing && existing.student_classes && existing.student_classes.length > 0) {
      setPendingAddRow(row)
      setConflictModal(true)
      return
    }

    await doAddStudent(row, 'replace')
  }

  // 計算匯入預覽中有幾位學員原本已有班級
  const importedIds = new Set(importRows.map(r => r.student_id))
  const conflictCount = students.filter(
    s => importedIds.has(s.student_id) && s.student_classes && s.student_classes.length > 0
  ).length
  const uniqueStudentCount = importedIds.size

  // 依 showInactive 過濾列表
  const visibleStudents = showInactive ? students : students.filter(s => s.active !== false)

  return (
    <AdminLayout>
      {/* ── 單筆新增 Modal ── */}
      {addModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">

            {/* 班級衝突詢問 */}
            {conflictModal ? (
              <div>
                <h3 className="text-lg font-bold text-gray-800 mb-2">學員已有班級紀錄</h3>
                <p className="text-sm text-gray-600 mb-5">
                  「{pendingAddRow?.name}」目前已有班級。請選擇處理方式：
                </p>
                <div className="flex flex-col gap-3">
                  <button
                    disabled={addSaving}
                    onClick={async () => {
                      setConflictModal(false)
                      await doAddStudent(pendingAddRow, 'merge')
                      setPendingAddRow(null)
                    }}
                    className="w-full bg-green-600 hover:bg-green-700 text-white font-medium py-2.5 rounded-xl transition-colors disabled:opacity-50"
                  >
                    合併（保留原班級，加上這個新班級）
                  </button>
                  <button
                    disabled={addSaving}
                    onClick={async () => {
                      setConflictModal(false)
                      await doAddStudent(pendingAddRow, 'replace')
                      setPendingAddRow(null)
                    }}
                    className="w-full bg-red-500 hover:bg-red-600 text-white font-medium py-2.5 rounded-xl transition-colors disabled:opacity-50"
                  >
                    覆蓋（清掉原班級，只留這次填的）
                  </button>
                  <button
                    onClick={() => { setConflictModal(false); setPendingAddRow(null) }}
                    className="w-full border border-gray-300 text-gray-600 hover:bg-gray-50 font-medium py-2.5 rounded-xl transition-colors"
                  >
                    取消
                  </button>
                </div>
                {addError && (
                  <p className="text-sm text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-3">
                    {addError}
                  </p>
                )}
              </div>
            ) : addSuccess ? (
              <div className="text-center py-8">
                <div className="text-5xl mb-4">✅</div>
                <p className="text-xl font-bold text-gray-800 mb-2">新增完成</p>
                <p className="text-gray-500 mb-6">
                  學員「<span className="font-medium text-amber-700">{addForm.name}</span>」已儲存
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => { setAddSuccess(false); setAddForm(EMPTY_FORM) }}
                    className="flex-1 border border-gray-300 text-gray-600 hover:bg-gray-50 font-medium py-2.5 rounded-xl transition-colors"
                  >
                    繼續新增
                  </button>
                  <button
                    onClick={closeAddModal}
                    className="flex-1 bg-amber-700 hover:bg-amber-800 text-white font-medium py-2.5 rounded-xl transition-colors"
                  >
                    關閉
                  </button>
                </div>
              </div>
            ) : (
              <>
                <h3 className="text-lg font-bold text-gray-800 mb-5">新增學員</h3>
                <form onSubmit={handleAddStudent} className="flex flex-col gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      學員編號 <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={addForm.student_id}
                      onChange={e => setAddForm(f => ({ ...f, student_id: e.target.value }))}
                      placeholder="例：115005662"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      姓名 <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={addForm.name}
                      onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
                      placeholder="例：王大明"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">班級</label>
                    <input
                      type="text"
                      value={addForm.class_name}
                      onChange={e => setAddForm(f => ({ ...f, class_name: e.target.value }))}
                      placeholder="例：初級日間班（可留空）"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">組別</label>
                    <input
                      type="text"
                      value={addForm.group_name}
                      onChange={e => setAddForm(f => ({ ...f, group_name: e.target.value }))}
                      placeholder="例：1 組（可留空）"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                  </div>

                  {addError && (
                    <p className="text-sm text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                      {addError}
                    </p>
                  )}

                  <p className="text-xs text-gray-400">
                    若學員編號已存在且已有班級，會詢問要合併或覆蓋
                  </p>

                  <div className="flex gap-3 mt-1">
                    <button
                      type="button"
                      onClick={closeAddModal}
                      className="flex-1 border border-gray-300 text-gray-600 hover:bg-gray-50 font-medium py-2.5 rounded-xl transition-colors"
                    >
                      取消
                    </button>
                    <button
                      type="submit"
                      disabled={addSaving}
                      className="flex-1 bg-amber-700 hover:bg-amber-800 text-white font-medium py-2.5 rounded-xl transition-colors disabled:opacity-50"
                    >
                      {addSaving ? '儲存中…' : '儲存'}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── 匯入 Modal ── */}
      {importModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl p-6 max-h-[88vh] flex flex-col">

            {importResult ? (
              /* ── 匯入完成畫面 ── */
              <div className="text-center py-10">
                <div className="text-5xl mb-4">✅</div>
                <p className="text-xl font-bold text-gray-800 mb-2">匯入完成</p>
                <p className="text-gray-500">
                  成功更新 <span className="font-bold text-amber-700">{importResult.imported}</span> 位學員
                </p>
                <button
                  onClick={closeImportModal}
                  className="mt-8 bg-amber-700 hover:bg-amber-800 text-white font-medium px-10 py-2.5 rounded-xl transition-colors"
                >
                  關閉
                </button>
              </div>
            ) : (
              /* ── 預覽畫面 ── */
              <>
                <h3 className="text-lg font-bold text-gray-800 mb-1">確認匯入學員資料</h3>
                <p className="text-sm text-gray-500 mb-3">
                  解析到 <span className="font-bold text-amber-700">{uniqueStudentCount}</span> 位學員、
                  <span className="font-bold text-amber-700">{importRows.length}</span> 筆班別紀錄
                  <span className="text-gray-400">（同一學員多個班別算多筆）</span>
                  {conflictCount > 0 && (
                    <span className="ml-2 text-orange-600 font-medium">
                      ・其中 {conflictCount} 位學員原本已有班級紀錄
                    </span>
                  )}
                </p>

                {parseError && (
                  <p className="text-sm text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">
                    {parseError}
                  </p>
                )}

                {/* 預覽表格 */}
                <div className="flex-1 overflow-auto border border-gray-200 rounded-xl mb-4 min-h-0">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0">
                      <tr className="bg-gray-50 border-b border-gray-100">
                        <th className="text-left px-3 py-2 font-medium text-gray-600">學員編號</th>
                        <th className="text-left px-3 py-2 font-medium text-gray-600">姓名</th>
                        <th className="text-left px-3 py-2 font-medium text-gray-600">班級</th>
                        <th className="text-left px-3 py-2 font-medium text-gray-600">組別</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importRows.slice(0, 100).map((r, i) => (
                        <tr key={i} className="border-b border-gray-50 hover:bg-amber-50/30">
                          <td className="px-3 py-2 font-mono text-gray-500">{r.student_id}</td>
                          <td className="px-3 py-2 font-medium text-gray-800">{r.name}</td>
                          <td className="px-3 py-2 text-gray-600">{r.class_name || <span className="text-gray-300">—</span>}</td>
                          <td className="px-3 py-2 text-gray-500">{r.group_name || <span className="text-gray-300">—</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {importRows.length > 100 && (
                    <p className="text-xs text-gray-400 text-center py-2">僅顯示前 100 筆，共 {importRows.length} 筆</p>
                  )}
                </div>

                {/* C：班級處理方式 */}
                <div className="border border-gray-200 rounded-xl px-4 py-3 mb-3">
                  <p className="text-sm font-medium text-gray-700 mb-2">班級處理方式</p>
                  <div className="flex gap-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="classMode"
                        value="replace"
                        checked={classMode === 'replace'}
                        onChange={() => setClassMode('replace')}
                        className="accent-amber-700"
                      />
                      <span className="text-sm text-gray-700">覆蓋（檔案為準，整個換掉）</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="classMode"
                        value="merge"
                        checked={classMode === 'merge'}
                        onChange={() => setClassMode('merge')}
                        className="accent-amber-700"
                      />
                      <span className="text-sm text-gray-700">合併（保留原班級，新增去重）</span>
                    </label>
                  </div>
                </div>

                {/* B：完整名單退場 */}
                <div className="border border-orange-200 bg-orange-50 rounded-xl px-4 py-3 mb-4">
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={deactivateMissing}
                      onChange={e => setDeactivateMissing(e.target.checked)}
                      className="mt-0.5 accent-orange-600"
                    />
                    <div>
                      <span className="text-sm font-medium text-orange-800">
                        這是完整在籍名單 — 名單中未出現的學員自動標記為未在籍
                      </span>
                      <p className="text-xs text-orange-600 mt-0.5">
                        只有當這份檔案包含本學期所有在籍學員時才勾選。
                      </p>
                    </div>
                  </label>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={closeImportModal}
                    className="flex-1 border border-gray-300 text-gray-600 hover:bg-gray-50 font-medium py-2.5 rounded-xl transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleImport}
                    disabled={importing}
                    className="flex-1 bg-amber-700 hover:bg-amber-800 text-white font-medium py-2.5 rounded-xl transition-colors disabled:opacity-50"
                  >
                    {importing ? '匯入中…' : '確認匯入'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── 頁首 ── */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gray-800">學員管理</h2>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-400">{visibleStudents.length} 位</span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={handleFileChange}
          />
          <button
            onClick={downloadTemplate}
            className="border border-gray-300 text-gray-600 hover:bg-gray-50 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            📋 下載模板
          </button>
          <button
            onClick={exportStudents}
            className="border border-gray-300 text-gray-600 hover:bg-gray-50 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            📤 匯出名單
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="border border-amber-700 text-amber-700 hover:bg-amber-50 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            📥 匯入學員
          </button>
          <button
            onClick={openAddModal}
            className="bg-amber-700 hover:bg-amber-800 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            ＋ 新增學員
          </button>
        </div>
      </div>

      {/* 解析失敗提示（modal 外） */}
      {parseError && !importModal && (
        <p className="text-sm text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">
          {parseError}
        </p>
      )}

      {/* 匯入格式說明 */}
      <p className="text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2 mb-4">
        支援 Excel（.xlsx / .xls）及 CSV。需包含欄位：<span className="font-medium text-gray-500">學員編號、姓名、班級、組別</span>。同學員多個班別請用多列。
      </p>

      {/* 搜尋 + 顯示未在籍開關 */}
      <div className="flex items-center gap-4 mb-4">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="搜尋姓名…"
          className="w-full sm:w-72 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
        />
        <label className="flex items-center gap-2 cursor-pointer select-none whitespace-nowrap">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={e => setShowInactive(e.target.checked)}
            className="accent-amber-700"
          />
          <span className="text-sm text-gray-500">顯示未在籍</span>
        </label>
      </div>

      {/* 學員列表 */}
      {loading ? (
        <p className="text-gray-400 text-sm text-center py-12">載入中…</p>
      ) : visibleStudents.length === 0 ? (
        <p className="text-gray-400 text-sm text-center py-12">找不到學員</p>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-600">學員編號</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">姓名</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">班別</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">狀態</th>
              </tr>
            </thead>
            <tbody>
              {visibleStudents.map(s => {
                const inactive = s.active === false
                return (
                  <tr
                    key={s.student_id}
                    className={`border-b border-gray-50 ${inactive ? 'bg-gray-50' : 'hover:bg-amber-50/30'}`}
                  >
                    <td className={`px-4 py-3 font-mono text-xs ${inactive ? 'text-gray-300' : 'text-gray-500'}`}>
                      {s.student_id}
                    </td>
                    <td className={`px-4 py-3 font-medium ${inactive ? 'text-gray-400' : 'text-gray-800'}`}>
                      {s.name}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {s.student_classes && s.student_classes.length > 0
                        ? s.student_classes.map((c, i) => (
                            <span
                              key={i}
                              className={`inline-block text-xs px-2 py-0.5 rounded mr-1 mb-0.5 ${
                                inactive
                                  ? 'bg-gray-100 text-gray-400'
                                  : 'bg-amber-50 text-amber-700'
                              }`}
                            >
                              {c.class_name}{c.group_name ? `・${c.group_name}` : ''}
                            </span>
                          ))
                        : <span className="text-gray-300">—</span>
                      }
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {inactive ? (
                          <>
                            <span className="text-gray-400 text-xs">未在籍</span>
                            <button
                              onClick={() => handleSetActive(s, true)}
                              className="text-xs text-green-600 border border-green-300 hover:bg-green-50 px-2 py-0.5 rounded transition-colors"
                            >
                              恢復在籍
                            </button>
                          </>
                        ) : (
                          <>
                            <span className="text-green-600 text-xs font-medium">在籍</span>
                            <button
                              onClick={() => handleSetActive(s, false)}
                              className="text-xs text-gray-400 border border-gray-300 hover:bg-red-50 hover:text-red-500 hover:border-red-300 px-2 py-0.5 rounded transition-colors"
                            >
                              標記未在籍
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </AdminLayout>
  )
}
