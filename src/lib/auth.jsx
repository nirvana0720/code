import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined) // undefined = 尚未確認

  useEffect(() => {
    // 取得目前 session
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
    })

    // 監聽登入/登出事件
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })

    return () => subscription.unsubscribe()
  }, [])

  const user = session?.user ?? null
  const role = user?.user_metadata?.role ?? 'volunteer'
  const isAdmin = role === 'admin'

  return (
    <AuthContext.Provider value={{ session, user, role, isAdmin }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
