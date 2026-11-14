// 職責：山上錄取名單 PDF 文字抽取（src/lib/approvalPdf.js）的單元測試＋樣本整合驗證。
// 執行：node test/run_unit.mjs（或雙擊 run_unit.bat）
//
// (a) itemsToLines：人工造的文字項目，測分列、排序、緊貼字相連
// (b) 樣本 PDF（docs/山上名單樣本/，含真實個資，不進 git）存在時才跑：用 node 版 pdfjs 讀出文字，
//     檢查標題／CTIS 編號，再用 approvalMatch 做整合比對。
//     ⚠️ 本檔不寫死、也不印出任何樣本裡的姓名或電話：假報名者的姓名是執行時從抽出文字動態取得，
//     失敗訊息只印數量與代號。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { itemsToLines, pagesToText } from '../src/lib/approvalPdf.js'
import { matchApprovalList, CTIS_CODE_RE } from '../src/lib/approvalMatch.js'

let pass = 0, fail = 0, skip = 0
async function test(name, fn) {
  try {
    await fn()
    pass++
    console.log('✅ ' + name)
  } catch (e) {
    fail++
    console.log('❌ ' + name)
    console.log('   ' + e.message)
  }
}

// 造一個 pdf.js 文字項目：str、x、y、寬度
const it = (str, x, y, width = str.length * 10) => ({ str, transform: [1, 0, 0, 1, x, y], width })

// ── (a) itemsToLines ────────────────────────────────────────
await test('itemsToLines：依 Y 分列（上到下）、同列依 X 排序，欄位間以空白相隔', () => {
  const items = [
    it('乙', 150, 700), it('1071-F0001', 60, 701, 74), it('1', 30, 699, 6),  // 同一列，Y 有 ±1 誤差、順序打亂
    it('標題', 30, 760),
    it('2', 30, 672), it('丙', 150, 671),
  ]
  assert.deepEqual(itemsToLines(items), ['標題', '1 1071-F0001 乙', '2 丙'])
})

await test('itemsToLines：Y 差超過容許誤差就是不同列', () => {
  assert.deepEqual(itemsToLines([it('A', 10, 500), it('B', 10, 490)]), ['A', 'B'])
})

await test('itemsToLines：逐字拆開但緊貼的項目直接接起來（保留「不錄取名單」原字樣）', () => {
  const chars = '不錄取名單'.split('').map((c, i) => it(c, 100 + i * 15, 300, 15))
  assert.deepEqual(itemsToLines([...chars, it('：2 人', 175, 300, 30)]), ['不錄取名單：2 人'])
})

await test('itemsToLines：空白項目、空陣列不出錯', () => {
  assert.deepEqual(itemsToLines([it('  ', 0, 0), it('', 5, 5)]), [])
  assert.deepEqual(itemsToLines(undefined), [])
})

await test('pagesToText：多頁依序接起來', () => {
  assert.equal(pagesToText([[it('第一頁', 0, 700)], [it('第二頁', 0, 700)]]), '第一頁\n第二頁')
})

// ── (b) 樣本 PDF（存在才跑）─────────────────────────────────
const SAMPLE_DIR = fileURLToPath(new URL('../../docs/山上名單樣本/', import.meta.url))
const HUQI = SAMPLE_DIR + '護七錄取總表_樣本.pdf'
const DAQI = SAMPLE_DIR + '打七錄取總表_樣本.pdf'

async function readSample(path) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(path)), verbosity: 0 }).promise
  const pagesItems = []
  for (let p = 1; p <= pdf.numPages; p++) pagesItems.push((await (await pdf.getPage(p)).getTextContent()).items)
  await pdf.destroy()
  return pagesToText(pagesItems)
}

const codesOf = (text, re) => [...new Set(text.match(re) || [])]

// 從抽出文字動態造假報名者：每個含 CTIS 編號的列，取編號後面第一個詞當姓名
function fakeRegsFrom(text) {
  const regs = []
  for (const line of text.split('\n')) {
    const m = line.match(CTIS_CODE_RE)
    if (!m) continue
    const after = line.slice(line.indexOf(m[0]) + m[0].length).trim().split(' ')[0]
    if (after) regs.push({ registration_id: m[0], student_id: m[0], students: { name: after }, answers: {} })
  }
  return regs
}
const ids = arr => arr.map(r => r.registration_id).sort()

if (fs.existsSync(HUQI)) {
  const text = await readSample(HUQI)
  await test('樣本・護七：含「錄取名單」「不錄取名單」標題，且 5 個 1071-X0000 編號', () => {
    assert.ok(text.replace(/\s/g, '').includes('不錄取名單'), '找不到「不錄取名單」')
    assert.ok(text.split('\n').some(l => /^錄取名單/.test(l.replace(/\s/g, ''))), '找不到「錄取名單」標題列')
    assert.equal(codesOf(text, /\b\d{4}-[A-Z]\d{4}\b/g).length, 5)
  })
  await test('樣本・護七整合：approvalMatch 得到 approved 3／rejected 2', () => {
    const regs = fakeRegsFrom(text)
    assert.equal(regs.length, 5, `抽到 ${regs.length} 位假報名者`)
    const res = matchApprovalList(text, regs)
    assert.equal(res.hasSections, true)
    assert.equal(res.approved.length, 3, `approved=${res.approved.length}`)
    assert.equal(res.rejected.length, 2, `rejected=${res.rejected.length}`)
    assert.equal(res.ambiguous.length, 0)
    assert.equal(res.notFound.length, 0)
    // 不錄取段落的人，編號應在錄取者之後（依 PDF 由上到下順序）
    const order = regs.map(r => r.registration_id)
    assert.deepEqual(ids(res.rejected), order.slice(3).sort())
  })
} else { skip++; console.log('⏭️  樣本・護七：找不到樣本檔，略過') }

if (fs.existsSync(DAQI)) {
  const text = await readSample(DAQI)
  await test('樣本・打七：5 個 71-X0000 編號', () => {
    assert.equal(codesOf(text, /\b\d{2}-[A-Z]\d{4}\b/g).length, 5)
  })
  await test('樣本・打七整合：沒有段落標題，approvalMatch 得到 approved 5', () => {
    const regs = fakeRegsFrom(text)
    assert.equal(regs.length, 5, `抽到 ${regs.length} 位假報名者`)
    const res = matchApprovalList(text, regs)
    assert.equal(res.hasSections, false)
    assert.equal(res.approved.length, 5, `approved=${res.approved.length}`)
    assert.equal(res.rejected.length, 0)
    assert.equal(res.ambiguous.length, 0)
  })
} else { skip++; console.log('⏭️  樣本・打七：找不到樣本檔，略過') }

console.log('')
console.log('=== 山上名單 PDF：' + pass + ' 過、' + fail + ' 沒過' + (skip ? `、${skip} 組略過` : '') + ' ===')
if (fail > 0) process.exitCode = 1
