import { useState, useEffect, useRef, useCallback } from 'react'
import {
  getActiveEvent,
  getStudentById,
  checkDuplicate,
  submitRegistration,
  getRegistration,
  updateRegistration
} from '../lib/supabase'
import DynamicForm from '../components/DynamicForm'

// 成功畫面停留秒數後自動 reset
const AUTO_RESET_SECONDS = 6
// 表單閒置幾秒後自動 reset（防止無人操作卡在表單頁）
const IDLE_RESET_SECONDS = 60

// ─── 畫面狀態 ────────────────────────────────────────────
// idle      → 等待刷卡
// loading   → 查詢學員中
// form      → 顯示表單
// submitting→ 送出中
// success   → 報名成功
// duplicate → 已報名過
// not_found → 找不到學員
// no_event  → 目前無進行中活動
// error     → 其他錯誤

export default function KioskPage() {
  const [phase, setPhase] = useState('idle')
  const [event, setEvent] = useState(null)
  const [fields, setFields] = useState([])
  const [student, setStudent] = useState(null)
  const [classes, setClasses] = useState([])
  const [answers, setAnswers] = useState({})
  const [errorMsg, setErrorMsg] = useState('')
  const [countdown, setCountdown] = useState(AUTO_RESET_SECONDS)
  const [registration, setRegistration] = useState(null)  // 已存在的報名紀錄
  const [isUpdate, setIsUpdate] = useState(false)         // 修改模式

  const scanBufferRef = useRef('')
  const scanTimerRef = useRef(null)
  const resetTimerRef = useRef(null)
  const countdownIntervalRef = useRef(null)
  const idleTimerRef = useRef(null)
  // ref 保存最新 event，避免 handleKeyDown closure 讀到舊值
  const eventRef = useRef(null)

  // ── 初始化：載入活動 ───────────────────────────────────
  useEffect(() => {
    loadEvent()
  }, [])

  async function loadEvent() {
    const { event, fields, error } = await getActiveEvent()
    if (error) { setPhase('error'); setErrorMsg(error); return }
    if (!event) { setPhase('no_event'); return }
    eventRef.current = event
    setEvent(event)
    setFields(fields)
    setPhase('idle')
  }

  // ── 全域鍵盤監聽（QR 掃描機輸入）──────────────────────
  const handleKeyDown = useCallback((e) => {
    // 只在 idle 狀態接受掃描輸入
    if (phase !== 'idle') return

    // 掃描機輸入通常是一連串數字＋最後一個 Enter
    if (e.key === 'Enter') {
      const code = scanBufferRef.current.trim()
      scanBufferRef.current = ''
      clearTimeout(scanTimerRef.current)
      if (code.length > 0) handleScan(code)
    } else if (e.key.length === 1) {
      // 只接受可見字元
      scanBufferRef.current += e.key
      // 如果 300ms 內沒有 Enter，也自動觸發（部分掃描機不送 Enter）
      clearTimeout(scanTimerRef.current)
      scanTimerRef.current = setTimeout(() => {
        const code = scanBufferRef.current.trim()
        scanBufferRef.current = ''
        if (code.length >= 6) handleScan(code)
        else scanBufferRef.current = ''
      }, 300)
    }
  }, [phase]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // ── 掃描後查詢學員 ────────────────────────────────────
  // 開發測試用：在 console 輸入 scan('學員編號') 直接觸發
  useEffect(() => { window.scan = handleScan }, [])

  async function handleScan(code) {
    const event = eventRef.current
    if (!event) return
    setPhase('loading')

    const { student, classes, error } = await getStudentById(code)

    if (error === 'NOT_FOUND') { setPhase('not_found'); scheduleReset(4); return }
    if (error) { setPhase('error'); setErrorMsg(error); scheduleReset(5); return }

    const isDuplicate = await checkDuplicate(event.event_id, student.student_id)
    if (isDuplicate) {
      const reg = await getRegistration(event.event_id, student.student_id)
      setStudent(student)
      setClasses(classes)
      setRegistration(reg)
      setPhase('duplicate')
      scheduleReset(10)
      return
    }

    setStudent(student)
    setClasses(classes)
    setAnswers({})
    setPhase('form')
    startIdleTimer()
  }

  // ── 修改現有報名 ──────────────────────────────────────
  function handleModify() {
    clearTimeout(resetTimerRef.current)
    clearInterval(countdownIntervalRef.current)
    setAnswers(registration?.answers || {})
    setIsUpdate(true)
    setPhase('form')
    startIdleTimer()
  }

  // ── 表單送出 ──────────────────────────────────────────
  async function handleSubmit() {
    // 驗證必填欄位
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
    if (isUpdate && registration) {
      // 修改模式：直接更新
      ;({ success, error } = await updateRegistration(registration.registration_id, answers))
    } else {
      // 新增模式：嘗試 INSERT
      ;({ success, error } = await submitRegistration(event.event_id, student.student_id, answers))
      // 若撞到 UNIQUE 約束（已有報名），自動改走 UPDATE
      if (!success && error && error.includes('unique_registration')) {
        const reg = await getRegistration(event.event_id, student.student_id)
        if (reg) {
          ;({ success, error } = await updateRegistration(reg.registration_id, answers))
          if (success) setIsUpdate(true)  // 讓成功畫面顯示「修改成功」
        }
      }
    }

    if (!success) { setPhase('error'); setErrorMsg(error); scheduleReset(5); return }

    setPhase('success')
    setCountdown(AUTO_RESET_SECONDS)
    scheduleReset(AUTO_RESET_SECONDS)
  }

  // ── 計時 reset ────────────────────────────────────────
  function scheduleReset(seconds) {
    // 清掉上一組計時器
    clearTimeout(resetTimerRef.current)
    clearInterval(countdownIntervalRef.current)
    setCountdown(seconds)

    // 倒數顯示
    let remaining = seconds
    countdownIntervalRef.current = setInterval(() => {
      remaining -= 1
      setCountdown(remaining)
      if (remaining <= 0) clearInterval(countdownIntervalRef.current)
    }, 1000)

    resetTimerRef.current = setTimeout(() => {
      clearInterval(countdownIntervalRef.current)
      reset()
    }, seconds * 1000)
  }

  function startIdleTimer() {
    clearTimeout(idleTimerRef.current)
    idleTimerRef.current = setTimeout(() => {
      reset()
    }, IDLE_RESET_SECONDS * 1000)
  }

  function reset() {
    clearTimeout(resetTimerRef.current)
    clearInterval(countdownIntervalRef.current)
    clearTimeout(idleTimerRef.current)
    scanBufferRef.current = ''
    setStudent(null)
    setClasses([])
    setAnswers({})
    setErrorMsg('')
    setRegistration(null)
    setIsUpdate(false)
    setPhase('idle')
  }

  // ── 畫面渲染 ──────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-blue-700 text-white px-6 py-4 shadow-md flex items-center justify-between">
        <div>
          <p className="text-kiosk-sm opacity-80">普宜精舍</p>
          <h1 className="text-kiosk-lg font-bold leading-tight">
            {event ? event.name : '報名系統'}
          </h1>
        </div>
        {event && (
          <div className="text-right text-kiosk-sm opacity-80">
            <p>{event.date_start}
              {event.date_end && event.date_end !== event.date_start && ` ～ ${event.date_end}`}
            </p>
            {event.location && <p>{event.location}</p>}
          </div>
        )}
      </header>

      {/* Main */}
      <main className="flex-1 flex items-center justify-center p-6">
        {phase === 'idle' && <IdleScreen onTestScan={handleScan} />}
        {phase === 'loading' && <LoadingScreen />}
        {phase === 'no_event' && <NoEventScreen onRefresh={loadEvent} />}
        {phase === 'not_found' && <NotFoundScreen countdown={countdown} onReset={reset} />}
        {phase === 'duplicate' && (
          <DuplicateScreen
            student={student}
            registration={registration}
            fields={fields}
            countdown={countdown}
            onModify={handleModify}
            onReset={reset}
          />
        )}
        {phase === 'error' && <ErrorScreen message={errorMsg} onReset={reset} />}
        {phase === 'success' && <SuccessScreen student={student} answers={answers} countdown={countdown} onReset={reset} isUpdate={isUpdate} />}
        {(phase === 'form' || phase === 'submitting') && (
          <FormScreen
            student={student}
            classes={classes}
            fields={fields}
            answers={answers}
            errorMsg={errorMsg}
            submitting={phase === 'submitting'}
            onChange={setAnswers}
            onSubmit={handleSubmit}
            onCancel={reset}
          />
        )}
      </main>
    </div>
  )
}

// ── 各子畫面 ──────────────────────────────────────────────

function IdleScreen({ onTestScan }) {
  const [testId, setTestId] = useState('')
  return (
    <div className="text-center select-none">
      <div className="text-9xl mb-8 animate-pulse">📛</div>
      <p className="text-kiosk-2xl font-bold text-gray-700 mb-4">請刷學員證</p>
      <p className="text-kiosk-base text-gray-500">將學員證條碼對準掃描機</p>
      {/* 測試用輸入框，部署前移除 */}
      <div className="mt-10 flex gap-2 justify-center">
        <input
          type="text"
          value={testId}
          onChange={e => setTestId(e.target.value)}
          onKeyDown={e => e.stopPropagation()}
          placeholder="輸入學員編號測試"
          className="border-2 border-gray-300 rounded-xl px-4 py-2 text-lg w-52 text-center"
        />
        <button
          onClick={() => { if (testId.trim()) onTestScan(testId.trim()) }}
          className="px-5 py-2 bg-gray-500 text-white rounded-xl text-lg"
        >測試</button>
      </div>
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
      <p className="text-kiosk-base text-gray-500 mb-8">請師父在後台將活動設為「開放報名」</p>
      <button
        onClick={onRefresh}
        className="px-8 py-4 bg-blue-600 text-white rounded-2xl text-kiosk-base font-semibold"
      >
        重新整理
      </button>
    </div>
  )
}

function NotFoundScreen({ countdown, onReset }) {
  return (
    <div className="text-center">
      <div className="text-8xl mb-6">🔍</div>
      <p className="text-kiosk-xl font-bold text-red-600 mb-3">找不到學員資料</p>
      <p className="text-kiosk-base text-gray-500 mb-8">請確認學員證是否正確，或洽現場師兄協助</p>
      <p className="text-kiosk-sm text-gray-400">{countdown} 秒後自動返回</p>
      <button onClick={onReset} className="mt-4 px-8 py-3 border-2 border-gray-400 rounded-2xl text-kiosk-base text-gray-600">
        立即返回
      </button>
    </div>
  )
}

function DuplicateScreen({ student, registration, fields, countdown, onModify, onReset }) {
  const answers = registration?.answers || {}
  return (
    <div className="text-center w-full max-w-lg">
      <div className="text-8xl mb-4">✅</div>
      <p className="text-kiosk-xl font-bold text-green-600 mb-2">您已完成報名</p>
      <p className="text-kiosk-lg text-gray-700 mb-4">{student?.name} 師兄</p>
      {/* 顯示目前報名資料 */}
      <div className="bg-white rounded-2xl shadow p-5 mb-6 text-left">
        <p className="text-kiosk-sm font-bold text-gray-500 mb-3">目前報名資料</p>
        {fields.map(f => {
          if (f.show_if) {
            const ok = Object.entries(f.show_if).every(([k, v]) => answers[k] === v)
            if (!ok) return null
          }
          const val = answers[f.field_key]
          if (!val) return null
          return (
            <p key={f.field_key} className="text-kiosk-base text-gray-700 mb-1">
              <span className="font-medium">{f.field_label}：</span>
              {Array.isArray(val) ? val.join('、') : val}
            </p>
          )
        })}
      </div>
      <div className="flex gap-3 justify-center mb-4">
        <button onClick={onModify} className="flex-1 py-4 bg-blue-600 text-white rounded-2xl text-kiosk-base font-bold shadow-md">
          修改報名
        </button>
        <button onClick={onReset} className="flex-1 py-4 border-2 border-gray-400 rounded-2xl text-kiosk-base text-gray-600">
          返回
        </button>
      </div>
      <p className="text-kiosk-sm text-gray-400">{countdown} 秒後自動返回</p>
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

function SuccessScreen({ student, answers, countdown, onReset, isUpdate }) {
  return (
    <div className="text-center">
      <div className="text-9xl mb-6 animate-bounce">🙏</div>
      <p className="text-kiosk-2xl font-bold text-green-600 mb-3">{isUpdate ? '修改成功！' : '報名成功！'}</p>
      <p className="text-kiosk-lg text-gray-700 mb-2">{student?.name} 師兄</p>
      {answers.identity && (
        <p className="text-kiosk-base text-gray-500 mb-1">身分：{answers.identity}</p>
      )}
      {answers.volunteer_group && (
        <p className="text-kiosk-base text-gray-500 mb-1">組別：{answers.volunteer_group}</p>
      )}
      {answers.time_slot && (
        <p className="text-kiosk-base text-gray-500 mb-1">時段：{answers.time_slot}</p>
      )}
      <p className="text-kiosk-base text-blue-600 font-medium mt-4">阿彌陀佛，感恩護持！</p>
      <p className="text-kiosk-sm text-gray-400 mt-6">{countdown} 秒後自動返回</p>
      <button onClick={onReset} className="mt-3 px-8 py-3 border-2 border-gray-300 rounded-2xl text-kiosk-sm text-gray-500">
        立即返回
      </button>
    </div>
  )
}

function FormScreen({ student, classes, fields, answers, errorMsg, submitting, onChange, onSubmit, onCancel }) {
  return (
    <div className="w-full max-w-lg">
      {/* 學員資訊卡 */}
      <div className="bg-white rounded-2xl shadow-md p-5 mb-6 border-l-8 border-blue-600">
        <p className="text-kiosk-xl font-bold text-gray-800">{student?.name} 師兄</p>
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

      {/* 操作按鈕 */}
      <div className="flex gap-3">
        <button
          onClick={onCancel}
          disabled={submitting}
          className="flex-1 py-4 border-2 border-gray-300 rounded-2xl text-kiosk-base text-gray-600 font-medium disabled:opacity-50"
        >
          取消
        </button>
        <button
          onClick={onSubmit}
          disabled={submitting}
          className="flex-2 flex-grow-[2] py-4 bg-blue-600 text-white rounded-2xl text-kiosk-base font-bold shadow-md disabled:opacity-50 active:scale-95 transition-transform"
        >
          {submitting ? '送出中…' : '確認報名'}
        </button>
      </div>
    </div>
  )
}
