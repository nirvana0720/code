import * as XLSX from '@e965/xlsx'
import { unzipSync, zipSync } from 'fflate'

// 之前用 <sheetView showGridLines="1"> 補「畫面格線」的做法，
// 實測寫入正確（XML 內容有驗證過）但 Excel 畫面依然不顯示，原因查不出來，已放棄不用。
// 改用「儲存格框線」(cell border)：這是實體樣式，不依賴 Excel 的畫面顯示設定，
// 列印、轉 PDF、任何版本的 Excel 開啟都會顯示。
// 另外幫「項目/標籤」儲存格加淺灰底色，跟「內容」儲存格做視覺區分。

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

// 幫一個 <xf ...>...</xf> 或 <xf .../> 元素同時換上新的 borderId + fillId（標籤儲存格版：框線＋灰底）
function withBorderAndFill(xfElemStr, borderIdx, fillIdx) {
  const stripped = xfElemStr
    .replace(/\s*borderId="\d+"/, '')
    .replace(/\s*applyBorder="[01]"/, '')
    .replace(/\s*fillId="\d+"/, '')
    .replace(/\s*applyFill="[01]"/, '')
  return stripped.replace(/^<xf\b/, `<xf borderId="${borderIdx}" applyBorder="1" fillId="${fillIdx}" applyFill="1"`)
}

/**
 * 在 xl/styles.xml 裡新增：
 * - 一個四邊 thin 的 border 定義
 * - 一個淺灰色 solid 的 fill 定義（給標籤儲存格用）
 * 並為每一個現有的 cellXfs 樣式各自複製兩份：「加框線版」「框線＋灰底版」，接在原本 cellXfs 後面。
 * 不直接修改原本樣式，避免改到不該加框線/底色的儲存格。
 *
 * cellXfs 排列後變成 [原本 0..N-1] [框線版 N..2N-1] [框線＋灰底版 2N..3N-1]，
 * 其中 N = xfCount（原本 cellXfs 數量）：
 * - 內容儲存格 index = 原本 index + xfCount（框線版）
 * - 標籤儲存格 index = 原本 index + xfCount * 2（框線＋灰底版）
 * @returns {{ xml: string, xfCount: number }}
 */
function addBorderAndFillStyles(xml) {
  const bordersMatch = xml.match(/<borders count="(\d+)">([\s\S]*?)<\/borders>/)
  if (!bordersMatch) throw new Error('styles.xml 找不到 <borders> 區塊')
  const borderCount = parseInt(bordersMatch[1], 10)
  const newBorderIndex = borderCount
  const thinBorder = '<border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/><diagonal/></border>'
  let out = xml.replace(
    bordersMatch[0],
    `<borders count="${borderCount + 1}">${bordersMatch[2]}${thinBorder}</borders>`
  )

  const fillsMatch = out.match(/<fills count="(\d+)">([\s\S]*?)<\/fills>/)
  if (!fillsMatch) throw new Error('styles.xml 找不到 <fills> 區塊')
  const fillCount = parseInt(fillsMatch[1], 10)
  const newFillIndex = fillCount
  // fgColor/bgColor 都設成同一個淺灰色：OOXML 對 patternType="solid" 實際顯示用哪個顏色，
  // 不同 Excel 版本/實作認知不一致，兩個都設同色可確保無論哪個生效畫面都正確。
  const grayFill = '<fill><patternFill patternType="solid"><fgColor rgb="FFF0F0F0"/><bgColor rgb="FFF0F0F0"/></patternFill></fill>'
  out = out.replace(
    fillsMatch[0],
    `<fills count="${fillCount + 1}">${fillsMatch[2]}${grayFill}</fills>`
  )

  const cellXfsMatch = out.match(/<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/)
  if (!cellXfsMatch) throw new Error('styles.xml 找不到 <cellXfs> 區塊')
  const declaredCount = parseInt(cellXfsMatch[1], 10)
  const xfs = cellXfsMatch[2].match(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g) || []
  if (xfs.length !== declaredCount) {
    console.warn(`[saveWorkbookWithBorders] cellXfs count="${declaredCount}" 與實際解析出的 ${xfs.length} 筆不一致，以實際解析結果為準`)
  }
  const xfCount = xfs.length
  const borderOnlyXfs = xfs.map(xf => withBorder(xf, newBorderIndex))
  const borderFillXfs = xfs.map(xf => withBorderAndFill(xf, newBorderIndex, newFillIndex))
  const newInner = cellXfsMatch[2] + borderOnlyXfs.join('') + borderFillXfs.join('')
  out = out.replace(
    cellXfsMatch[0],
    `<cellXfs count="${xfCount * 3}">${newInner}</cellXfs>`
  )

  return { xml: out, xfCount }
}

// 把 <fonts> 區塊裡每一個字型的 <name val="..."/> 都換成標楷體，其餘屬性（大小、粗體等）不動。
// 同時把 <scheme val="minor"/>／val="major" 整個移除：只要 font 帶 scheme 屬性，
// Excel 顯示時會改成跟隨 xl/theme/theme1.xml 的 minorFont/majorFont typeface，
// 忽略這裡寫的 <name>（這正是之前改了 <name> 但畫面沒變成標楷體的原因），
// 拿掉 scheme 才能讓 <name> 真正生效。
function setFontToKaiti(xml) {
  const fontsMatch = xml.match(/(<fonts\b[^>]*>)([\s\S]*?)(<\/fonts>)/)
  if (!fontsMatch) {
    console.warn('[saveWorkbookWithBorders] styles.xml 找不到 <fonts> 區塊，略過字型調整')
    return xml
  }
  let patchedInner = fontsMatch[2].replace(/<name val="[^"]*"\s*\/>/g, '<name val="DFKai-SB"/>')
  patchedInner = patchedInner.replace(/<scheme val="[^"]*"\s*\/>/g, '')
  return xml.replace(fontsMatch[0], `${fontsMatch[1]}${patchedInner}${fontsMatch[3]}`)
}

// 把一個 <c ...>...</c> 或 <c .../> 元素的 s 屬性換成指定 offset 後的 index（沒有 s 屬性就視為原本 index 0）
function remapCellStyle(cElemStr, offset) {
  const sMatch = cElemStr.match(/\bs="(\d+)"/)
  const origIdx = sMatch ? parseInt(sMatch[1], 10) : 0
  const newIdx = origIdx + offset
  if (sMatch) return cElemStr.replace(/\bs="\d+"/, `s="${newIdx}"`)
  return cElemStr.replace(/^<c\b/, `<c s="${newIdx}"`)
}

// 依 <dimension ref="A1:H23"/> 讀出的實際資料範圍，把範圍內每個 <c> 的樣式換成框線版；
// 座標落在 labelCellSet 裡的則換成框線＋灰底版（標籤儲存格）
function patchSheetXml(xml, contentOffset, labelOffset, labelCellSet) {
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
    const ref = refMatch[1] + refMatch[2]
    const col = colToNum(refMatch[1])
    const row = parseInt(refMatch[2], 10)
    if (col < minCol || col > maxCol || row < minRow || row > maxRow) return cellStr
    const offset = labelCellSet.has(ref) ? labelOffset : contentOffset
    return remapCellStyle(cellStr, offset)
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
 * 不依賴 Excel 畫面設定，列印/轉 PDF/任何版本 Excel 開啟都會顯示），
 * 標籤儲存格（座標列於 labelCells）額外加淺灰底色跟內容儲存格做區分，
 * 並把整個工作表字型改成標楷體 (DFKai-SB)。
 * @param {object} wb SheetJS workbook
 * @param {string} filename 下載檔名
 * @param {string[]} [labelCells] 標籤/項目儲存格座標（例如 ['A1','A2','D1',...]），套用框線＋灰底版樣式；
 *   其餘有資料的儲存格套用框線版（無底色）樣式，適用於工作表內所有 sheet（每個 sheet 版面結構相同）
 */
export function saveWorkbookWithBorders(wb, filename, labelCells = []) {
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  const files = unzipSync(new Uint8Array(buf))

  const stylesName = 'xl/styles.xml'
  if (!files[stylesName]) {
    console.warn('[saveWorkbookWithBorders] 找不到 xl/styles.xml，無法加上框線，改用原始檔案下載')
    triggerDownload(buf, filename)
    return
  }

  const stylesXml = new TextDecoder('utf-8').decode(files[stylesName])
  const { xml: borderedFilledStylesXml, xfCount } = addBorderAndFillStyles(stylesXml)
  const newStylesXml = setFontToKaiti(borderedFilledStylesXml)
  files[stylesName] = new TextEncoder().encode(newStylesXml)

  const labelCellSet = new Set(labelCells)
  const contentOffset = xfCount
  const labelOffset = xfCount * 2

  for (const name of Object.keys(files)) {
    if (/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) {
      const xml = new TextDecoder('utf-8').decode(files[name])
      const patched = patchSheetXml(xml, contentOffset, labelOffset, labelCellSet)
      files[name] = new TextEncoder().encode(patched)
    }
  }

  const patchedZip = zipSync(files, { level: 6 })
  triggerDownload(patchedZip, filename)
}
