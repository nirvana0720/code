import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'

/**
 * 包住後台頁面，未登入自動導向 /admin/login
 * adminOnly=true 時，義工角色會被導向 /admin/events
 * session === undefined 表示仍在確認中，顯示空白避免閃爍
 */
export default function ProtectedRoute({ children, adminOnly = false }) {
  const { session, isAdmin } = useAuth()

  if (session === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-400 text-sm">載入中…</p>
      </div>
    )
  }

  if (!session) {
    return <Navigate to="/admin/login" replace />
  }

  if (adminOnly && !isAdmin) {
    return <Navigate to="/admin/events" replace />
  }

  return children
}
