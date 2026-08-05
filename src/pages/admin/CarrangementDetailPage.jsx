import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import AdminLayout from '../../components/AdminLayout'
import SearchableSelect from '../../components/SearchableSelect'
import {
  getAllEvents,
  getEventRegistrationsDetail,
  getRelationshipGroups,
  getCarArrangement,
  saveCarArrangement,
  getHeadLeader,
  setHeadLeader as saveHeadLeader,
  getSmallCarLeaders,
  setSmallCarLeaders as saveSmallCarLeaders,
  getMonks,
  setRegistrationIsDriver,
  setTransportOverride,
  getCarSmallOverrides,
  replaceCarSmallOverridesForEvent,
} from '../../lib/supabase'
import { preceptBadgeProps } from '../../lib/registrationHelpers'

import { genId, dirLabel, getName, getGuestNote, findGuestHost, fieldKeysFor, isSmallCar, isLargeCar, isOtherTransport, computeSmallGroups, keyFor } from '../../lib/carrangeHelpers'
import { isInSlot, eachDateInRange } from '../../lib/attendDateHelpers'
import autoArrange from '../../lib/autoArrange'
import { getChoreLocationsByEvent } from '../../lib/choreAssignment'
import { formatEventDate } from '../../lib/eventDetailHelpers'
import { exportCarrangement } from '../../lib/carrangeExport'
import CarNotificationModal from '../../components/CarNotificationModal'
import DateDirectionTabs from '../../components/carrange/DateDirectionTabs'
import CarSearchStats from '../../components/carrange/CarSearchStats'
import LargeCarList from '../../components/carrange/LargeCarList'
import SmallCarList from '../../components/carrange/SmallCarList'


export default function CarrangementDetailPage() {
  const { eventId } = useParams()
  const navigate    = useNavigate()

  const [loading, setLoading]     = useState(true)
  const [event,   setEvent]       = useState(null)
  const [regs,    setRegs]        = useState([])
  const [choreLocations, setChoreLocations] = useState({})
  const [relGroups, setRelGroups] = useState([])

  // ── 方向（去程/回程）＋ 多日回山排車的日期籤 ──
  const [direction, setDirection] = useState('up')
  const dates = useMemo(
    () => event?.multi_day_transport ? eachDateInRange(event.date_start, event.date_end) : [],
    [event]
  )
  const [selectedDate, setSelectedDate] = useState(null)
  useEffect(() => {
    if (dates.length > 0 && !dates.includes(selectedDate)) setSelectedDate(dates[0])
    if (dates.length === 0 && selectedDate !== null) setSelectedDate(null)
  }, [dates]) // eslint-disable-line react-hooks/exhaustive-deps
  // dateKeysAll：要載入/儲存/匯出的全部「日期」清單；單日活動固定 [null]
  const dateKeysAll = dates.length > 0 ? dates : [null]
  // dirKey：目前畫面顯示中的「日期＋方向」state key（單日活動＝原本的 'up'/'down'）
  const dirKey = keyFor(selectedDate, direction)

  // 以下所有 XxxByDir 狀態改用 dirKey 索引（單日活動時 dirKey 就是 'up'/'down'，行為不變）
  const [carsByDir, setCarsByDir]               = useState({})
  const [carCountByDir, setCarCountByDir]       = useState({})
  const [seatsPerCarByDir, setSeatsPerCarByDir] = useState({})
  const [orphanByDir, setOrphanByDir]         = useState({})
  // 大車移小車持久化（取代原本只存在前端 state 的 guestSmallOverrides，對所有人生效，不限訪客）
  const [smallOverridesByDir, setSmallOverridesByDir] = useState({})
  const [smallCarMonksByDir, setSmallCarMonksByDir] = useState({})
  const [smallPreDepartByDir, setSmallPreDepartByDir] = useState({})
  const [smallLateReturnByDir, setSmallLateReturnByDir] = useState({})
  const [autoArrangeWarningsByDir, setAutoArrangeWarningsByDir] = useState({})
  const [groupPreceptByDir, setGroupPreceptByDir] = useState({})

  const [headLeaderRegId, setHeadLeaderRegId]   = useState('')
  const [headLeaderToken, setHeadLeaderToken]   = useState('')
  const [smallCarLeaders, setSmallCarLeaders]   = useState([])

  const [allMonks, setAllMonks] = useState([])
  const [saving,  setSaving]    = useState(false)
  const [msg,     setMsg]       = useState('')
  const [copyMsg, setCopyMsg]   = useState('')
  const [notifyOpen, setNotifyOpen] = useState(false)
  const [driverPickerBusy, setDriverPickerBusy] = useState(null)

  // ── 取目前 dirKey 的 state ──
  const cars                = carsByDir[dirKey] ?? []
  const carCount             = carCountByDir[dirKey] ?? 2
  const seatsPerCar         = seatsPerCarByDir[dirKey] ?? 20
  const orphanAssignments   = orphanByDir[dirKey] ?? {}
  const smallOverrides      = smallOverridesByDir[dirKey] ?? {}
  const autoArrangeWarnings = autoArrangeWarningsByDir[dirKey] ?? []
  const groupPrecept        = groupPreceptByDir[dirKey] ?? false

  const setCars = updater => setCarsByDir(prev => {
    const next = typeof updater === 'function' ? updater(prev[dirKey] ?? []) : updater
    return { ...prev, [dirKey]: next }
  })
  const setCarCount    = v => setCarCountByDir(prev => ({ ...prev, [dirKey]: v }))
  const setSeatsPerCar = v => setSeatsPerCarByDir(prev => ({ ...prev, [dirKey]: v }))
  const setOrphanAssignments = updater => setOrphanByDir(prev => {
    const next = typeof updater === 'function' ? updater(prev[dirKey] ?? {}) : updater
    return { ...prev, [dirKey]: next }
  })
  const setSmallOverrides = updater => setSmallOverridesByDir(prev => {
    const next = typeof updater === 'function' ? updater(prev[dirKey] ?? {}) : updater
    return { ...prev, [dirKey]: next }
  })
  const setAutoArrangeWarnings = v => setAutoArrangeWarningsByDir(prev => ({ ...prev, [dirKey]: v }))
  const setGroupPrecept        = v => setGroupPreceptByDir(prev => ({ ...prev, [dirKey]: v }))

  // ── 衍生資料（含訪客；多日活動再依日期＋方向篩一次） ──
  const regMap      = useMemo(() => Object.fromEntries(regs.map(r => [r.registration_id, r])), [regs])
  const inSlot = r => isInSlot(r.answers, selectedDate, direction)
  const largePeople = useMemo(
    () => regs.filter(r => isLargeCar(r, direction) && inSlot(r) && !smallOverrides.hasOwnProperty(r.registration_id)),
    [regs, smallOverrides, direction, selectedDate]
  )
  const smallPeople = useMemo(
    () => regs.filter(r => isSmallCar(r.answers, direction) && inSlot(r)),
    [regs, direction, selectedDate]
  )

  const { matchedGroups, orphans } = useMemo(
    () => computeSmallGroups(smallPeople, direction),
    [smallPeople, direction]
  )

  // 把已手動指派的孤兒乘客 + 從大車移過來的人（不限訪客），併入對應的小車群組
  const finalSmallGroups = useMemo(() =>
    matchedGroups.map(g => ({
      ...g,
      allMembers: [
        ...g.members,
        ...orphans.filter(o => orphanAssignments[o.registration_id] === g.key),
        ...regs.filter(r => smallOverrides[r.registration_id] === g.key),
      ],
    })),
  [matchedGroups, orphans, orphanAssignments, regs, smallOverrides])

  const unassignedOrphans = useMemo(() =>
    orphans.filter(o => !orphanAssignments[o.registration_id]),
  [orphans, orphanAssignments])

  const assignedSet = useMemo(() => new Set(cars.flatMap(c => c.members)), [cars])
  const unassigned  = useMemo(() => largePeople.filter(r => !assignedSet.has(r.registration_id)), [largePeople, assignedSet])

  const guestInfoMap = useMemo(() => {
    const map = {}
    const studentRegs = largePeople.filter(r => r.student_id)
    for (const guest of largePeople.filter(r => !r.student_id)) {
      const note    = getGuestNote(guest)
      const matched = findGuestHost(guest, studentRegs)
      map[guest.registration_id] = { note, matchedName: matched ? getName(matched) : null }
    }
    return map
  }, [largePeople])

  const guestsNeedFollowup = useMemo(() =>
    largePeople.filter(r => !r.student_id && !guestInfoMap[r.registration_id]?.matchedName),
  [largePeople, guestInfoMap])

  const otherTransportRegs = useMemo(() =>
    regs.filter(r => isOtherTransport(r, direction) && inSlot(r)),
  [regs, direction, selectedDate])

  // ── 載入 ──
  useEffect(() => { load() }, [eventId])

  async function load() {
    setLoading(true)
    const [
      { events },
      { registrations },
      { groups },
      { cars: allCars },
      { headLeader },
      { headLeaders: smallCarLeaderList },
      { monks: monkList },
    ] = await Promise.all([
      getAllEvents({ excludeCanary: true }),
      getEventRegistrationsDetail(eventId),
      getRelationshipGroups(),
      getCarArrangement(eventId),   // 不篩方向/日期，一次撈全部再依 dirKey 分組
      getHeadLeader(eventId),
      getSmallCarLeaders(eventId),
      getMonks(),
    ])
    setAllMonks(monkList ?? [])
    const ev = events.find(e => e.event_id === eventId) ?? null
    setEvent(ev)
    setRegs(registrations)
    setRelGroups(groups)

    setChoreLocations(ev?.is_chore_event ? await getChoreLocationsByEvent(eventId) : {})

    const evDateKeys = ev?.multi_day_transport ? eachDateInRange(ev.date_start, ev.date_end) : [null]
    const byKey = {}
    for (const c of (allCars ?? [])) {
      const dk = keyFor(c.service_date ?? null, c.direction)
      if (!byKey[dk]) byKey[dk] = []
      byKey[dk].push(c)
    }

    const nextCars = {}, nextCarCount = {}, nextSeats = {}, nextOrphan = {}
    const nextSmallMonks = {}, nextSmallPre = {}, nextSmallLate = {}
    for (const dk0 of evDateKeys) {
      for (const dir of ['up', 'down']) {
        const dk = keyFor(dk0, dir)
        const restored = restoreDirection(byKey[dk] ?? [], registrations, dir, dk0)
        nextCars[dk] = restored.cars
        nextCarCount[dk] = restored.carCount
        nextSeats[dk] = restored.seats
        nextOrphan[dk] = restored.orphans
        nextSmallMonks[dk] = restored.smallCarMonks
        nextSmallPre[dk] = restored.smallPreDeparts
        nextSmallLate[dk] = restored.smallLateReturns
      }
    }
    setCarsByDir(nextCars)
    setCarCountByDir(nextCarCount)
    setSeatsPerCarByDir(nextSeats)
    setOrphanByDir(nextOrphan)
    setSmallCarMonksByDir(nextSmallMonks)
    setSmallPreDepartByDir(nextSmallPre)
    setSmallLateReturnByDir(nextSmallLate)

    // 大車移小車持久化：從 car_small_overrides 表載入（取代舊版用 car_members 內容反推的猜測法）
    const regIds = registrations.map(r => r.registration_id)
    const { overrides } = await getCarSmallOverrides(regIds)
    const nextSmallOverrides = {}
    for (const o of (overrides ?? [])) {
      const dk = keyFor(o.service_date ?? null, o.direction)
      if (!nextSmallOverrides[dk]) nextSmallOverrides[dk] = {}
      nextSmallOverrides[dk][o.registration_id] = o.target_driver_reg_id
    }
    setSmallOverridesByDir(nextSmallOverrides)

    if (headLeader) {
      setHeadLeaderRegId(headLeader.registration_id ?? '')
      setHeadLeaderToken(headLeader.access_token ?? '')
    }
    setSmallCarLeaders(smallCarLeaderList ?? [])
    setLoading(false)
  }

  async function handleSelectMainDriver(group, newDriverRegId) {
    if (!group?.candidates || group.candidates.length === 0) return
    setDriverPickerBusy(group.key)
    try {
      const results = await Promise.all(
        group.candidates.map(c =>
          setRegistrationIsDriver(c.registration_id, c.registration_id === newDriverRegId)
        )
      )
      const firstErr = results.find(r => !r.success)
      if (firstErr) { alert('指定主司機失敗：' + firstErr.error); return }
      const { registrations } = await getEventRegistrationsDetail(eventId)
      setRegs(registrations)
    } catch (e) {
      alert('指定主司機失敗：' + (e?.message ?? String(e)))
    } finally {
      setDriverPickerBusy(null)
    }
  }

  // 還原單一「日期＋方向」的排車結果（從 DB savedCars + registrations）
  // dateKey：這批車的 service_date（單日活動傳 null）
  function restoreDirection(savedCars, registrations, dir, dateKey) {
    const out = { cars: [], carCount: 2, seats: 20, orphans: {}, smallCarMonks: {}, smallPreDeparts: {}, smallLateReturns: {} }
    if (!savedCars || savedCars.length === 0) return out

    const largeSaved = savedCars.filter(c => c.car_type === 'large')
    if (largeSaved.length > 0) {
      out.cars = largeSaved.map(c => ({
        tempId:       c.car_id,
        car_name:     c.car_name,
        seats:        c.seats,
        members:      (c.car_members ?? []).map(m => m.registration_id),
        leaders:      (c.car_leaders ?? []).map(l => l.registration_id),
        access_token: c.access_token ?? '',
        monks:        (c.car_monks ?? []).map(m => m.monk_id),
        preDepart:    c.pre_depart || false,
        notice_text:  c.notice_text ?? '',
      }))
      out.carCount = out.cars.length
      out.seats    = out.cars[0]?.seats ?? 20
    }

    const smallSaved = savedCars.filter(c => c.car_type === 'small')
    if (smallSaved.length > 0) {
      const smallRegs = registrations.filter(r => isSmallCar(r.answers, dir) && isInSlot(r.answers, dateKey, dir))
      const { matchedGroups: freshMatched } = computeSmallGroups(smallRegs, dir)
      for (const savedCar of smallSaved) {
        const groupKey   = savedCar.note   // 司機的 registration_id
        const freshGroup = freshMatched.find(g => g.key === groupKey)
        const originalIds = new Set((freshGroup?.members ?? []).map(m => m.registration_id))
        for (const member of (savedCar.car_members ?? [])) {
          if (originalIds.has(member.registration_id)) continue
          const reg = registrations.find(r => r.registration_id === member.registration_id)
          // 只還原「孤兒乘客手動指定小車」；大車移小車的人一律從 car_small_overrides 表載入，這裡不猜
          if (reg && isSmallCar(reg.answers, dir)) out.orphans[member.registration_id] = groupKey
        }
        const savedMonks = (savedCar.car_monks ?? []).map(m => m.monk_id)
        if (savedMonks.length > 0) out.smallCarMonks[groupKey] = savedMonks
        if (savedCar.pre_depart) out.smallPreDeparts[groupKey] = true
        if (savedCar.late_return) out.smallLateReturns[groupKey] = true
      }
    }
    return out
  }

  // ── 操作 ──
  function handleAutoArrange() {
    if (largePeople.length === 0) { alert('此方向沒有搭精舍車的學員'); return }
    if (cars.length > 0 && !window.confirm(`自動排車會覆蓋目前「${dirLabel(direction)}」的排法，確定繼續？`)) return
    const { cars: newCars, warnings } = autoArrange(
      largePeople,
      Number(carCount),
      Number(seatsPerCar),
      relGroups,
      { groupPrecept }
    )
    setCars(newCars)
    setAutoArrangeWarnings(warnings)
  }

  function handleCopyToOtherDir() {
    const otherDir = direction === 'up' ? 'down' : 'up'
    const otherDirKey = keyFor(selectedDate, otherDir)
    const otherCarsExist = (carsByDir[otherDirKey] ?? []).length > 0
    if (otherCarsExist && !window.confirm(`會覆蓋目前「${dirLabel(otherDir)}」的所有排車結果，確定繼續？`)) return

    let removedCount = 0
    const copiedCars = cars.map(c => {
      const keptMembers = c.members.filter(rid => {
        const reg = regMap[rid]
        if (!reg) return false
        const keep = isLargeCar(reg, otherDir)
        if (!keep) removedCount++
        return keep
      })
      return {
        tempId:   genId(),
        car_name: c.car_name,
        seats:    c.seats,
        members:  keptMembers,
        leaders:  c.leaders.filter(lid => keptMembers.includes(lid)),
        monks:    [...(c.monks ?? [])],
      }
    })

    setCarsByDir(prev      => ({ ...prev, [otherDirKey]: copiedCars }))
    setCarCountByDir(prev  => ({ ...prev, [otherDirKey]: carCount }))
    setSeatsPerCarByDir(prev => ({ ...prev, [otherDirKey]: seatsPerCar }))
    setOrphanByDir(prev     => ({ ...prev, [otherDirKey]: {} }))
    setSmallOverridesByDir(prev => ({ ...prev, [otherDirKey]: {} }))
    setAutoArrangeWarningsByDir(prev => ({ ...prev, [otherDirKey]: [] }))

    setDirection(otherDir)
    const fromLabel = dirLabel(direction)
    const toLabel   = dirLabel(otherDir)
    setMsg(
      removedCount > 0
        ? `已從「${fromLabel}」複製到「${toLabel}」（自動排除 ${removedCount} 位另一方向不搭精舍車的人），記得按儲存`
        : `已從「${fromLabel}」複製到「${toLabel}」，記得按儲存`
    )
    setTimeout(() => setMsg(''), 8000)
  }

  // 單人移動（大車之間／未分配／訪客快速移小車下拉選單用）
  function movePerson(regId, target) {
    if (typeof target === 'string' && target.startsWith('small:')) {
      const groupKey = target.slice(6)
      setCars(prev => prev.map(c => ({
        ...c,
        members: c.members.filter(id => id !== regId),
        leaders: c.leaders.filter(id => id !== regId),
      })))
      setSmallOverrides(prev => ({ ...prev, [regId]: groupKey }))
    } else if (target === 'back-to-large') {
      setSmallOverrides(prev => { const next = { ...prev }; delete next[regId]; return next })
    } else {
      const targetCarIdx = typeof target === 'string' ? Number(target) : target
      setSmallOverrides(prev => {
        if (!prev.hasOwnProperty(regId)) return prev
        const next = { ...prev }; delete next[regId]; return next
      })
      setCars(prev => prev.map((c, i) => {
        const without = { ...c, members: c.members.filter(id => id !== regId), leaders: c.leaders.filter(id => id !== regId) }
        if (i === targetCarIdx) return { ...without, members: [...without.members, regId] }
        return without
      }))
    }
  }

  // 多選批次移到小車（大量排車操作優化：LargeCarList 的「已選 N 人・移到小車」）
  function moveManyToSmall(regIds, targetGroupKey) {
    const idSet = new Set(regIds)
    setCars(prev => prev.map(c => ({
      ...c,
      members: c.members.filter(id => !idSet.has(id)),
      leaders: c.leaders.filter(id => !idSet.has(id)),
    })))
    setSmallOverrides(prev => {
      const next = { ...prev }
      for (const id of regIds) next[id] = targetGroupKey
      return next
    })
  }
  function moveBackToLarge(regId) {
    setSmallOverrides(prev => { const next = { ...prev }; delete next[regId]; return next })
  }

  function toggleLeader(carIdx, regId) {
    setCars(prev => prev.map((c, i) => {
      if (i !== carIdx) return c
      const has = c.leaders.includes(regId)
      return { ...c, leaders: has ? c.leaders.filter(id => id !== regId) : [...c.leaders, regId] }
    }))
  }

  // ─── 跨大小車法師指派（同 dirKey 唯一性） ─────────────────────
  function unassignMonkAllCars(monkId) {
    setCars(prev => prev.map(c => ({ ...c, monks: (c.monks ?? []).filter(id => id !== monkId) })))
    setSmallCarMonksByDir(prev => {
      const d = { ...(prev[dirKey] ?? {}) }
      for (const k of Object.keys(d)) {
        d[k] = d[k].filter(id => id !== monkId)
        if (d[k].length === 0) delete d[k]
      }
      return { ...prev, [dirKey]: d }
    })
  }

  function assignMonkToLargeCar(ci, monkId) {
    setCars(prev => prev.map((c, i) => {
      const filtered = (c.monks ?? []).filter(id => id !== monkId)
      return { ...c, monks: i === ci ? [...filtered, monkId] : filtered }
    }))
    setSmallCarMonksByDir(prev => {
      const d = { ...(prev[dirKey] ?? {}) }
      let changed = false
      for (const k of Object.keys(d)) {
        const next = d[k].filter(id => id !== monkId)
        if (next.length !== d[k].length) { d[k] = next; changed = true }
        if (d[k].length === 0) delete d[k]
      }
      return changed ? { ...prev, [dirKey]: d } : prev
    })
  }

  function assignMonkToSmallCar(groupKey, monkId) {
    setCars(prev => {
      const idx = prev.findIndex(c => (c.monks ?? []).includes(monkId))
      if (idx < 0) return prev
      return prev.map((c, i) => i === idx ? { ...c, monks: (c.monks ?? []).filter(id => id !== monkId) } : c)
    })
    setSmallCarMonksByDir(prev => {
      const d = { ...(prev[dirKey] ?? {}) }
      for (const k of Object.keys(d)) {
        d[k] = d[k].filter(id => id !== monkId)
        if (d[k].length === 0) delete d[k]
      }
      d[groupKey] = [...(d[groupKey] ?? []), monkId]
      return { ...prev, [dirKey]: d }
    })
  }

  function toggleSmallPreDepart(groupKey) {
    setSmallPreDepartByDir(prev => {
      const d = { ...(prev[dirKey] ?? {}) }
      if (d[groupKey]) delete d[groupKey]
      else d[groupKey] = true
      return { ...prev, [dirKey]: d }
    })
  }

  function toggleSmallLateReturn(groupKey) {
    setSmallLateReturnByDir(prev => {
      const d = { ...(prev[dirKey] ?? {}) }
      if (d[groupKey]) delete d[groupKey]
      else d[groupKey] = true
      return { ...prev, [dirKey]: d }
    })
  }

  async function handleToggleOverride(reg, field) {
    const current = !!reg[field]
    const next = !current
    setRegs(prev => prev.map(r => r.registration_id === reg.registration_id ? { ...r, [field]: next } : r))
    const { success, error } = await setTransportOverride(reg.registration_id, field, next)
    if (!success) {
      alert(`設定失敗：${error}`)
      setRegs(prev => prev.map(r => r.registration_id === reg.registration_id ? { ...r, [field]: current } : r))
    }
  }

  function updateCarName(carIdx, name) {
    setCars(prev => prev.map((c, i) => i === carIdx ? { ...c, car_name: name } : c))
  }

  async function handleSave() {
    // 1. 人員爆掉：列出所有超額車輛（已含法師人數），強制確認
    const overflowList = []
    for (const dk0 of dateKeysAll) {
      for (const dir of ['up', 'down']) {
        const dk = keyFor(dk0, dir)
        for (const car of (carsByDir[dk] ?? [])) {
          const total = car.members.length + (car.monks ?? []).length
          if (total > car.seats) {
            const dateLabel = dk0 ? `${dk0}・` : ''
            overflowList.push(`${dateLabel}${dirLabel(dir)}・${car.car_name}（${total}/${car.seats}，超額 +${total - car.seats}）`)
          }
        }
      }
    }
    if (overflowList.length > 0) {
      if (!window.confirm(`⚠️ 以下車輛人數超過座位數：\n\n${overflowList.join('\n')}\n\n仍要儲存？`)) return
    }

    // 2. 法師：整場活動都沒指派任何法師，提醒一次（可繞過）
    let totalMonks = 0, hasAnyCar = false
    for (const dk0 of dateKeysAll) {
      for (const dir of ['up', 'down']) {
        const dk = keyFor(dk0, dir)
        const dkCars = carsByDir[dk] ?? []
        if (dkCars.length > 0) hasAnyCar = true
        totalMonks += dkCars.flatMap(c => c.monks ?? []).length
        totalMonks += Object.values(smallCarMonksByDir[dk] ?? {}).flat().length
      }
    }
    if (hasAnyCar && totalMonks === 0) {
      if (!window.confirm('法師尚未排入車次，仍要儲存？')) return
    }

    setSaving(true); setMsg('')

    const calcFinalSmall = (dir, dk0) => {
      const dk = keyFor(dk0, dir)
      const smallRegsDir = regs.filter(r => isSmallCar(r.answers, dir) && isInSlot(r.answers, dk0, dir))
      const { matchedGroups: m } = computeSmallGroups(smallRegsDir, dir)
      const orphanMap = orphanByDir[dk] ?? {}
      const overrideMap = smallOverridesByDir[dk] ?? {}
      return m.map(g => ({
        ...g,
        allMembers: [
          ...g.members,
          ...smallRegsDir.filter(o => orphanMap[o.registration_id] === g.key),
          ...regs.filter(r => overrideMap[r.registration_id] === g.key),
        ],
      }))
    }

    const savePromises = []
    for (const dk0 of dateKeysAll) {
      for (const dir of ['up', 'down']) {
        const dk = keyFor(dk0, dir)
        savePromises.push(
          saveCarArrangement(
            eventId,
            carsByDir[dk] ?? [],
            calcFinalSmall(dir, dk0),
            dir,
            smallCarMonksByDir[dk] ?? {},
            smallPreDepartByDir[dk] ?? {},
            smallLateReturnByDir[dk] ?? {},
            dk0
          )
        )
      }
    }

    // 大車移小車持久化：全量取代
    const overrideRows = []
    for (const dk0 of dateKeysAll) {
      for (const dir of ['up', 'down']) {
        const dk = keyFor(dk0, dir)
        for (const [regId, targetKey] of Object.entries(smallOverridesByDir[dk] ?? {})) {
          overrideRows.push({ registration_id: regId, direction: dir, service_date: dk0, target_driver_reg_id: targetKey })
        }
      }
    }
    const regIds = regs.map(r => r.registration_id)

    const [carResults, hlRes, sclRes, overrideRes] = await Promise.all([
      Promise.all(savePromises),
      headLeaderRegId ? saveHeadLeader(eventId, headLeaderRegId) : Promise.resolve({ success: true }),
      saveSmallCarLeaders(eventId, smallCarLeaders.map(l => l.registration_id).filter(Boolean)),
      replaceCarSmallOverridesForEvent(regIds, overrideRows),
    ])

    setSaving(false)
    const firstCarErr = carResults.find(r => !r.success)
    if (!firstCarErr && hlRes.success && sclRes.success && overrideRes.success) {
      setMsg('已儲存 ✓')
      await load()
    } else {
      setMsg(`儲存失敗：${firstCarErr?.error || hlRes.error || sclRes.error || overrideRes.error}`)
    }
    setTimeout(() => setMsg(''), 4000)
  }

  function copyLink(token, label) {
    const url = `${window.location.origin}/car-checkin/${token}`
    navigator.clipboard.writeText(url).then(() => {
      setCopyMsg(`${label} 連結已複製`)
      setTimeout(() => setCopyMsg(''), 2500)
    })
  }

  function handleExport() {
    exportCarrangement({
      event, regs, regMap, allMonks, choreLocations,
      dateKeysAll, carsByDir, orphanByDir, smallOverridesByDir,
    })
  }

  // ── 渲染 ──
  if (loading) return <AdminLayout><div className="text-center py-20 text-gray-400">載入中…</div></AdminLayout>

  const hasAnyCarAnywhere = dateKeysAll.some(dk0 => ['up', 'down'].some(dir => (carsByDir[keyFor(dk0, dir)] ?? []).length > 0))

  return (
    <AdminLayout>
      <div className="space-y-6 pb-24">

        {/* 頁首 */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <button
              onClick={() => navigate('/admin/carrangement')}
              className="text-sm text-amber-700 hover:underline mb-1 block"
            >
              ← 返回活動列表
            </button>
            <h1 className="text-xl font-bold text-gray-800">{event?.name ?? '載入中…'}</h1>
            <p className="text-sm text-gray-400">排車系統</p>
          </div>
          <div className="flex items-center gap-2">
            {msg && (
              <span className={`text-sm font-medium ${msg.includes('失敗') ? 'text-red-500' : 'text-green-600'}`}>
                {msg}
              </span>
            )}
            <button
              onClick={handleExport}
              disabled={!hasAnyCarAnywhere}
              className="px-3 py-2 text-sm border rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-40"
            >
              📥 匯出分車名單
            </button>
            <button
              onClick={() => setNotifyOpen(true)}
              disabled={cars.length === 0}
              className="px-3 py-2 text-sm border rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-40"
            >
              📨 發送乘車通知
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors font-medium"
            >
              {saving ? '儲存中…' : '儲存'}
            </button>
          </div>
        </div>

        {/* ── 日期籤（多日活動）＋ 上下山 Tab ── */}
        <DateDirectionTabs
          dates={dates} selectedDate={selectedDate} setSelectedDate={setSelectedDate}
          direction={direction} setDirection={setDirection} carsByDir={carsByDir}
        />

        {/* 統計卡片 */}
        {(() => {
          const statMonkCount = cars.reduce((s, c) => s + (c.monks?.length ?? 0), 0)
          const smallMonkCount = Object.values(smallCarMonksByDir[dirKey] ?? {}).flat().length
          return (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border px-4 py-3 bg-blue-50 border-blue-200 text-blue-700">
            <p className="text-xs font-medium">搭精舍車（大車）— {dirLabel(direction)}</p>
            <p className="text-xl font-bold mt-1">{largePeople.length + statMonkCount}</p>
            {statMonkCount > 0 && <p className="text-xs mt-0.5">含法師 {statMonkCount} 人</p>}
          </div>
          <div className="rounded-xl border px-4 py-3 bg-green-50 border-green-200 text-green-700">
            <p className="text-xs font-medium">小車（自行/共乘）— {dirLabel(direction)}</p>
            <p className="text-xl font-bold mt-1">{smallPeople.length + smallMonkCount}</p>
            {smallMonkCount > 0 && <p className="text-xs mt-0.5">含法師 {smallMonkCount} 人</p>}
          </div>
          <div className="rounded-xl border px-4 py-3 bg-gray-50 border-gray-200 text-gray-600">
            <p className="text-xs font-medium">其他/未填</p>
            <p className="text-xl font-bold mt-1">{regs.length - largePeople.length - smallPeople.length}</p>
          </div>
        </div>
          )
        })()}

        {/* 搜尋＋統計列（大量排車操作優化） */}
        <CarSearchStats cars={cars} regMap={regMap} unassignedCount={unassigned.length} />

        {/* ── 大車排車 ── */}
        <LargeCarList
          direction={direction} cars={cars} carCount={carCount} setCarCount={setCarCount}
          seatsPerCar={seatsPerCar} setSeatsPerCar={setSeatsPerCar}
          groupPrecept={groupPrecept} setGroupPrecept={setGroupPrecept}
          handleAutoArrange={handleAutoArrange} handleCopyToOtherDir={handleCopyToOtherDir} setCars={setCars}
          regMap={regMap} guestInfoMap={guestInfoMap} guestsNeedFollowup={guestsNeedFollowup}
          autoArrangeWarnings={autoArrangeWarnings} setAutoArrangeWarnings={setAutoArrangeWarnings}
          allMonks={allMonks} smallCarMonks={smallCarMonksByDir[dirKey] ?? {}} finalSmallGroups={finalSmallGroups}
          unassigned={unassigned}
          movePerson={movePerson} toggleLeader={toggleLeader}
          unassignMonkAllCars={unassignMonkAllCars} assignMonkToLargeCar={assignMonkToLargeCar}
          updateCarName={updateCarName} onMoveManyToSmall={moveManyToSmall} copyLink={copyLink}
        />

        {/* ── 小車配對 ── */}
        {smallPeople.length > 0 && (
          <SmallCarList
            direction={direction} finalSmallGroups={finalSmallGroups} orphans={orphans}
            unassignedOrphans={unassignedOrphans} orphanAssignments={orphanAssignments}
            setOrphanAssignments={setOrphanAssignments}
            allMonks={allMonks} smallCarMonks={smallCarMonksByDir[dirKey] ?? {}}
            unassignMonkAllCars={unassignMonkAllCars} assignMonkToSmallCar={assignMonkToSmallCar}
            smallPreDeparts={smallPreDepartByDir[dirKey] ?? {}} smallLateReturns={smallLateReturnByDir[dirKey] ?? {}}
            toggleSmallPreDepart={toggleSmallPreDepart} toggleSmallLateReturn={toggleSmallLateReturn}
            handleSelectMainDriver={handleSelectMainDriver} driverPickerBusy={driverPickerBusy}
            smallOverrides={smallOverrides} onMoveBackToLarge={moveBackToLarge}
          />
        )}

        {/* ── 其他交通（本方向不歸大車也不歸小車） ── */}
        {otherTransportRegs.length > 0 && (
          <section>
            <h2 className="text-base font-bold text-gray-700 mb-3 flex items-center gap-2">
              🚶 其他交通
              <span className="text-xs font-normal text-gray-400">
                （{direction === 'up' ? '去程' : '回程'}方向不搭精舍車、自行開車、搭學員的人，{otherTransportRegs.length} 人）
              </span>
            </h2>
            <div className="bg-slate-50 border border-slate-200 rounded-xl overflow-hidden">
              <div className="divide-y divide-slate-200">
                {otherTransportRegs.map(r => {
                  const cls = (r.students?.student_classes ?? []).map(c => c.class_name).join('/')
                  const transport = r.answers?.[fieldKeysFor(direction).transport] ?? '（未填）'
                  const badges = preceptBadgeProps(r)
                  const overrideField = direction === 'up' ? 'pre_depart_override' : 'late_return_override'
                  const overrideLabel = direction === 'up' ? '🚀 提前出發' : '🕓 延後回程'
                  const isUp = direction === 'up'
                  const checked = !!r[overrideField]
                  return (
                    <div key={r.registration_id} className="flex items-center gap-2 px-4 py-2 text-sm">
                      <span className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap">
                        <span className="font-medium">{getName(r)}</span>
                        {badges.map((b, i) => (
                          <span key={i} className={b.className} title={b.title}>{b.children}</span>
                        ))}
                        {cls && <span className="text-xs text-gray-400">{cls}</span>}
                        <span className="text-xs text-slate-500">{transport}</span>
                      </span>
                      <label className="flex items-center gap-1 cursor-pointer" title="勾選後此人計入提前/延後，看板應到不計入">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => handleToggleOverride(r, overrideField)}
                          className={`w-3.5 h-3.5 ${isUp ? 'accent-teal-600' : 'accent-amber-600'}`}
                        />
                        <span className={`text-xs ${checked ? (isUp ? 'text-teal-700 font-semibold' : 'text-amber-700 font-semibold') : 'text-gray-400'}`}>
                          {overrideLabel}
                        </span>
                      </label>
                    </div>
                  )
                })}
              </div>
            </div>
          </section>
        )}

        {/* ── 小車領隊（上下山共用，可多人） ── */}
        <section>
          <h2 className="text-base font-bold text-gray-700 mb-3">
            🚗 小車領隊
            <span className="text-xs font-normal text-gray-400 ml-2">（去回程共用、可多人）</span>
          </h2>
          {smallCarLeaders.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {smallCarLeaders.map(l => {
                const reg  = regMap[l.registration_id]
                const name = reg ? getName(reg) : '(已移除)'
                return (
                  <div key={l.registration_id} className="bg-green-50 border border-green-300 rounded-lg px-2.5 py-1.5 text-sm flex items-center gap-2">
                    <span className="font-medium text-green-800">{name}</span>
                    {l.access_token ? (
                      <button onClick={() => copyLink(l.access_token, `小車領隊・${name}`)} className="text-xs text-blue-600 hover:text-blue-800 hover:underline">
                        🔗 複製連結
                      </button>
                    ) : (
                      <span className="text-xs text-gray-400">（儲存後可複製）</span>
                    )}
                    <button
                      onClick={() => setSmallCarLeaders(prev => prev.filter(x => x.registration_id !== l.registration_id))}
                      className="text-red-400 hover:text-red-600 text-base leading-none"
                      title="移除"
                    >
                      ×
                    </button>
                  </div>
                )
              })}
            </div>
          )}
          <div className="flex items-center gap-3 flex-wrap">
            <SearchableSelect
              value=""
              onChange={rid => {
                if (!rid) return
                if (smallCarLeaders.some(l => l.registration_id === rid)) return
                setSmallCarLeaders(prev => [...prev, { registration_id: rid, access_token: '' }])
              }}
              className="w-full max-w-xs"
              placeholder="＋ 加入小車領隊（可重複加入）"
              options={regs
                .filter(r => r.student_id && !smallCarLeaders.some(l => l.registration_id === r.registration_id))
                .map(r => {
                  const cls = (r.students?.student_classes ?? []).map(c => c.class_name).join('/')
                  return {
                    value: r.registration_id,
                    label: getName(r),
                    sublabel: cls,
                    searchText: `${getName(r)} ${cls} ${r.student_id ?? ''}`,
                  }
                })}
            />
          </div>
          <p className="text-xs text-gray-400 mt-2">
            小車領隊可查看並操作所有小車成員的報到狀況（含去程與回程）。可設定多位領隊分擔任務，每位都有獨立的連結。<br />
            ⚠️ 每次儲存後連結會更新，請重新複製。
          </p>
        </section>

        {/* ── 總領隊（上下山共用） ── */}
        <section>
          <h2 className="text-base font-bold text-gray-700 mb-3">
            👑 總領隊
            <span className="text-xs font-normal text-gray-400 ml-2">（去回程共用）</span>
          </h2>
          <div className="flex items-center gap-3 flex-wrap">
            <SearchableSelect
              value={headLeaderRegId}
              onChange={setHeadLeaderRegId}
              className="w-full max-w-xs"
              placeholder="（未設定）"
              options={regs.filter(r => r.student_id).map(r => {
                const cls = (r.students?.student_classes ?? []).map(c => c.class_name).join('/')
                return {
                  value: r.registration_id,
                  label: getName(r),
                  sublabel: cls,
                  searchText: `${getName(r)} ${cls} ${r.student_id ?? ''}`,
                }
              })}
            />
            {headLeaderToken ? (
              <button onClick={() => copyLink(headLeaderToken, '總領隊')} className="px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium">
                🔗 複製總領隊連結
              </button>
            ) : (
              <span className="text-xs text-gray-400">（儲存後可複製連結）</span>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-2">
            總領隊看板可即時查看所有大車＋小車的報到進度（含去程與回程）。<br />
            ⚠️ 每次儲存排車後 token 會更新，請重新複製連結再傳給領隊。
          </p>
        </section>

        {copyMsg && (
          <div className="fixed bottom-20 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-sm px-4 py-2 rounded-lg shadow-lg whitespace-nowrap z-50">
            ✓ {copyMsg}
          </div>
        )}

      </div>

      {notifyOpen && (
        <CarNotificationModal
          eventId={eventId}
          direction={direction}
          cars={cars
            .filter(c => c.tempId && !String(c.tempId).startsWith('tmp-'))
            .map(c => ({ car_id: c.tempId, car_name: c.car_name, notice_text: c.notice_text }))}
          defaultNoticeText={event?.default_notice_text ?? ''}
          registrations={regs}
          choreLocations={choreLocations}
          isChoreEvent={!!event?.is_chore_event}
          eventName={event?.name ?? ''}
          eventDateLabel={formatEventDate(event)}
          onClose={() => setNotifyOpen(false)}
        />
      )}
    </AdminLayout>
  )
}
