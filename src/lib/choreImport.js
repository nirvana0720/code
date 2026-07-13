// 福慧出坡：坡務表 Excel 解析與匯入
// 山上坡務表版面不固定，靠標題文字比對找欄位，不寫死儲存格座標
import * as XLSX from '@e965/xlsx'
import { supabase } from './supabase'

function findCol(headerRow, matcher) {
  for (let i = 0; i < headerRow.length; i++) {
    if (matcher(String(headerRow[i] ?? '').trim())) return i
  }
  return -1
}

function cellAt(row, idx) {
  if (idx < 0) return ''
  return String(row[idx] ?? '').trim()
}

function normalizeSession(raw) {
  const s = raw.trim()
  if (s.includes('上')) return '上午'
  if (s.includes('下')) return '下午'
  return s
}

// 「王大明/法名/0910223156」→ { leader_name, leader_phone }
// 格式不規則時整段存 leader_name，leader_phone 留空，不讓解析失敗擋掉整筆匯入
function parseLeader(raw) {
  if (!raw) return { leader_name: '', leader_phone: '' }
  const parts = raw.split('/').map(s => s.trim()).filter(Boolean)
  if (parts.length >= 2) {
    const last = parts[parts.length - 1]
    if (/^[\d\-]{6,}$/.test(last)) {
      return { leader_name: parts.slice(0, -1).join('/'), leader_phone: last }
    }
  }
  return { leader_name: raw, leader_phone: '' }
}

// 「見賦法師\n0975-220-455」或「見賦法師 0975220455」→ { supervising_monk, supervising_monk_phone }
// 抓出裡面像電話的連續數字（可含 -），剩下文字當姓名；抓不到電話格式就整段存姓名，不讓解析失敗擋掉整筆匯入
function parseMonk(raw) {
  if (!raw) return { supervising_monk: '', supervising_monk_phone: '' }
  const match = raw.match(/\d[\d-]{7,}\d/)
  if (match) {
    const digitCount = match[0].replace(/\D/g, '').length
    if (digitCount >= 9) {
      const phone = match[0]
      const name = raw.replace(phone, '').replace(/\s+/g, ' ').trim()
      return { supervising_monk: name, supervising_monk_phone: phone }
    }
  }
  return { supervising_monk: raw.replace(/\s+/g, ' ').trim(), supervising_monk_phone: '' }
}

/**
 * 解析坡務表 Excel（單一工作表），回傳可預覽/確認的坡務列陣列
 * @param {File} file
 * @returns {Promise<Array<{session, unit, work_content, location, supervising_monk, supervising_monk_phone, leader_name, leader_phone, quota_male, quota_female, date_for_display}>>}
 */
export async function parseChoreExcel(file) {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' })

  const headerIdx = rows.findIndex(row =>
    row.some(c => String(c).includes('坡務內容')) && row.some(c => String(c).includes('集合地點'))
  )
  if (headerIdx === -1) {
    throw new Error('找不到標題列（需同時包含「坡務內容」與「集合地點」欄位），請確認 Excel 格式')
  }

  const headerRow = rows[headerIdx]
  const subRow    = rows[headerIdx + 1] || []

  const colSession = findCol(headerRow, c => c.includes('時段'))
  const colDate     = findCol(headerRow, c => c === '日期' || c.includes('日期'))
  const colUnit     = findCol(headerRow, c => c.includes('單位'))
  const colMonk     = findCol(headerRow, c => c.includes('負責法師'))
  const colWork     = findCol(headerRow, c => c.includes('坡務內容'))
  const colLocation = findCol(headerRow, c => c.includes('集合地點'))
  const colLeader   = findCol(headerRow, c => c.includes('小組長'))

  let colMale = -1, colFemale = -1
  for (let i = 0; i < subRow.length; i++) {
    const cell = String(subRow[i] ?? '').trim()
    if (cell === '男' && colMale === -1) colMale = i
    else if (cell === '女' && colFemale === -1) colFemale = i
  }

  const results = []
  let carrySession = ''
  let carryDate = ''

  for (const row of rows.slice(headerIdx + 2)) {
    const sessionRaw = cellAt(row, colSession)
    const dateRaw     = cellAt(row, colDate)
    if (sessionRaw) carrySession = normalizeSession(sessionRaw)
    if (dateRaw) carryDate = dateRaw

    const unit           = cellAt(row, colUnit)
    const work_content   = cellAt(row, colWork)
    const location        = cellAt(row, colLocation)
    const monkRaw          = cellAt(row, colMonk)
    const leaderRaw       = cellAt(row, colLeader)
    const quota_male   = parseInt(cellAt(row, colMale), 10)   || 0
    const quota_female = parseInt(cellAt(row, colFemale), 10) || 0

    // 整列空白（不含男女人數皆 0）視為分隔/裝飾列，略過
    if (!unit && !work_content && !location && !monkRaw && !leaderRaw && quota_male === 0 && quota_female === 0) {
      continue
    }

    const { leader_name, leader_phone } = parseLeader(leaderRaw)
    const { supervising_monk, supervising_monk_phone } = parseMonk(monkRaw)

    results.push({
      session: carrySession,
      unit,
      work_content,
      location,
      supervising_monk,
      supervising_monk_phone,
      leader_name,
      leader_phone,
      quota_male,
      quota_female,
      date_for_display: carryDate,
    })
  }

  return results
}

/**
 * 把使用者確認過的坡務列寫入 chores 表（依陣列順序遞增 sort_order）
 * @param {string} eventId
 * @param {Array} choreRows  parseChoreExcel 回傳的物件陣列（可能經使用者編輯/勾選）
 */
export async function importChores(eventId, choreRows) {
  if (!choreRows || choreRows.length === 0) {
    return { success: false, imported: 0, error: '沒有可匯入的坡務資料' }
  }
  const rows = choreRows.map((r, i) => ({
    event_id: eventId,
    session: r.session,
    unit: r.unit || null,
    work_content: r.work_content || null,
    location: r.location || null,
    supervising_monk: r.supervising_monk || null,
    supervising_monk_phone: r.supervising_monk_phone || null,
    leader_name: r.leader_name || null,
    leader_phone: r.leader_phone || null,
    quota_male: r.quota_male ?? 0,
    quota_female: r.quota_female ?? 0,
    sort_order: i,
  }))
  const { error } = await supabase.from('chores').insert(rows)
  if (error) return { success: false, imported: 0, error: error.message }
  return { success: true, imported: rows.length, error: null }
}
