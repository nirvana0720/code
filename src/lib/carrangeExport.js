// 職責單一：排車頁「匯出分車名單」Excel 產生邏輯（從 CarrangementDetailPage.jsx 搬出）
// 支援多日回山排車：dateKeysAll 有多個日期時，每個日期各自的大車/小車/其他交通 sheet
// 名稱加上日期前綴；單日活動 dateKeysAll = [null]，行為與搬出前完全相同。
import * as XLSX from '@e965/xlsx'
import { getName, getClasses, getGuestNote, fieldKeysFor, isLargeCar, isSmallCar, computeSmallGroups, keyFor } from './carrangeHelpers'
import { getPreceptFlags } from './registrationHelpers'
import { formatDateWithWeekday, isInSlot } from './attendDateHelpers'

// Excel sheet 名稱受限：≤31 字、不能含 : \ / ? * [ ]
const safeSheetName = name => String(name).replace(/[:\\/?*[\]]/g, '').slice(0, 31)

const classRank = name => {
  if (!name) return [9, 9]
  const day = name.includes('日間') ? 0 : name.includes('夜間') ? 1 : 2
  let lv = 5
  if (name.includes('初級')) lv = 1
  else if (name.includes('中級')) lv = 2
  else if (name.includes('高級')) lv = 3
  else if (name.includes('研經')) lv = 4
  return [day, lv]
}
const sortByClassGroup = (a, b) => {
  const ca = getClasses(a)[0] || {}
  const cb = getClasses(b)[0] || {}
  const [dA, lA] = classRank(ca.class_name)
  const [dB, lB] = classRank(cb.class_name)
  if (dA !== dB) return dA - dB
  if (lA !== lB) return lA - lB
  return (ca.group_name ?? '').localeCompare(cb.group_name ?? '', 'zh-TW')
}

function clusterByMentions(arr) {
  if (arr.length < 2) return arr
  const parent = arr.map((_, i) => i)
  const find = i => parent[i] === i ? i : (parent[i] = find(parent[i]))
  const union = (i, j) => { const ri = find(i), rj = find(j); if (ri !== rj) parent[ri] = rj }
  for (let i = 0; i < arr.length; i++) {
    const note = getGuestNote(arr[i])
    if (!note.trim()) continue
    for (let j = 0; j < arr.length; j++) {
      if (i === j) continue
      const nm = getName(arr[j])
      if (nm && nm.length >= 2 && note.includes(nm)) union(i, j)
    }
  }
  const seen = new Array(arr.length).fill(false)
  const result = []
  for (let i = 0; i < arr.length; i++) {
    if (seen[i]) continue
    const root = find(i)
    for (let j = i; j < arr.length; j++) {
      if (!seen[j] && find(j) === root) { result.push(arr[j]); seen[j] = true }
    }
  }
  return result
}

const preceptText = r => {
  const { refuge, five } = getPreceptFlags(r)
  if (refuge && five) return '三皈、五戒'
  if (five) return '五戒'
  if (refuge) return '三皈'
  return ''
}

const guestsOfHost = (host, pool) => {
  if (!host?.student_id) return []
  const hostName = getName(host)
  return pool.filter(g => {
    if (g.host_student_id && g.host_student_id === host.student_id) return true
    const note = getGuestNote(g)
    if (note && hostName.length >= 2 && note.includes(hostName)) return true
    return false
  })
}

export function exportCarrangement({ event, regs, regMap, allMonks, choreLocations, dateKeysAll, carsByDir, orphanByDir, smallOverridesByDir, otherDateCarsByDir = {} }) {
  const clsOf = r => getClasses(r).map(c => c.class_name).join('/')
  const grpOf = r => getClasses(r).map(c => c.group_name).filter(Boolean).join('/')
  const idOf  = r => r.answers?.identity ?? (r.student_id ? '' : '訪客')

  const showChoreCols = !!event?.is_chore_event
  const choreColHeaders = showChoreCols ? ['上午坡務位置', '下午坡務位置'] : []
  const fmtChore = s => s ? `${s.unit || s.work_content || ''}${s.location ? `（${s.location}）` : ''}` : ''
  const choreColsFor = regId => showChoreCols
    ? [fmtChore(choreLocations[regId]?.['上午']), fmtChore(choreLocations[regId]?.['下午'])]
    : []

  function buildLargeCarSheet(carName, upCar, downCar) {
    const upMembers   = new Set(upCar?.members ?? [])
    const downMembers = new Set(downCar?.members ?? [])
    const upLeaders   = new Set(upCar?.leaders ?? [])
    const downLeaders = new Set(downCar?.leaders ?? [])
    const upMonkIds   = new Set(upCar?.monks ?? [])
    const downMonkIds = new Set(downCar?.monks ?? [])
    const leaderAny   = new Set([...upLeaders, ...downLeaders])

    const allIds  = [...new Set([...upMembers, ...downMembers])]
    const allRegs = allIds.map(id => regMap[id]).filter(Boolean)

    const leaderOrder = [
      ...(upCar?.leaders ?? []),
      ...(downCar?.leaders ?? []).filter(id => !(upCar?.leaders ?? []).includes(id)),
    ]
    const leaderRegs    = leaderOrder.map(id => regMap[id]).filter(Boolean)
    const otherStudents = allRegs.filter(r => r.student_id && !leaderAny.has(r.registration_id))
    const guestPool     = allRegs.filter(r => !r.student_id && !leaderAny.has(r.registration_id))

    const sortedLeaders  = clusterByMentions(leaderRegs)
    const sortedStudents = clusterByMentions([...otherStudents].sort(sortByClassGroup))

    const finalRegs = []
    let remaining = [...guestPool]
    const flush = host => {
      const attached = guestsOfHost(host, remaining)
      finalRegs.push(...attached)
      remaining = remaining.filter(g => !attached.includes(g))
    }
    for (const r of sortedLeaders)  { finalRegs.push(r); flush(r) }
    for (const r of sortedStudents) { finalRegs.push(r); flush(r) }
    finalRegs.push(...remaining)

    const headers = ['序號', '車次', '姓名', '班級', '組別', '身份別', '電話', '去程', '回程', '寮號', '備註', ...choreColHeaders]
    const data = []
    let seq = 1

    const allMonkIds = [...new Set([...upMonkIds, ...downMonkIds])]
    for (const mid of allMonkIds) {
      const monk = allMonks.find(m => m.id === mid)
      if (!monk) continue
      const up   = upMonkIds.has(mid)   ? 'V' : ''
      const down = downMonkIds.has(mid) ? 'V' : ''
      data.push([seq++, carName, monk.name, '', '', '法師', '', up, down, '', '法師', ...choreColsFor(null)])
    }

    for (const r of finalRegs) {
      const isLeader = leaderAny.has(r.registration_id)
      const up   = upMembers.has(r.registration_id)   ? 'V' : ''
      const down = downMembers.has(r.registration_id) ? 'V' : ''
      const origNote = getGuestNote(r)
      const pTxt = preceptText(r)
      const parts = []
      if (pTxt) parts.push(pTxt)
      if (isLeader) parts.push('領隊')
      if (idOf(r) === '義工' && r.answers?.volunteer_group) parts.push(r.answers.volunteer_group)
      if (origNote) parts.push(origNote)
      const phone = r.student_id ? '' : (r.answers?.guest_phone ?? '')
      data.push([seq++, carName, getName(r), clsOf(r), grpOf(r), idOf(r), phone, up, down, r.dormitory_room ?? '', parts.join('/'), ...choreColsFor(r.registration_id)])
    }

    return XLSX.utils.aoa_to_sheet([headers, ...data])
  }

  function buildSmallCarSheet(dateKey) {
    const upKey = keyFor(dateKey, 'up'), downKey = keyFor(dateKey, 'down')
    const upSmallRegs   = regs.filter(r => isSmallCar(r.answers, 'up')   && isInSlot(r.answers, dateKey, 'up'))
    const downSmallRegs = regs.filter(r => isSmallCar(r.answers, 'down') && isInSlot(r.answers, dateKey, 'down'))
    const upRes   = computeSmallGroups(upSmallRegs,   'up')
    const downRes = computeSmallGroups(downSmallRegs, 'down')

    const byDriver = new Map()
    const touch = (key, plate) => {
      if (!byDriver.has(key)) byDriver.set(key, { plate: '', up: null, down: null })
      if (plate && !byDriver.get(key).plate) byDriver.get(key).plate = plate
    }
    for (const g of upRes.matchedGroups)   { touch(g.key, g.plate); byDriver.get(g.key).up   = g }
    for (const g of downRes.matchedGroups) { touch(g.key, g.plate); byDriver.get(g.key).down = g }

    const upOM   = orphanByDir[upKey] ?? {}
    const downOM = orphanByDir[downKey] ?? {}
    const upGM   = smallOverridesByDir[upKey] ?? {}
    const downGM = smallOverridesByDir[downKey] ?? {}

    const headers = ['序號', '車次', '車號', '姓名', '班級', '組別', '身份別', '電話', '去程', '回程', '寮號', '備註', ...choreColHeaders]
    const data = []
    let seq = 1
    let carIdx = 1

    for (const [driverKey, { plate, up, down }] of byDriver) {
      const carName = `小車${carIdx++}`
      const upMemberIds = new Set()
      const downMemberIds = new Set()
      if (up)   up.members.forEach(r   => upMemberIds.add(r.registration_id))
      if (down) down.members.forEach(r => downMemberIds.add(r.registration_id))
      upRes.orphans.filter(o => upOM[o.registration_id] === driverKey).forEach(o => upMemberIds.add(o.registration_id))
      downRes.orphans.filter(o => downOM[o.registration_id] === driverKey).forEach(o => downMemberIds.add(o.registration_id))
      regs.filter(r => upGM[r.registration_id] === driverKey).forEach(r => upMemberIds.add(r.registration_id))
      regs.filter(r => downGM[r.registration_id] === driverKey).forEach(r => downMemberIds.add(r.registration_id))

      const allIds  = [...new Set([...upMemberIds, ...downMemberIds])]
      const allRegs = allIds.map(id => regMap[id]).filter(Boolean)

      const driverReg  = allRegs.find(r => r.registration_id === driverKey)
      const others     = allRegs.filter(r => r.registration_id !== driverKey)
      const sortedOthers = [...others].sort(sortByClassGroup)

      const ordered = []
      if (driverReg) ordered.push(driverReg)
      ordered.push(...sortedOthers)

      for (const r of ordered) {
        const isDriver = r.registration_id === driverKey
        const up_   = upMemberIds.has(r.registration_id)   ? 'V' : ''
        const down_ = downMemberIds.has(r.registration_id) ? 'V' : ''
        const origNote = getGuestNote(r)
        const pTxt = preceptText(r)
        const parts = []
        if (pTxt) parts.push(pTxt)
        if (isDriver) parts.push('司機')
        if (idOf(r) === '義工' && r.answers?.volunteer_group) parts.push(r.answers.volunteer_group)
        if (origNote) parts.push(origNote)
        const phone = r.student_id ? '' : (r.answers?.guest_phone ?? '')
        data.push([seq++, carName, plate || '', getName(r), clsOf(r), grpOf(r), idOf(r), phone, up_, down_, r.dormitory_room ?? '', parts.join('/'), ...choreColsFor(r.registration_id)])
      }
    }

    const upUnassigned   = upRes.orphans.filter(o => !upOM[o.registration_id])
    const downUnassigned = downRes.orphans.filter(o => !downOM[o.registration_id])
    const unassignedIds  = [...new Set([
      ...upUnassigned.map(o => o.registration_id),
      ...downUnassigned.map(o => o.registration_id),
    ])]
    for (const id of unassignedIds) {
      const r = regMap[id]
      if (!r) continue
      const upV   = upUnassigned.some(o => o.registration_id === id)   ? 'V' : ''
      const downV = downUnassigned.some(o => o.registration_id === id) ? 'V' : ''
      const origNote   = getGuestNote(r)
      const pTxt = preceptText(r)
      const carpoolUp   = r.answers?.[fieldKeysFor('up').carpool]   ?? ''
      const carpoolDown = r.answers?.[fieldKeysFor('down').carpool] ?? ''
      const carpool = carpoolUp || carpoolDown
      const parts = []
      if (pTxt) parts.push(pTxt)
      if (carpool) parts.push(`→ ${carpool}`)
      if (idOf(r) === '義工' && r.answers?.volunteer_group) parts.push(r.answers.volunteer_group)
      if (origNote) parts.push(origNote)
      const phone = r.student_id ? '' : (r.answers?.guest_phone ?? '')
      data.push([seq++, '小車（未指定）', '', getName(r), clsOf(r), grpOf(r), idOf(r), phone, upV, downV, r.dormitory_room ?? '', parts.join('/'), ...choreColsFor(r.registration_id)])
    }

    return data.length > 0 ? XLSX.utils.aoa_to_sheet([headers, ...data]) : null
  }

  function buildOtherTransportSheet() {
    const transportUpKey   = fieldKeysFor('up').transport
    const transportDownKey = fieldKeysFor('down').transport
    const otherRegs = regs.filter(r => {
      const upOther   = !isLargeCar(r, 'up')   && !isSmallCar(r.answers, 'up')
      const downOther = !isLargeCar(r, 'down') && !isSmallCar(r.answers, 'down')
      return upOther || downOther
    })
    if (otherRegs.length === 0) return null

    const sortedRegs = [...otherRegs].sort(sortByClassGroup)
    const headers = ['序號', '姓名', '班級', '組別', '身份別', '電話', '去程方式', '回程方式', '寮號', '備註', ...choreColHeaders]
    const data = []
    let seq = 1
    for (const r of sortedRegs) {
      const origNote = getGuestNote(r)
      const pTxt = preceptText(r)
      const parts = []
      if (pTxt) parts.push(pTxt)
      if (idOf(r) === '義工' && r.answers?.volunteer_group) parts.push(r.answers.volunteer_group)
      if (origNote) parts.push(origNote)
      const phone = r.student_id ? '' : (r.answers?.guest_phone ?? '')
      const upT   = r.answers?.[transportUpKey]   ?? ''
      const downT = r.answers?.[transportDownKey] ?? ''
      data.push([seq++, getName(r), clsOf(r), grpOf(r), idOf(r), phone, upT, downT, r.dormitory_room ?? '', parts.join('/'), ...choreColsFor(r.registration_id)])
    }
    return XLSX.utils.aoa_to_sheet([headers, ...data])
  }

  // 「其他日期」分頁：提前掛單回山／延後回家的少數人，另外用獨立分組區塊呈現，不跟正常日期資料混在一起
  function buildOtherDateSheet(direction, cars) {
    if (!cars || cars.length === 0) return null
    const headers = ['序號', '車次', '說明', '姓名', '班級', '組別', '身份別', '電話', '寮號', '備註', ...choreColHeaders]
    const data = []
    let seq = 1
    for (const car of cars) {
      for (const regId of car.members) {
        const r = regMap[regId]
        if (!r) continue
        const origNote = getGuestNote(r)
        const pTxt = preceptText(r)
        const parts = []
        if (pTxt) parts.push(pTxt)
        if (idOf(r) === '義工' && r.answers?.volunteer_group) parts.push(r.answers.volunteer_group)
        if (origNote) parts.push(origNote)
        const phone = r.student_id ? '' : (r.answers?.guest_phone ?? '')
        data.push([seq++, car.car_name, car.note ?? '', getName(r), clsOf(r), grpOf(r), idOf(r), phone, r.dormitory_room ?? '', parts.join('/'), ...choreColsFor(r.registration_id)])
      }
    }
    return data.length > 0 ? XLSX.utils.aoa_to_sheet([headers, ...data]) : null
  }

  const wb = XLSX.utils.book_new()

  for (const dateKey of dateKeysAll) {
    const upKey = keyFor(dateKey, 'up'), downKey = keyFor(dateKey, 'down')
    const upCars   = carsByDir[upKey]   ?? []
    const downCars = carsByDir[downKey] ?? []
    const datePrefix = dateKey ? `${formatDateWithWeekday(dateKey)} ` : ''

    const orderedNames = []
    const seenNames = new Set()
    for (const c of upCars)   if (!seenNames.has(c.car_name)) { orderedNames.push(c.car_name); seenNames.add(c.car_name) }
    for (const c of downCars) if (!seenNames.has(c.car_name)) { orderedNames.push(c.car_name); seenNames.add(c.car_name) }

    for (const carName of orderedNames) {
      const upCar   = upCars.find(c   => c.car_name === carName)
      const downCar = downCars.find(c => c.car_name === carName)
      const ws = buildLargeCarSheet(carName, upCar, downCar)
      if (ws) XLSX.utils.book_append_sheet(wb, ws, safeSheetName(`${datePrefix}${carName}`))
    }

    const smallWs = buildSmallCarSheet(dateKey)
    if (smallWs) XLSX.utils.book_append_sheet(wb, smallWs, safeSheetName(`${datePrefix}小車`))
  }

  // 「其他日期」分頁（獨立於上方逐日 sheet 之外的分組區塊）
  for (const dir of ['up', 'down']) {
    const otherDateWs = buildOtherDateSheet(dir, otherDateCarsByDir[dir] ?? [])
    if (otherDateWs) XLSX.utils.book_append_sheet(wb, otherDateWs, safeSheetName(`其他日期・${dir === 'up' ? '去程' : '回程'}`))
  }

  // 其他交通不分日期（依報名答案判斷，跟原本單日行為一致）
  const otherWs = buildOtherTransportSheet()
  if (otherWs) XLSX.utils.book_append_sheet(wb, otherWs, '其他交通')

  if (wb.SheetNames.length === 0) {
    alert('沒有任何車輛可匯出')
    return
  }

  XLSX.writeFile(wb, `${event?.name ?? '活動'}_分車名單.xlsx`)
}
