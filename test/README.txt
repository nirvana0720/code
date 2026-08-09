報名系統自動化測試 — 使用說明
================================

目的
----
比照補課系統的做法，往後改動 car_assignments / chores / head_leader 相關的 RPC
（車輛簽到、坡務、學員查詢自己報名記錄）之後，先在測試專案跑過一輪確認沒問題，
再貼到正式環境（正式環境跟補課系統共用同一個 Supabase 專案，出錯影響範圍較大，
更要小心）。

第一次設定（測試專案重建過也要重做一次）
------------------------------------
1. 到測試專案（puyi-signup-test）確認左上角不是寫 PRODUCTION 的正式環境，
   SQL Editor 依序貼上執行：
   a) code/sql/full_setup_all_in_one.sql（建表 + 建函式，81 個 migration 串起來）
   b) test/seed.sql（灌測試資料：2 名學員、2 場測試活動、車輛/坡務/總領隊 token）
2. 確認 test/config.json 存在且指向測試專案（不是正式環境）：
   {
     "SUPABASE_URL": "https://jiudppdqfsrcxbawyrdf.supabase.co",
     "SUPABASE_ANON_KEY": "sb_publishable_..."
   }
   這支檔案不進 git（.gitignore 已排除），换电脑要重新填一次，
   或跟 config/config.js 一样集中记录在良师父自己的密码管理工具里。
   SUPABASE_SERVICE_ROLE_KEY 是選填欄位（Supabase Dashboard → 測試專案 →
   Project Settings → API → service_role secret），只給「分時段整合測試」
   繞過 RLS 用，沒填就自動跳過那段、其他測試案例照常跑，見下方分時段測試段落。

平常怎麼用
----------
1. 改完 code/sql/ 底下的 RPC 主檔（例如 lock_expired_token_pages.sql 或
   fix_head_leader_checkin_token.sql）之後，先貼到測試專案的 SQL Editor 跑一次
2. 雙擊 run.bat（會用電腦本來就有裝的 node，不用另外裝東西）
3. 全部綠燈（✅）才把同一份 SQL 貼到正式環境
4. 如果測試資料被改動過（例如報到狀態被測試改掉），重新貼一次 test/seed.sql
   即可重置（seed.sql 開頭會先清掉舊資料再重建，可重複執行）

目前涵蓋的測試案例（2026-07-22 建立）
------------------------------------
- get_car_by_token：進行中活動能查到車輛資料、已結束活動自動鎖住查不到
- get_leader_cars：車輛自己的 token 能查到同活動底下指定的車（前端「切換方向」
  Tab 用的是車 token，不是 head_leader token；head_leader 表是另一套查詢，走
  get_head_leader_by_token）
- get_car_by_token／get_leader_cars／checkin_car_member 的 service_date 鎖定判斷
  （2026-08-04 多日回山排車＋補件）：車輛有 service_date 時優先用它判斷是否已過，不受活動本身
  date_end 影響（測 service_date 已過但活動還「進行中」該鎖、service_date 未到但活動已「結束」
  該保持開放；checkin_car_member 額外驗證 service_date 已過會擋下報到寫入）。checkin_all_car／
  checkin_car_monk／is_token_expired 改法跟 checkin_car_member 完全同一套邏輯，暫沒有各自另外
  補測試案例，只靠程式碼比對確認改法一致。
- checkin_car_member：單筆報到寫入成功；用 head_leader token 也能報到
  （這是 2026-07-15 修過一次的 bug，寫這條測試防止之後又活過來）
- checkin_all_car：一鍵全車報到
- checkin_car_monk：車上法師報到
- checkin_car_member 對已結束活動：確認會擋下來、丟出「活動已結束」錯誤
- get_chore_by_token：坡務資料含車次資訊正確帶出
- get_chore_locations_by_event：依報名 id 分組回傳上午/下午坡務地點
- kiosk_get_registrations_for_student：查得到報名記錄，且 guest_phone 有被遮掉

附註：test/package.json 只有一行 "type": "commonjs"，用來覆寫 code/package.json
的 "type": "module"，讓 run.js 的 require() 能正常運作（不然雙擊 run.bat 會報
「require is not defined in ES module scope」）。這個檔案不用管，不要刪掉。

以後要加新測試案例，抄 run.js 裡 test(...) 的寫法複製一段改內容即可。
需要新的種子資料，去改 seed.sql（記得 run.js 開頭的 SEED 常數要跟著改）。

暫緩未做（先記著，之後有空再補）
--------------------------------
- create_recurring_events_in_range（定期活動範本自動建立）：2026-07-22 複查已確認
  沒有活著的 bug，暫時沒寫自動化測試案例
- touch_event_donors_updated_at / touch_registrations_updated_at：兩個都是最簡單的
  時間戳記觸發器，兩個版本逐字相同，暫不需要測試案例
- 涉及後台登入（authenticated 角色）才能呼叫的函式（例如活動/學員後台管理相關，
  多日回山「分時段」以外的其他功能）需要額外做 Supabase Auth 登入拿 JWT，比較
  麻煩，先不寫，之後有空再補

分時段（multi_slot_transport）測試（2026-08-09 建立，補件 2026-08-09 更新）
------------------------------------------------------------------
分兩支檔案：

1. test/unit_slot_logic.mjs —— 不連線 Supabase、不用 config.json，用 Node
   原生 ESM 直接 import src/lib/attendDateHelpers.js／carrangeHelpers.js／
   carSlotHelpers.js 的實際函式來測（isSlotBasedAnswers／resolveSlotBasedAttendSlots／
   countDistinctSlotDays／isInSlot／isFieldVisible／getVisibleRequiredFields／
   keyFor／timeSlotsFor／overrideStateKey／allDateDirectionSlots），涵蓋：
   - 分時段答案怎麼反推「哪些日期+方向+時段需要車」、留白的時段題不計入
   - 只填一天 vs 填兩天，is_lodging 該不該顯示／列入必填
   - 排車頁 state key（keyFor／timeSlotsFor／overrideStateKey）向下相容非分時段活動
   - 舊 attend_dates 模式（isInSlot 的 fallback 分支）行為不受影響
   執行：雙擊 test/run_unit.bat，或指令 node test/run_unit.mjs（用 node:module 的
   register() 補上 Vite 專案原始碼慣用的無副檔名 relative import，見
   test/esm-js-ext-loader.mjs）。

2. test/run.js 的「分時段整合測試」區塊（檔案最後一段）—— 真正對測試專案的
   event_fields／car_assignments 寫入 + 讀回斷言，不是只測純函式。這幾支寫入函式
   （syncTimeSlotFields／cleanupOppositeMultiDayFields／saveCarArrangement／
   getCarArrangement）要 authenticated 角色才能寫入這兩張表（anon INSERT
   event_fields 會被 RLS 擋下，42501），所以這段改用 config.json 的
   SUPABASE_SERVICE_ROLE_KEY（繞過 RLS）發送跟這幾支函式完全相同的 PostgREST
   請求，不是呼叫 JS 函式本身（那幾支是 Vite ESM 模組、用到 import.meta.env，
   純 Node 沒有 bundler 沒辦法直接 import 執行）。沒填 SUPABASE_SERVICE_ROLE_KEY
   時這段會整段跳過，不影響前面所有既有測試案例。
   涵蓋：
   - event_fields 正確生成 slot_up_xxx／slot_down_xxx（數量/label/options），
     且沒有 attend_dates
   - 用 fixture 真實報名答案（只填一天 vs 填兩天）驗證 is_lodging 必填清單判斷
   - ⚠️ 最重要：time_slot 的 NULL 比對——存三筆同一天同方向、時段分別是
     上午／中午／NULL 的車，驗證查詢跟刪除都精準只命中對應那一筆，不會互相污染
     （這是 saveCarArrangement／getCarArrangement 用 .is()/.eq() 分流處理
     NULL 比對這個風險點的直接驗證）
   - cleanupOppositeMultiDayFields 兩個方向：切到一般模式清掉 slot_up/slot_down
     （is_lodging 留著）、切到分時段模式清掉 attend_dates
   用到的 fixture 在 test/seed.sql 第 8 節（event_id 尾碼 e2，報名 e3/e4，車輛
   e5），第一次用或種子資料重貼過，記得先貼一次 test/seed.sql。
   ⚠️ time_slot 那組測試需要 sql/add_multi_slot_transport.sql 已經套用到測試
   專案（events.multi_slot_transport／car_assignments.time_slot 兩個欄位都要
   存在），沒套用會在第一個 POST 就丟出 42703 column does not exist，先貼這支
   migration 到測試專案 SQL Editor 再跑。
