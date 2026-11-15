// 職責：「自動停止異動時間」的時間轉換（純函式，可單元測試）。
// 不論使用者電腦設在哪個時區，一律以台北時間（UTC+8，無夏令時間）解讀與顯示。
// - datetime-local 輸入值格式：'YYYY-MM-DDTHH:mm'（不帶時區）
// - 資料庫存 TIMESTAMPTZ，前端送出／讀回都是 ISO 字串（UTC）

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000
const INPUT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/

/** 資料庫 ISO 字串 → datetime-local 輸入值（台北時間）；空值回 '' */
export function isoToTaipeiInput(iso) {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  return new Date(t + TAIPEI_OFFSET_MS).toISOString().slice(0, 16)
}

/** datetime-local 輸入值（視為台北時間）→ ISO 字串（UTC）；空值或格式不對回 null（＝清除） */
export function taipeiInputToIso(value) {
  const m = INPUT_RE.exec(String(value ?? '').trim())
  if (!m) return null
  const [, y, mo, d, h, mi] = m.map(Number)
  return new Date(Date.UTC(y, mo - 1, d, h, mi) - TAIPEI_OFFSET_MS).toISOString()
}

/** 顯示用：'11月20日 18:00'（台北時間）；空值回 '' */
export function formatTaipeiLabel(iso) {
  const v = isoToTaipeiInput(iso)
  if (!v) return ''
  const [, , mo, d, h, mi] = INPUT_RE.exec(v)
  return `${Number(mo)}月${Number(d)}日 ${h}:${mi}`
}

/** 輸入值（台北時間）是否早於（或等於）現在；空值回 false */
export function isTaipeiInputPast(value, now = Date.now()) {
  const iso = taipeiInputToIso(value)
  return !!iso && new Date(iso).getTime() <= now
}
