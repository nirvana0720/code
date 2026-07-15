// 領隊報到頁「寮區」頁籤（唯讀，無報到勾選功能）：依 dormitory_room 分組顯示
import { getMemberName, isGuest, formatMemberClasses } from '../../lib/checkinHelpers'
import { groupMembersByDormitory } from '../../lib/checkinGrouping'

export default function DormitoryTab({ members }) {
  const groups = groupMembersByDormitory(members)

  if (groups.length === 0) {
    return <div className="text-center text-gray-400 py-12 text-sm">此範圍尚無寮房資料</div>
  }

  return (
    <div className="space-y-3">
      {groups.map(g => {
        const isUnassigned = g.key === '__unassigned__'
        return (
          <div key={g.key} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className={`px-4 py-2.5 border-b text-sm font-semibold ${
              isUnassigned ? 'bg-gray-50 border-gray-100 text-gray-500' : 'bg-sky-50 border-sky-100 text-sky-800'
            }`}>
              {isUnassigned ? g.label : `🛏 ${g.label}`}
            </div>
            <div className="divide-y">
              {g.members.map(m => (
                <div key={m.registration_id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-medium text-gray-700 truncate">{getMemberName(m)}</span>
                      {isGuest(m) && (
                        <span className="text-xs bg-blue-100 text-blue-600 rounded-full px-1.5 shrink-0">訪客</span>
                      )}
                    </div>
                    {formatMemberClasses(m) && (
                      <div className="text-[11px] text-gray-500 mt-0.5 truncate">{formatMemberClasses(m)}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
