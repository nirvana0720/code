// 共用的 pdf.js 文字抽取 helper（瀏覽器端解析文字層 PDF，非掃描檔不需 OCR）
// 給 DormitoryImportPanel / VolunteerGroupImportPanel 共用
import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl

const Y_TOLERANCE = 3 // 同一列文字 y 座標容許誤差（pt）

// 把一頁的 text items 依 y 座標分組重組成列，同列依 x 座標排序後 join
function groupItemsIntoLines(items) {
  const rows = []
  for (const item of items) {
    const text = (item.str ?? '').trim()
    if (!text) continue
    const x = item.transform[4]
    const y = item.transform[5]
    let row = rows.find(r => Math.abs(r.y - y) <= Y_TOLERANCE)
    if (!row) { row = { y, cells: [] }; rows.push(row) }
    row.cells.push({ x, text })
  }
  // PDF 座標系原點在左下角，y 越大越上面 → 由大到小排序還原閱讀順序
  rows.sort((a, b) => b.y - a.y)
  return rows
    .map(r => r.cells.sort((a, b) => a.x - b.x).map(c => c.text).join(' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

/**
 * 讀取 PDF 檔案，回傳指定頁面重組後的文字行
 * @param {File} file
 * @param {{ pages?: number[] }} opts pages 為 1-based 頁碼陣列，省略則抽取全部頁
 * @returns {Promise<Array<{ pageNum: number, lines: string[] }>>}
 */
export async function extractPdfLines(file, { pages } = {}) {
  const buf = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise
  const pageNums = pages ?? Array.from({ length: pdf.numPages }, (_, i) => i + 1)
  const result = []
  for (const pageNum of pageNums) {
    if (pageNum < 1 || pageNum > pdf.numPages) continue
    const page = await pdf.getPage(pageNum)
    const content = await page.getTextContent()
    result.push({ pageNum, lines: groupItemsIntoLines(content.items) })
  }
  return result
}
