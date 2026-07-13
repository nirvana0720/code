import * as XLSX from '@e965/xlsx'
import { unzipSync, zipSync } from 'fflate'

// @e965/xlsx（SheetJS 免費版）寫出的 <sheetView> 不含 showGridLines 屬性，
// 部分 Excel／WPS 版本會把「沒寫」解讀成不顯示格線。套件本身沒有任何選項可以加這個屬性，
// 所以下載前直接解壓縮產生的 xlsx，補上 showGridLines="1" 後再重新打包下載。
export function saveWorkbookWithGridlines(wb, filename) {
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  const files = unzipSync(new Uint8Array(buf))

  for (const name of Object.keys(files)) {
    if (/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) {
      const xml = new TextDecoder('utf-8').decode(files[name])
      files[name] = new TextEncoder().encode(xml.replace(/<sheetView\b/, '<sheetView showGridLines="1"'))
    }
  }

  const patched = zipSync(files, { level: 6 })
  const blob = new Blob([patched], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
