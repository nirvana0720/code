// 發送功德主通知：後台「當天資訊管理」／「發送功德主通知」按鈕呼叫
// 輸入 { event_id, items: [{ donor_id, student_id, name, message_text }] }
// message_text 已由前端組好完整訊息，這支函式只負責查 line_user_id + 發送
//
// 與 send-car-notification 的差異：car 版是先查 car_members 再撈 registrations/students，
// donor 版直接用 student_id 查 students，結構不同無法共用同一支函式，故另立新檔。
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const LINE_CHANNEL_ACCESS_TOKEN = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// 呼叫 LINE Messaging API 推播單一使用者純文字訊息
async function pushLineMessage(userId: string, text: string): Promise<boolean> {
  try {
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({ to: userId, messages: [{ type: 'text', text }] }),
    })
    if (!res.ok) {
      console.error('[send-donor-notification] LINE push failed', res.status, await res.text())
      return false
    }
    return true
  } catch (err) {
    console.error('[send-donor-notification] LINE push exception', err)
    return false
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405)

  // ── 驗證呼叫者是登入的管理員 ──
  const authHeader = req.headers.get('Authorization') ?? ''
  const jwt = authHeader.replace(/^Bearer\s+/i, '')
  const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  const { data: { user }, error: authErr } = await authClient.auth.getUser(jwt)
  if (authErr || !user) return json({ error: '未授權：請重新登入' }, 401)
  const role = (user.app_metadata as { role?: string } | null)?.role ?? 'volunteer'
  if (role !== 'admin') return json({ error: '未授權：僅限管理員發送通知' }, 403)

  let body: { event_id?: string; items?: Array<{ donor_id: string; student_id: string | null; name: string; message_text: string }> }
  try {
    body = await req.json()
  } catch {
    return json({ error: '請求格式錯誤' }, 400)
  }

  const items = body.items ?? []
  if (!Array.isArray(items) || items.length === 0) {
    return json({ error: '沒有要發送的對象' }, 400)
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const studentIds = [...new Set(items.map(i => i.student_id).filter((v): v is string => !!v))]
  const lineByStudent = new Map<string, string>()
  if (studentIds.length > 0) {
    const { data: students, error: sErr } = await db
      .from('students')
      .select('student_id, line_user_id')
      .in('student_id', studentIds)
    if (sErr) {
      console.error('[send-donor-notification] query students failed', sErr)
    } else {
      for (const s of (students ?? [])) {
        if (s.line_user_id) lineByStudent.set(s.student_id, s.line_user_id)
      }
    }
  }

  const results = []
  for (const item of items) {
    const lineUserId = item.student_id ? lineByStudent.get(item.student_id) : undefined
    if (!lineUserId) {
      results.push({ donor_id: item.donor_id, name: item.name, sent: false, skipped: true, failed: false })
      continue
    }
    const ok = await pushLineMessage(lineUserId, item.message_text ?? '')
    results.push({ donor_id: item.donor_id, name: item.name, sent: ok, skipped: false, failed: !ok })
  }

  return json({ results })
})
