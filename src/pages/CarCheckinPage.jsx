import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import CameraScanner from '../components/CameraScanner'
import {
  getCarByToken,
  getLinkedCarsForLeader,
  getHeadLeaderByToken,
  getAllCarsProgressByToken,
  checkIn,
  checkInAllCar,
  uncheckIn,
  checkInCarMember,
  uncheckInCarMember,
  kioskCheckinOtherTransport,
  checkInMonk,
  uncheckInMonk,
  isTokenExpired,
} from '../lib/supabase'
import { getMemberName, isGuest, getMemberCheckedAt, isCheckedIn, isOtherTransport, regAsMember, formatMemberClasses, sortCheckinMembers, formatDate, getAutoCheckedSet, markAutoChecked, getEffectivePreArrive, getPreArriveInfo, getEffectiveLateReturn, getLateReturnInfo, isMemberExcludedFromExpected, isVolunteerSelfReturn, isCarFullyEffectiveExcluded, getCarDriverNames, getCarDriverDate, carHasDateMismatch } from '../lib/checkinHelpers'
import { getChoreLocationsByEvent } from '../lib/choreAssignment'
import { eachDateInRange, getLocalTodayString, formatDateWithWeekday, isInSlot } from '../lib/attendDateHelpers'
import { OTHER_DATE_KEY } from '../lib/carrangeHelpers'
import ScanToast from '../components/ScanToast'
import DirectionBadge from '../components/DirectionBadge'
import MemberCheckinRow from '../components/checkin/MemberCheckinRow'
import DormitoryTab from '../components/checkin/DormitoryTab'
import ChoreTab from '../components/checkin/ChoreTab'

// 福慧出坡：頁面上方顯示今天上午/下午的出坡時間、報到時間；沒有資料的時段不顯示
function formatSessionTimes(events) {
  if (!events) return null
  const parts = []
  if (events.chore_am_work_time || events.chore_am_checkin_time) {
    let s = `上午出坡${events.chore_am_work_time ? ' ' + events.chore_am_work_time : ''}`
    if (events.chore_am_checkin_time) s += `（報到 ${events.chore_am_checkin_time}）`
    parts.push(s)
  }
  if (events.chore_pm_work_time || events.chore_pm_checkin_time) {
    let s = `下午出坡${events.chore_pm_work_time ? ' ' + events.chore_pm_work_time : ''}`
    if (events.chore_pm_checkin_time) s += `（報到 ${events.chore_pm_checkin_time}）`
    parts.push(s)
  }
  return parts.length > 0 ? parts.join('　') : null
}

// 報到／寮區／坡務頁籤切換列（大車／小車領隊／總領隊三處共用，色調依各自 header 主題傳入）
function TabBar({ active, onChange, showDormitory, showChore, wrapClass, activeClass }) {
  if (!showDormitory && !showChore) return null
  const tabs = [
    { key: 'checkin', label: '✅ 報到' },
    ...(showDormitory ? [{ key: 'dormitory', label: '🛏 寮區' }] : []),
    ...(showChore ? [{ key: 'chore', label: '🧹 坡務' }] : []),
  ]
  return (
    <div className={`flex gap-1 mt-3 ${wrapClass} rounded-lg p-1`}>
      {tabs.map(t => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors ${
            active === t.key ? `${activeClass} shadow-sm` : 'text-white/80 hover:text-white'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

// 精舍車（大車/小車/其他日期車）是否屬於目前選定的日期分頁
// selectedDate === null：非多日活動，不篩選（回傳 true）
// selectedDate === OTHER_DATE_KEY：只留 is_other_date 的車
// 其餘：只留 service_date 相符、且不是 is_other_date 的車
function carMatchesCheckinDate(c, selectedDate) {
  if (selectedDate == null) return true
  if (selectedDate === OTHER_DATE_KEY) return !!c.is_other_date
  return !c.is_other_date && c.service_date === selectedDate
}

// ─── 主頁面 ───────────────────────────────────────────────

export default function CarCheckinPage() {
  const { token } = useParams()

  const [loading, setLoading]     = useState(true)
  const [mode, setMode]           = useState(null)   // 'car' | 'head' | 'small_car' | 'invalid'

  // car mode
  const [car, setCar]             = useState(null)
  // 同領隊在另一個方向的車（含當前 car，依 up→down 排序）
  // 長度 > 1 時顯示上山/下山切換 Tab
  const [linkedCars, setLinkedCars] = useState([])

  // head mode
  const [headLeader, setHeadLeader] = useState(null)
  const [allCars, setAllCars]     = useState([])
  const [allEventRegs, setAllEventRegs] = useState([])   // 用於計算「其他交通」名單
  const [expandedCarId, setExpandedCarId] = useState(null)
  const [expandedSmallCarId, setExpandedSmallCarId] = useState(null)
  // 總領隊看板：上山/下山 Tab（'up' / 'down'）
  const [headDirection, setHeadDirection] = useState('up')
  // 總領隊／小車領隊看板：多日活動的日期分頁（單日活動固定 null，代表不篩選）
  const [selectedCheckinDate, setSelectedCheckinDate] = useState(null)

  // 福慧出坡：{ [registration_id]: { 上午: {...}, 下午: {...} } }，只有 is_chore_event 活動才有資料
  const [choreLocations, setChoreLocations] = useState({})

  // 報到／寮區／坡務頁籤（同一個 token，純前端切換，不用新增路由）
  const [activeTab, setActiveTab] = useState('checkin')

  // 共用
  const [scanMsg, setScanMsg]     = useState('')
  const [showCamera, setShowCamera] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  // 硬體掃描機
  const scanBufRef  = useRef('')
  const scanTimerRef = useRef(null)

  // ── 載入 ──
  useEffect(() => { load() }, [token])

  // 取得當前 car + 同領隊在另一個方向的車
  // 回傳 { car, linkedCars }，linkedCars 含當前 car，依 up→down 排序
  async function loadCarWithLinked(t) {
    const { car } = await getCarByToken(t)
    if (!car) return { car: null, linkedCars: [] }
    const leaderIds = (car.car_leaders ?? []).map(l => l.registration_id)
    if (leaderIds.length === 0) return { car, linkedCars: [car] }

    const { cars: linked } = await getLinkedCarsForLeader(t, leaderIds)
    const seen = new Set([car.car_id])
    const all  = [car]
    for (const c of (linked ?? [])) {
      if (!seen.has(c.car_id)) { seen.add(c.car_id); all.push(c) }
    }
    // 上山在前、下山在後
    all.sort((a, b) => (a.direction === 'up' ? -1 : 1) - (b.direction === 'up' ? -1 : 1))
    return { car, linkedCars: all }
  }

  async function load() {
    setLoading(true)
    setActiveTab('checkin')
    const [carInfo, hlRes] = await Promise.all([
      loadCarWithLinked(token),
      getHeadLeaderByToken(token),
    ])

    if (carInfo.car) {
      setMode('car')
      // 提前上山者自動標記為已報到（靜默執行）— 含所有跨方向的車
      // 注意：用 sessionStorage 過濾「本 session 已自動勾過」的人，避免取消後 F5 又被勾回
      const dateStart = carInfo.car.events?.date_start
      const autoChecked = getAutoCheckedSet(token)
      // 提前上山自動勾：只對「上山」方向適用（下山不該被自動勾，延後者另計）
      const toAutoCheck = carInfo.linkedCars.flatMap(c => {
        if ((c.direction ?? 'down') !== 'up') return []
        return (c.car_members ?? [])
          .filter(m =>
            !m.registrations?.checked_in_at &&
            getEffectivePreArrive(m, c, dateStart) &&
            !autoChecked.has(m.registration_id)
          )
          .map(m => ({ member: m, carId: c.car_id }))
      })
      if (toAutoCheck.length > 0) {
        await Promise.all(toAutoCheck.map(({ member, carId }) => checkInCarMember(token, carId, member.registration_id)))
        markAutoChecked(token, toAutoCheck.map(({ member }) => member.registration_id))
        const fresh = await loadCarWithLinked(token)
        setLinkedCars(fresh.linkedCars)
        setCar(fresh.linkedCars.find(c => c.car_id === carInfo.car.car_id) ?? fresh.car)
      } else {
        setLinkedCars(carInfo.linkedCars)
        setCar(carInfo.car)
      }
      setChoreLocations(
        carInfo.car.events?.is_chore_event
          ? await getChoreLocationsByEvent(carInfo.car.events.event_id)
          : {}
      )
    } else if (hlRes.headLeader) {
      const leaderType = hlRes.headLeader.type ?? 'all'
      setMode(leaderType === 'small_car' ? 'small_car' : 'head')
      setHeadLeader(hlRes.headLeader)
      const hlEvent = hlRes.headLeader.events
      if (hlEvent?.multi_day_transport) {
        // 小車領隊若連結有限定 service_date，直接鎖定那一天，不用「今天」去猜預設分頁
        if (leaderType === 'small_car' && hlRes.headLeader.service_date) {
          setSelectedCheckinDate(hlRes.headLeader.service_date)
        } else {
          const dates = eachDateInRange(hlEvent.date_start, hlEvent.date_end)
          const today = getLocalTodayString()
          const defaultDate = dates.includes(today)
            ? today
            : (dates.length > 0 && today < dates[0]) ? dates[0]
            : (dates[dates.length - 1] ?? null)
          setSelectedCheckinDate(defaultDate)
        }
      } else {
        setSelectedCheckinDate(null)
      }
      const eventId = hlRes.headLeader.events?.event_id ?? hlRes.headLeader.event_id
      setChoreLocations(
        hlRes.headLeader.events?.is_chore_event
          ? await getChoreLocationsByEvent(eventId)
          : {}
      )
      const { cars, regs } = await getAllCarsProgressByToken(token)
      setAllEventRegs(regs ?? [])
      // 提前上山者自動標記為已報到（靜默執行）
      // 注意：用 sessionStorage 過濾「本 session 已自動勾過」的人，避免取消後 F5 又被勾回
      const dateStart = hlRes.headLeader.events?.date_start
      const autoChecked = getAutoCheckedSet(token)
      // 提前上山自動勾：只對「上山」方向適用
      const toAutoCheck = (cars ?? []).flatMap(c => {
        if ((c.direction ?? 'down') !== 'up') return []
        return (c.car_members ?? [])
          .filter(m =>
            !m.registrations?.checked_in_at &&
            getEffectivePreArrive(m, c, dateStart) &&
            !autoChecked.has(m.registration_id)
          )
          .map(m => ({ member: m, carId: c.car_id }))
      })
      if (toAutoCheck.length > 0) {
        await Promise.all(toAutoCheck.map(({ member, carId }) => checkInCarMember(token, carId, member.registration_id)))
        markAutoChecked(token, toAutoCheck.map(({ member }) => member.registration_id))
        const { cars: fresh } = await getAllCarsProgressByToken(token)
        setAllCars(fresh ?? cars)
      } else {
        setAllCars(cars)
      }
    } else {
      const expired = await isTokenExpired(token)
      setMode(expired ? 'expired' : 'invalid')
    }
    setLoading(false)
  }

  // ── 重新整理 ──
  const refresh = useCallback(async () => {
    setRefreshing(true)
    if (mode === 'car') {
      const fresh = await loadCarWithLinked(token)
      if (fresh.car) {
        setLinkedCars(fresh.linkedCars)
        // 維持當前正在看的方向
        const currentId = car?.car_id
        const same = fresh.linkedCars.find(c => c.car_id === currentId)
        setCar(same ?? fresh.car)
      }
    } else if (mode === 'head' || mode === 'small_car') {
      const { cars, regs } = await getAllCarsProgressByToken(token)
      setAllCars(cars)
      setAllEventRegs(regs ?? [])
    }
    setRefreshing(false)
  }, [mode, token, car])

  // ── 自動每 30 秒重新整理 ──
  useEffect(() => {
    if (!mode || mode === 'invalid' || mode === 'expired' || mode === 'loading') return
    const id = setInterval(refresh, 30_000)
    return () => clearInterval(id)
  }, [mode, refresh])

  // ── 硬體掃描機監聽 ──
  useEffect(() => {
    function handleKeyPress(e) {
      if (showCamera) return
      if (e.key === 'Enter') {
        const code = scanBufRef.current.trim()
        scanBufRef.current = ''
        clearTimeout(scanTimerRef.current)
        if (code) handleScanCode(code)
      } else if (e.key.length === 1) {
        scanBufRef.current += e.key
        clearTimeout(scanTimerRef.current)
        scanTimerRef.current = setTimeout(() => { scanBufRef.current = '' }, 300)
      }
    }
    window.addEventListener('keypress', handleKeyPress)
    return () => window.removeEventListener('keypress', handleKeyPress)
  }, [mode, car, allCars, showCamera])

  // ── 掃描處理 ──
  async function handleScanCode(code) {
    let found = null
    let foundCar = null

    if (mode === 'car' && car) {
      // 跨方向尋找：當前車 + 同領隊另一方向的車
      const carsToSearch = linkedCars.length > 0 ? linkedCars : [car]
      for (const c of carsToSearch) {
        found = (c.car_members ?? []).find(
          m => m.registrations?.student_id === code || m.registration_id === code
        )
        if (found) {
          foundCar = c
          // 若在另一方向的車找到，自動切換顯示
          if (c.car_id !== car.car_id) setCar(c)
          break
        }
      }
    } else if (mode === 'head' || mode === 'small_car') {
      for (const c of allCars) {
        found = (c.car_members ?? []).find(
          m => m.registrations?.student_id === code || m.registration_id === code
        )
        if (found) {
          foundCar = c
          // 總領隊看板：若掃到的人在另一方向的車，自動切換 Tab
          if (mode === 'head' && c.direction && c.direction !== headDirection) {
            setHeadDirection(c.direction)
          }
          // 若掃到的人在另一個日期分頁的車，自動切換分頁，避免掃卡成功但畫面上看不到
          if ((mode === 'head' || mode === 'small_car') && selectedCheckinDate != null) {
            const targetDate = c.is_other_date ? OTHER_DATE_KEY : c.service_date
            if (targetDate && targetDate !== selectedCheckinDate) setSelectedCheckinDate(targetDate)
          }
          break
        }
      }
    }

    if (!found) {
      showMsg('找不到此學員（不在本車名單內）')
      return
    }

    const name = getMemberName(found)
    await checkInCarMember(token, foundCar.car_id, found.registration_id)
    showMsg(`✓ ${name} 報到完成`)
    await refresh()
  }

  function showMsg(text, ms = 3000) {
    setScanMsg(text)
    setTimeout(() => setScanMsg(''), ms)
  }

  // ── 手動點選報到 ──
  // carId: 有值 → 寫 car_members.checked_in_at（方向分離）
  //         null → 其他交通，寫 registrations.checked_in_at
  async function handleToggleCheckin(carId, registrationId, checkedAt) {
    if (carId) {
      if (checkedAt) {
        await uncheckInCarMember(token, carId, registrationId)
        markAutoChecked(token, [registrationId])
      } else {
        await checkInCarMember(token, carId, registrationId)
      }
    } else {
      // 其他交通：方向分離（headDirection closure）
      if (checkedAt) {
        await kioskCheckinOtherTransport(registrationId, headDirection, false)
        markAutoChecked(token, [registrationId])
      } else {
        await kioskCheckinOtherTransport(registrationId, headDirection, true)
      }
    }
    await refresh()
  }

  // ── 法師手動點選報到（無 QR code） ──
  async function handleToggleMonkCheckin(carMonkId, checkedAt) {
    if (checkedAt) {
      await uncheckInMonk(token, carMonkId)
    } else {
      await checkInMonk(token, carMonkId)
    }
    await refresh()
  }

  // ── 畫面 ──

  if (loading) return (
    <div className="min-h-screen bg-amber-50 flex items-center justify-center">
      <div className="text-amber-700 text-xl animate-pulse">載入中…</div>
    </div>
  )

  if (mode === 'expired') return (
    <div className="min-h-screen bg-amber-50 flex items-center justify-center p-8">
      <div className="text-center">
        <div className="text-5xl mb-4">📅</div>
        <div className="text-xl font-semibold text-gray-700 mb-2">此活動已結束，報到頁面已關閉</div>
        <div className="text-gray-500 text-sm">如需查詢報到資料，請洽詢精舍師父</div>
      </div>
    </div>
  )

  if (mode === 'invalid') return (
    <div className="min-h-screen bg-amber-50 flex items-center justify-center p-8">
      <div className="text-center">
        <div className="text-5xl mb-4">🔒</div>
        <div className="text-xl font-semibold text-gray-700 mb-2">連結無效</div>
        <div className="text-gray-500 text-sm">請向師父索取正確的報到連結</div>
      </div>
    </div>
  )

  // ════════════════════════════════════════
  //  大車領隊模式
  // ════════════════════════════════════════

  if (mode === 'car' && car) {
    const members       = car.car_members ?? []
    const monks         = car.car_monks ?? []
    const dateStart     = car.events?.date_start
    const dateEnd       = car.events?.date_end
    const showDormitory = !!car.events?.show_dormitory_to_public
    const showChore     = !!car.events?.is_chore_event
    const showDormitoryTab = showDormitory && members.some(m => m.registrations?.dormitory_room)
    const showChoreTab     = showChore
    const memberCheckedIn = members.filter(isCheckedIn).length
    const monkCheckedIn   = monks.filter(m => !!m.checked_in_at).length
    const checkedIn     = memberCheckedIn + monkCheckedIn
    const total         = members.length + monks.length
    const eventName     = car.events?.name ?? ''
    const eventDate     = formatDate(dateStart)
    const pct           = total > 0 ? Math.round((checkedIn / total) * 100) : 0

    // 排序：領隊 → 學員 → 訪客（同段內依班級+組別+姓名）
    const leaderRegIds = (car.car_leaders ?? []).map(l => l.registration_id)
    const sorted = sortCheckinMembers(members, leaderRegIds)

    return (
      <div className="min-h-screen bg-amber-50 pb-24 car-checkin-page">
        <ScanToast msg={scanMsg} />

        {/* Header */}
        <div className="bg-amber-700 text-white px-4 py-5 shadow-md">
          <div className="max-w-lg mx-auto">
            <div className="text-xs opacity-75 mb-0.5">{eventName}　{eventDate}</div>

            {/* 上下山切換 Tab（只有當該領隊在另一方向也有車時才顯示） */}
            {linkedCars.length > 1 && (
              <div className="flex gap-1 mb-2 bg-amber-800/40 rounded-lg p-1">
                {linkedCars.map(c => {
                  const active = c.car_id === car.car_id
                  const dir = c.direction === 'up' ? '🚌 去程' : '🚍 回程'
                  return (
                    <button
                      key={c.car_id}
                      onClick={() => setCar(c)}
                      className={`flex-1 py-2 px-2 rounded-md text-xs font-semibold transition-colors text-center ${
                        active
                          ? 'bg-white text-amber-700 shadow-sm'
                          : 'text-white/90 hover:bg-amber-700/40 active:bg-amber-700/60'
                      }`}
                    >
                      {dir}　{c.car_name}
                    </button>
                  )
                })}
              </div>
            )}

            <div className="text-xl font-bold flex items-center gap-2 flex-wrap">
              <span>{car.car_name} 報到</span>
              {car.direction && (
                <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                  car.direction === 'up'
                    ? 'bg-blue-100 text-blue-800'
                    : 'bg-amber-50 text-amber-900'
                }`}>
                  {car.direction === 'up' ? '🚌 去程' : '🚍 回程'}
                </span>
              )}
            </div>
            <div className="flex items-end gap-2 mt-3">
              <span className="text-4xl font-bold leading-none">{checkedIn}</span>
              <span className="text-base opacity-75 pb-0.5">/ {total} 人　{pct}%</span>
            </div>
            <div className="mt-2 bg-white/30 rounded-full h-2.5">
              <div
                className="bg-white rounded-full h-2.5 transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>

            <TabBar
              active={activeTab} onChange={setActiveTab}
              showDormitory={showDormitoryTab} showChore={showChoreTab}
              wrapClass="bg-amber-800/40" activeClass="bg-white text-amber-700"
            />
          </div>
        </div>

        {activeTab === 'checkin' && (
          <>
            {/* 福慧出坡：今天上午/下午出坡時間、報到時間 */}
            {showChore && formatSessionTimes(car.events) && (
              <div className="px-4 pt-3 max-w-lg mx-auto">
                <div className="bg-lime-50 border border-lime-200 rounded-lg px-3 py-2 text-xs text-lime-800">
                  🕐 {formatSessionTimes(car.events)}
                </div>
              </div>
            )}

            {/* 掃描按鈕 */}
            <div className="px-4 pt-4 max-w-lg mx-auto">
              <button
                onClick={() => setShowCamera(true)}
                className="w-full py-3 bg-white border-2 border-amber-400 rounded-xl text-amber-700 font-semibold text-sm hover:bg-amber-50 active:bg-amber-100 transition-colors shadow-sm"
              >
                📷 用相機掃描學員證
              </button>
              <p className="text-center text-xs text-gray-400 mt-1.5">
                硬體掃描機直接對著螢幕掃即可
              </p>
            </div>

            {/* 成員清單 */}
            <div className="px-4 pt-3 max-w-lg mx-auto space-y-2">
              {/* 法師列表（排最上面，提醒領隊優先勾選） */}
              {monks.length > 0 && (
                <div className="mb-1">
                  <div className="text-xs text-purple-500 font-semibold px-1 mb-1.5">🛕 法師（手動點選報到）</div>
                  {monks.map(cm => {
                    const chk = !!cm.checked_in_at
                    return (
                      <div
                        key={cm.id}
                        className={`flex items-center gap-3 bg-white rounded-xl px-4 py-3 shadow-sm border mb-2 transition-opacity ${
                          chk ? 'border-green-200 opacity-60' : 'border-purple-300'
                        }`}
                      >
                        <div className="flex-1 min-w-0 flex items-center gap-1.5">
                          <span className={`font-medium ${chk ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                            {cm.temple_monks?.name ?? '（未知）'}
                          </span>
                          <span className="text-xs bg-purple-100 text-purple-700 rounded-full px-1.5 shrink-0">法師</span>
                        </div>
                        <button
                          onClick={() => handleToggleMonkCheckin(cm.id, cm.checked_in_at)}
                          className={`shrink-0 px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                            chk
                              ? 'bg-gray-100 text-gray-500 hover:bg-red-50 hover:text-red-500'
                              : 'bg-green-600 text-white hover:bg-green-700 active:bg-green-800'
                          }`}
                        >
                          {chk ? '已到' : '報到'}
                        </button>
                      </div>
                    )
                  })}
                  <div className="border-t border-dashed border-gray-200 my-3"></div>
                </div>
              )}

              {sorted.map(member => {
                const checked  = isCheckedIn(member)
                const isLeader = (car.car_leaders ?? []).some(
                  l => l.registration_id === member.registration_id
                )
                const dir = car.direction ?? 'down'
                const ex  = dir === 'down'
                  ? getEffectiveLateReturn(member, car, dateEnd)
                  : getEffectivePreArrive(member, car, dateStart)
                const exCls = dir === 'down'
                  ? 'bg-amber-100 text-amber-700 border-amber-200'
                  : 'bg-teal-100 text-teal-700 border-teal-200'
                const exLabel = dir === 'down' ? '延後回程' : '提前出發'

                return (
                  <MemberCheckinRow
                    key={member.registration_id}
                    variant="card"
                    member={member}
                    isLeader={isLeader}
                    checked={checked}
                    disabled={!!ex}
                    disabledLabel={exLabel}
                    disabledTitle={ex ? `已標記為${exLabel}，從應到排除（如需手動處理，請至排車頁取消標記）` : ''}
                    badgeLabel={ex}
                    badgeClassName={exCls}
                    onToggle={() => handleToggleCheckin(car.car_id, member.registration_id, getMemberCheckedAt(member))}
                  />
                )
              })}

              {members.length === 0 && monks.length === 0 && (
                <div className="text-center text-gray-400 py-12 text-sm">此車目前無成員</div>
              )}
            </div>
          </>
        )}

        {activeTab === 'dormitory' && (
          <div className="px-4 pt-3 max-w-lg mx-auto">
            <DormitoryTab members={members} />
          </div>
        )}

        {activeTab === 'chore' && (
          <div className="px-4 pt-3 max-w-lg mx-auto">
            <ChoreTab members={members} choreLocations={choreLocations} />
          </div>
        )}

        {/* 重新整理按鈕 */}
        <button
          onClick={refresh}
          disabled={refreshing}
          className="fixed bottom-6 right-4 w-12 h-12 bg-white border shadow-lg rounded-full flex items-center justify-center text-lg text-gray-500 hover:bg-gray-50 active:bg-gray-100 disabled:opacity-40 transition-all"
          title="重新整理"
        >
          {refreshing ? '…' : '🔄'}
        </button>

        {/* 相機 */}
        {showCamera && (
          <CameraScanner
            onScan={code => { setShowCamera(false); handleScanCode(code) }}
            onClose={() => setShowCamera(false)}
          />
        )}
      </div>
    )
  }

  // ════════════════════════════════════════
  //  小車領隊模式
  // ════════════════════════════════════════

  if (mode === 'small_car') {
    const eventName  = headLeader?.events?.name ?? ''
    const dateStart  = headLeader?.events?.date_start
    const dateEnd    = headLeader?.events?.date_end
    const showDormitory = !!headLeader?.events?.show_dormitory_to_public
    const showChore     = !!headLeader?.events?.is_chore_event
    const eventDate  = formatDate(dateStart)
    // 排除延後/提前者（與大車模式 isExcludedFromExpected 邏輯一致）
    const isExcludedHere = (m, c) => isMemberExcludedFromExpected(m, c, dateStart, dateEnd)
    // 先依方向過濾（tab 控制），再依日期分頁過濾
    const directionCars = allCars
      .filter(c => (c.direction ?? 'down') === headDirection)
      .filter(c => carMatchesCheckinDate(c, selectedCheckinDate))
    // 寮區／坡務頁籤範圍：目前方向所有小車成員合併（不分車），跟隨 headDirection
    const dormChoreMembers = directionCars.flatMap(c => c.car_members ?? [])
    const showDormitoryTab = showDormitory && dormChoreMembers.some(m => m.registrations?.dormitory_room)
    const showChoreTab     = showChore
    // 整車提前/延後/義工車直接整車排除
    const activeCars = directionCars.filter(c => {
      if (headDirection === 'down') {
        if (c.late_return) return false
        if (isVolunteerSelfReturn(c, dateEnd)) return false
        return true
      }
      return !c.pre_depart
    })
    const totalAll   = activeCars.reduce((s, c) =>
      s + (c.car_members?.filter(m => !isExcludedHere(m, c)).length ?? 0)
        + (c.car_monks?.length ?? 0), 0
    )
    const checkedAll = activeCars.reduce((s, c) =>
      s + (c.car_members?.filter(m => !isExcludedHere(m, c) && isCheckedIn(m)).length ?? 0)
        + (c.car_monks?.filter(cm => !!cm.checked_in_at).length ?? 0), 0
    )
    const uncheckedAll = totalAll - checkedAll

    async function handleCheckInAllCar(carId) {
      await checkInAllCar(token, carId)
      await refresh()
    }

    return (
      <div className="min-h-screen bg-green-50 pb-24 car-checkin-page">
        <ScanToast msg={scanMsg} />

        {/* Header */}
        <div className="bg-green-700 text-white px-4 py-5 shadow-md">
          <div className="max-w-lg mx-auto">
            <div className="text-xs opacity-75 mb-0.5">{eventName}　{eventDate}</div>
            <div className="text-xl font-bold">🚗 小車領隊看板</div>

            {/* 去程/回程 Tab */}
            <div className="flex gap-1 mt-3 bg-green-800/40 rounded-lg p-1">
              <button
                onClick={() => setHeadDirection('up')}
                className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  headDirection === 'up'
                    ? 'bg-white text-green-800 shadow-sm'
                    : 'text-white/80 hover:text-white'
                }`}
              >
                🚌 去程
              </button>
              <button
                onClick={() => setHeadDirection('down')}
                className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  headDirection === 'down'
                    ? 'bg-white text-green-800 shadow-sm'
                    : 'text-white/80 hover:text-white'
                }`}
              >
                🚍 回程
              </button>
            </div>

            {headLeader?.service_date && (
              <div className="text-xs text-white/70 mt-1">此連結僅限 {formatDateWithWeekday(headLeader.service_date)} 使用</div>
            )}

            {selectedCheckinDate != null && (
              <div className="flex gap-1.5 mt-2 flex-wrap">
                {(headLeader?.service_date ? [headLeader.service_date] : eachDateInRange(dateStart, dateEnd)).map(d => (
                  <button
                    key={d}
                    onClick={() => setSelectedCheckinDate(d)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-full border transition-colors ${
                      selectedCheckinDate === d
                        ? 'bg-white text-green-800 border-white'
                        : 'bg-white/10 text-white/85 border-white/30 hover:bg-white/20'
                    }`}
                  >
                    📅 {formatDateWithWeekday(d)}
                  </button>
                ))}
                {!headLeader?.service_date && (
                  <button
                    onClick={() => setSelectedCheckinDate(OTHER_DATE_KEY)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-full border transition-colors ${
                      selectedCheckinDate === OTHER_DATE_KEY
                        ? 'bg-white text-green-800 border-white'
                        : 'bg-white/10 text-white/85 border-white/30 hover:bg-white/20'
                    }`}
                  >
                    🗓️ 其他日期
                  </button>
                )}
              </div>
            )}

            <div className="flex gap-5 mt-3 text-sm">
              <span>應到 <strong className="text-xl">{totalAll}</strong></span>
              <span>已到 <strong className="text-xl">{checkedAll}</strong></span>
              <span>未到 <strong className="text-xl">{uncheckedAll}</strong></span>
            </div>

            <TabBar
              active={activeTab} onChange={setActiveTab}
              showDormitory={showDormitoryTab} showChore={showChoreTab}
              wrapClass="bg-green-800/40" activeClass="bg-white text-green-800"
            />
          </div>
        </div>

        {activeTab === 'checkin' && (
          <>
        <p className="text-center text-xs text-gray-400 mt-3 px-4">
          確認每台小車都出發後，按「全車確認出發」即可
        </p>

        {/* 各小車卡片 */}
        <div className="px-4 pt-3 max-w-lg mx-auto space-y-3">
          {directionCars.map(c => {
            const members  = c.car_members ?? []
            const driverNames = getCarDriverNames(c)
            // 排除延後/提前者
            const todayMembers = members.filter(m => !isExcludedHere(m, c))
            const monkCnt     = (c.car_monks ?? []).length
            const monkChecked = (c.car_monks ?? []).filter(cm => !!cm.checked_in_at).length
            const total    = todayMembers.length + monkCnt
            const checked  = todayMembers.filter(isCheckedIn).length + monkChecked
            const unchecked = total - checked
            const done     = checked === total && total > 0

            // 偵測整車狀態
            const dir = c.direction ?? 'down'
            const fullyEffectiveLate = dir === 'down' && isCarFullyEffectiveExcluded(c, dateStart, dateEnd)
            const fullyEffectivePre  = dir === 'up'   && isCarFullyEffectiveExcluded(c, dateStart, dateEnd)
            const volSelfReturn      = dir === 'down' && isVolunteerSelfReturn(c, dateEnd)
            const integratedExcluded = c.late_return || c.pre_depart || volSelfReturn || fullyEffectiveLate || fullyEffectivePre
            const cardBgWrap = integratedExcluded
              ? (dir === 'down' ? 'border-amber-300' : 'border-teal-300')
              : (done ? 'border-green-300' : 'border-gray-200')
            const headerBg = integratedExcluded
              ? (dir === 'down' ? 'bg-amber-50' : 'bg-teal-50')
              : (done ? 'bg-green-50' : 'bg-gray-50')
            return (
              <div key={c.car_id} className={`bg-white rounded-xl shadow-sm border overflow-hidden ${cardBgWrap}`}>
                {/* 車次標題 */}
                <div className={`px-4 py-3 flex items-center gap-3 ${headerBg} border-b`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-800">{c.car_name}</span>
                      <DirectionBadge direction={c.direction} />
                      {dir === 'up' && (c.pre_depart || fullyEffectivePre) && (
                        <span className="text-xs bg-teal-100 text-teal-700 border border-teal-200 rounded-full px-1.5 shrink-0">🚀 提前出發</span>
                      )}
                      {dir === 'down' && (c.late_return || fullyEffectiveLate) && (
                        <span className="text-xs bg-amber-100 text-amber-700 border border-amber-200 rounded-full px-1.5 shrink-0">🕓 延後回程</span>
                      )}
                      {volSelfReturn && (
                        <span className="text-xs bg-amber-100 text-amber-700 border border-amber-200 rounded-full px-1.5 shrink-0">🛠 義工車・自行回程</span>
                      )}
                      {done && !integratedExcluded && <span className="text-xs bg-green-100 text-green-700 border border-green-200 rounded-full px-1.5">全員出發 ✓</span>}
                    </div>
                    {driverNames.length > 0 && (
                      <div className="text-xs text-green-700 mt-0.5">司機：{driverNames.join('、')}</div>
                    )}
                    <div className="text-xs text-gray-500 mt-0.5">
                      {integratedExcluded
                        ? (volSelfReturn ? '（義工車自行回程，不列入今日應到）'
                          : dir === 'down' ? '（已延後回程，不列入今日應到）'
                          : '（已提前出發，不列入今日應到）')
                        : `應到 ${total}　已到 ${checked}　未到 ${unchecked}`}
                    </div>
                  </div>
                  {!done && !integratedExcluded && (
                    <button
                      onClick={() => handleCheckInAllCar(c.car_id)}
                      className="shrink-0 px-3 py-1.5 bg-green-600 text-white text-xs font-semibold rounded-lg hover:bg-green-700 active:bg-green-800 transition-colors"
                    >
                      ✅ 全車確認出發
                    </button>
                  )}
                </div>

                {/* 成員清單（常駐顯示，不需展開） */}
                <div className="divide-y">
                  {/* 法師（排最上面，紫色強調） */}
                  {(c.car_monks ?? []).map(cm => {
                    const mchk = !!cm.checked_in_at
                    return (
                      <div key={cm.id} className={`flex items-center gap-3 px-4 py-2.5 bg-purple-50/40 ${mchk ? 'opacity-50' : ''}`}>
                        <div className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap">
                          <span className={`text-sm ${mchk ? 'line-through text-gray-400' : 'text-gray-700 font-medium'}`}>
                            {cm.temple_monks?.name ?? '（未知）'}
                          </span>
                          <span className="text-xs bg-purple-100 text-purple-700 rounded-full px-1.5 shrink-0">法師</span>
                        </div>
                        <button
                          onClick={() => handleToggleMonkCheckin(cm.id, cm.checked_in_at)}
                          className={`shrink-0 px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                            mchk ? 'bg-gray-100 text-gray-500 hover:bg-red-50 hover:text-red-500' : 'bg-green-100 text-green-700 hover:bg-green-200'
                          }`}
                        >
                          {mchk ? '已到' : '報到'}
                        </button>
                      </div>
                    )
                  })}
                  {sortCheckinMembers(members, (c.car_leaders ?? []).map(l => l.registration_id)).map(member => {
                    const chkRaw = isCheckedIn(member)
                    const dir    = c.direction ?? 'down'
                    const preArr = dir === 'down'
                      ? getEffectiveLateReturn(member, c, dateEnd)
                      : getEffectivePreArrive(member, c, dateStart)
                    // 義工車 + 整車排除：整車視為「未參與當日」
                    const memberExcluded = !!preArr || integratedExcluded
                    const chk    = chkRaw && !memberExcluded   // 視覺強制顯示為未到
                    const preArrCls = dir === 'down'
                      ? 'bg-amber-100 text-amber-700 border-amber-200'
                      : 'bg-teal-100 text-teal-700 border-teal-200'
                    const isLeader = (c.car_leaders ?? []).some(l => l.registration_id === member.registration_id)
                    const disabledLabel = volSelfReturn
                      ? (member.registrations?.answers?.identity === '義工' ? '義工' : '自行')
                      : dir === 'down' ? '延後' : '提前'
                    return (
                      <MemberCheckinRow
                        key={member.registration_id}
                        variant="row"
                        buttonTone="soft"
                        member={member}
                        isLeader={isLeader}
                        checked={chk}
                        disabled={memberExcluded}
                        disabledLabel={disabledLabel}
                        disabledTitle={memberExcluded ? (volSelfReturn ? '義工車自行回程，從應到排除' : `已標記為${dir === 'down' ? '延後回程' : '提前出發'}，從應到排除`) : ''}
                        badgeLabel={preArr}
                        badgeClassName={preArrCls}
                        onToggle={() => handleToggleCheckin(c.car_id, member.registration_id, getMemberCheckedAt(member))}
                      />
                    )
                  })}
                </div>
              </div>
            )
          })}

          {allCars.length === 0 && (
            <div className="text-center text-gray-400 py-12 text-sm">尚無小車排班資料，請師父先完成排車並儲存</div>
          )}
          {allCars.length > 0 && directionCars.length === 0 && (
            <div className="text-center text-gray-400 py-12 text-sm">
              {headDirection === 'up' ? '去程' : '回程'}尚無小車資料
            </div>
          )}
        </div>
          </>
        )}

        {activeTab === 'dormitory' && (
          <div className="px-4 pt-3 max-w-lg mx-auto">
            <DormitoryTab members={dormChoreMembers} />
          </div>
        )}

        {activeTab === 'chore' && (
          <div className="px-4 pt-3 max-w-lg mx-auto">
            <ChoreTab members={dormChoreMembers} choreLocations={choreLocations} />
          </div>
        )}

        {/* 重新整理 */}
        <button
          onClick={refresh}
          disabled={refreshing}
          className="fixed bottom-6 right-4 w-12 h-12 bg-white border shadow-lg rounded-full flex items-center justify-center text-lg text-gray-500 hover:bg-gray-50 disabled:opacity-40 transition-all"
        >
          {refreshing ? '…' : '🔄'}
        </button>
      </div>
    )
  }

  // ════════════════════════════════════════
  //  總領隊模式
  // ════════════════════════════════════════

  if (mode === 'head') {
    const eventName  = headLeader?.events?.name ?? ''
    const dateStart  = headLeader?.events?.date_start
    const dateEnd    = headLeader?.events?.date_end
    const showDormitory = !!headLeader?.events?.show_dormitory_to_public
    const showChore     = !!headLeader?.events?.is_chore_event
    const eventDate  = formatDate(dateStart)

    // 依方向過濾（總領隊看板分上下山 Tab，上下山資訊不再混在一起），再依日期分頁過濾
    const carsInDir = allCars
      .filter(c => (c.direction ?? 'down') === headDirection)
      .filter(c => carMatchesCheckinDate(c, selectedCheckinDate))
    const largeCars = carsInDir.filter(c => c.car_type === 'large')
    const smallCars = carsInDir.filter(c => c.car_type === 'small')

    // 「其他日期」分頁：大車依司機日期由早到晚排序，同一天的車排在一起；
    // 查不到司機日期的車固定排最後面，不打亂彼此原本的相對順序（穩定排序）
    if (selectedCheckinDate === OTHER_DATE_KEY) {
      largeCars.sort((a, b) => {
        const da = getCarDriverDate(a) ?? '9999-99-99'
        const db = getCarDriverDate(b) ?? '9999-99-99'
        return da < db ? -1 : da > db ? 1 : 0
      })
    }

    const monkTotalAll   = carsInDir.reduce((s, c) => s + (c.car_monks?.length ?? 0), 0)
    const monkCheckedAll = carsInDir.reduce((s, c) => s + (c.car_monks?.filter(m => !!m.checked_in_at).length ?? 0), 0)

    // 應到 = 當天搭車出發/回程的人（排除提前/延後），法師一律算
    // 上山方向：c.pre_depart（整車提前）OR 個人/同車 getEffectivePreArrive
    // 下山方向：c.late_return（整車延後）OR 個人/同車 getEffectiveLateReturn
    // 注意：總領隊看板用 headDirection（跨 carsInDir 已過濾過方向）；
    //       mode='small_car' 沒過濾、要用 c.direction，所以共用 helper 內看 c.direction
    const isExcludedFromExpected = (m, c) => isMemberExcludedFromExpected(m, c, dateStart, dateEnd)
    const todayMembers  = carsInDir.flatMap(c => (c.car_members ?? []).filter(m => !isExcludedFromExpected(m, c)))

    // 「其他交通」：本方向不歸大車也不歸小車的人
    // 應到（otherRegsInDir）= 排除提前/延後（個人 override + 自動判別）
    // 已排除的人（otherExcluded）：UI 仍顯示但加 badge，不算入應到
    const carMemberRegIds = new Set(carsInDir.flatMap(c => (c.car_members ?? []).map(m => m.registration_id)))
    const isOtherExcluded = (r) => {
      if (headDirection === 'down') {
        if (r.late_return_override) return true
        return !!getLateReturnInfo(r.answers, dateEnd)
      }
      if (r.pre_depart_override) return true
      return !!getPreArriveInfo(r.answers, dateStart)
    }
    const otherAllInDir = allEventRegs.filter(r =>
      isOtherTransport(r, headDirection) &&
      !carMemberRegIds.has(r.registration_id) &&
      isInSlot(r.answers, selectedCheckinDate, headDirection)
    )
    const otherRegsInDir = otherAllInDir.filter(r => !isOtherExcluded(r))
    const otherExcluded  = otherAllInDir.filter(isOtherExcluded)
    const otherTotal   = otherRegsInDir.length

    // 寮區／坡務頁籤範圍：目前方向所有大車＋小車＋其他交通合併（不分車），跟隨 headDirection
    const dormChoreMembers = [
      ...carsInDir.flatMap(c => c.car_members ?? []),
      ...otherRegsInDir.map(regAsMember),
    ]
    const showDormitoryTab = showDormitory && dormChoreMembers.some(m => m.registrations?.dormitory_room)
    const showChoreTab     = showChore
    // 義工：預設已報到（不需刷卡），信眾：需實際報到時間（方向分離）
    const otherCheckedField = headDirection === 'down' ? 'checked_in_down_at' : 'checked_in_at'
    const otherChecked = otherRegsInDir.filter(r =>
      r.answers?.identity === '義工' || !!r[otherCheckedField]
    ).length

    const totalAll      = todayMembers.length + monkTotalAll + otherTotal
    const checkedAll    = todayMembers.filter(isCheckedIn).length + monkCheckedAll + otherChecked
    const uncheckedAll  = totalAll - checkedAll

    // 小車計數：排除整車提前（上山 pre_depart）/ 延後（下山 late_return）
    //         + 個人/同車 effective 提前/延後 + 義工車自行回程（下山）
    const smallCarsToday = smallCars.filter(c => {
      if (headDirection === 'down') {
        if (c.late_return) return false
        if (isVolunteerSelfReturn(c, dateEnd)) return false
        return true
      }
      return !c.pre_depart
    })
    const smallTotal   = smallCarsToday.reduce((s, c) =>
      s + (c.car_members?.filter(m => !isExcludedFromExpected(m, c)).length ?? 0)
        + (c.car_monks?.length ?? 0), 0
    )
    const smallChecked = smallCarsToday.reduce((s, c) =>
      s + (c.car_members?.filter(m => !isExcludedFromExpected(m, c) && isCheckedIn(m)).length ?? 0)
        + (c.car_monks?.filter(cm => !!cm.checked_in_at).length ?? 0), 0
    )

    // 「回報聯絡組資訊」統計（上下山皆顯示）
    // 法師：已點報到的法師（= monkCheckedAll，當日方向）
    // 義工/信眾：提前/延後（整車 + 個人/同車 effective + 其他交通 override）OR 當日已報到
    const confirmedRegIds = new Set()
    for (const c of carsInDir) {
      const carWideExcluded = headDirection === 'down' ? c.late_return : c.pre_depart
      if (carWideExcluded) {
        for (const m of (c.car_members ?? [])) confirmedRegIds.add(m.registration_id)
      } else {
        for (const m of (c.car_members ?? [])) {
          if (isExcludedFromExpected(m, c)) confirmedRegIds.add(m.registration_id)
        }
      }
    }
    // 其他交通的提前/延後也算「已確認」（不來當天）
    for (const r of otherExcluded) confirmedRegIds.add(r.registration_id)
    // reportCounts 改用 car_members.checked_in_at（方向已由 carsInDir 過濾）
    // 其他交通仍用 registrations.checked_in_at；義工預設已確認
    const carCheckedRegIds = new Set(
      carsInDir.flatMap(c => c.car_members ?? []).filter(m => !!m.checked_in_at).map(m => m.registration_id)
    )
    for (const r of otherRegsInDir) {
      if (r.answers?.identity === '義工' || !!r.checked_in_at) carCheckedRegIds.add(r.registration_id)
    }
    const reportCounts = { 法師: monkCheckedAll, 義工: 0, 信眾: 0 }
    for (const r of allEventRegs) {
      const id = r.answers?.identity
      if (id !== '義工' && id !== '信眾') continue
      if (!carCheckedRegIds.has(r.registration_id) && !confirmedRegIds.has(r.registration_id)) continue
      if (id === '義工') reportCounts.義工 += 1
      else reportCounts.信眾 += 1
    }

    // Tab 標籤上顯示車數（兩方向，跟隨目前選定的日期分頁）
    const carCountUp = allCars
      .filter(c => (c.direction ?? 'down') === 'up')
      .filter(c => carMatchesCheckinDate(c, selectedCheckinDate)).length
    const carCountDown = allCars
      .filter(c => (c.direction ?? 'down') === 'down')
      .filter(c => carMatchesCheckinDate(c, selectedCheckinDate)).length

    return (
      <div className="min-h-screen bg-amber-50 pb-24 car-checkin-page">
        <ScanToast msg={scanMsg} />

        {/* Header */}
        <div className="bg-amber-800 text-white px-4 py-5 shadow-md">
          <div className="max-w-lg mx-auto">
            <div className="text-xs opacity-75 mb-0.5">{eventName}　{eventDate}</div>
            <div className="text-xl font-bold">👑 總領隊看板</div>

            {/* 上下山切換 Tab */}
            <div className="flex gap-1 mt-3 bg-amber-900/40 rounded-lg p-1">
              <button
                onClick={() => { setHeadDirection('up'); setExpandedCarId(null) }}
                className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  headDirection === 'up'
                    ? 'bg-white text-amber-800 shadow-sm'
                    : 'text-white/80 hover:text-white'
                }`}
              >
                🚌 去程{carCountUp > 0 && <span className="text-xs opacity-70 ml-1">（{carCountUp}）</span>}
              </button>
              <button
                onClick={() => { setHeadDirection('down'); setExpandedCarId(null) }}
                className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  headDirection === 'down'
                    ? 'bg-white text-amber-800 shadow-sm'
                    : 'text-white/80 hover:text-white'
                }`}
              >
                🚍 回程{carCountDown > 0 && <span className="text-xs opacity-70 ml-1">（{carCountDown}）</span>}
              </button>
            </div>

            {selectedCheckinDate != null && (
              <div className="flex gap-1.5 mt-2 flex-wrap">
                {eachDateInRange(dateStart, dateEnd).map(d => (
                  <button
                    key={d}
                    onClick={() => setSelectedCheckinDate(d)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-full border transition-colors ${
                      selectedCheckinDate === d
                        ? 'bg-white text-amber-800 border-white'
                        : 'bg-white/10 text-white/85 border-white/30 hover:bg-white/20'
                    }`}
                  >
                    📅 {formatDateWithWeekday(d)}
                  </button>
                ))}
                <button
                  onClick={() => setSelectedCheckinDate(OTHER_DATE_KEY)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-full border transition-colors ${
                    selectedCheckinDate === OTHER_DATE_KEY
                      ? 'bg-white text-amber-800 border-white'
                      : 'bg-white/10 text-white/85 border-white/30 hover:bg-white/20'
                  }`}
                >
                  🗓️ 其他日期
                </button>
              </div>
            )}

            <div className="flex gap-5 mt-3 text-sm">
              <span>應到 <strong className="text-xl">{totalAll}</strong></span>
              <span>已到 <strong className="text-xl">{checkedAll}</strong></span>
              <span>未到 <strong className="text-xl">{uncheckedAll}</strong></span>
            </div>
            {monkTotalAll > 0 && (
              <div className="mt-1 text-xs opacity-80">含法師 {monkTotalAll} 人（已到 {monkCheckedAll}）</div>
            )}
            {headDirection === 'up' && (
              <div className="flex gap-4 mt-1.5 text-sm flex-wrap opacity-90">
                <span>法師 <strong>{reportCounts.法師}</strong></span>
                <span>義工 <strong>{reportCounts.義工}</strong></span>
                <span>信眾 <strong>{reportCounts.信眾}</strong></span>
                <span className="text-xs opacity-60 self-center">（回報聯絡組資訊）</span>
              </div>
            )}

            <TabBar
              active={activeTab} onChange={setActiveTab}
              showDormitory={showDormitoryTab} showChore={showChoreTab}
              wrapClass="bg-amber-900/40" activeClass="bg-white text-amber-800"
            />
          </div>
        </div>

        {activeTab === 'checkin' && (
          <>
        {/* 全域掃描按鈕 */}
        <div className="px-4 pt-4 max-w-lg mx-auto">
          <button
            onClick={() => setShowCamera(true)}
            className="w-full py-3 bg-white border-2 border-amber-400 rounded-xl text-amber-700 font-semibold text-sm hover:bg-amber-50 active:bg-amber-100 transition-colors shadow-sm"
          >
            📷 掃描報到（全車通用）
          </button>
          <p className="text-center text-xs text-gray-400 mt-1.5">掃任何車的學員，系統自動找到並報到</p>
        </div>

        <div className="px-4 pt-4 max-w-lg mx-auto space-y-3">

          {/* ── 大車（各台獨立） ── */}
          {largeCars.map(c => {
            const carToday  = (c.car_members ?? []).filter(m => !isExcludedFromExpected(m, c))
            const total     = carToday.length + (c.car_monks?.length ?? 0)
            const checked   = carToday.filter(isCheckedIn).length + (c.car_monks ?? []).filter(m => !!m.checked_in_at).length
            const unchecked = total - checked
            const done      = total > 0 && unchecked === 0
            const expanded  = expandedCarId === c.car_id

            const leaderNames = (c.car_leaders ?? []).map(l => {
              const m = (c.car_members ?? []).find(m => m.registration_id === l.registration_id)
              return getMemberName(m)
            }).filter(Boolean)

            const leaderRegIds = (c.car_leaders ?? []).map(l => l.registration_id)
            const sorted = sortCheckinMembers(c.car_members ?? [], leaderRegIds)

            // 「其他日期」分頁專用：司機日期徽章＋日期不一致警示，其他分頁不算，維持 null
            const otherDateInfo = selectedCheckinDate === OTHER_DATE_KEY ? (() => {
              const d = getCarDriverDate(c)
              if (!d) return null
              const dt = new Date(d + 'T00:00:00')
              const verb = headDirection === 'up' ? '出發' : '回程'
              return { label: `${dt.getMonth() + 1}/${dt.getDate()} ${verb}`, mismatch: carHasDateMismatch(c) }
            })() : null

            return (
              <div key={c.car_id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <button
                  onClick={() => setExpandedCarId(expanded ? null : c.car_id)}
                  className="w-full px-4 py-3.5 flex items-center gap-3 text-left hover:bg-gray-50 active:bg-gray-100 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-800">{c.car_name}</span>
                      <DirectionBadge direction={c.direction} />
                      {otherDateInfo && (
                        <span className="text-xs bg-amber-100 text-amber-700 border border-amber-200 rounded-full px-1.5 shrink-0">📅 {otherDateInfo.label}</span>
                      )}
                      {otherDateInfo?.mismatch && (
                        <span className="text-xs bg-red-100 text-red-700 border border-red-200 rounded-full px-1.5 font-semibold shrink-0">⚠️ 此車{headDirection === 'up' ? '去程' : '回程'}日期不一致</span>
                      )}
                      {done && <span className="text-xs bg-green-100 text-green-700 border border-green-200 rounded-full px-1.5">全員到齊 ✓</span>}
                    </div>
                    {leaderNames.length > 0 && (
                      <div className="text-xs text-amber-600 mt-0.5">領隊：{leaderNames.join('、')}</div>
                    )}
                    <div className="text-xs text-gray-500 mt-1">
                      應到 {total}　已到 {checked}　未到 {unchecked}
                    </div>
                  </div>
                  <span className="text-gray-300 text-xs shrink-0">{expanded ? '▲' : '▼'}</span>
                </button>

                {expanded && (
                  <div className="border-t divide-y">
                    {/* 法師（排最上面，提醒優先勾選） */}
                    {(c.car_monks ?? []).map(cm => {
                      const chk = !!cm.checked_in_at
                      return (
                        <div key={cm.id} className={`flex items-center gap-3 px-4 py-2.5 bg-purple-50/40 ${chk ? 'opacity-55' : ''}`}>
                          <div className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap">
                            <span className={`text-sm truncate ${chk ? 'line-through text-gray-400' : 'text-gray-700 font-medium'}`}>
                              {cm.temple_monks?.name ?? '（未知）'}
                            </span>
                            <span className="text-xs bg-purple-100 text-purple-700 rounded-full px-1.5 shrink-0">法師</span>
                          </div>
                          <button
                            onClick={() => handleToggleMonkCheckin(cm.id, cm.checked_in_at)}
                            className={`shrink-0 px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                              chk ? 'bg-gray-100 text-gray-500 hover:bg-red-50 hover:text-red-500' : 'bg-green-600 text-white hover:bg-green-700'
                            }`}
                          >
                            {chk ? '已到' : '報到'}
                          </button>
                        </div>
                      )
                    })}
                    {sorted.map(member => {
                      const chk      = isCheckedIn(member)
                      const isLeader = (c.car_leaders ?? []).some(l => l.registration_id === member.registration_id)
                      const ex = headDirection === 'down'
                        ? getEffectiveLateReturn(member, c, dateEnd)
                        : getEffectivePreArrive(member, c, dateStart)
                      const exCls = headDirection === 'down'
                        ? 'bg-amber-100 text-amber-700 border-amber-200'
                        : 'bg-teal-100 text-teal-700 border-teal-200'
                      const exLabel = headDirection === 'down' ? '延後回程' : '提前出發'
                      return (
                        <MemberCheckinRow
                          key={member.registration_id}
                          variant="row"
                          member={member}
                          isLeader={isLeader}
                          checked={chk}
                          disabled={!!ex}
                          disabledLabel={exLabel}
                          disabledTitle={ex ? `已標記為${exLabel}，從應到排除` : ''}
                          badgeLabel={ex}
                          badgeClassName={exCls}
                          onToggle={() => handleToggleCheckin(c.car_id, member.registration_id, getMemberCheckedAt(member))}
                        />
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}

          {/* ── 小車（摘要 + 可展開各台） ── */}
          {smallCars.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              {/* 小車總摘要列（點擊展開/收合所有小車） */}
              <button
                onClick={() => setExpandedCarId(expandedCarId === '__small__' ? null : '__small__')}
                className="w-full px-4 py-3.5 flex items-center gap-3 text-left hover:bg-gray-50 active:bg-gray-100 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-800">🚗 小車（共 {smallCars.length} 台）</span>
                    {smallChecked === smallTotal && smallTotal > 0 && (
                      <span className="text-xs bg-green-100 text-green-700 border border-green-200 rounded-full px-1.5">全員出發 ✓</span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    應到 {smallTotal}　已到 {smallChecked}　未到 {smallTotal - smallChecked}
                  </div>
                </div>
                <span className="text-gray-300 text-xs shrink-0">
                  {expandedCarId === '__small__' ? '▲' : '▼'}
                </span>
              </button>

              {/* 展開：各台小車（用獨立 expandedSmallCarId 管內層） */}
              {expandedCarId === '__small__' && (
                <div className="border-t divide-y">
                  {smallCars.map(c => {
                    // 排除延後/提前者（與外層摘要一致）
                    const todayMembers = (c.car_members ?? []).filter(m => !isExcludedFromExpected(m, c))
                    const monkCnt      = (c.car_monks ?? []).length
                    const monkChecked  = (c.car_monks ?? []).filter(cm => !!cm.checked_in_at).length
                    const total     = todayMembers.length + monkCnt
                    const checked   = todayMembers.filter(isCheckedIn).length + monkChecked
                    const unchecked = total - checked
                    const done      = checked === total && total > 0
                    const innerExp  = expandedSmallCarId === c.car_id

                    const innerLeaderRegIds = (c.car_leaders ?? []).map(l => l.registration_id)
                    const sorted = sortCheckinMembers(c.car_members ?? [], innerLeaderRegIds)
                    const driverNames = getCarDriverNames(c)

                    // 偵測整車狀態
                    const fullyEffectiveLate = headDirection === 'down' && isCarFullyEffectiveExcluded(c, dateStart, dateEnd)
                    const fullyEffectivePre  = headDirection === 'up'   && isCarFullyEffectiveExcluded(c, dateStart, dateEnd)
                    const volSelfReturn      = headDirection === 'down' && isVolunteerSelfReturn(c, dateEnd)
                    const integratedExcluded = c.late_return || c.pre_depart || volSelfReturn || fullyEffectiveLate || fullyEffectivePre
                    // 背景色：依車況；展開時加 border-l-4 強調線（顏色依車況）
                    const cardBaseBg = integratedExcluded
                      ? (headDirection === 'down' ? 'bg-amber-50' : 'bg-teal-50')
                      : (innerExp ? 'bg-emerald-50' : 'bg-gray-50')
                    const cardBorderL = innerExp
                      ? (integratedExcluded
                        ? (headDirection === 'down' ? 'border-l-4 border-amber-500' : 'border-l-4 border-teal-500')
                        : 'border-l-4 border-emerald-500')
                      : ''
                    const cardBg = `${cardBaseBg} ${cardBorderL}`.trim()
                    return (
                      <div key={c.car_id} className={cardBg}>
                        <button
                          onClick={() => setExpandedSmallCarId(innerExp ? null : c.car_id)}
                          className="w-full px-5 py-2.5 flex items-center gap-3 text-left hover:bg-gray-100 transition-colors"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-sm text-gray-700">{c.car_name}</span>
                              <DirectionBadge direction={c.direction} />
                              {headDirection === 'up' && (c.pre_depart || fullyEffectivePre) && (
                                <span className="text-xs bg-teal-100 text-teal-700 border border-teal-200 rounded-full px-1.5 shrink-0">🚀 提前出發</span>
                              )}
                              {headDirection === 'down' && (c.late_return || fullyEffectiveLate) && (
                                <span className="text-xs bg-amber-100 text-amber-700 border border-amber-200 rounded-full px-1.5 shrink-0">🕓 延後回程</span>
                              )}
                              {volSelfReturn && (
                                <span className="text-xs bg-amber-100 text-amber-700 border border-amber-200 rounded-full px-1.5 shrink-0">🛠 義工車・自行回程</span>
                              )}
                              {done && !integratedExcluded && (
                                <span className="text-xs bg-green-100 text-green-700 border border-green-200 rounded-full px-1.5">全員出發 ✓</span>
                              )}
                            </div>
                            {driverNames.length > 0 && (
                              <div className="text-xs text-amber-600 mt-0.5">司機：{driverNames.join('、')}</div>
                            )}
                            <div className="text-xs text-gray-400 mt-0.5">
                              {integratedExcluded
                                ? (volSelfReturn ? '（義工車自行回程，不列入今日應到）'
                                  : headDirection === 'down' ? '（已延後回程，不列入今日應到）'
                                  : '（已提前出發，不列入今日應到）')
                                : `應到 ${total}　已到 ${checked}　未到 ${unchecked}`}
                            </div>
                          </div>
                          <span className="text-gray-300 text-xs shrink-0">{innerExp ? '▲' : '▼'}</span>
                        </button>

                        {innerExp && (
                          <div className="bg-white border-t divide-y">
                            {/* 法師（排最上面，紫色強調） */}
                            {(c.car_monks ?? []).map(cm => {
                              const mchk = !!cm.checked_in_at
                              return (
                                <div key={cm.id} className={`flex items-center gap-3 px-5 py-2.5 bg-purple-50/40 ${mchk ? 'opacity-55' : ''}`}>
                                  <div className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap">
                                    <span className={`text-sm truncate ${mchk ? 'line-through text-gray-400' : 'text-gray-700 font-medium'}`}>
                                      {cm.temple_monks?.name ?? '（未知）'}
                                    </span>
                                    <span className="text-xs bg-purple-100 text-purple-700 rounded-full px-1.5 shrink-0">法師</span>
                                  </div>
                                  <button
                                    onClick={() => handleToggleMonkCheckin(cm.id, cm.checked_in_at)}
                                    className={`shrink-0 px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                                      mchk ? 'bg-gray-100 text-gray-500 hover:bg-red-50 hover:text-red-500' : 'bg-green-600 text-white hover:bg-green-700'
                                    }`}
                                  >
                                    {mchk ? '已到' : '報到'}
                                  </button>
                                </div>
                              )
                            })}
                            {sorted.map(member => {
                              const chkRaw = isCheckedIn(member)
                              const preArr = headDirection === 'down'
                                ? getEffectiveLateReturn(member, c, dateEnd)
                                : getEffectivePreArrive(member, c, dateStart)
                              const memberExcluded = !!preArr || integratedExcluded
                              const chk    = chkRaw && !memberExcluded
                              const preArrCls = headDirection === 'down'
                                ? 'bg-amber-100 text-amber-700 border-amber-200'
                                : 'bg-teal-100 text-teal-700 border-teal-200'
                              const isLeader = innerLeaderRegIds.includes(member.registration_id)
                              const disabledLabel = volSelfReturn
                                ? (member.registrations?.answers?.identity === '義工' ? '義工' : '自行')
                                : headDirection === 'down' ? '延後' : '提前'
                              return (
                                <MemberCheckinRow
                                  key={member.registration_id}
                                  variant="row"
                                  paddingX="px-5"
                                  member={member}
                                  isLeader={isLeader}
                                  checked={chk}
                                  disabled={memberExcluded}
                                  disabledLabel={disabledLabel}
                                  disabledTitle={memberExcluded ? (volSelfReturn ? '義工車自行回程，從應到排除' : `已標記為${headDirection === 'down' ? '延後回程' : '提前出發'}，從應到排除`) : ''}
                                  badgeLabel={preArr}
                                  badgeClassName={preArrCls}
                                  onToggle={() => handleToggleCheckin(c.car_id, member.registration_id, getMemberCheckedAt(member))}
                                />
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── 其他交通（不歸大車也不歸小車，手動點選報到） ── */}
          {otherTotal > 0 && (() => {
            const otherMembers = otherRegsInDir.map(regAsMember)
            const otherSorted  = sortCheckinMembers(otherMembers, [])
            const otherDone    = otherChecked === otherTotal && otherTotal > 0
            const expanded     = expandedCarId === '__other__'
            return (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <button
                  onClick={() => setExpandedCarId(expanded ? null : '__other__')}
                  className="w-full px-4 py-3.5 flex items-center gap-3 text-left hover:bg-gray-50 active:bg-gray-100 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-800">🚶 其他交通（{otherTotal} 人）</span>
                      {otherDone && (
                        <span className="text-xs bg-green-100 text-green-700 border border-green-200 rounded-full px-1.5">全員報到 ✓</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      應到 {otherTotal}　已到 {otherChecked}　未到 {otherTotal - otherChecked}
                    </div>
                    <div className="text-[11px] text-gray-400 mt-0.5">未排到大車／小車的人；請手動點選報到</div>
                  </div>
                  <span className="text-gray-300 text-xs shrink-0">{expanded ? '▲' : '▼'}</span>
                </button>

                {expanded && (
                  <div className="border-t divide-y">
                    {otherSorted.map(member => {
                      const name   = getMemberName(member)
                      const guest  = isGuest(member)
                      const chk    = isCheckedIn(member, headDirection)
                      const cls    = formatMemberClasses(member)
                      const dirKey = headDirection === 'up' ? 'transport_up' : 'transport_down'
                      const t      = member.registrations?.answers?.[dirKey] ?? '（未填）'
                      return (
                        <div key={member.registration_id} className={`flex items-center gap-3 px-4 py-2.5 ${chk ? 'opacity-55' : ''}`}>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className={`text-sm truncate ${chk ? 'line-through text-gray-400' : 'text-gray-700 font-medium'}`}>{name}</span>
                              {guest && <span className="text-xs bg-blue-100 text-blue-600 rounded-full px-1.5 shrink-0">訪客</span>}
                              <span className="text-xs bg-gray-100 text-gray-600 rounded-full px-1.5 shrink-0">{t}</span>
                            </div>
                            {cls && <div className="text-[11px] text-gray-500 mt-0.5 truncate">{cls}</div>}
                          </div>
                          <button
                            onClick={() => handleToggleCheckin(null, member.registration_id, getMemberCheckedAt(member, headDirection))}
                            className={`shrink-0 px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                              chk ? 'bg-gray-100 text-gray-500 hover:bg-red-50 hover:text-red-500' : 'bg-green-600 text-white hover:bg-green-700'
                            }`}
                          >
                            {chk ? '已到' : '報到'}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })()}

          {allCars.length === 0 && otherTotal === 0 && (
            <div className="text-center text-gray-400 py-12 text-sm">尚無排車資料，請師父先完成排車並儲存</div>
          )}
          {allCars.length > 0 && carsInDir.length === 0 && otherTotal === 0 && (
            <div className="text-center text-gray-400 py-12 text-sm">
              {headDirection === 'up' ? '去程' : '回程'}尚無排車資料
            </div>
          )}
        </div>
          </>
        )}

        {activeTab === 'dormitory' && (
          <div className="px-4 pt-4 max-w-lg mx-auto">
            <DormitoryTab members={dormChoreMembers} />
          </div>
        )}

        {activeTab === 'chore' && (
          <div className="px-4 pt-4 max-w-lg mx-auto">
            <ChoreTab members={dormChoreMembers} choreLocations={choreLocations} />
          </div>
        )}

        {/* 重新整理 */}
        <button
          onClick={refresh}
          disabled={refreshing}
          className="fixed bottom-6 right-4 w-12 h-12 bg-white border shadow-lg rounded-full flex items-center justify-center text-lg text-gray-500 hover:bg-gray-50 active:bg-gray-100 disabled:opacity-40 transition-all"
        >
          {refreshing ? '…' : '🔄'}
        </button>

        {showCamera && (
          <CameraScanner
            onScan={code => { setShowCamera(false); handleScanCode(code) }}
            onClose={() => setShowCamera(false)}
    
          />
        )}
      </div>
    )
  }

  return null
}
