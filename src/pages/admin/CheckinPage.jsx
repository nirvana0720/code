import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import AdminLayout from '../../components/AdminLayout'
import { getAllEvents, getRegistrationForCheckin, checkIn, uncheckIn } from '../../lib/supabase'

const IDLE_SECONDS = 5 // 成功/失敗畫面停留秒數

export default function CheckinPage() {
  const { id } = useParams()
  const [eventName, setEventName] = useState('')
  const [status, setStatus] = useState('idle') // idle | loading | success | already | not_found | error
  const [result, setResult] = useState(null) // { name, checkedInAt, registrationId }
  const [countdown, setCountdown] = useState(IDLE_SECONDS)
  const [todayCount, setTodayCount] = useState(0)

  const inputRef = useRef('')
  const countdownRef = useRef(null)

  // 取得活動名稱
  useEffect(() => {
    getAllEvents().then(({ events }) => {
      const ev = events.find(e => e.event_id === id)
      if (ev) setEventName(ev.name)
    })
  }, [id])

  // 監聽鍵盤輸入（掃描機模擬鍵盤）
  useEffect(() => {
    function onKey(e) {
      if (status === 'loading') return
      if (e.key === 'Enter') {
        const val = inputRef.current.trim()
        inputRef.current = ''
        if (val) handleScan(val)
      } else if (e.key.length === 1) {
        inputRef.current += e.key
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [status]) // eslint-disable-line

  const resetToIdle = useCallback(() => {
    clearInterval(countdownRef.current)
    setStatus('idle')
    setResult(null)
    setCountdown(IDLE_SECONDS)
  }, [])

  function startCountdown() {
    setCountdown(IDLE_SECONDS)
    clearInterval(countdownRef.current)
    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(countdownRef.current)
          resetToIdle()
          return IDLE_SECONDS
        }
        return prev - 1
      })
    }, 1000)
  }

  async function handleScan(studentId) {
    setStatus('loading')
    clearInterval(countdownRef.current)

    const { registration, error } = await getRegistrationForCheckin(id, studentId)

    if (error === 'NOT_REGISTERED') {
      setStatus('not_found')
      setResult(null)
      startCountdown()
      return
    }
    if (error) {
      setStatus('error')
      setResult(null)
      startCountdown()
      return
    }

    const name = registration.students?.name ?? studentId

    if (registration.checked_in_at) {
      // 已報到過
      setStatus('already')
      setResult({ name, checkedInAt: registration.checked_in_at, registrationId: registration.registration_id })
      startCountdown()
      return
    }

    // 執行報到
    const { success } = await checkIn(registration.registration_id)
    if (success) {
      setTodayCount(c => c + 1)
      setStatus('success')
      setResult({ name, registrationId: registration.registration_id })
      startCountdown()
    } else {
      setStatus('error')
      setResult(null)
      startCountdown()
    }
  }

  async function handleUncheck() {
    if (!result?.registrationId) return
    await uncheckIn(result.registrationId)
    resetToIdle()
  }

  return (
    <AdminLayout>
      {/* 頂列 */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          to={`/admin/events/${id}`}
          className="text-sm text-gray-500 hover:text-amber-700 transition-colors"
        >
          ← 返回活動
        </Link>
        <span className="text-gray-300">|</span>
        <h2 className="text-lg font-bold text-gray-800">{eventName || '現場報到'}</h2>
        <span className="ml-auto text-sm text-gray-500">
          今日已報到：<strong className="text-amber-700">{todayCount}</strong> 人
        </span>
      </div>

      {/* 主顯示區 */}
      <div className="flex flex-col items-center justify-center min-h-[60vh]">

        {status === 'idle' && (
          <div className="text-center animate-pulse">
            <div className="text-8xl mb-6">📷</div>
            <p className="text-2xl font-bold text-gray-700">請刷學員證</p>
            <p className="text-sm text-gray-400 mt-3">掃描機刷卡後自動報到</p>
          </div>
        )}

        {status === 'loading' && (
          <div className="text-center">
            <div className="text-6xl mb-4 animate-spin">⏳</div>
            <p className="text-xl text-gray-500">確認中…</p>
          </div>
        )}

        {status === 'success' && result && (
          <div className="text-center">
            <div className="text-8xl mb-6">✅</div>
            <p className="text-4xl font-bold text-green-700 mb-2">{result.name}</p>
            <p className="text-xl text-green-600">報到成功！</p>
            <p className="text-sm text-gray-400 mt-4">{countdown} 秒後自動重置</p>
            <button
              onClick={resetToIdle}
              className="mt-4 text-xs text-gray-400 hover:text-gray-600 underline"
            >
              立即重置
            </button>
          </div>
        )}

        {status === 'already' && result && (
          <div className="text-center">
            <div className="text-8xl mb-6">⚠️</div>
            <p className="text-4xl font-bold text-amber-700 mb-2">{result.name}</p>
            <p className="text-xl text-amber-600">已於 {new Date(result.checkedInAt).toLocaleTimeString('zh-TW', { hour12: false })} 報到過</p>
            <div className="flex gap-3 justify-center mt-5">
              <button
                onClick={handleUncheck}
                className="text-sm text-red-500 hover:text-red-700 border border-red-200 hover:border-red-400 px-4 py-2 rounded-lg transition-colors"
              >
                取消報到
              </button>
              <button
                onClick={resetToIdle}
                className="text-sm text-gray-500 hover:text-gray-700 border border-gray-200 px-4 py-2 rounded-lg transition-colors"
              >
                返回（{countdown}s）
              </button>
            </div>
          </div>
        )}

        {status === 'not_found' && (
          <div className="text-center">
            <div className="text-8xl mb-6">❓</div>
            <p className="text-2xl font-bold text-gray-500 mb-2">找不到此學員</p>
            <p className="text-gray-400">此學員尚未報名本活動</p>
            <p className="text-sm text-gray-400 mt-4">{countdown} 秒後自動重置</p>
            <button onClick={resetToIdle} className="mt-2 text-xs text-gray-400 hover:text-gray-600 underline">立即重置</button>
          </div>
        )}

        {status === 'error' && (
          <div className="text-center">
            <div className="text-8xl mb-6">🔴</div>
            <p className="text-2xl font-bold text-red-500 mb-2">發生錯誤</p>
            <p className="text-sm text-gray-400 mt-4">{countdown} 秒後自動重置</p>
            <button onClick={resetToIdle} className="mt-2 text-xs text-gray-400 hover:text-gray-600 underline">立即重置</button>
          </div>
        )}
      </div>
    </AdminLayout>
  )
}
