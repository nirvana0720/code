// 職責：山上審核功能的常數（狀態代碼、中文標籤、顏色、預設未核准文字）。
// 程式一律用英文代碼，中文標籤只在這裡定義，畫面要顯示時從這裡取。
// 純常數＋純函式，不 import 任何東西（單元測試可直接載入）。

export const APPROVAL_STATUS = {
  REGISTERED: 'registered',           // 已報名（預設）
  CTIS_REGISTERED: 'ctis_registered', // CTIS已報名
  APPROVED: 'approved',               // 核准
  REJECTED: 'rejected',               // 未核准
}

// 依流程順序排列（篩選下拉、批次按鈕用）
export const APPROVAL_STATUSES = [
  APPROVAL_STATUS.REGISTERED,
  APPROVAL_STATUS.CTIS_REGISTERED,
  APPROVAL_STATUS.APPROVED,
  APPROVAL_STATUS.REJECTED,
]

export const APPROVAL_LABEL = {
  registered: '已報名',
  ctis_registered: 'CTIS已報名',
  approved: '核准',
  rejected: '未核准',
}

// Tailwind class（徽章用：底色＋字色＋邊框）
export const APPROVAL_COLOR = {
  registered: 'bg-gray-100 text-gray-700 border-gray-300',
  ctis_registered: 'bg-blue-100 text-blue-700 border-blue-300',
  approved: 'bg-green-100 text-green-700 border-green-300',
  rejected: 'bg-red-100 text-red-700 border-red-300',
}

export const DEFAULT_REJECTED_TEXT = '歡迎報名下次禪七'

export function isValidApprovalStatus(status) {
  return APPROVAL_STATUSES.includes(status)
}

// 舊資料／欄位尚未帶出時，一律視為「已報名」
export function normalizeApprovalStatus(status) {
  return isValidApprovalStatus(status) ? status : APPROVAL_STATUS.REGISTERED
}

export function approvalLabel(status) {
  return APPROVAL_LABEL[normalizeApprovalStatus(status)]
}

// 未核准時學員頁要顯示的文字：活動有設定就用活動的，空值用預設
export function getRejectedText(event) {
  const t = (event?.approval_rejected_text ?? '').trim()
  return t || DEFAULT_REJECTED_TEXT
}
