import { NavLink, useNavigate } from 'react-router-dom'
import { signOut } from '../lib/supabase'

const navItems = [
  { to: '/admin/events',   label: '活動管理' },
  { to: '/admin/students', label: '學員管理' },
]

export default function AdminLayout({ children }) {
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut()
    navigate('/admin/login')
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* 頂部導覽列 */}
      <header className="bg-amber-700 text-white shadow-md">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <span className="font-bold text-lg tracking-wide">普宜精舍 · 後台</span>
            <nav className="flex gap-1">
              {navItems.map(item => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `px-3 py-1 rounded text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-white/20'
                        : 'hover:bg-white/10'
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <NavLink
              to="/"
              className="text-xs text-white/70 hover:text-white transition-colors"
            >
              ← 前台報名
            </NavLink>
            <button
              onClick={handleSignOut}
              className="text-xs bg-white/10 hover:bg-white/20 px-3 py-1 rounded transition-colors"
            >
              登出
            </button>
          </div>
        </div>
      </header>

      {/* 主內容 */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-6">
        {children}
      </main>
    </div>
  )
}
