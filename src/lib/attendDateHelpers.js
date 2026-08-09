// 職責單一：多日回山排車的出席日期判斷（answers.attend_dates / answers.is_lodging）

// answers.attend_dates 是字串陣列（如 ["2026-08-10","2026-08-11"]）
// 「是否掛單」優先讀 answers.is_lodging；如果活動用的是回山模板既有的 stay_overnight
// （寮房比對用的「是否掛單」，syncAttendDatesField 偵測到已有這個欄位時就不會再另外
// 加 is_lodging，避免問兩次一樣的問題），就 fallback 讀 stay_overnight
// （2026-08-05 定調：兩者語意上是同一件事——會被排車邏輯判定「掛單」的人，
// 本來就是回山期間有在山上過夜留宿的人）
// 回傳這個人在哪些「日期+方向」組合需要車：[{ date, direction }]
export function resolveAttendSlots(answers) {
  const dates = (answers?.attend_dates ?? []).slice().sort()
  if (dates.length === 0) return []
  const isLodging = answers?.is_lodging ?? answers?.stay_overnight ?? false
  if (isLodging) {
    return [
      { date: dates[0], direction: 'up' },
      { date: dates[dates.length - 1], direction: 'down' },
    ]
  }
  // 不掛單：每天都當天來回，各自需要去程+回程
  return dates.flatMap(d => [{ date: d, direction: 'up' }, { date: d, direction: 'down' }])
}

// 分時段模式（multi_slot_transport）專用：answers 裡的 key 直接是 slot_up_YYYY-MM-DD／
// slot_down_YYYY-MM-DD（radio，值為選中的時段字串），不再用 attend_dates 反推
const SLOT_FIELD_RE = /^slot_(up|down)_(\d{4}-\d{2}-\d{2})$/

// 掃描 answers 的 key，反推這個人在哪些「日期+方向」需要車，含時段
// 只有分時段模式的報名答案會有 slot_up_xxx / slot_down_xxx 這種 key
export function resolveSlotBasedAttendSlots(answers) {
  const results = []
  for (const key of Object.keys(answers || {})) {
    const m = key.match(SLOT_FIELD_RE)
    if (!m) continue
    const timeSlot = answers[key]
    if (!timeSlot) continue // 留白 = 不需要
    results.push({ direction: m[1], date: m[2], timeSlot })
  }
  return results.sort((a, b) => a.date === b.date
    ? a.direction.localeCompare(b.direction)
    : a.date.localeCompare(b.date))
}

// 判斷 answers 是不是分時段模式的答案（有沒有任何 slot_ 開頭的 key）
export function isSlotBasedAnswers(answers) {
  return Object.keys(answers || {}).some(k => SLOT_FIELD_RE.test(k))
}

// 分時段模式專用：算填答涵蓋幾個不同日期，供「是否掛單」顯示判斷用
export function countDistinctSlotDays(answers) {
  const days = new Set(resolveSlotBasedAttendSlots(answers).map(s => s.date))
  return days.size
}

// 判斷單一欄位在目前作答狀態下是否應該顯示（DynamicForm 渲染／Kiosk 必填驗證共用邏輯，
// 避免同一套判斷各自維護一份）：
// - is_lodging／stay_overnight：若這個活動是分時段模式（fields 裡有任何 slot_up/slot_down
//   欄位），改用 countDistinctSlotDays(answers) >= 2 判斷要不要顯示／必填，不走 show_if
// - 其他欄位（含 stay_start／stay_end）維持原本 show_if 判斷
export function isFieldVisible(field, answers, fields) {
  if (field.field_key === 'is_lodging' || field.field_key === 'stay_overnight') {
    const isSlotMode = (fields || []).some(f => SLOT_FIELD_RE.test(f.field_key))
    if (isSlotMode) return countDistinctSlotDays(answers) >= 2
  }
  if (!field.show_if) return true
  return Object.entries(field.show_if).every(([k, v]) => answers[k] === v)
}

// Kiosk 前台必填驗證共用：目前應顯示、且標記必填的欄位清單
export function getVisibleRequiredFields(fields, answers) {
  return (fields || []).filter(f => f.required && isFieldVisible(f, answers, fields))
}

// 判斷某人在指定 date+direction(+timeSlot) 是否需要車（單日活動 selectedDate 傳 null）
// selectedTimeSlot：分時段活動的時段篩選，預設 null＝不篩選時段（相容既有呼叫）
export function isInSlot(answers, selectedDate, direction, selectedTimeSlot = null) {
  if (selectedDate == null) return true // 單日活動，維持現有行為，不篩選
  const slots = isSlotBasedAnswers(answers)
    ? resolveSlotBasedAttendSlots(answers)
    : resolveAttendSlots(answers).map(s => ({ ...s, timeSlot: null }))
  return slots.some(s =>
    s.date === selectedDate &&
    s.direction === direction &&
    (selectedTimeSlot == null || s.timeSlot === selectedTimeSlot)
  )
}

// 週幾中文對照，供日期籤 UI／event_fields options 顯示用（例：8/10（一））
const WEEKDAY_CH = ['日', '一', '二', '三', '四', '五', '六']
export function formatDateWithWeekday(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return dateStr
  return `${d.getMonth() + 1}/${d.getDate()}（${WEEKDAY_CH[d.getDay()]}）`
}

// 依活動起訖日逐日展開成 YYYY-MM-DD 陣列（含頭尾），供 attend_dates 欄位 options 產生用
// 注意：全程用 UTC 運算，不要用「本地時區建 Date 再轉 toISOString」的寫法——
// 在 UTC+8（台灣）環境下，本地午夜轉成 UTC 字串會退到前一天，導致整組日期少一天
// （2026-08-05 發現：date_start=2026-08-06 卻算出 2026-08-05，即此 bug）
export function eachDateInRange(dateStart, dateEnd) {
  if (!dateStart || !dateEnd || dateStart > dateEnd) return []
  const dates = []
  let cur = new Date(dateStart + 'T00:00:00Z')
  const last = new Date(dateEnd + 'T00:00:00Z')
  while (cur <= last && dates.length < 60) {
    dates.push(cur.toISOString().slice(0, 10))
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return dates
}
