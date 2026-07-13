// LINE 綁定連結
// referral 自訂識別碼方案已查證 LINE 現行 API 不支援，改為「加好友後手動輸入學員編號」簡化版
// 因此這個連結對所有學員都一樣，真正的綁定是靠學員在聊天室輸入自己的學員編號（見 line-webhook）

// Bot Basic ID，未來若換 LINE OA 只需改這裡
const BOT_BASIC_ID = '615dqzid'

export const LINE_ADD_FRIEND_URL = `https://line.me/R/ti/p/@${BOT_BASIC_ID}`

// studentId 暫時不使用（保留參數以維持呼叫端介面不變），目前所有學員回傳同一個加好友連結
export function getBindingUrl(studentId) {
  return LINE_ADD_FRIEND_URL
}
