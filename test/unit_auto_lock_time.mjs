// 職責：「自動停止異動時間」台北時間轉換（src/lib/autoLockTime.js）的單元測試。
// 執行：node test/run_unit.mjs（或雙擊 run_unit.bat）
// 這些函式不依賴電腦時區（只用 Date.UTC／toISOString）；可用 TZ=America/New_York node ... 驗證結果相同。

import assert from 'node:assert/strict'
import { isoToTaipeiInput, taipeiInputToIso, formatTaipeiLabel, isTaipeiInputPast } from '../src/lib/autoLockTime.js'

let pass = 0, fail = 0
function test(name, fn) {
  try {
    fn()
    pass++
    console.log('✅ ' + name)
  } catch (e) {
    fail++
    console.log('❌ ' + name)
    console.log('   ' + e.message)
  }
}

test('taipeiInputToIso：台北 18:00 → UTC 10:00', () => {
  assert.equal(taipeiInputToIso('2026-11-20T18:00'), '2026-11-20T10:00:00.000Z')
})
test('taipeiInputToIso：跨日（台北凌晨 03:30 → UTC 前一天 19:30）', () => {
  assert.equal(taipeiInputToIso('2026-12-01T03:30'), '2026-11-30T19:30:00.000Z')
})
test('taipeiInputToIso：跨年（台北 1/1 00:00 → UTC 12/31 16:00）', () => {
  assert.equal(taipeiInputToIso('2027-01-01T00:00'), '2026-12-31T16:00:00.000Z')
})
test('isoToTaipeiInput：UTC 19:30 → 台北隔天 03:30（跨日）', () => {
  assert.equal(isoToTaipeiInput('2026-11-30T19:30:00.000Z'), '2026-12-01T03:30')
})
test('isoToTaipeiInput：資料庫回傳帶 +00:00 格式也可解析', () => {
  assert.equal(isoToTaipeiInput('2026-11-20T10:00:00+00:00'), '2026-11-20T18:00')
})
test('來回轉換不變', () => {
  for (const v of ['2026-11-20T18:00', '2026-02-28T23:59', '2028-02-29T00:05']) {
    assert.equal(isoToTaipeiInput(taipeiInputToIso(v)), v)
  }
})
test('清除：空值 → null／空字串，不會變成 1970 年', () => {
  assert.equal(taipeiInputToIso(''), null)
  assert.equal(taipeiInputToIso(null), null)
  assert.equal(taipeiInputToIso('亂打'), null)
  assert.equal(isoToTaipeiInput(null), '')
  assert.equal(isoToTaipeiInput(''), '')
  assert.equal(formatTaipeiLabel(null), '')
})
test('formatTaipeiLabel：顯示「○月○日 HH:mm」（台北時間）', () => {
  assert.equal(formatTaipeiLabel('2026-11-30T19:30:00.000Z'), '12月1日 03:30')
  assert.equal(formatTaipeiLabel('2026-11-20T10:00:00.000Z'), '11月20日 18:00')
})
test('isTaipeiInputPast：早於／等於現在為 true，之後為 false，空值為 false', () => {
  const now = Date.parse('2026-11-20T10:00:00.000Z') // 台北 18:00
  assert.equal(isTaipeiInputPast('2026-11-20T17:59', now), true)
  assert.equal(isTaipeiInputPast('2026-11-20T18:00', now), true)
  assert.equal(isTaipeiInputPast('2026-11-20T18:01', now), false)
  assert.equal(isTaipeiInputPast('', now), false)
})

console.log('')
console.log('=== 自動停止異動時間：' + pass + ' 過、' + fail + ' 沒過 ===')
if (fail > 0) process.exitCode = 1
