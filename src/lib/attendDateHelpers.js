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

// 判斷某人在指定 date+direction 是否需要車（單日活動 selectedDate 傳 null）
export function isInSlot(answers, selectedDate, direction) {
  if (selectedDate == null) return true // 單日活動，維持現有行為，不篩選
  return resolveAttendSlots(answers).some(s => s.date === selectedDate && s.direction === direction)
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
