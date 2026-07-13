// LINE Messaging API webhook：follow 事件回覆歡迎詞；message(text) 事件用學員手動輸入的學員編號完成綁定
// referral 自動識別方案已查證 LINE 現行 API 不支援（follow 事件沒有 referral 欄位），改用此簡化版
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const LINE_CHANNEL_ACCESS_TOKEN = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN')!
const LINE_CHANNEL_SECRET = Deno.env.get('LINE_CHANNEL_SECRET')!

const WELCOME_TEXT = '歡迎加入普宜精舍報名系統！請直接輸入您的學員編號，即可完成綁定，之後活動相關通知會發送到這裡。'
const NOT_FOUND_TEXT = '查無此學員編號，請確認後重新輸入'
const BOUND_TEXT = '✅ 已完成綁定，之後活動相關通知會發送到這裡'

// ── 驗證 x-line-signature（HMAC-SHA256, base64） ──
async function verifySignature(rawBody: string, signature: string | null): Promise<boolean> {
  if (!signature) return false
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(LINE_CHANNEL_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sigBuffer = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody))
  const computed = btoa(String.fromCharCode(...new Uint8Array(sigBuffer)))
  return computed === signature
}

async function replyMessage(replyToken: string, text: string) {
  try {
    const res = await fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({ replyToken, messages: [{ type: 'text', text }] }),
    })
    if (!res.ok) console.error('[line-webhook] reply failed', res.status, await res.text())
  } catch (err) {
    console.error('[line-webhook] reply exception', err)
  }
}

// 學員手動輸入學員編號完成綁定：純數字才查表，查無/非數字都回同一句提示；查到就直接覆蓋 line_user_id
async function handleTextMessage(db: ReturnType<typeof createClient>, event: any) {
  const replyToken = event.replyToken
  const userId = event.source?.userId
  const text = String(event.message?.text ?? '').trim()
  if (!replyToken || !userId) return

  if (!/^\d+$/.test(text)) {
    await replyMessage(replyToken, NOT_FOUND_TEXT)
    return
  }

  const { data: student, error: findErr } = await db
    .from('students')
    .select('student_id')
    .eq('student_id', text)
    .maybeSingle()

  if (findErr || !student) {
    await replyMessage(replyToken, NOT_FOUND_TEXT)
    return
  }

  const { error: updateErr } = await db
    .from('students')
    .update({ line_user_id: userId })
    .eq('student_id', text)

  if (updateErr) {
    console.error('[line-webhook] update line_user_id failed', updateErr)
    await replyMessage(replyToken, '綁定時發生錯誤，請稍後再試一次')
    return
  }

  await replyMessage(replyToken, BOUND_TEXT)
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

  const rawBody = await req.text()
  const signature = req.headers.get('x-line-signature')
  const valid = await verifySignature(rawBody, signature)
  if (!valid) return new Response('Invalid signature', { status: 401 })

  let payload: { events?: any[] }
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return new Response('Bad Request', { status: 400 })
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  for (const event of payload.events ?? []) {
    try {
      if (event.type === 'follow') {
        await replyMessage(event.replyToken, WELCOME_TEXT)
      } else if (event.type === 'message' && event.message?.type === 'text') {
        await handleTextMessage(db, event)
      }
    } catch (err) {
      console.error('[line-webhook] event handling error', err)
    }
  }

  // 一律回 200，避免 LINE 判定失敗而重送同一批事件
  return new Response('OK', { status: 200 })
})
