// 職責：解析「山上寄回的錄取名單」貼上文字，比對本活動報名者（純函式，可單元測試）。
//
// 規則（docs/山上審核_技術規格.md 第三節）：
// 1. 以「報名者姓名集合」逐行比對該行每個詞，不依賴欄位順序（可直接貼 PDF 複製出的整張表）；
//    姓名被空白拆成單字（「張　三」）時，會把連續單字接起來再比一次
// 2. 段落標題：出現「不錄取名單」之後的行歸 rejected；出現「錄取名單」之後的行歸 approved；
//    完全沒有標題（打七表）→ 全部歸 approved
// 3. 姓名標準化：全形轉半形（NFKC）、去掉所有空白（含全形空白）
// 4. 同名多筆報名 → ambiguous（需手動處理）；同一人同時出現在錄取與不錄取段落 → 也列 ambiguous
// 5. 長得像資料列（含 CTIS 編號，如 71-A0002、1071-F0001）卻找不到報名者 → notFound
//
// 比對用的姓名：學員用 students.name，訪客用 answers.guest_name（getDisplayName 的前兩個來源，
// 但不加「（XX 親友）」後綴，否則永遠比對不到名單上的純姓名）。
// 畫面要顯示名字時由呼叫端傳 displayNameOf（建議傳 eventDetailHelpers.getDisplayName）；
// 這裡不直接 import eventDetailHelpers.jsx，因為它含 JSX，純 Node 單元測試載入不了。

export const CTIS_CODE_RE = /\d{2,4}-[A-Za-z]\d{4}/
const CTIS_CODE_RE_G = /\d{2,4}-[A-Za-z]\d{4}/g

// 全形轉半形＋去空白
export function normalizeName(s) {
  return String(s ?? '').normalize('NFKC').replace(/\s+/g, '')
}

// 報名者用來比對的原始姓名（學員姓名 > 訪客姓名）
export function matchNameOf(reg) {
  return reg?.students?.name || reg?.answers?.guest_name || ''
}

// 判斷段落標題；回傳 'rejected' | 'approved' | null
// 只認「短的標題列」（例如「錄取名單：3 人」「第一期護七不錄取名單」）：
// 含逗號／句號、或超過 HEADER_MAX_LEN 字的是說明文字裡的句子（例如「…請參閱打七錄取名單，…」），不算標題。
// （2026-11-14 用打七 PDF 樣本整合驗證時發現說明文字被誤判成標題。）
const HEADER_MAX_LEN = 20
export function detectSectionHeader(line) {
  const n = normalizeName(line)
  if (n.length > HEADER_MAX_LEN || /[，。,]/.test(n)) return null
  if (n.includes('不錄取名單') || n.includes('未錄取名單')) return 'rejected'
  if (n.includes('錄取名單')) return 'approved'
  return null
}

// 一行切成詞：先把 CTIS 編號換成空白（避免編號黏著姓名），再依空白／逗號／頓號／tab 切開
function tokenize(line) {
  return String(line ?? '')
    .normalize('NFKC')
    .replace(CTIS_CODE_RE_G, ' ')
    .split(/[\s,，、;；|]+/)
    .map(normalizeName)
    .filter(Boolean)
}

// 從一行的詞找出命中的姓名：單一詞直接比；比不到時，試著把連續 2～4 個單字詞接起來
// （PDF 常把姓名排成「張　三」「王　小　明」，被空白切開）
const CJK_CHAR_RE = /^[㐀-鿿]$/
function candidateNames(tokens, byName) {
  const found = []
  for (let i = 0; i < tokens.length; i++) {
    if (byName.has(tokens[i])) { found.push(tokens[i]); continue }
    if (!CJK_CHAR_RE.test(tokens[i])) continue
    let joined = tokens[i]
    for (let j = i + 1; j < Math.min(tokens.length, i + 4); j++) {
      if (!CJK_CHAR_RE.test(tokens[j])) break
      joined += tokens[j]
      if (byName.has(joined)) { found.push(joined); i = j; break }
    }
  }
  return found
}

/**
 * @param {string} text 貼上的名單全文
 * @param {Array} registrations 本活動報名紀錄（需含 registration_id、students.name 或 answers.guest_name）
 * @param {{ displayNameOf?: (reg) => string }} [opts]
 * @returns {{
 *   hasSections: boolean,
 *   approved: Array<reg>,
 *   rejected: Array<reg>,
 *   ambiguous: Array<{ name, reason: 'duplicate_name'|'conflict', candidates: Array<{reg, displayName}>, lines: string[] }>,
 *   notFound: Array<{ line, code, section }>,
 *   unmatched: Array<reg>,   // 名單上完全沒出現的報名者（打七「其餘標未核准」用）
 * }}
 */
export function matchApprovalList(text, registrations, opts = {}) {
  const displayNameOf = opts.displayNameOf || matchNameOf
  const regs = registrations || []

  // 標準化姓名 → 報名紀錄（可能多筆）
  const byName = new Map()
  for (const r of regs) {
    const key = normalizeName(matchNameOf(r))
    if (!key) continue
    if (!byName.has(key)) byName.set(key, [])
    byName.get(key).push(r)
  }

  const lines = String(text ?? '').split(/\r?\n/)
  const hasSections = lines.some(l => detectSectionHeader(l) !== null)

  // regId → { reg, sections:Set, lines:[] }
  const hits = new Map()
  // 同名多筆：name → { candidates, lines }
  const dupNames = new Map()
  const notFound = []

  let section = 'approved' // 沒標題或標題之前的行都視為錄取
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    const header = detectSectionHeader(line)
    if (header) { section = header; continue }

    let matchedAny = false
    for (const tok of candidateNames(tokenize(line), byName)) {
      const cands = byName.get(tok)
      matchedAny = true
      if (cands.length > 1) {
        if (!dupNames.has(tok)) dupNames.set(tok, { candidates: cands, lines: [] })
        dupNames.get(tok).lines.push(line)
        continue
      }
      const reg = cands[0]
      const id = reg.registration_id
      if (!hits.has(id)) hits.set(id, { reg, sections: new Set(), lines: [] })
      const h = hits.get(id)
      h.sections.add(section)
      h.lines.push(line)
    }

    if (!matchedAny) {
      const m = line.normalize('NFKC').match(CTIS_CODE_RE)
      if (m) notFound.push({ line, code: m[0], section })
    }
  }

  const approved = []
  const rejected = []
  const ambiguous = []

  for (const [name, d] of dupNames) {
    ambiguous.push({
      name,
      reason: 'duplicate_name',
      candidates: d.candidates.map(reg => ({ reg, displayName: displayNameOf(reg) })),
      lines: d.lines,
    })
  }
  for (const { reg, sections, lines: ls } of hits.values()) {
    if (sections.size > 1) {
      ambiguous.push({
        name: normalizeName(matchNameOf(reg)),
        reason: 'conflict',
        candidates: [{ reg, displayName: displayNameOf(reg) }],
        lines: ls,
      })
    } else if (sections.has('rejected')) {
      rejected.push(reg)
    } else {
      approved.push(reg)
    }
  }

  const mentioned = new Set(hits.keys())
  for (const d of dupNames.values()) for (const r of d.candidates) mentioned.add(r.registration_id)
  const unmatched = regs.filter(r => !mentioned.has(r.registration_id))

  return { hasSections, approved, rejected, ambiguous, notFound, unmatched }
}
