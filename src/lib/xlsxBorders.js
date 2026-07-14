import * as XLSX from '@e965/xlsx'
import { unzipSync, zipSync } from 'fflate'

// 之前用 <sheetView showGridLines="1"> 補「畫面格線」的做法，
// 實測寫入正確（XML 內容有驗證過）但 Excel 畫面依然不顯示，原因查不出來，已放棄不用。
// 改用「儲存格框線」(cell border)：這是實體樣式，不依賴 Excel 的畫面顯示設定，
// 列印、轉 PDF、任何版本的 Excel 開啟都會顯示。

// 欄字母（A, B, ..., Z, AA, ...）轉成數字（A=1）
function colToNum(letters) {
  let n = 0
  for (let i = 0; i < letters.length; i++) {
    n = n * 26 + (letters.charCodeAt(i) - 64)
  }
  return n
}

// 幫一個 <xf ...>...</xf> 或 <xf .../> 元素換上新的 borderId，並標記 applyBorder="1"
// 先移除舊的 borderId/applyBorder（若有），避免重複屬性
function withBorder(xfElemStr, borderIdx) {
  const stripped = xfElemStr
    .replace(/\s*borderId="\d+"/, '')
    .replace(/\s*applyBorder="[01]"/, '')
  return stripped.replace(/^<xf\b/, `<xf borderId="${borderIdx}" applyBorder="1"`)
}

/**
 * 在 xl/styles.xml 裡新增一個四邊 thin 的 border 定義，
 * 並為每一個現有的 cellXfs 樣式各自複製一份「加了框線版」，接在原本 cellXfs 後面。
 * 不直接修改原本樣式，避免改到不該加框線的儲存格。
 * @returns {{ xml: string, newBorderIndex: number, xfCount: number }} xfCount 為原本 cellXfs 數量，
 *   也是「原本 index → 框線版 index」的位移量（框線版 index = 原本 index + xfCount）
 */
function addBorderStyles(xml) {
  const bordersMatch = xml.match(/<borders count="(\d+)">([\s\S]*?)<\/borders>/)
  if (!bordersMatch) throw new Error('styles.xml 找不到 <borders> 區塊')
  const borderCount = parseInt(bordersMatch[1], 10)
  const newBorderIndex = borderCount
  const thinBorder = '<border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/><diagonal/></border>'
  let out = xml.replace(
    bordersMatch[0],
    `<borders count="${borderCount + 1}">${bordersMatch[2]}${thinBorder}</borders>`
  )

  const cellXfsMatch = out.match(/<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/)
  if (!cellXfsMatch) throw new Error('styles.xml 找不到 <cellXfs> 區塊')
  const declaredCount = parseInt(cellXfsMatch[1], 10)
  const xfs = cellXfsMatch[2].match(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g) || []
  if (xfs.length !== declaredCount) {
    console.warn(`[saveWorkbookWithBorders] cellXfs count="${declaredCount}" 與實際解析出的 ${xfs.length} 筆不一致，以實際解析結果為準`)
  }
  const xfCount = xfs.length
  const borderedXfs = xfs.map(xf => withBorder(xf, newBorderIndex))
  const newInner = cellXfsMatch[2] + borderedXfs.join('')
  out = out.replace(
    cellXfsMatch[0],
    `<cellXfs count="${xfCount + borderedXfs.length}">${newInner}</cellXfs>`
  )

  return { xml: out, newBorderIndex, xfCount }
}

// 把一個 <c ...>...</c> 或 <c .../> 元素的 s 屬性換成框線版 index（沒有 s 屬性就視為原本 index 0）
function remapCellStyle(cElemStr, xfCount) {
  const sMatch = cElemStr.match(/\bs="(\d+)"/)
  const origIdx = sMatch ? parseInt(sMatch[1], 10) : 0
  const newIdx = origIdx + xfCount
  if (sMatch) return cElemStr.replace(/\bs="\d+"/, `s="${newIdx}"`)
  return cElemStr.replace(/^<c\b/, `<c s="${newIdx}"`)
}

// 依 <dimension ref="A1:H23"/> 讀出的實際資料範圍，把範圍內每個 <c> 的樣式換成框線版
function patchSheetXml(xml, xfCount) {
  const dimMatch = xml.match(/<dimension ref="([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?"\s*\/>/)
  if (!dimMatch) {
    console.warn('[saveWorkbookWithBorders] 找不到 <dimension>，此工作表略過加框線')
    return xml
  }
  const minCol = colToNum(dimMatch[1])
  const minRow = parseInt(dimMatch[2], 10)
  const maxCol = dimMatch[3] ? colToNum(dimMatch[3]) : minCol
  const maxRow = dimMatch[4] ? parseInt(dimMatch[4], 10) : minRow

  const sheetDataMatch = xml.match(/<sheetData>([\s\S]*?)<\/sheetData>/)
  if (!sheetDataMatch) return xml

  const patchedInner = sheetDataMatch[1].replace(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g, cellStr => {
    const refMatch = cellStr.match(/\br="([A-Z]+)(\d+)"/)
    if (!refMatch) return cellStr
    const col = colToNum(refMatch[1])
    const row = parseInt(refMatch[2], 10)
    if (col < minCol || col > maxCol || row < minRow || row > maxRow) return cellStr
    return remapCellStyle(cellStr, xfCount)
  })

  return xml.replace(sheetDataMatch[0], `<sheetData>${patchedInner}</sheetData>`)
}

function triggerDownload(bytes, filename) {
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * 匯出 workbook 為 xlsx 下載，並幫「有資料的儲存格範圍」加上四邊實線框線（真正的儲存格樣式，
 * 不依賴 Excel 畫面設定，列印/轉 PDF/任何版本 Excel 開啟都會顯示）。
 */
export function saveWorkbookWithBorders(wb, filename) {
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  const files = unzipSync(new Uint8Array(buf))

  const stylesName = 'xl/styles.xml'
  if (!files[stylesName]) {
    console.warn('[saveWorkbookWithBorders] 找不到 xl/styles.xml，無法加上框線，改用原始檔案下載')
    triggerDownload(buf, filename)
    return
  }

  const stylesXml = new TextDecoder('utf-8').decode(files[stylesName])
  const { xml: newStylesXml, xfCount } = addBorderStyles(stylesXml)
  files[stylesName] = new TextEncoder().encode(newStylesXml)

  for (const name of Object.keys(files)) {
    if (/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) {
      const xml = new TextDecoder('utf-8').decode(files[name])
      const patched = patchSheetXml(xml, xfCount)
      files[name] = new TextEncoder().encode(patched)
    }
  }

  const patchedZip = zipSync(files, { level: 6 })
  triggerDownload(patchedZip, filename)
}
