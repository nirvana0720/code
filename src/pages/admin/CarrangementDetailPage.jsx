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
  getOtherDateCars,
  saveOtherDateCars,
  deleteOtherDateCarMember,
  getRegistrationBucketOverrides,
  upsertRegistrationBucketOverride,
} from '../../lib/supabase'
import { preceptBadgeProps } from '../../lib/registrationHelpers'

import { genId, dirLabel, getName, getGuestNote, findGuestHost, fieldKeysFor, isSmallCar, isLargeCar, isOtherTransport, computeSmallGroups, keyFor, OTHER_DATE_KEY } from '../../lib/carrangeHelpers'
import { eachDateInRange, isInSlot } from '../../lib/attendDateHelpers'
import { timeSlotsFor, restoreCarDirection, overrideStateKey, allDateDirectionSlots } from '../../lib/carSlotHelpers'
import { filterByFinalBucket, resolveFinalBucket, pendingOtherDateRegs as computePendingOtherDateRegs, buildOtherDateCarFromGroup } from '../../lib/otherDateHelpers'
import autoArrange from '../../lib/autoArrange'
import { getChoreLocationsByEvent } from '../../lib/choreAssignment'
import { formatEventDate } from '../../lib/eventDetailHelpers'
import { exportCarrangement } from '../../lib/carrangeExport'
import CarNotificationModal from '../../components/CarNotificationModal'
import DateDirectionTabs from '../../components/carrange/DateDirectionTabs'
import CarSearchStats from '../../components/carrange/CarSearchStats'
import LargeCarList from '../../components/carrange/LargeCarList'
import SmallCarList from '../../components/carrange/SmallCarList'
import OtherDateCarList from '../../components/carrange/OtherDateCarList'


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

  // ── 分時段活動（multi_slot_transport）的時段籤：依目前選中方向決定選項 ──
  const timeSlots = useMemo(() => timeSlotsFor(event, direction), [event, direction])
  const [selectedTimeSlot, setSelectedTimeSlot] = useState(null)
  useEffect(() => {
    if (timeSlots[0] !== null && !timeSlots.includes(selectedTimeSlot)) setSelectedTimeSlot(timeSlots[0])
    if (timeSlots[0] === null && selectedTimeSlot !== null) setSelectedTimeSlot(null)
  }, [timeSlots]) // eslint-disable-line react-hooks/exhaustive-deps

  // dirKey：目前畫面顯示中的「日期＋方向＋時段」state key（單日活動＝原本的 'up'/'down'）
  const dirKey = keyFor(selectedDate, direction, selectedTimeSlot)

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

  // ── 「其他日期」分頁：完全獨立的 state 與存讀邏輯（不進 allDateDirectionSlots 的迭代範圍）──
  const [otherDateCarsByDir, setOtherDateCarsByDir] = useState({ up: [], down: [] })
  // ── 跨分頁手動 override：{ [registration_id]: { up: overrideRow, down: overrideRow } } ──
  const [overridesMap, setOverridesMap] = useState({})

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

  // ── 衍生資料（含訪客；多日活動再依日期＋方向＋時段篩一次） ──
  const regMap      = useMemo(() => Object.fromEntries(regs.map(r => [r.registration_id, r])), [regs])
  // 「這個日期+方向該顯示的人」：先用 isInSlot 篩出原始候選，再排除掉歸進其他日期分頁的人
  // （自動判斷或手動 override 都算），override 指定回某個正常日期的人則歸到那個日期
  const bucketFilteredRegs = useMemo(
    () => filterByFinalBucket(regs, selectedDate, direction, selectedTimeSlot, event, overridesMap),
    [regs, selectedDate, direction, selectedTimeSlot, event, overridesMap]
  )
  const largePeople = useMemo(
    () => bucketFilteredRegs.filter(r => isLargeCar(r, direction) && !smallOverrides.hasOwnProperty(r.registration_id)),
    [bucketFilteredRegs, smallOverrides, direction]
  )
  const smallPeople = useMemo(
    () => bucketFilteredRegs.filter(r => isSmallCar(r.answers, direction)),
    [bucketFilteredRegs, direction]
  )
  // 目前方向下每個人的 bucket／isStale 判斷結果，供「移到...」按鈕與異動提示使用
  const bucketInfoByReg = useMemo(() => {
    const map = {}
    for (const r of regs) map[r.registration_id] = resolveFinalBucket(r, direction, event, overridesMap)
    return map
  }, [regs, direction, event, overridesMap])

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
    bucketFilteredRegs.filter(r => isOtherTransport(r, direction)),
  [bucketFilteredRegs, direction])

  // ── 「其他日期」分頁衍生資料 ──
  const otherDateCars = otherDateCarsByDir[direction] ?? []
  const otherDateAssignedSet = useMemo(
    () => new Set(otherDateCars.flatMap(c => c.members)),
    [otherDateCars]
  )
  // 2026-08-20 修：陳誼婕案例——同一人同時出現在「正常日期」小車與「其他日期」車，
  // root cause 是搜尋加人的候選名單之前只排除「已在其他日期車」的人，沒排除「已在正常
  // 日期車」的人，導致 +搜尋加人 可以搜到已經有正常排車的人、再加一次造成重複排車。
  // 這裡逐日＋逐時段重算這個方向「正常日期」大車／小車已指派的人（含孤兒手動指定、
  // 大車移小車 override），跟畫面上各日期分頁實際顯示的指派結果保持一致。
  const normalDateAssignedForDirection = useMemo(() => {
    const set = new Set()
    // 大車：carsByDir 是用 dirKey（含日期／方向／時段）索引，篩出屬於目前方向的即可
    for (const [dk, dkCars] of Object.entries(carsByDir)) {
      if (!dk.split('::').includes(direction)) continue
      for (const c of dkCars) for (const id of (c.members ?? [])) set.add(id)
    }
    // 小車：逐日／逐時段重算共乘分組＋孤兒指定／大車移小車 override，跟各分頁小車清單同邏輯
    for (const dateKey of dateKeysAll) {
      for (const timeSlot of timeSlotsFor(event, direction)) {
        const dk = keyFor(dateKey, direction, timeSlot)
        const dateRegs = filterByFinalBucket(regs, dateKey, direction, timeSlot, event, overridesMap)
        const dateSmallPeople = dateRegs.filter(r => isSmallCar(r.answers, direction))
        const { matchedGroups: dateMatched, orphans: dateOrphans } = computeSmallGroups(dateSmallPeople, direction)
        for (const g of dateMatched) for (const m of g.members) set.add(m.registration_id)
        const dateOrphanAssignments = orphanByDir[dk] ?? {}
        for (const o of dateOrphans) if (dateOrphanAssignments[o.registration_id]) set.add(o.registration_id)
        const dateSmallOverrides = smallOverridesByDir[dk] ?? {}
        for (const regId of Object.keys(dateSmallOverrides)) set.add(regId)
      }
    }
    return set
  }, [carsByDir, direction, dateKeysAll, event, regs, overridesMap, orphanByDir, smallOverridesByDir])
  const searchableOtherDateRegs = useMemo(
    () => regs.filter(r => !otherDateAssignedSet.has(r.registration_id) && !normalDateAssignedForDirection.has(r.registration_id)),
    [regs, otherDateAssignedSet, normalDateAssignedForDirection]
  )
  // 系統自動判斷該歸其他日期、但還沒被排進任何其他日期車輛的人（即時衍生，不持久化）
  const pendingOtherDateRegs = useMemo(
    () => computePendingOtherDateRegs(regs, direction, event, overridesMap, otherDateAssignedSet),
    [regs, direction, event, overridesMap, otherDateAssignedSet]
  )
  // 待處理名單再切分：有填「自行開車／搭學員的車」的人 → 套用共乘自動配對；
  // 其餘（大車／其他交通／未填）維持原本平面清單
  const pendingOtherDateSmallRegs = useMemo(
    () => pendingOtherDateRegs.filter(r => isSmallCar(r.answers, direction)),
    [pendingOtherDateRegs, direction]
  )
  const pendingOtherDateRestRegs = useMemo(
    () => pendingOtherDateRegs.filter(r => !isSmallCar(r.answers, direction)),
    [pendingOtherDateRegs, direction]
  )
  const { matchedGroups: otherDatePendingGroups, orphans: otherDatePendingOrphans } = useMemo(
    () => computeSmallGroups(pendingOtherDateSmallRegs, direction),
    [pendingOtherDateSmallRegs, direction]
  )
  const otherDatePendingFlat = useMemo(
    () => [...otherDatePendingOrphans, ...pendingOtherDateRestRegs],
    [otherDatePendingOrphans, pendingOtherDateRestRegs]
  )

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
      const dk = keyFor(c.service_date ?? null, c.direction, c.time_slot ?? null)
      if (!byKey[dk]) byKey[dk] = []
      byKey[dk].push(c)
    }

    const nextCars = {}, nextCarCount = {}, nextSeats = {}, nextOrphan = {}
    const nextSmallMonks = {}, nextSmallPre = {}, nextSmallLate = {}
    for (const { dateKey: dk0, direction: dir, timeSlot: slot, dirKey: dk } of allDateDirectionSlots(evDateKeys, ev)) {
      const restored = restoreCarDirection(byKey[dk] ?? [], registrations, dir, dk0, slot)
      nextCars[dk] = restored.cars
      nextCarCount[dk] = restored.carCount
      nextSeats[dk] = restored.seats
      nextOrphan[dk] = restored.orphans
      nextSmallMonks[dk] = restored.smallCarMonks
      nextSmallPre[dk] = restored.smallPreDeparts
      nextSmallLate[dk] = restored.smallLateReturns
    }
    setCarsByDir(nextCars)
    setCarCountByDir(nextCarCount)
    setSeatsPerCarByDir(nextSeats)
    setOrphanByDir(nextOrphan)
    setSmallCarMonksByDir(nextSmallMonks)
    setSmallPreDepartByDir(nextSmallPre)
    setSmallLateReturnByDir(nextSmallLate)

    // 大車移小車持久化：從 car_small_overrides 表載入（取代舊版用 car_members 內容反推的猜測法）
    // car_small_overrides 沒有 time_slot 欄位，分時段活動要用每個人自己的分時段答案反推 dirKey（見 overrideStateKey）
    const regIds = registrations.map(r => r.registration_id)
    const regById = Object.fromEntries(registrations.map(r => [r.registration_id, r]))
    const { overrides } = await getCarSmallOverrides(regIds)
    const nextSmallOverrides = {}
    for (const o of (overrides ?? [])) {
      const dk = overrideStateKey(regById[o.registration_id], o.direction, o.service_date ?? null)
      if (!nextSmallOverrides[dk]) nextSmallOverrides[dk] = {}
      nextSmallOverrides[dk][o.registration_id] = o.target_driver_reg_id
    }
    setSmallOverridesByDir(nextSmallOverrides)

    // 跨分頁手動 override（其他日期分頁功能）：一次查好整個活動的份量，組成 overridesMap
    const { overrides: bucketOverrides } = await getRegistrationBucketOverrides(regIds)
    const nextOverridesMap = {}
    for (const o of (bucketOverrides ?? [])) {
      if (!nextOverridesMap[o.registration_id]) nextOverridesMap[o.registration_id] = {}
      nextOverridesMap[o.registration_id][o.direction] = o
    }
    setOverridesMap(nextOverridesMap)

    // 「其他日期」分頁車輛：獨立讀取，不進 allDateDirectionSlots 的迭代範圍
    const { cars: otherCars } = await getOtherDateCars(eventId)
    const nextOtherDateByDir = { up: [], down: [] }
    for (const c of (otherCars ?? [])) {
      nextOtherDateByDir[c.direction].push({
        tempId: c.car_id,
        car_name: c.car_name,
        note: c.note ?? '',
        members: (c.car_members ?? []).map(m => m.registration_id),
      })
    }
    setOtherDateCarsByDir(nextOtherDateByDir)

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
    // 分時段活動：去程/回程的時段選項不完全相同（上午/中午 vs 中午/下午），
    // 目前選中的時段若對方也有就沿用，否則落到對方的第一個時段
    const otherSlots = timeSlotsFor(event, otherDir)
    const otherSlot = otherSlots.includes(selectedTimeSlot) ? selectedTimeSlot : otherSlots[0]
    const otherDirKey = keyFor(selectedDate, otherDir, otherSlot)
    const otherCarsExist = (carsByDir[otherDirKey] ?? []).length > 0
    if (otherCarsExist && !window.confirm(`會覆蓋目前「${dirLabel(otherDir)}」的所有排車結果，確定繼續？`)) return

    // 2026-08-20 修：陳誼婕案例排查同一天發現的另一個獨立 bug——多日回山活動裡，
    // 「複製到另一個方向」原本只檢查「這個人在對方方向是否搭精舍大車」，沒檢查
    // 「這個人在目前這個日期＋對方方向，是不是真的有出席需求」，導致掛單留宿的人
    // （例如 8/22 掛單住到 8/23 才回程）被整車複製成「8/22 回程」，跟他真正的
    // 「8/23 回程」重複。改用 isInSlot()（跟畫面上各分頁篩名單同一套判斷）多加一層
    // 檢查：只有這個人在目標日期＋方向本來就該出席，才會被複製過去；不掛單、當天
    // 來回的人因為每天都算有出席需求，isInSlot 仍會回傳真，不受影響。
    let removedCount = 0
    const copiedCars = cars.map(c => {
      const keptMembers = c.members.filter(rid => {
        const reg = regMap[rid]
        if (!reg) return false
        const keep = isLargeCar(reg, otherDir) && isInSlot(reg.answers, selectedDate, otherDir, otherSlot)
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
        ? `已從「${fromLabel}」複製到「${toLabel}」（自動排除 ${removedCount} 位另一方向不搭精舍車、或這天不需要該方向交通的人），記得按儲存`
        : `已從「${fromLabel}」複製到「${toLabel}」，記得按儲存`
    )
    setTimeout(() => setMsg(''), 8000)
  }

  // ─── 「其他日期」分頁車輛操作（獨立 state，只在本頁存檔時一併送出） ───────────────
  function setOtherDateCars(updater) {
    setOtherDateCarsByDir(prev => {
      const cur  = prev[direction] ?? []
      const next = typeof updater === 'function' ? updater(cur) : updater
      return { ...prev, [direction]: next }
    })
  }
  function addOtherDateCar() {
    setOtherDateCars(prev => [...prev, { tempId: genId(), car_name: `其他車 ${prev.length + 1}`, note: '', members: [] }])
  }
  function removeOtherDateCar(idx) {
    setOtherDateCars(prev => prev.filter((_, i) => i !== idx))
  }
  function updateOtherDateCarName(idx, name) {
    setOtherDateCars(prev => prev.map((c, i) => i === idx ? { ...c, car_name: name } : c))
  }
  function updateOtherDateCarNote(idx, note) {
    setOtherDateCars(prev => prev.map((c, i) => i === idx ? { ...c, note } : c))
  }
  function addOtherDateMember(idx, regId) {
    setOtherDateCars(prev => prev.map((c, i) => i === idx ? { ...c, members: [...c.members, regId] } : c))
  }
  // 「建議共乘分組」一鍵建立：新增一台其他日期車＋整組成員（司機＋乘客）一次加入，
  // 不用先新增車輛再逐一手動加人
  function addOtherDateCarFromGroup(group) {
    setOtherDateCars(prev => [...prev, buildOtherDateCarFromGroup(group)])
  }
  function removeOtherDateMember(idx, regId) {
    setOtherDateCars(prev => prev.map((c, i) => i === idx ? { ...c, members: c.members.filter(id => id !== regId) } : c))
  }

  // ─── 跨分頁手動 override（「移到...」按鈕，SECTION F）───────────────────────────
  async function handleMoveToBucket(regId, targetBucket, fromOtherCarIdx) {
    const reg = regMap[regId]
    const answers = reg?.answers ?? {}
    const row = {
      registration_id: regId,
      direction,
      target_bucket: targetBucket,
      source_stay_start: answers.stay_start ?? null,
      source_stay_end: answers.stay_end ?? null,
      source_transport: answers[fieldKeysFor(direction).transport] ?? null,
    }
    const { success, error } = await upsertRegistrationBucketOverride(row)
    if (!success) { alert('移動失敗：' + error); return }
    setOverridesMap(prev => ({ ...prev, [regId]: { ...(prev[regId] ?? {}), [direction]: row } }))
    // 從其他日期分頁移出去到別的地方：override 生效的同時，立即把這個人從原本那台其他
    // 日期車的 car_members 清掉（不留到下次按「儲存」），避免沒存檔就離開頁面時，
    // 這個人同時出現在正常分頁（override 已生效）跟其他日期分頁（car_members 還留著）
    if (fromOtherCarIdx != null && targetBucket !== 'other') {
      const fromCar = otherDateCars[fromOtherCarIdx]
      if (fromCar && !String(fromCar.tempId).startsWith('tmp-')) {
        const { success: odSuccess, error: odError } = await deleteOtherDateCarMember(fromCar.tempId, regId)
        if (!odSuccess) { alert('移動失敗（清除原車輛乘客失敗）：' + odError); return }
      }
      removeOtherDateMember(fromOtherCarIdx, regId)
    }
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
    for (const { dateKey: dk0, direction: dir, timeSlot: slot, dirKey: dk } of allDateDirectionSlots(dateKeysAll, event)) {
      for (const car of (carsByDir[dk] ?? [])) {
        const total = car.members.length + (car.monks ?? []).length
        if (total > car.seats) {
          const dateLabel = dk0 ? `${dk0}${slot ? `・${slot}` : ''}・` : ''
          overflowList.push(`${dateLabel}${dirLabel(dir)}・${car.car_name}（${total}/${car.seats}，超額 +${total - car.seats}）`)
        }
      }
    }
    if (overflowList.length > 0) {
      if (!window.confirm(`⚠️ 以下車輛人數超過座位數：\n\n${overflowList.join('\n')}\n\n仍要儲存？`)) return
    }

    // 2. 法師：整場活動都沒指派任何法師，提醒一次（可繞過）
    let totalMonks = 0, hasAnyCar = false
    for (const { dirKey: dk } of allDateDirectionSlots(dateKeysAll, event)) {
      const dkCars = carsByDir[dk] ?? []
      if (dkCars.length > 0) hasAnyCar = true
      totalMonks += dkCars.flatMap(c => c.monks ?? []).length
      totalMonks += Object.values(smallCarMonksByDir[dk] ?? {}).flat().length
    }
    if (hasAnyCar && totalMonks === 0) {
      if (!window.confirm('法師尚未排入車次，仍要儲存？')) return
    }

    setSaving(true); setMsg('')

    const calcFinalSmall = (dir, dk0, slot) => {
      const dk = keyFor(dk0, dir, slot)
      const smallRegsDir = filterByFinalBucket(regs, dk0, dir, slot, event, overridesMap).filter(r => isSmallCar(r.answers, dir))
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

    const savePromises = allDateDirectionSlots(dateKeysAll, event).map(
      ({ dateKey: dk0, direction: dir, timeSlot: slot, dirKey: dk }) => saveCarArrangement(
        eventId,
        carsByDir[dk] ?? [],
        calcFinalSmall(dir, dk0, slot),
        dir,
        smallCarMonksByDir[dk] ?? {},
        smallPreDepartByDir[dk] ?? {},
        smallLateReturnByDir[dk] ?? {},
        dk0,
        slot
      )
    )

    // 大車移小車持久化：全量取代（car_small_overrides 沒有 time_slot 欄位，
    // 同一人在同一 date+direction 只會落在一個時段，不會重複寫入）
    const overrideRows = []
    for (const { dateKey: dk0, direction: dir, dirKey: dk } of allDateDirectionSlots(dateKeysAll, event)) {
      for (const [regId, targetKey] of Object.entries(smallOverridesByDir[dk] ?? {})) {
        overrideRows.push({ registration_id: regId, direction: dir, service_date: dk0, target_driver_reg_id: targetKey })
      }
    }
    const regIds = regs.map(r => r.registration_id)

    // 「其他日期」分頁車輛：獨立存檔（不進 allDateDirectionSlots 的迭代範圍）
    const otherDateSavePromises = ['up', 'down'].map(dir => saveOtherDateCars(eventId, dir, otherDateCarsByDir[dir] ?? []))

    const [carResults, hlRes, sclRes, overrideRes, otherDateResults] = await Promise.all([
      Promise.all(savePromises),
      headLeaderRegId ? saveHeadLeader(eventId, headLeaderRegId) : Promise.resolve({ success: true }),
      saveSmallCarLeaders(eventId, smallCarLeaders.map(l => l.registration_id).filter(Boolean)),
      replaceCarSmallOverridesForEvent(regIds, overrideRows),
      Promise.all(otherDateSavePromises),
    ])

    setSaving(false)
    const firstCarErr = carResults.find(r => !r.success)
    const firstOtherDateErr = otherDateResults.find(r => !r.success)
    if (!firstCarErr && hlRes.success && sclRes.success && overrideRes.success && !firstOtherDateErr) {
      setMsg('已儲存 ✓')
      await load()
    } else {
      setMsg(`儲存失敗：${firstCarErr?.error || hlRes.error || sclRes.error || overrideRes.error || firstOtherDateErr?.error}`)
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
      dateKeysAll, carsByDir, orphanByDir, smallOverridesByDir, otherDateCarsByDir,
    })
  }

  // ── 渲染 ──
  if (loading) return <AdminLayout><div className="text-center py-20 text-gray-400">載入中…</div></AdminLayout>

  const hasAnyCarAnywhere = allDateDirectionSlots(dateKeysAll, event).some(({ dirKey }) => (carsByDir[dirKey] ?? []).length > 0)
    || Object.values(otherDateCarsByDir).some(list => (list ?? []).length > 0)

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
          multiSlot={!!event?.multi_slot_transport}
          selectedTimeSlot={selectedTimeSlot} setSelectedTimeSlot={setSelectedTimeSlot}
          event={event}
        />

        {/* ── 「其他日期」分頁：安置不在正常班表的少數人，完全獨立於下方大車/小車排車 UI ── */}
        {selectedDate === OTHER_DATE_KEY ? (
          <OtherDateCarList
            direction={direction} cars={otherDateCars} regMap={regMap} searchableRegs={searchableOtherDateRegs}
            onUpdateCarName={updateOtherDateCarName} onUpdateCarNote={updateOtherDateCarNote}
            onAddMember={addOtherDateMember} onRemoveMember={removeOtherDateMember}
            onAddCar={addOtherDateCar} onRemoveCar={removeOtherDateCar}
            dates={dates} onMoveToBucket={handleMoveToBucket} bucketInfoByReg={bucketInfoByReg}
            pendingRegs={otherDatePendingFlat}
            pendingGroups={otherDatePendingGroups}
            onCreateCarFromGroup={addOtherDateCarFromGroup}
          />
        ) : (
        <>
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
          dates={dates} onMoveToBucket={handleMoveToBucket} bucketInfoByReg={bucketInfoByReg}
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
            dates={dates} onMoveToBucket={handleMoveToBucket} bucketInfoByReg={bucketInfoByReg}
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
        </>
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
