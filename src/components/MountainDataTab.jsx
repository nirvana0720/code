// 「山上資料匯入」頁籤排版容器，只放兩個 Panel，不寫業務邏輯
import DormitoryImportPanel from './DormitoryImportPanel'
import VolunteerGroupImportPanel from './VolunteerGroupImportPanel'

export default function MountainDataTab({ eventId, registrations, onImported }) {
  return (
    <div className="space-y-8">
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
        上傳山上寄回的安單總表 / 報到總表 PDF，系統會自動解析並比對本活動報名紀錄，確認預覽無誤後再寫入。
      </div>
      <DormitoryImportPanel eventId={eventId} registrations={registrations} onImported={onImported} />
      <VolunteerGroupImportPanel eventId={eventId} registrations={registrations} onImported={onImported} />
    </div>
  )
}
