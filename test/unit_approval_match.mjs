// 職責：山上審核「貼上名單比對」純邏輯（src/lib/approvalMatch.js）＋審核常數／判斷的單元測試。
// 不連線 Supabase。執行：node test/run_unit.mjs（或雙擊 run_unit.bat，會一併跑 unit_slot_logic.mjs）
//
// 測試資料模擬兩種山上寄回的表：
//   打七表：只有錄取名單（可能有標題「錄取名單」，也可能完全沒標題）
//   護七表：錄取名單＋不錄取名單兩段

import assert from 'node:assert/strict'
import { matchApprovalList, normalizeName, detectSectionHeader } from '../src/lib/approvalMatch.js'
import { getRejectedText, DEFAULT_REJECTED_TEXT, approvalLabel, normalizeApprovalStatus } from '../src/lib/approvalConstants.js'

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

const stu = (id, name) => ({ registration_id: id, student_id: 'S' + id, students: { name }, answers: {} })
const guest = (id, name, host) => ({ registration_id: id, student_id: null, students: null, answers: { guest_name: name, host_name: host } })
const ids = arr => arr.map(r => r.registration_id).sort()

const REGS = [
  stu('r1', '王小明'),
  stu('r2', '李大華'),
  stu('r3', '陳美玲'),
  guest('r4', '林志成', '王小明'),
  stu('r5', '張　三'), // 系統裡姓名含全形空白
]

// ── 標準化 ─────────────────────────────────────────────────
test('normalizeName：去半形／全形空白、全形英數轉半形', () => {
  assert.equal(normalizeName(' 張　三 '), '張三')
  assert.equal(normalizeName('ＡＢＣ　１２'), 'ABC12')
})
test('detectSectionHeader：不錄取優先於錄取', () => {
  assert.equal(detectSectionHeader('第一期護七 不錄取名單'), 'rejected')
  assert.equal(detectSectionHeader('第一期護七錄取名單'), 'approved')
  assert.equal(detectSectionHeader('1 71-A0002 王小明'), null)
})

// ── 打七表：沒有標題 ────────────────────────────────────────
test('打七表（無標題）：全部歸 approved，訪客用 guest_name 比對', () => {
  const text = [
    '序號 CTIS編號 姓名 性別 班別',
    '1 71-A0002 王小明 男 初級班',
    '2 71-A0003 林志成 男 訪客',
  ].join('\n')
  const res = matchApprovalList(text, REGS)
  assert.equal(res.hasSections, false)
  assert.deepEqual(ids(res.approved), ['r1', 'r4'])
  assert.equal(res.rejected.length, 0)
  assert.deepEqual(ids(res.unmatched), ['r2', 'r3', 'r5'])
})

test('打七表（只有「錄取名單」標題）：仍全部歸 approved', () => {
  const text = '一一五年度第一期打七錄取名單\n1\t1071-F0001\t陳美玲\t女'
  const res = matchApprovalList(text, REGS)
  assert.equal(res.hasSections, true)
  assert.deepEqual(ids(res.approved), ['r3'])
})

// ── 護七表：錄取＋不錄取 ───────────────────────────────────
test('護七表：錄取段落歸 approved、不錄取段落歸 rejected', () => {
  const text = [
    '護七錄取名單',
    '1 1071-F0001 王小明 男',
    '2 1071-F0002 陳美玲 女',
    '',
    '護七不錄取名單',
    '1 1071-F0003 李大華 男',
  ].join('\n')
  const res = matchApprovalList(text, REGS)
  assert.deepEqual(ids(res.approved), ['r1', 'r3'])
  assert.deepEqual(ids(res.rejected), ['r2'])
  assert.equal(res.notFound.length, 0)
})

// ── 姓名標準化比對 ─────────────────────────────────────────
test('名單上的姓名有空白／全形空白，或系統姓名含全形空白，都比對得到', () => {
  // 姓名被空白拆成單字（PDF 常見）也要比對得到
  const res = matchApprovalList('1 71-A0010 張 三 男\n2 71-A0011 王　小　明 男', REGS)
  assert.deepEqual(ids(res.approved), ['r1', 'r5'])
  assert.equal(res.notFound.length, 0)
  const res2 = matchApprovalList('1 71-A0010 張三 男', REGS)
  assert.deepEqual(ids(res2.approved), ['r5'])
})

test('CTIS 編號黏著姓名（PDF 複製常見）仍可比對', () => {
  const res = matchApprovalList('1 71-A0002王小明 男', REGS)
  assert.deepEqual(ids(res.approved), ['r1'])
})

// ── 同名多筆 ───────────────────────────────────────────────
test('同名多筆報名 → ambiguous（duplicate_name），不自動歸類', () => {
  const regs = [...REGS, stu('r6', '王小明')]
  const res = matchApprovalList('1 71-A0002 王小明 男', regs)
  assert.equal(res.approved.length, 0)
  assert.equal(res.ambiguous.length, 1)
  assert.equal(res.ambiguous[0].reason, 'duplicate_name')
  assert.deepEqual(res.ambiguous[0].candidates.map(c => c.reg.registration_id).sort(), ['r1', 'r6'])
  assert.ok(!ids(res.unmatched).includes('r1'), '同名候選人不算「名單上沒出現」')
})

test('同一人同時出現在錄取與不錄取 → ambiguous（conflict）', () => {
  const text = '錄取名單\n王小明\n不錄取名單\n王小明'
  const res = matchApprovalList(text, REGS)
  assert.equal(res.approved.length, 0)
  assert.equal(res.rejected.length, 0)
  assert.equal(res.ambiguous[0].reason, 'conflict')
})

test('同一人在同段落重複出現只算一次', () => {
  const res = matchApprovalList('王小明\n1 71-A0002 王小明', REGS)
  assert.deepEqual(ids(res.approved), ['r1'])
})

// ── 找不到 ─────────────────────────────────────────────────
test('有 CTIS 編號但找不到報名者 → notFound（記錄所在段落）', () => {
  const text = '錄取名單\n1 71-A0099 趙六 男\n不錄取名單\n2 1071-F0099 錢七 女'
  const res = matchApprovalList(text, REGS)
  assert.equal(res.notFound.length, 2)
  assert.equal(res.notFound[0].code, '71-A0099')
  assert.equal(res.notFound[0].section, 'approved')
  assert.equal(res.notFound[1].code, '1071-F0099')
  assert.equal(res.notFound[1].section, 'rejected')
})

test('沒有 CTIS 編號、也比對不到的行（表頭、頁碼）不列入 notFound', () => {
  const res = matchApprovalList('序號 CTIS編號 姓名 性別\n第 1 頁，共 2 頁', REGS)
  assert.equal(res.notFound.length, 0)
})

test('displayNameOf 可由呼叫端指定（畫面顯示用）', () => {
  const regs = [...REGS, guest('r7', '林志成', '李大華')]
  const res = matchApprovalList('林志成', regs, { displayNameOf: r => 'X' + r.registration_id })
  assert.deepEqual(res.ambiguous[0].candidates.map(c => c.displayName).sort(), ['Xr4', 'Xr7'])
})

test('空字串／空報名 不出錯', () => {
  const res = matchApprovalList('', [])
  assert.deepEqual(res, { hasSections: false, approved: [], rejected: [], ambiguous: [], notFound: [], unmatched: [] })
})

// ── 常數 ──────────────────────────────────────────────────
test('getRejectedText：空值用預設文字，有設定用設定值', () => {
  assert.equal(getRejectedText({ approval_rejected_text: null }), DEFAULT_REJECTED_TEXT)
  assert.equal(getRejectedText({ approval_rejected_text: '  ' }), DEFAULT_REJECTED_TEXT)
  assert.equal(getRejectedText({ approval_rejected_text: '名額已滿' }), '名額已滿')
})
test('approvalLabel：未知／空值視為「已報名」', () => {
  assert.equal(approvalLabel(undefined), '已報名')
  assert.equal(approvalLabel('ctis_registered'), 'CTIS已報名')
  assert.equal(normalizeApprovalStatus('xxx'), 'registered')
})

console.log('')
console.log('=== 山上審核比對：' + pass + ' 過、' + fail + ' 沒過 ===')
if (fail > 0) process.exitCode = 1
