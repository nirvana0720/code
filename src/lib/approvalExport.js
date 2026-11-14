// 職責：山上審核用的「簡單名單」CSV 匯出（學員編號、姓名、身分別、交通方式、審核狀態）。
// CSV 格式比照 eventDetailHelpers.exportCSV：每格加雙引號、UTF-8 BOM（Excel 開中文不亂碼）。
//
// 欄位辨識：
// - 身分別：pickRoleField(fields, 'identity', 'identity')（dashboard_role = 'identity' 優先）
// - 交通方式：dashboard_role 沒有交通角色（只有 identity／lunch_total／parking_kind），
//   沿用 computeDashboardStats 的寫死 field_key：transport_up（或舊的 transport）＋ transport_down

import { getDisplayName, pickRoleField, formatFieldValue } from './eventDetailHelpers'
import { approvalLabel } from './approvalConstants'

const HEADER = ['學員編號', '姓名', '身分別', '交通方式', '審核狀態']

function fieldText(field, answers) {
  if (!field) return ''
  const v = formatFieldValue(field, answers?.[field.field_key])
  return v === '-' ? '' : String(v ?? '')
}

/** 組出 CSV 的資料列（不含表頭），獨立出來方便預覽／測試 */
export function buildApprovalRows(registrations, fields = []) {
  const identityField = pickRoleField(fields, 'identity', 'identity')
  const upField = fields.find(f => f.field_key === 'transport_up') ?? fields.find(f => f.field_key === 'transport')
  const downField = fields.find(f => f.field_key === 'transport_down')

  return (registrations || []).map(r => {
    const up = fieldText(upField, r.answers)
    const down = fieldText(downField, r.answers)
    const transport = upField && downField
      ? [up && `去：${up}`, down && `回：${down}`].filter(Boolean).join('／')
      : (up || down)
    return [
      r.student_id ?? '訪客',
      getDisplayName(r),
      fieldText(identityField, r.answers),
      transport,
      approvalLabel(r.approval_status),
    ]
  })
}

function toCsv(rows) {
  return rows
    .map(row => row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n')
}

/** 下載簡單名單 CSV；檔名：民國年＋活動名稱＋審核名單＋MMDD */
export function exportApprovalCSV(registrations, fields, event) {
  const csv = toCsv([HEADER, ...buildApprovalRows(registrations, fields)])

  const eventName = (event?.name ?? '活動').replace(/^\d{4}\s*/, '')
  const dateBase = event?.date_start ?? new Date().toISOString().slice(0, 10)
  const rocYear = parseInt(dateBase.slice(0, 4)) - 1911
  const mmdd = dateBase.replace(/-/g, '').slice(4)
  const filename = `${rocYear}年${eventName}審核名單${mmdd}.csv`

  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
