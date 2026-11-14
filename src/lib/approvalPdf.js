// 職責：山上錄取名單 PDF → 純文字（給 approvalMatch 比對用）。只在瀏覽器本機讀取，不上傳、不記 log。
//
// - extractPdfText(file)：使用者按「上傳 PDF」時才 dynamic import pdfjs-dist（不進主 bundle），
//   worker 用 Vite 的 `?url` 慣例取得網址。
// - itemsToLines(items)：純函式（單元測試用），把 pdf.js 的文字項目重組成「列」：
//   依 Y 座標分群（容許少量誤差）→ 同列依 X 由左到右 → 緊貼的字直接接起來、有欄距的以空白相隔。
//   （有些 PDF 把一句話拆成一字一個項目，直接接起來才能保留「不錄取名單」等標題原字樣。）
//
// 跟 lib/pdfTextExtract.js（寮號／義工組別匯入用）分開：那支在模組頂層靜態載入 pdfjs，
// 且同列一律以空白相隔，會把逐字拆開的標題變成「不 錄 取 名 單」。

const Y_TOLERANCE = 4   // 同一列 Y 座標容許誤差（pt）；名單表列距約 20pt 以上
const JOIN_GAP = 2      // 兩個項目間距 ≤ 此值（pt）視為同一個詞，直接相連不加空白

/**
 * @param {Array<{ str: string, transform: number[], width?: number }>} items 單一頁的 textContent.items
 * @returns {string[]} 由上到下的文字列
 */
export function itemsToLines(items) {
  const rows = []
  for (const it of items || []) {
    const text = String(it?.str ?? '')
    if (!text.trim()) continue
    const x = it.transform?.[4] ?? 0
    const y = it.transform?.[5] ?? 0
    let row = rows.find(r => Math.abs(r.y - y) <= Y_TOLERANCE)
    if (!row) { row = { y, cells: [] }; rows.push(row) }
    row.cells.push({ x, end: x + (Number(it.width) || 0), hasWidth: Number(it.width) > 0, text: text.trim() })
  }
  // PDF 座標原點在左下角：Y 越大越上面
  rows.sort((a, b) => b.y - a.y)
  return rows.map(r => {
    const cells = r.cells.sort((a, b) => a.x - b.x)
    let line = ''
    let prev = null
    for (const c of cells) {
      if (prev) {
        const touching = prev.hasWidth && c.x - prev.end <= JOIN_GAP
        line += touching ? '' : ' '
      }
      line += c.text
      prev = c
    }
    return line.replace(/\s+/g, ' ').trim()
  }).filter(Boolean)
}

/** 多頁：各頁 items 依序轉成列後接起來 */
export function pagesToText(pagesItems) {
  return (pagesItems || []).flatMap(items => itemsToLines(items)).join('\n')
}

let pdfjsPromise = null
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.mjs?url'),
    ]).then(([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default
      return pdfjs
    }).catch(err => { pdfjsPromise = null; throw err })
  }
  return pdfjsPromise
}

/**
 * 讀取使用者選的 PDF（File），回傳重組後的文字
 * @param {File} file
 * @returns {Promise<{ text: string, pageCount: number, hasText: boolean }>}
 */
export async function extractPdfText(file) {
  const pdfjs = await loadPdfjs()
  const data = new Uint8Array(await file.arrayBuffer())
  const pdf = await pdfjs.getDocument({ data }).promise
  try {
    const pagesItems = []
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p)
      const content = await page.getTextContent()
      pagesItems.push(content.items)
    }
    const text = pagesToText(pagesItems)
    return { text, pageCount: pdf.numPages, hasText: text.trim().length > 0 }
  } finally {
    pdf.destroy()
  }
}
