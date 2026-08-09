// 職責：多日回山活動「分時段」核心判斷邏輯的單元測試（純函式，不連線 Supabase）
// 執行：node test/unit_slot_logic.mjs（Node 原生支援 ESM，不用另外裝東西／不用建置）
//
// 為什麼跟 test/run.js 分開一支檔案：run.js 只用 anon key 打 Supabase RPC/REST，
// 而 syncTimeSlotFields／cleanupOppositeMultiDayFields／saveCarArrangement／
// getCarArrangement 這些新函式都要 authenticated（後台登入）角色才能寫入
// event_fields／car_assignments（實測 anon INSERT event_fields 會被 RLS 擋下，
// 42501），跟 README.txt「暫緩未做」段落列的其他後台函式屬於同一個已知限制，
// 這支測試harness 目前沒有 Auth 登入能力，測不到。
//
// 這支檔案改測「這些 DB 寫入動作背後依賴的純判斷邏輯」──分時段活動最容易出錯、
// 也最需要保護的地方（answers 怎麼反推出日期/方向/時段、is_lodging 什麼時候該
// 顯示/必填、state key 怎麼組），且完全不依賴網路或 DB schema 是否已套用新
// migration，可以直接跑。

import assert from 'node:assert/strict'
import {
  resolveSlotBasedAttendSlots,
  isSlotBasedAnswers,
  countDistinctSlotDays,
  isInSlot,
  isFieldVisible,
  getVisibleRequiredFields,
} from '../src/lib/attendDateHelpers.js'
import { keyFor } from '../src/lib/carrangeHelpers.js'
import { timeSlotsFor, overrideStateKey } from '../src/lib/carSlotHelpers.js'

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

// ── isSlotBasedAnswers ──────────────────────────────────────────
test('isSlotBasedAnswers：有 slot_up_xxx key 視為分時段答案', () => {
  assert.equal(isSlotBasedAnswers({ 'slot_up_2026-08-06': '上午' }), true)
})
test('isSlotBasedAnswers：只有 attend_dates（舊模式）不算分時段答案', () => {
  assert.equal(isSlotBasedAnswers({ attend_dates: ['2026-08-06'] }), false)
})
test('isSlotBasedAnswers：空 answers 回傳 false', () => {
  assert.equal(isSlotBasedAnswers(null), false)
  assert.equal(isSlotBasedAnswers({}), false)
})

// ── resolveSlotBasedAttendSlots ─────────────────────────────────
test('resolveSlotBasedAttendSlots：只填一天（去程+回程都填）解析出 2 筆，日期方向正確', () => {
  const answers = { 'slot_up_2026-08-06': '上午', 'slot_down_2026-08-06': '下午' }
  const slots = resolveSlotBasedAttendSlots(answers)
  assert.equal(slots.length, 2)
  assert.deepEqual(slots.map(s => s.direction).sort(), ['down', 'up'])
  assert.ok(slots.every(s => s.date === '2026-08-06'))
})
test('resolveSlotBasedAttendSlots：留白的時段題（值為空字串）不計入', () => {
  const answers = { 'slot_up_2026-08-06': '上午', 'slot_down_2026-08-06': '' }
  const slots = resolveSlotBasedAttendSlots(answers)
  assert.equal(slots.length, 1)
  assert.equal(slots[0].direction, 'up')
})
test('resolveSlotBasedAttendSlots：兩天不同時段，依日期排序，timeSlot 正確帶出', () => {
  const answers = {
    'slot_up_2026-08-07': '中午',
    'slot_up_2026-08-06': '上午',
    'slot_down_2026-08-07': '下午',
  }
  const slots = resolveSlotBasedAttendSlots(answers)
  assert.equal(slots.length, 3)
  assert.equal(slots[0].date, '2026-08-06')
  assert.equal(slots[0].timeSlot, '上午')
  const d07 = slots.filter(s => s.date === '2026-08-07')
  assert.equal(d07.find(s => s.direction === 'up').timeSlot, '中午')
  assert.equal(d07.find(s => s.direction === 'down').timeSlot, '下午')
})

// ── countDistinctSlotDays（is_lodging 顯示/必填門檻用）─────────────
test('countDistinctSlotDays：只填一天 → 1', () => {
  const answers = { 'slot_up_2026-08-06': '上午', 'slot_down_2026-08-06': '下午' }
  assert.equal(countDistinctSlotDays(answers), 1)
})
test('countDistinctSlotDays：填兩個不同日期 → 2', () => {
  const answers = { 'slot_up_2026-08-06': '上午', 'slot_up_2026-08-07': '中午' }
  assert.equal(countDistinctSlotDays(answers), 2)
})

// ── isInSlot（含分時段 + 向下相容舊 attend_dates 模式）──────────────
test('isInSlot：分時段模式，date+direction+timeSlot 都符合才算命中', () => {
  const answers = { 'slot_up_2026-08-06': '上午' }
  assert.equal(isInSlot(answers, '2026-08-06', 'up', '上午'), true)
  assert.equal(isInSlot(answers, '2026-08-06', 'up', '中午'), false)
  assert.equal(isInSlot(answers, '2026-08-06', 'down', '上午'), false)
})
test('isInSlot：不帶 selectedTimeSlot（傳 null）時只比對 date+direction，向下相容舊呼叫端', () => {
  const answers = { 'slot_up_2026-08-06': '上午' }
  assert.equal(isInSlot(answers, '2026-08-06', 'up'), true)
})
test('isInSlot：單日活動（selectedDate 傳 null）一律視為命中', () => {
  assert.equal(isInSlot({}, null, 'up'), true)
})
test('isInSlot：舊 attend_dates 模式（非分時段答案）行為不受影響', () => {
  const answers = { attend_dates: ['2026-08-06', '2026-08-07'], is_lodging: true }
  // 掛單：只需要頭尾兩天
  assert.equal(isInSlot(answers, '2026-08-06', 'up'), true)
  assert.equal(isInSlot(answers, '2026-08-07', 'down'), true)
  assert.equal(isInSlot(answers, '2026-08-06', 'down'), false)
})

// ── isFieldVisible / getVisibleRequiredFields（DynamicForm + Kiosk 共用邏輯）──
const slotFields = [
  { field_key: 'slot_up_2026-08-06', field_label: '8/6 去程時段', field_type: 'radio', required: false },
  { field_key: 'slot_down_2026-08-06', field_label: '8/6 回程時段', field_type: 'radio', required: false },
  { field_key: 'slot_up_2026-08-07', field_label: '8/7 去程時段', field_type: 'radio', required: false },
  { field_key: 'slot_down_2026-08-07', field_label: '8/7 回程時段', field_type: 'radio', required: false },
  { field_key: 'is_lodging', field_label: '是否掛單', field_type: 'boolean', required: true },
]

test('isFieldVisible：分時段活動只填一天，is_lodging 不顯示（也就不會被列入必填）', () => {
  const answers = { 'slot_up_2026-08-06': '上午', 'slot_down_2026-08-06': '下午' }
  const field = slotFields.find(f => f.field_key === 'is_lodging')
  assert.equal(isFieldVisible(field, answers, slotFields), false)
})
test('isFieldVisible：分時段活動填兩天，is_lodging 才顯示', () => {
  const answers = { 'slot_up_2026-08-06': '上午', 'slot_up_2026-08-07': '中午' }
  const field = slotFields.find(f => f.field_key === 'is_lodging')
  assert.equal(isFieldVisible(field, answers, slotFields), true)
})
test('getVisibleRequiredFields：只填一天時，is_lodging 不在必填清單內', () => {
  const answers = { 'slot_up_2026-08-06': '上午', 'slot_down_2026-08-06': '下午' }
  const required = getVisibleRequiredFields(slotFields, answers)
  assert.ok(!required.some(f => f.field_key === 'is_lodging'), 'is_lodging 不該出現在必填清單')
})
test('getVisibleRequiredFields：填兩天時，is_lodging 進入必填清單', () => {
  const answers = { 'slot_up_2026-08-06': '上午', 'slot_up_2026-08-07': '中午' }
  const required = getVisibleRequiredFields(slotFields, answers)
  assert.ok(required.some(f => f.field_key === 'is_lodging'), 'is_lodging 應該出現在必填清單')
})
test('isFieldVisible：非分時段活動（fields 沒有 slot_ 開頭），is_lodging 照舊走 show_if', () => {
  const normalFields = [{ field_key: 'is_lodging', field_label: '是否掛單', required: true }]
  assert.equal(isFieldVisible(normalFields[0], {}, normalFields), true) // 沒有 show_if → 一律顯示
})
test('isFieldVisible：一般欄位（非 is_lodging/stay_overnight）維持原本 show_if 判斷，不受分時段影響', () => {
  const field = { field_key: 'stay_start', show_if: { is_lodging: true } }
  assert.equal(isFieldVisible(field, { is_lodging: true }, slotFields), true)
  assert.equal(isFieldVisible(field, { is_lodging: false }, slotFields), false)
})

// ── keyFor（排車頁 state key，含時段向下相容）─────────────────────
test('keyFor：不帶 timeSlot 時行為與改版前完全一致（單日/多日活動不受影響）', () => {
  assert.equal(keyFor(null, 'up'), 'up')
  assert.equal(keyFor('2026-08-06', 'down'), '2026-08-06::down')
})
test('keyFor：帶 timeSlot 時多一段後綴', () => {
  assert.equal(keyFor('2026-08-06', 'up', '上午'), '2026-08-06::up::上午')
})
test('keyFor：timeSlot 傳 null 等同不傳', () => {
  assert.equal(keyFor('2026-08-06', 'up', null), '2026-08-06::up')
})

// ── timeSlotsFor（排車頁時段清單）───────────────────────────────
test('timeSlotsFor：非分時段活動固定回傳 [null]（迴圈跑一次，維持現狀）', () => {
  assert.deepEqual(timeSlotsFor({ multi_slot_transport: false }, 'up'), [null])
  assert.deepEqual(timeSlotsFor(null, 'up'), [null])
})
test('timeSlotsFor：分時段活動去程回傳 上午/中午，回程回傳 中午/下午', () => {
  const ev = { multi_slot_transport: true }
  assert.deepEqual(timeSlotsFor(ev, 'up'), ['上午', '中午'])
  assert.deepEqual(timeSlotsFor(ev, 'down'), ['中午', '下午'])
})

// ── overrideStateKey（大車移小車持久化的 state key 反推）───────────
test('overrideStateKey：非分時段答案，回傳不含時段的 key（跟改版前行為一致）', () => {
  const reg = { answers: { attend_dates: ['2026-08-06'] } }
  assert.equal(overrideStateKey(reg, 'up', '2026-08-06'), '2026-08-06::up')
})
test('overrideStateKey：分時段答案，反推出這個人實際所在的時段', () => {
  const reg = { answers: { 'slot_up_2026-08-06': '上午', 'slot_down_2026-08-07': '下午' } }
  assert.equal(overrideStateKey(reg, 'up', '2026-08-06'), '2026-08-06::up::上午')
  assert.equal(overrideStateKey(reg, 'down', '2026-08-07'), '2026-08-07::down::下午')
})
test('overrideStateKey：分時段答案但查無對應 date+direction（理論上不該發生），退回不含時段的 key', () => {
  const reg = { answers: { 'slot_up_2026-08-06': '上午' } }
  assert.equal(overrideStateKey(reg, 'down', '2026-08-06'), '2026-08-06::down')
})

console.log('')
console.log('=== 結果：' + pass + ' 過、' + fail + ' 沒過 ===')
process.exit(fail > 0 ? 1 : 0)
