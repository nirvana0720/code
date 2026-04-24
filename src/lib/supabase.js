import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('請在 .env.local 設定 VITE_SUPABASE_URL 與 VITE_SUPABASE_ANON_KEY')
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// ─── 活動查詢 ─────────────────────────────────────────────

/**
 * 取得目前 active 狀態的活動（含動態欄位）
 * @returns {{ event: object|null, fields: array, error: string|null }}
 */
export async function getActiveEvent() {
  const { data: events, error: eventErr } = await supabase
    .from('events')
    .select('*')
    .eq('status', 'active')
    .order('date_start', { ascending: true })
    .limit(1)

  if (eventErr) return { event: null, fields: [], error: eventErr.message }
  if (!events || events.length === 0) return { event: null, fields: [], error: null }

  const event = events[0]

  const { data: fields, error: fieldErr } = await supabase
    .from('event_fields')
    .select('*')
    .eq('event_id', event.event_id)
    .order('sort_order', { ascending: true })

  if (fieldErr) return { event, fields: [], error: fieldErr.message }

  return { event, fields: fields || [], error: null }
}

// ─── 學員查詢 ─────────────────────────────────────────────

/**
 * 用學員編號查詢學員資料（含班別）
 * @param {string} studentId - 9 位數字學員編號
 * @returns {{ student: object|null, classes: array, error: string|null }}
 */
export async function getStudentById(studentId) {
  const { data: student, error: studentErr } = await supabase
    .from('students')
    .select('*')
    .eq('student_id', studentId)
    .eq('active', true)
    .single()

  if (studentErr) {
    if (studentErr.code === 'PGRST116') {
      return { student: null, classes: [], error: 'NOT_FOUND' }
    }
    return { student: null, classes: [], error: studentErr.message }
  }

  const { data: classes, error: classErr } = await supabase
    .from('student_classes')
    .select('class_name, group_name')
    .eq('student_id', studentId)

  if (classErr) return { student, classes: [], error: classErr.message }

  return { student, classes: classes || [], error: null }
}

// ─── 報名 ─────────────────────────────────────────────────

/**
 * 檢查是否已重複報名
 * @param {string} eventId
 * @param {string} studentId
 * @returns {boolean}
 */
export async function checkDuplicate(eventId, studentId) {
  const { data, error } = await supabase
    .from('registrations')
    .select('registration_id')
    .eq('event_id', eventId)
    .eq('student_id', studentId)
    .limit(1)

  if (error) return false
  return data && data.length > 0
}

/**
 * 送出報名
 * @param {string} eventId
 * @param {string} studentId
 * @param {object} answers - 動態欄位答案 { field_key: value }
 * @param {string} terminal - 裝置識別（可選）
 * @returns {{ success: boolean, error: string|null }}
 */
export async function submitRegistration(eventId, studentId, answers, terminal = 'tablet-01') {
  const { error } = await supabase
    .from('registrations')
    .upsert({
      event_id: eventId,
      student_id: studentId,
      answers,
      terminal
    }, { onConflict: 'event_id,student_id' })

  if (error) return { success: false, error: error.message }
  return { success: true, error: null }
}

/**
 * 取得現有報名紀錄
 */
export async function getRegistration(eventId, studentId) {
  const { data, error } = await supabase
    .from('registrations')
    .select('registration_id, answers')
    .eq('event_id', eventId)
    .eq('student_id', studentId)
    .single()
  if (error) return null
  return data
}

/**
 * 更新現有報名紀錄
 */
export async function updateRegistration(registrationId, answers) {
  const { error } = await supabase
    .from('registrations')
    .update({ answers })
    .eq('registration_id', registrationId)
  if (error) return { success: false, error: error.message }
  return { success: true, error: null }
}
