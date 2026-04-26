import { useState, useEffect, useRef, useCallback } from 'react'
import {
  getActiveEvents,
  getStudentById,
  getStudentEventStatuses,
  submitRegistration,
  updateRegistration,
  deleteRegistration,
} from '../lib/supabase'
import DynamicForm from '../components/DynamicForm'
import CameraScanner from '../components/CameraScanner'

const OVERVIEW_IDLE_SECONDS = 30   // 總覽畫面閒置幾秒後自動返回
const FORM_IDLE_SECONDS = 120      // 填表畫面閒置幾秒後自動返回（長者填表需要較多時間）
const SUCCESS_SECONDS = 3          // 報名成功提示停留秒數

export default function KioskPage() {
  // 所有進行中活動（含欄位）
  const [eventItems, setEventItems] = useState([]) // [{event, fields}, ...]

  // 刷卡後狀態
  const [phase, setPhase] = useState('idle') // idle | loading | overview | form | submitting | not_found | error | no_event
  const [student, setStudent] = useState(null)
  const [classes, setClasses] = useState([])
  const [statuses, setStatuses] = useState({}) // { eventId: registration|null }

  // 填表狀態（選擇某場活動後）
  const [selectedItem, setSelectedItem] = useState(null) // { event, fields }
  const [answers, setAnswers] = useState({})
  const [isUpdate, setIsUpdate] = useState(false)
  const [currentReg, setCurrentReg] = useState(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [successEventName, setSuccessEventName] = useState('')
  const [showSuccess, setShowSuccess] = useState(false)

  const [cameraOpen, setCameraOpen] = useState(false)
  const [cancellingEventId, setCancellingEventId] = useState(null) // 正在確認取消的活動 ID

  const scanBufferRef = useRef('')
  const scanTimerRef = useRef(null)
  const idleTimerRef = useRef(null)

  // ── 初始載入活動 ──────────────────────────────────────────
  useEffect(() => { loadEvents() }, [])

  // ── 閒置時定期重載（確保程式碼與資料保持最新）──────────────
  useEffect(() => {
    const timer = setInterval(() => {
      if (phase === 'idle') window.location.reload()
    }, 10 * 60 * 1000) // 閒置 10 分鐘自動重載
    return () => clearInterval(timer)
  }, [phase])

  async function loadEvents() {
    const { events, error } = await getActiveEvents()
    if (error) { setPhase('error'); setErrorMsg(error); return }
    if (!events.length) { setPhase('no_event'); return }
    setEventItems(events)
    setPhase('idle')
  }

  // ── 鍵盤監聽（掃描機）────────────────────────────────────
  const handleKeyDown = useCallback((e) => {
    if (phase !== 'idle') return
    if (e.key === 'Enter') {
      const code = scanBufferRef.current.trim()
      scanBufferRef.current = ''
      clearTimeout(scanTimerRef.current)
      if (code.length > 0) handleScan(code)
    } else if (e.key.length === 1) {
      scanBufferRef.current += e.key
      clearTimeout(scanTimerRef.current)
      scanTimerRef.current = setTimeout(() => {
        const code = scanBufferRef.current.trim()
        scanBufferRef.current = ''
        if (code.length >= 6) handleScan(code)
      }, 300)
    }
  }, [phase]) // eslint-disable-line

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // ── 相機掃描回呼 ─────────────────────────────────────────
  function handleCameraScan(code) {
    setCameraOpen(false)
    handleScan(code)
  }

  // ── 刷卡後查詢 ────────────────────────────────────────────
  async function handleScan(code) {
    setPhase('loading')
    const { student, classes, error } = await getStudentById(code)
    if (error === 'NOT_FOUND') { setPhase('not_found'); scheduleAutoReset(4); return }
    if (error) { setPhase('error'); setErrorMsg(error); scheduleAutoReset(5); return }

    const eventIds = eventItems.map(i => i.event.event_id)
    const { map: statusMap, error: statusErr } = await getStudentEventStatuses(student.student_id, eventIds)

    setStudent(student)
    setClasses(classes)
    setStatuses(statusMap)
    if (statusErr) setErrorMsg(`報名狀態查詢失敗：${statusErr}`)
    else setErrorMsg('')
    setPhase('overview')
    startIdleTimer()
  }

  // ── 選擇某場活動（填表）──────────────────────────────────
  function handleSelectEvent(item) {
    clearTimeout(idleTimerRef.current)
    const reg = statuses[item.event.event_id]
    setSelectedItem(item)
    setCurrentReg(reg)
    setIsUpdate(!!reg)
    setAnswers(reg?.answers || {})
    setErrorMsg('')
    setPhase('form')
    startFormTimer()
  }

  // ── 取消報名 ──────────────────────────────────────────────
  async function handleCancelRegistration(eventId) {
    const reg = statuses[eventId]
    if (!reg) return
    const { success } = await deleteRegistration(reg.registration_id)
    if (!success) return
    setStatuses(prev => ({ ...prev, [eventId]: null }))
    setCancellingEventId(null)
    startIdleTimer()
  }

  // ── 送出表單 ──────────────────────────────────────────────
  async function handleSubmit() {
    const { event, fields } = selectedItem
    // 驗證必填
    const visibleRequired = fields.filter(f => {
      if (!f.required) return false
      if (!f.show_if) return true
      return Object.entries(f.show_if).every(([k, v]) => answers[k] === v)
    })
    const missing = visibleRequired.filter(f => {
      const val = answers[f.field_key]
      return val === undefined || val === null || val === '' || (Array.isArray(val) && val.length === 0)
    })
    if (missing.length > 0) {
      setErrorMsg(`請填寫：${missing.map(f => f.field_label).join('、')}`)
      return
    }
    setErrorMsg('')
    clearTimeout(idleTimerRef.current)
    setPhase('submitting')

    let success, error
    if (isUpdate && currentReg) {
      ;({ success, error } = await updateRegistration(currentReg.registration_id, answers))
    } else {
      ;({ success, error } = await submitRegistration(event.event_id, student.student_id, answers))
    }

    if (!success) { setPhase('form'); setErrorMsg(error); startFormTimer(); return }

    // 更新本地狀態
    const newReg = { registration_id: currentReg?.registration_id || 'new', event_id: event.event_id, answers }
    setStatuses(prev => ({ ...prev, [event.event_id]: newReg }))
    setSuccessEventName(event.name)
    setShowSuccess(true)
    setTimeout(() => setShowSuccess(false), SUCCESS_SECONDS * 1000)

    // 回到總覽
    setPhase('overview')
    startIdleTimer()
  }

  // ── 計時 ──────────────────────────────────────────────────
  function scheduleAutoReset(sec) {
    clearTimeout(idleTimerRef.current)
    idleTimerRef.current = setTimeout(() => reset(), sec * 1000)
  }

  function startIdleTimer() {
    clearTimeout(idleTimerRef.current)
    idleTimerRef.current = setTimeout(() => reset(), OVERVIEW_IDLE_SECONDS * 1000)
  }

  function startFormTimer() {
    clearTimeout(idleTimerRef.current)
    idleTimerRef.current = setTimeout(() => reset(), FORM_IDLE_SECONDS * 1000)
  }

  function reset() {
    clearTimeout(idleTimerRef.current)
    clearTimeout(scanTimerRef.current)
    scanBufferRef.current = ''
    setStudent(null)
    setClasses([])
    setStatuses({})
    setSelectedItem(null)
    setAnswers({})
    setIsUpdate(false)
    setCurrentReg(null)
    setErrorMsg('')
    setShowSuccess(false)
    setCancellingEventId(null)
    setPhase(eventItems.length ? 'idle' : 'no_event')
  }

  // ── 渲染 ──────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* 相機掃描覆蓋層 */}
      {cameraOpen && (
        <CameraScanner
          onScan={handleCameraScan}
          onClose={() => setCameraOpen(false)}
        />
      )}

      {/* Header */}
      <header className="bg-blue-700 text-white px-6 py-4 shadow-md">
        <p className="text-kiosk-sm opacity-80">普宜精舍</p>
        <h1 className="text-kiosk-lg font-bold leading-tight">活動報名</h1>
      </header>

      <main className="flex-1 flex items-center justify-center p-6">
        {phase === 'idle' && <IdleScreen onOpenCamera={() => setCameraOpen(true)} />}
        {phase === 'loading' && <LoadingScreen />}
        {phase === 'no_event' && <NoEventScreen onRefresh={loadEvents} />}
        {phase === 'not_found' && <NotFoundScreen onReset={reset} />}
        {phase === 'error' && <ErrorScreen message={errorMsg} onReset={reset} />}

        {phase === 'overview' && (
          <OverviewScreen
            student={student}
            classes={classes}
            eventItems={eventItems}
            statuses={statuses}
            showSuccess={showSuccess}
            successEventName={successEventName}
            cancellingEventId={cancellingEventId}
            errorMsg={errorMsg}
            onSelectEvent={handleSelectEvent}
            onRequestCancel={setCancellingEventId}
            onConfirmCancel={handleCancelRegistration}
            onDone={reset}
          />
        )}

        {(phase === 'form' || phase === 'submitting') && selectedItem && (
          <FormScreen
            student={student}
            classes={classes}
            event={selectedItem.event}
            fields={selectedItem.fields}
            answers={answers}
            isUpdate={isUpdate}
            errorMsg={errorMsg}
            submitting={phase === 'submitting'}
            onChange={setAnswers}
            onSubmit={handleSubmit}
            onBack={() => { clearTimeout(idleTimerRef.current); setPhase('overview'); startIdleTimer() }}
          />
        )}
      </main>
    </div>
  )
}

// ── 等待刷卡 ────────────────────────────────────────────────
function IdleScreen({ onOpenCamera }) {
  return (
    <div className="text-center select-none">
      <div className="text-9xl mb-8 animate-pulse">📛</div>
      <p className="text-kiosk-2xl font-bold text-gray-700 mb-4">請刷學員證</p>
      <p className="text-kiosk-base text-gray-500 mb-8">將學員證條碼對準掃描機</p>
      <button
        onClick={onOpenCamera}
        className="inline-flex items-center gap-3 px-8 py-4 bg-white border-2 border-blue-400 text-blue-700 rounded-2xl text-kiosk-base font-semibold shadow-sm active:scale-95 transition-transform"
      >
        <span className="text-2xl">📷</span>
        用手機相機掃描
      </button>
    </div>
  )
}

function LoadingScreen() {
  return (
    <div className="text-center">
      <div className="w-20 h-20 border-8 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-6" />
      <p className="text-kiosk-lg text-gray-600">查詢中…</p>
    </div>
  )
}

function NoEventScreen({ onRefresh }) {
  return (
    <div className="text-center">
      <div className="text-8xl mb-6">📅</div>
      <p className="text-kiosk-xl font-bold text-gray-700 mb-3">目前沒有進行中的活動</p>
      <p className="text-kiosk-base text-gray-500 mb-8">請師父在後台將活動設為「進行中」</p>
      <button onClick={onRefresh} className="px-8 py-4 bg-blue-600 text-white rounded-2xl text-kiosk-base font-semibold">
        重新整理
      </button>
    </div>
  )
}

function NotFoundScreen({ onReset }) {
  return (
    <div className="text-center">
      <div className="text-8xl mb-6">🔍</div>
      <p className="text-kiosk-xl font-bold text-red-600 mb-3">找不到學員資料</p>
      <p className="text-kiosk-base text-gray-500 mb-8">請確認學員證是否正確，或洽現場師兄協助</p>
      <button onClick={onReset} className="px-8 py-4 border-2 border-gray-400 rounded-2xl text-kiosk-base text-gray-600">
        返回
      </button>
    </div>
  )
}

function ErrorScreen({ message, onReset }) {
  return (
    <div className="text-center">
      <div className="text-8xl mb-6">⚠️</div>
      <p className="text-kiosk-xl font-bold text-red-600 mb-3">發生問題</p>
      <p className="text-kiosk-sm text-gray-500 mb-8 max-w-sm mx-auto">{message}</p>
      <button onClick={onReset} className="px-8 py-4 bg-red-100 border-2 border-red-400 rounded-2xl text-kiosk-base text-red-700">
        返回首頁
      </button>
    </div>
  )
}

// ── 總覽畫面：所有活動報名狀態 ────────────────────────────
function OverviewScreen({
  student, classes, eventItems, statuses, showSuccess, successEventName,
  cancellingEventId, errorMsg, onSelectEvent, onRequestCancel, onConfirmCancel, onDone,
}) {
  return (
    <div className="w-full max-w-lg">
      {/* 報名狀態查詢失敗提示 */}
      {errorMsg && (
        <div className="bg-red-50 border-2 border-red-300 rounded-2xl px-5 py-3 mb-4 text-center">
          <p className="text-red-700 text-kiosk-sm">⚠ {errorMsg}</p>
        </div>
      )}
      {/* 學員資訊卡 */}
      <div className="bg-white rounded-2xl shadow-md p-5 mb-5 border-l-8 border-blue-600">
        <p className="text-kiosk-xl font-bold text-gray-800">{student?.name} 師兄，您好！</p>
        <div className="flex flex-wrap gap-2 mt-2">
          {classes.map((c, i) => (
            <span key={i} className="bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-kiosk-sm">
              {c.class_name}{c.group_name ? `・${c.group_name}` : ''}
            </span>
          ))}
        </div>
      </div>

      {/* 報名成功提示 */}
      {showSuccess && (
        <div className="bg-green-50 border-2 border-green-400 rounded-2xl px-5 py-3 mb-4 text-center">
          <p className="text-green-700 font-bold text-kiosk-base">✅ {successEventName} 報名完成！</p>
        </div>
      )}

      {/* 活動列表 */}
      <div className="space-y-3 mb-5">
        {eventItems.map(({ event, fields }) => {
          const reg = statuses[event.event_id]
          const registered = !!reg
          const confirming = cancellingEventId === event.event_id

          return (
            <div
              key={event.event_id}
              className={`bg-white rounded-2xl shadow-sm border-2 p-5 transition-all ${
                confirming ? 'border-red-300 bg-red-50' : registered ? 'border-green-300' : 'border-gray-200'
              }`}
            >
              {/* 上方：活動資訊 + 主要按鈕 */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-kiosk-base font-bold text-gray-800">{event.name}</p>
                  <p className="text-kiosk-sm text-gray-500 mt-0.5">
                    {event.date_start || ''}
                    {event.date_end && event.date_end !== event.date_start ? ` ～ ${event.date_end}` : ''}
                    {event.location ? `　${event.location}` : ''}
                  </p>
                  {/* 已報名則顯示報名資料摘要（依後台欄位順序） */}
                  {registered && !confirming && reg.answers && (
                    <div className="mt-2 text-kiosk-sm text-gray-600 space-y-0.5">
                      {fields.map(f => {
                        const v = reg.answers[f.field_key]
                        if (v === undefined || v === null || v === '') return null
                        let display
                        if (f.field_type === 'boolean') {
                          display = v === true ? '是' : v === false ? '否' : ''
                        } else if (f.field_type === 'datetime' && typeof v === 'string') {
                          display = v.replace('T', ' ')
                        } else if (Array.isArray(v)) {
                          display = v.join('、')
                        } else {
                          display = v
                        }
                        if (!display && display !== 0) return null
                        return (
                          <p key={f.field_key}>
                            <span className="text-gray-400">{f.field_label}：</span>
                            {display}
                          </p>
                        )
                      })}
                    </div>
                  )}
                  {/* 取消確認提示 */}
                  {confirming && (
                    <p className="mt-2 text-kiosk-sm text-red-600 font-medium">確定要取消此活動的報名嗎？</p>
                  )}
                </div>

                <div className="flex-shrink-0">
                  {!registered && (
                    <button
                      onClick={() => onSelectEvent({ event, fields })}
                      className="px-4 py-2 bg-blue-600 text-white rounded-xl text-kiosk-sm font-bold shadow active:scale-95 transition-transform"
                    >
                      立即報名
                    </button>
                  )}
                  {registered && !confirming && (
                    <button
                      onClick={() => onSelectEvent({ event, fields })}
                      className="px-4 py-2 border-2 border-green-400 text-green-700 rounded-xl text-kiosk-sm font-medium bg-green-50 active:scale-95 transition-transform"
                    >
                      ✓ 已報名<br/>
                      <span className="text-xs font-normal">點此修改</span>
                    </button>
                  )}
                  {confirming && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => onRequestCancel(null)}
                        className="px-4 py-2 border-2 border-gray-300 text-gray-600 rounded-xl text-kiosk-sm active:scale-95 transition-transform"
                      >
                        不了
                      </button>
                      <button
                        onClick={() => onConfirmCancel(event.event_id)}
                        className="px-4 py-2 bg-red-500 text-white rounded-xl text-kiosk-sm font-bold active:scale-95 transition-transform"
                      >
                        確認取消
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* 下方：取消報名按鈕（已報名且非確認中才顯示） */}
              {registered && !confirming && (
                <div className="mt-3 pt-3 border-t border-gray-100 text-right">
                  <button
                    onClick={() => onRequestCancel(event.event_id)}
                    className="text-kiosk-sm text-red-400 border border-red-200 px-4 py-1.5 rounded-xl active:scale-95 transition-transform"
                  >
                    取消報名
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* 完成按鈕 */}
      <button
        onClick={onDone}
        className="w-full py-4 border-2 border-gray-300 rounded-2xl text-kiosk-base text-gray-600 font-medium"
      >
        完成，返回首頁
      </button>
      <p className="text-center text-kiosk-sm text-gray-400 mt-3">{OVERVIEW_IDLE_SECONDS} 秒無操作自動返回</p>
    </div>
  )
}

// ── 填表畫面 ─────────────────────────────────────────────
function FormScreen({ student, classes, event, fields, answers, isUpdate, errorMsg, submitting, onChange, onSubmit, onBack }) {
  return (
    <div className="w-full max-w-lg">
      {/* 學員資訊卡 */}
      <div className="bg-white rounded-2xl shadow-md p-5 mb-4 border-l-8 border-blue-600">
        <p className="text-kiosk-xl font-bold text-gray-800">{student?.name} 師兄</p>
        <p className="text-kiosk-base text-blue-700 font-medium mt-1">{event.name}</p>
        <div className="flex flex-wrap gap-2 mt-2">
          {classes.map((c, i) => (
            <span key={i} className="bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-kiosk-sm">
              {c.class_name}{c.group_name ? `・${c.group_name}` : ''}
            </span>
          ))}
        </div>
      </div>

      {/* 動態表單 */}
      {fields.length > 0 && (
        <div className="bg-white rounded-2xl shadow-md p-5 mb-4">
          <DynamicForm fields={fields} answers={answers} onChange={onChange} />
        </div>
      )}

      {/* 錯誤提示 */}
      {errorMsg && (
        <p className="text-red-600 text-kiosk-sm bg-red-50 border border-red-300 rounded-xl px-4 py-3 mb-4">
          ⚠ {errorMsg}
        </p>
      )}

      {/* 按鈕 */}
      <div className="flex gap-3">
        <button
          onClick={onBack}
          disabled={submitting}
          className="flex-1 py-4 border-2 border-gray-300 rounded-2xl text-kiosk-base text-gray-600 font-medium disabled:opacity-50"
        >
          ← 返回
        </button>
        <button
          onClick={onSubmit}
          disabled={submitting}
          className="flex-grow-[2] py-4 bg-blue-600 text-white rounded-2xl text-kiosk-base font-bold shadow-md disabled:opacity-50 active:scale-95 transition-transform"
        >
          {submitting ? '送出中…' : isUpdate ? '確認修改' : '確認報名'}
        </button>
      </div>
    </div>
  )
}
