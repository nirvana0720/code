// 福慧出坡：排坡查詢與自動排坡邏輯
import { supabase } from './supabase'

export function deriveGenderFromClasses(classes) {
  for (const c of (classes || [])) {
    if (c.group_name?.includes('男')) return 'male'
    if (c.group_name?.includes('女')) return 'female'
  }
  return 'unknown'
}

/**
 * 取得某活動某時段的坡務清單（依 sort_order 排序）
 */
export async function getChoresByEventSession(eventId, session) {
  const { data, error } = await supabase
    .from('chores')
    .select('*')
    .eq('event_id', eventId)
    .eq('session', session)
    .order('sort_order', { ascending: true })
  if (error) return { chores: [], error: error.message }
  return { chores: data || [], error: null }
}

/**
 * 取得該活動「上山」方向所有車輛與成員（依車輛 sort_order 排序），每位成員附性別
 * 性別靠 student_classes.group_name 是否含「男」/「女」判斷，訪客/無組別資訊 → unknown
 */
export async function getUpCarMembersWithGender(eventId) {
  const { data: cars, error: carErr } = await supabase
    .from('car_assignments')
    .select('car_id, car_name, sort_order, car_members ( registration_id )')
    .eq('event_id', eventId)
    .eq('direction', 'up')
    .order('sort_order', { ascending: true })
  if (carErr) return { cars: [], error: carErr.message }
  if (!cars || cars.length === 0) return { cars: [], error: null }

  const allRegIds = [...new Set(cars.flatMap(c => (c.car_members ?? []).map(m => m.registration_id)))]
  if (allRegIds.length === 0) {
    return { cars: cars.map(c => ({ car_id: c.car_id, car_name: c.car_name, members: [] })), error: null }
  }

  const { data: regs, error: regErr } = await supabase
    .from('registrations')
    .select('registration_id, student_id, answers, registered_at, students!student_id ( name, phone, student_classes ( group_name ) )')
    .in('registration_id', allRegIds)
  if (regErr) return { cars: [], error: regErr.message }

  const regMap = Object.fromEntries((regs || []).map(r => [r.registration_id, r]))

  const cars2 = cars.map(c => {
    const members = (c.car_members ?? [])
      .map(m => regMap[m.registration_id])
      .filter(Boolean)
      .sort((a, b) => new Date(a.registered_at) - new Date(b.registered_at))
      .map(r => ({
        registration_id: r.registration_id,
        student_id: r.student_id,
        name: r.students?.name ?? r.answers?.guest_name ?? '訪客',
        phone: r.students?.phone || '',
        gender: deriveGenderFromClasses(r.students?.student_classes),
        car_id: c.car_id,
        car_name: c.car_name,
      }))
    return { car_id: c.car_id, car_name: c.car_name, members }
  })

  return { cars: cars2, error: null }
}

/**
 * 取得該活動「所有報名者」（不限是否有排上山大車），供排坡「未排入名單」使用——
 * 沒有排大車（例如選「其他交通」自行前往）的人 car_name 顯示為「自行前往」，一樣可以被批次指派坡務。
 * 跟 getUpCarMembersWithGender 分開一支：自動排坡（依車輛分組）仍只用後者，不吃這批「自行前往」的人，
 * 避免自動排坡邏輯被打亂——這批人固定要手動指派。
 */
export async function getEventMembersWithGender(eventId) {
  const { data: regs, error: regErr } = await supabase
    .from('registrations')
    .select('registration_id, student_id, answers, registered_at, students!student_id ( name, phone, student_classes ( group_name ) )')
    .eq('event_id', eventId)
    .order('registered_at', { ascending: true })
  if (regErr) return { members: [], error: regErr.message }

  const { data: cars, error: carErr } = await supabase
    .from('car_assignments')
    .select('car_id, car_name, car_members ( registration_id )')
    .eq('event_id', eventId)
    .eq('direction', 'up')
  if (carErr) return { members: [], error: carErr.message }

  const carByRegId = {}
  for (const c of (cars || [])) {
    for (const m of (c.car_members ?? [])) {
      carByRegId[m.registration_id] = { car_id: c.car_id, car_name: c.car_name }
    }
  }

  const members = (regs || []).map(r => ({
    registration_id: r.registration_id,
    student_id: r.student_id,
    name: r.students?.name ?? r.answers?.guest_name ?? '訪客',
    phone: r.students?.phone || '',
    gender: deriveGenderFromClasses(r.students?.student_classes),
    car_id: carByRegId[r.registration_id]?.car_id ?? null,
    car_name: carByRegId[r.registration_id]?.car_name ?? '自行前往',
  }))

  return { members, error: null }
}

/**
 * 取得某活動某時段所有已分配的坡務成員（含姓名/性別/上山車次），供展開名單與「已排除」判斷用
 */
export async function getChoreMembersByEventSession(eventId, session) {
  const { chores, error: choreErr } = await getChoresByEventSession(eventId, session)
  if (choreErr) return { members: [], error: choreErr }
  const choreIds = chores.map(c => c.chore_id)
  if (choreIds.length === 0) return { members: [], error: null }

  const { data: cms, error: cmErr } = await supabase
    .from('chore_members')
    .select('id, chore_id, registration_id')
    .in('chore_id', choreIds)
  if (cmErr) return { members: [], error: cmErr.message }
  if (!cms || cms.length === 0) return { members: [], error: null }

  const regIds = [...new Set(cms.map(m => m.registration_id))]

  const { data: regs, error: regErr } = await supabase
    .from('registrations')
    .select('registration_id, student_id, answers, students!student_id ( name, phone, student_classes ( group_name ) )')
    .in('registration_id', regIds)
  if (regErr) return { members: [], error: regErr.message }
  const regMap = Object.fromEntries((regs || []).map(r => [r.registration_id, r]))

  // 上山車次名稱（給展開名單顯示「原本上山車次」用）
  const { data: upCars } = await supabase
    .from('car_assignments')
    .select('car_id, car_name')
    .eq('event_id', eventId)
    .eq('direction', 'up')
  const carIdToName = Object.fromEntries((upCars || []).map(c => [c.car_id, c.car_name]))
  const carIds = Object.keys(carIdToName)
  let carNameMap = {}
  if (carIds.length > 0) {
    const { data: carMembers } = await supabase
      .from('car_members')
      .select('registration_id, car_id')
      .in('car_id', carIds)
      .in('registration_id', regIds)
    for (const cm of (carMembers || [])) carNameMap[cm.registration_id] = carIdToName[cm.car_id]
  }

  const members = cms.map(m => {
    const r = regMap[m.registration_id]
    return {
      id: m.id,
      chore_id: m.chore_id,
      registration_id: m.registration_id,
      name: r?.students?.name ?? r?.answers?.guest_name ?? '訪客',
      phone: r?.students?.phone || '',
      gender: deriveGenderFromClasses(r?.students?.student_classes),
      car_name: carNameMap[m.registration_id] ?? '',
    }
  })
  return { members, error: null }
}

/**
 * 自動排坡：依上山車輛順序，儘量讓同車的人排進同一坡務，滿了才溢到下一個（男女配額分開計算）
 * 會先清空這個 event+session 底下所有 chore_members 再重排（呼叫前請先由 UI 跳確認彈窗）
 */
export async function autoAssignChores(eventId, session) {
  const { chores, error: choreErr } = await getChoresByEventSession(eventId, session)
  if (choreErr) return { success: false, error: choreErr }
  if (chores.length === 0) return { success: false, error: '此時段尚無坡務資料，請先匯入坡務表' }

  const choreIds = chores.map(c => c.chore_id)
  const { error: delErr } = await supabase.from('chore_members').delete().in('chore_id', choreIds)
  if (delErr) return { success: false, error: delErr.message }

  const { cars, error: carErr } = await getUpCarMembersWithGender(eventId)
  if (carErr) return { success: false, error: carErr }
  if (!cars || cars.length === 0) return { success: false, error: '此活動尚無「上山」排車結果，請先完成排車' }

  const assignedCount = { male: {}, female: {} }
  for (const c of chores) { assignedCount.male[c.chore_id] = 0; assignedCount.female[c.chore_id] = 0 }

  const insertRows = []
  const unassignedList = []

  for (const gender of ['male', 'female']) {
    let chorePointer = 0
    for (const car of cars) {
      let remaining = car.members.filter(m => m.gender === gender)
      while (remaining.length > 0) {
        if (chorePointer >= chores.length) {
          unassignedList.push(...remaining.map(m => ({ ...m, reason: '坡務名額已滿' })))
          remaining = []
          break
        }
        const chore = chores[chorePointer]
        const quota = (gender === 'male' ? chore.quota_male : chore.quota_female) ?? 0
        const capacity = quota - assignedCount[gender][chore.chore_id]
        if (capacity <= 0) {
          chorePointer += 1
          continue
        }
        const take = Math.min(remaining.length, capacity)
        const taken = remaining.slice(0, take)
        for (const m of taken) insertRows.push({ chore_id: chore.chore_id, registration_id: m.registration_id })
        assignedCount[gender][chore.chore_id] += take
        remaining = remaining.slice(take)
      }
    }
  }

  // 無性別資訊（訪客/沒有組別資料）完全跳過不排，留給師父手動處理
  const unknownMembers = cars.flatMap(c => c.members.filter(m => m.gender === 'unknown'))
  unassignedList.push(...unknownMembers.map(m => ({ ...m, reason: '無性別資訊（非學員或無組別資料）' })))

  if (insertRows.length > 0) {
    const { error: insErr } = await supabase.from('chore_members').insert(insertRows)
    if (insErr) return { success: false, error: insErr.message }
  }

  const summary = chores.map(c => ({
    chore_id: c.chore_id,
    unit: c.unit,
    work_content: c.work_content,
    assigned_male: assignedCount.male[c.chore_id],
    assigned_female: assignedCount.female[c.chore_id],
    quota_male: c.quota_male,
    quota_female: c.quota_female,
  }))

  return { success: true, summary, unassigned: unassignedList, error: null }
}

/**
 * 手動把某人加入某坡務；若此人在同一 session 已在別的坡務，先移除舊的再加入新的
 */
export async function manualAssignMember(choreId, registrationId) {
  const { data: chore, error: choreErr } = await supabase
    .from('chores')
    .select('chore_id, event_id, session')
    .eq('chore_id', choreId)
    .single()
  if (choreErr) return { success: false, error: choreErr.message }

  const { chores: sessionChores, error: scErr } = await getChoresByEventSession(chore.event_id, chore.session)
  if (scErr) return { success: false, error: scErr }
  const sessionChoreIds = sessionChores.map(c => c.chore_id)

  const { error: delErr } = await supabase
    .from('chore_members')
    .delete()
    .in('chore_id', sessionChoreIds)
    .eq('registration_id', registrationId)
  if (delErr) return { success: false, error: delErr.message }

  const { error: insErr } = await supabase
    .from('chore_members')
    .insert({ chore_id: choreId, registration_id: registrationId })
  if (insErr) return { success: false, error: insErr.message }

  return { success: true, error: null }
}

/**
 * 批次把多人一次加入某坡務；每個人若在同一 session 已在別的坡務，先移除舊的再加入新的
 */
export async function batchAssignMembers(choreId, registrationIds) {
  if (!registrationIds || registrationIds.length === 0) return { success: false, rows: [], error: '未選擇任何人員' }

  const { data: chore, error: choreErr } = await supabase
    .from('chores')
    .select('chore_id, event_id, session')
    .eq('chore_id', choreId)
    .single()
  if (choreErr) return { success: false, rows: [], error: choreErr.message }

  const { chores: sessionChores, error: scErr } = await getChoresByEventSession(chore.event_id, chore.session)
  if (scErr) return { success: false, rows: [], error: scErr }
  const sessionChoreIds = sessionChores.map(c => c.chore_id)

  const { error: delErr } = await supabase
    .from('chore_members')
    .delete()
    .in('chore_id', sessionChoreIds)
    .in('registration_id', registrationIds)
  if (delErr) return { success: false, rows: [], error: delErr.message }

  const { data: rows, error: insErr } = await supabase
    .from('chore_members')
    .insert(registrationIds.map(id => ({ chore_id: choreId, registration_id: id })))
    .select('id, chore_id, registration_id')
  if (insErr) return { success: false, rows: [], error: insErr.message }

  return { success: true, rows: rows || [], error: null }
}

/**
 * 手動移除某人的坡務分配
 */
export async function removeMember(choreMemberId) {
  const { error } = await supabase.from('chore_members').delete().eq('id', choreMemberId)
  if (error) return { success: false, error: error.message }
  return { success: true, error: null }
}

/**
 * 取得整個活動的坡務對照表：
 * { [registration_id]: { 上午: {chore_id, unit, work_content, location, sort_order} | undefined, 下午: {...} | undefined } }
 * 供「分車名單」匯出加欄、以及領隊報到頁「坡務」頁籤分組共用（避免逐人查詢）
 * 走 SECURITY DEFINER RPC（get_chore_locations_by_event），取代直接查 chores/chore_members 表——
 * 這支函式會被 CarCheckinPage.jsx（公開領隊報到頁）呼叫，不能依賴 anon 直接查表權限
 */
export async function getChoreLocationsByEvent(eventId) {
  const { data, error } = await supabase.rpc('get_chore_locations_by_event', { p_event_id: eventId })
  if (error || !data) return {}
  return data
}
