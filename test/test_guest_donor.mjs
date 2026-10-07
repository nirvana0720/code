import fs from 'fs'
const src = fs.readFileSync('src/lib/supabase.js', 'utf8')
const m = src.match(/export async function getDonorForGuestRegistration[\s\S]*?\n}\n/)
if (!m) throw new Error('function not found')
const body = m[0].replace('export async function', 'async function')
function mk(donors, regs, regErr) {
  const supabase = { from(t) {
    const q = { _t: t, select() { return q }, eq() { return q }, in() { return q },
      then(res) { res(t === 'event_donors' ? { data: donors, error: null } : { data: regs, error: regErr || null }) } }
    return q } }
  return new Function('supabase', 'DONOR_COLS', body + '; return getDonorForGuestRegistration')(supabase, '*')
}
const g = { donor_id: 'g1', student_id: null, name: '王小明' }
const s1 = { donor_id: 's1', student_id: '111', name: '王小明' }
const s2 = { donor_id: 's2', student_id: '222', name: '王小明' }
let pass = 0, fail = 0
function t(name, cond) { cond ? pass++ : (fail++, console.log('FAIL', name)) }
let r
r = await mk([], [])('e', '王小明'); t('無功德主', !r.donor && r.candidates.length === 0)
r = await mk([g], [])('e', '王小明'); t('只有訪客型', r.donor?.donor_id === 'g1')
r = await mk([s1], [])('e', '王小明'); t('只有學員型且本人沒報名（本人被親友代報）', r.donor?.donor_id === 's1')
r = await mk([s1], [{ student_id: '111' }])('e', '王小明'); t('學員型但本人已報名→排除', !r.donor && r.candidates.length === 0)
r = await mk([g, s1], [{ student_id: '111' }])('e', '王小明'); t('訪客型＋已報名學員型→選訪客型', r.donor?.donor_id === 'g1')
r = await mk([s1, s2], [])('e', '王小明'); t('兩位學員型都沒報名→要人工選', !r.donor && r.candidates.length === 2)
r = await mk([s1, s2], [{ student_id: '222' }])('e', '王小明'); t('其中一位已報名→選另一位', r.donor?.donor_id === 's1')
r = await mk([g, s1], [], { message: 'x' })('e', '王小明'); t('查報名失敗→不擅自排除，要人工選', !r.donor && r.candidates.length === 2)
r = await mk([g], [])('e', '  王小明  '); t('姓名前後空白', r.donor?.donor_id === 'g1')
r = await mk([g], [])('e', ''); t('空姓名', !r.donor)
console.log(`結果：${pass} 過、${fail} 沒過`)
