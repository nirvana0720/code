import { useEffect, useState, useCallback } from 'react'
import AdminLayout from '../../components/AdminLayout'
import { getAllStudents } from '../../lib/supabase'

export default function StudentsPage() {
  const [students, setStudents] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (q = '') => {
    setLoading(true)
    const { students: data } = await getAllStudents(q)
    setStudents(data)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // 防抖搜尋
  useEffect(() => {
    const t = setTimeout(() => load(search), 300)
    return () => clearTimeout(t)
  }, [search, load])

  return (
    <AdminLayout>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gray-800">學員管理</h2>
        <span className="text-sm text-gray-400">{students.length} 位</span>
      </div>

      {/* 搜尋框 */}
      <div className="mb-4">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="搜尋姓名…"
          className="w-full sm:w-72 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
        />
      </div>

      {loading ? (
        <p className="text-gray-400 text-sm text-center py-12">載入中…</p>
      ) : students.length === 0 ? (
        <p className="text-gray-400 text-sm text-center py-12">找不到學員</p>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-600">學員編號</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">姓名</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">班別</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">狀態</th>
              </tr>
            </thead>
            <tbody>
              {students.map(s => (
                <tr key={s.student_id} className="border-b border-gray-50 hover:bg-amber-50/30">
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{s.student_id}</td>
                  <td className="px-4 py-3 font-medium text-gray-800">{s.name}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {s.student_classes && s.student_classes.length > 0
                      ? s.student_classes.map((c, i) => (
                          <span key={i} className="inline-block bg-amber-50 text-amber-700 text-xs px-2 py-0.5 rounded mr-1 mb-0.5">
                            {c.class_name}{c.group_name ? `・${c.group_name}` : ''}
                          </span>
                        ))
                      : <span className="text-gray-300">—</span>
                    }
                  </td>
                  <td className="px-4 py-3">
                    {s.active
                      ? <span className="text-green-600 text-xs font-medium">在籍</span>
                      : <span className="text-gray-400 text-xs">停止</span>
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminLayout>
  )
}
