// 封裝 fetch 呼叫本地印表代理程式（print-agent）的邏輯
// 代理程式沒開/印表機沒開都要靜默失敗，絕不能擋報到流程

const PRINT_AGENT_URL = 'http://127.0.0.1:9789/print'
const TIMEOUT_MS = 4000

// donor: 功德主紀錄物件（donor_item, seat, corsage, offering, donor_note），可為 null
// eventName: 活動全名（例如「普宜精舍金剛經共修法會暨護法會頒證大典」），印在小單副標
export async function printDonorTicket({ name, donor, eventName } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(PRINT_AGENT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name ?? '',
        donorItem: donor?.donor_item ?? '',
        seat: donor?.seat ?? '',
        corsage: donor?.corsage ?? '',
        offering: donor?.offering ?? '',
        note: donor?.donor_note ?? '',
        eventName: eventName ?? '',
      }),
      signal: controller.signal,
    })
    if (!res.ok) {
      console.warn('[printAgent] 列印失敗', res.status)
      return { success: false }
    }
    return { success: true }
  } catch (err) {
    console.warn('[printAgent] 印表代理程式無回應，略過列印', err.message)
    return { success: false }
  } finally {
    clearTimeout(timer)
  }
}

export default { printDonorTicket }
