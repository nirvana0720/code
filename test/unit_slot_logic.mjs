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
import { keyFor, computeSmallGroups, isSmallCar } from '../src/lib/carrangeHelpers.js'
import { timeSlotsFor, overrideStateKey, slotsForDirection } from '../src/lib/carSlotHelpers.js'
import { resolveOtherDateSlots, resolveFinalBucket, filterByFinalBucket, pendingOtherDateRegs, buildOtherDateCarFromGroup } from '../src/lib/otherDateHelpers.js'

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

// ── slotsForDirection / timeSlotsFor（分時段彈性選項，2026-08-10）─────────────
test('slotsForDirection：後台設定 up_slot_options=[上午]，去程回傳單一選項', () => {
  const ev = { up_slot_options: ['上午'], down_slot_options: ['中午', '下午'] }
  assert.deepEqual(slotsForDirection('up', ev), ['上午'])
  assert.deepEqual(slotsForDirection('down', ev), ['中午', '下午'])
})
test('slotsForDirection：未設定（NULL/空陣列）沿用舊預設', () => {
  assert.deepEqual(slotsForDirection('up', {}), ['上午', '中午'])
  assert.deepEqual(slotsForDirection('down', { up_slot_options: [] }), ['中午', '下午'])
})
test('timeSlotsFor：某方向只設定 1 個選項時視同不分時段（[null]，不出現單選項 radio 題）', () => {
  const ev = { multi_slot_transport: true, up_slot_options: ['上午'], down_slot_options: ['中午', '下午'] }
  assert.deepEqual(timeSlotsFor(ev, 'up'), [null])
  assert.deepEqual(timeSlotsFor(ev, 'down'), ['中午', '下午'])
})

// ── resolveOtherDateSlots（其他日期分頁自動判斷，2026-08-10）─────────────────
const otherDateEvent = { date_start: '2026-08-06', date_end: '2026-08-10' }
test('resolveOtherDateSlots：掛單開始日期早於活動官方開始日期＋交通方式是精舍（大車）→ up=true', () => {
  const reg = { student_id: 's1', answers: { stay_start: '2026-08-05', transport_up: '精舍' } }
  assert.equal(resolveOtherDateSlots(reg, otherDateEvent).up, true)
})
test('resolveOtherDateSlots：同上但交通方式是其他交通 → up 應為 false（不自動歸類，這些人不用系統排車）', () => {
  const reg = { student_id: 's1', answers: { stay_start: '2026-08-05', transport_up: '其他方式' } }
  assert.equal(resolveOtherDateSlots(reg, otherDateEvent).up, false)
})
test('resolveOtherDateSlots：掛單日期在活動官方範圍內（相等不算超出）→ 都是 false', () => {
  const reg = { student_id: 's1', answers: { stay_start: '2026-08-06', stay_end: '2026-08-10', transport_up: '精舍', transport_down: '精舍' } }
  const result = resolveOtherDateSlots(reg, otherDateEvent)
  assert.equal(result.up, false)
  assert.equal(result.down, false)
})
test('resolveOtherDateSlots：掛單結束日期晚於活動官方結束日期＋精舍 → down=true', () => {
  const reg = { student_id: 's1', answers: { stay_end: '2026-08-11', transport_down: '精舍' } }
  assert.equal(resolveOtherDateSlots(reg, otherDateEvent).down, true)
})
test('resolveOtherDateSlots：answers 完全沒有 stay_start/stay_end → 都是 false', () => {
  const reg = { student_id: 's1', answers: { transport_up: '精舍' } }
  const result = resolveOtherDateSlots(reg, otherDateEvent)
  assert.equal(result.up, false)
  assert.equal(result.down, false)
})

// ── resolveFinalBucket（跨分頁手動 override + isStale 判斷，2026-08-10）───────
test('resolveFinalBucket：無 override，走自動判斷', () => {
  const reg = { registration_id: 'r1', student_id: 's1', answers: { stay_start: '2026-08-05', transport_up: '精舍' } }
  const result = resolveFinalBucket(reg, 'up', otherDateEvent, {})
  assert.equal(result.bucket, 'other')
  assert.equal(result.isStale, false)
})
test('resolveFinalBucket：有 override 且答案未異動 → 沿用 override 指定的 bucket，isStale=false', () => {
  const reg = { registration_id: 'r1', student_id: 's1', answers: { stay_start: '2026-08-05', transport_up: '精舍' } }
  const overridesMap = {
    r1: { up: { target_bucket: '2026-08-07', source_stay_start: '2026-08-05', source_stay_end: null, source_transport: '精舍' } },
  }
  const result = resolveFinalBucket(reg, 'up', otherDateEvent, overridesMap)
  assert.equal(result.bucket, '2026-08-07')
  assert.equal(result.isStale, false)
})
test('resolveFinalBucket：建立 override 後答案異動（stay_start 改變）→ isStale=true，但 bucket 仍維持 override 指定的值', () => {
  const reg = { registration_id: 'r1', student_id: 's1', answers: { stay_start: '2026-08-04', transport_up: '精舍' } }
  const overridesMap = {
    r1: { up: { target_bucket: 'other', source_stay_start: '2026-08-05', source_stay_end: null, source_transport: '精舍' } },
  }
  const result = resolveFinalBucket(reg, 'up', otherDateEvent, overridesMap)
  assert.equal(result.bucket, 'other')
  assert.equal(result.isStale, true)
})

// ── filterByFinalBucket（正常日期分頁排除掉歸進其他日期的人，2026-08-10）───────
test('filterByFinalBucket：自動判斷為 other 的人不出現在正常日期分頁清單', () => {
  const regs = [
    { registration_id: 'r1', student_id: 's1', answers: { stay_start: '2026-08-05', transport_up: '精舍', attend_dates: ['2026-08-06'] } },
    { registration_id: 'r2', student_id: 's2', answers: { transport_up: '精舍', attend_dates: ['2026-08-06'] } },
  ]
  const result = filterByFinalBucket(regs, '2026-08-06', 'up', null, otherDateEvent, {})
  assert.equal(result.length, 1)
  assert.equal(result[0].registration_id, 'r2')
})
test('filterByFinalBucket：override 指定回某個正常日期的人，改用該日期比對（不是 answers 反推的日期）', () => {
  const regs = [
    { registration_id: 'r1', student_id: 's1', answers: { transport_up: '精舍', attend_dates: ['2026-08-06'] } },
  ]
  const overridesMap = { r1: { up: { target_bucket: '2026-08-07', source_stay_start: null, source_stay_end: null, source_transport: '精舍' } } }
  // 原本 attend_dates 只在 08-06 命中，override 後應該改在 08-07 才出現，08-06 不再出現
  assert.equal(filterByFinalBucket(regs, '2026-08-06', 'up', null, otherDateEvent, overridesMap).length, 0)
  assert.equal(filterByFinalBucket(regs, '2026-08-07', 'up', null, otherDateEvent, overridesMap).length, 1)
})

// ── pendingOtherDateRegs（其他日期分頁「待處理」清單，2026-08-10 補件）───────
test('pendingOtherDateRegs：bucket 判定為 other、且沒有任何 car_members 紀錄 → 出現在待處理清單', () => {
  const regs = [
    { registration_id: 'r1', student_id: 's1', answers: { stay_start: '2026-08-05', transport_up: '精舍' } },
  ]
  const result = pendingOtherDateRegs(regs, 'up', otherDateEvent, {}, new Set())
  assert.equal(result.length, 1)
  assert.equal(result[0].registration_id, 'r1')
})
test('pendingOtherDateRegs：一旦被加進某台其他日期車（在 assignedRegIds 內）→ 從待處理清單消失', () => {
  const regs = [
    { registration_id: 'r1', student_id: 's1', answers: { stay_start: '2026-08-05', transport_up: '精舍' } },
  ]
  const result = pendingOtherDateRegs(regs, 'up', otherDateEvent, {}, new Set(['r1']))
  assert.equal(result.length, 0)
})
test('pendingOtherDateRegs：bucket 不是 other 的人不出現在待處理清單', () => {
  const regs = [
    { registration_id: 'r1', student_id: 's1', answers: { transport_up: '精舍' } },
  ]
  assert.equal(pendingOtherDateRegs(regs, 'up', otherDateEvent, {}, new Set()).length, 0)
})
test('pendingOtherDateRegs：手動 override 指定回 other 但還沒排進車 → 也出現在待處理清單', () => {
  const regs = [
    { registration_id: 'r1', student_id: 's1', answers: { transport_up: '精舍' } },
  ]
  const overridesMap = { r1: { up: { target_bucket: 'other', source_stay_start: null, source_stay_end: null, source_transport: '精舍' } } }
  const result = pendingOtherDateRegs(regs, 'up', otherDateEvent, overridesMap, new Set())
  assert.equal(result.length, 1)
})

// ── 其他日期分頁「建議共乘分組」（2026-08-13 新增）─────────────────────────
test('其他日期待處理切分＋共乘配對：driver+passenger 都是 bucket=other 且未排進任何其他日期車 → computeSmallGroups 能配成一組', () => {
  const driver = {
    registration_id: 'd1', student_id: 's1', students: { name: '王小明' },
    answers: { stay_start: '2026-08-05', transport_up: '自行開車', plate_up: 'ABC-1234' },
  }
  const passenger = {
    registration_id: 'p1', student_id: 's2', students: { name: '李小華' },
    answers: { stay_start: '2026-08-05', transport_up: '搭學員的車', carpool_up: '王小明' },
  }
  const regs = [driver, passenger]

  const pending = pendingOtherDateRegs(regs, 'up', otherDateEvent, {}, new Set())
  assert.equal(pending.length, 2, '兩人都該進待處理清單')

  const smallSubset = pending.filter(r => isSmallCar(r.answers, 'up'))
  assert.equal(smallSubset.length, 2)
  const { matchedGroups, orphans } = computeSmallGroups(smallSubset, 'up')
  assert.equal(matchedGroups.length, 1, '應該配成一組')
  assert.equal(matchedGroups[0].driverName, '王小明')
  assert.deepEqual(matchedGroups[0].members.map(m => m.registration_id), ['d1', 'p1'])
  assert.equal(orphans.length, 0)
})

test('其他日期「建立這台車」：buildOtherDateCarFromGroup 把整組（司機＋乘客）一次建成新車，建立後從待處理清單消失', () => {
  const driver = {
    registration_id: 'd1', student_id: 's1', students: { name: '王小明' },
    answers: { stay_start: '2026-08-05', transport_up: '自行開車', plate_up: 'ABC-1234' },
  }
  const passenger = {
    registration_id: 'p1', student_id: 's2', students: { name: '李小華' },
    answers: { stay_start: '2026-08-05', transport_up: '搭學員的車', carpool_up: '王小明' },
  }
  const regs = [driver, passenger]
  const { matchedGroups } = computeSmallGroups(regs, 'up')
  assert.equal(matchedGroups.length, 1)

  const car = buildOtherDateCarFromGroup(matchedGroups[0])
  assert.equal(car.car_name, '王小明的車')
  assert.deepEqual(car.members, ['d1', 'p1'], '司機＋乘客都要在新車的 members 裡')
  assert.ok(car.tempId, '應該有 tempId 供前端 React key／存檔用')

  // 建立後：這兩人已是其他日期車的 car_members → 從待處理清單（含建議分組來源）消失
  const assignedRegIds = new Set(car.members)
  const stillPending = pendingOtherDateRegs(regs, 'up', otherDateEvent, {}, assignedRegIds)
  assert.equal(stillPending.length, 0, '建立車輛後兩人都不該再出現在待處理清單')
})

test('其他日期待處理切分：配不到司機的孤兒乘客／大車／其他交通／未填交通 仍留在平面清單，不誤入建議分組', () => {
  const orphanPassenger = {
    registration_id: 'o1', student_id: 's3', students: { name: '陳小美' },
    answers: { stay_start: '2026-08-05', transport_up: '搭學員的車', carpool_up: '查無此人' },
  }
  const largeCarReg = {
    registration_id: 'l1', student_id: 's4', students: { name: '林大同' },
    answers: { stay_start: '2026-08-05', transport_up: '精舍' },
  }
  const otherTransportReg = {
    registration_id: 'ot1', student_id: 's5', students: { name: '張小天' },
    answers: { transport_up: '其他交通' },
  }
  const noTransportReg = {
    registration_id: 'n1', student_id: 's6', students: { name: '劉小安' },
    answers: {},
  }
  const regs = [orphanPassenger, largeCarReg, otherTransportReg, noTransportReg]
  // 其他交通／未填交通方式不會被自動判斷歸進 other，這裡模擬師父用「移到...」手動指定回其他日期
  const overridesMap = {
    ot1: { up: { target_bucket: 'other', source_stay_start: null, source_stay_end: null, source_transport: '其他交通' } },
    n1:  { up: { target_bucket: 'other', source_stay_start: null, source_stay_end: null, source_transport: null } },
  }

  const pending = pendingOtherDateRegs(regs, 'up', otherDateEvent, overridesMap, new Set())
  assert.equal(pending.length, 4)

  const smallSubset = pending.filter(r => isSmallCar(r.answers, 'up'))
  const restSubset   = pending.filter(r => !isSmallCar(r.answers, 'up'))
  assert.deepEqual(smallSubset.map(r => r.registration_id), ['o1'])
  assert.deepEqual(restSubset.map(r => r.registration_id).sort(), ['l1', 'n1', 'ot1'])

  const { matchedGroups, orphans } = computeSmallGroups(smallSubset, 'up')
  assert.equal(matchedGroups.length, 0, '沒有司機，不該配成任何建議分組')
  assert.equal(orphans.length, 1)
  assert.equal(orphans[0].registration_id, 'o1')
})

console.log('')
console.log('=== 結果：' + pass + ' 過、' + fail + ' 沒過 ===')
process.exit(fail > 0 ? 1 : 0)
