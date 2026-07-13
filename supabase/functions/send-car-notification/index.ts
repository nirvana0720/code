// 發送乘車通知：後台「發送乘車通知」按鈕呼叫
// 輸入 { event_id, direction, cars: [{ car_id, car_name, message_text }] }
// message_text 已由前端組好完整訊息，這支函式只負責查收件人 + 發送
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
      console.error('[send-car-notification] LINE push failed', res.status, await res.text())
      return false
    }
    return true
  } catch (err) {
    console.error('[send-car-notification] LINE push exception', err)
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

  let body: { event_id?: string; direction?: string; cars?: Array<{ car_id: string; car_name: string; message_text: string }> }
  try {
    body = await req.json()
  } catch {
    return json({ error: '請求格式錯誤' }, 400)
  }

  const cars = body.cars ?? []
  if (!Array.isArray(cars) || cars.length === 0) {
    return json({ error: '沒有要發送的車輛' }, 400)
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const results = []

  for (const car of cars) {
    const carResult = { car_id: car.car_id, car_name: car.car_name, sent: 0, skipped: 0, failed: 0 }

    const { data: members, error: memberErr } = await db
      .from('car_members')
      .select(`
        registration_id,
        registrations!inner (
          student_id,
          students!student_id ( line_user_id )
        )
      `)
      .eq('car_id', car.car_id)

    if (memberErr) {
      console.error('[send-car-notification] query car_members failed', car.car_id, memberErr)
      results.push(carResult)
      continue
    }

    for (const m of (members ?? [])) {
      const lineUserId = (m as any).registrations?.students?.line_user_id
      if (!lineUserId) {
        carResult.skipped++
        continue
      }
      const ok = await pushLineMessage(lineUserId, car.message_text ?? '')
      if (ok) carResult.sent++
      else carResult.failed++
    }

    results.push(carResult)
  }

  return json({ results })
})
