# 普宜精舍報名系統 — 部署說明

> 給想要複製這套系統的分院使用。
> 跟著步驟做，全程約 30–45 分鐘。
> 可以請 Claude 協助操作每一步。

---

## 事前準備（需要的帳號）

| 服務 | 用途 | 費用 |
|------|------|------|
| [GitHub](https://github.com) | 存放程式碼 | 免費 |
| [Supabase](https://supabase.com) | 資料庫 | 免費 |
| [Vercel](https://vercel.com) | 網站部署 | 免費 |

---

## 步驟一：Fork GitHub 專案

1. 登入 GitHub
2. 開啟原始專案：`https://github.com/nirvana0720/code`
3. 右上角點「**Fork**」→ 建立自己的副本
4. Fork 完成後，你會有一個 `你的帳號/code` 的 repo

---

## 步驟二：建立 Supabase 專案

1. 登入 [Supabase](https://supabase.com) → 點「**New project**」
2. 填寫：
   - **Name**：任意（例如：你的分院名稱）
   - **Database Password**：設一個強密碼並記下來
   - **Region**：選 **Singapore**（東南亞，台灣連線最快）
3. 等待專案建立完成（約 1–2 分鐘）

---

## 步驟三：建立資料庫結構

1. 進入 Supabase Dashboard → 左側選「**SQL Editor**」
2. 點「**New query**」
3. 開啟專案裡的 `schema.sql` 檔案，複製全部內容貼進去
4. 點「**Run**」執行
5. 執行完成後，用以下查詢確認 6 張資料表都存在：

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' ORDER BY table_name;
```

應該看到：`audit_log`、`event_fields`、`events`、`registrations`、`student_classes`、`students`

---

## 步驟四：取得 API 金鑰

1. Supabase Dashboard → 左側「**Project Settings**」→「**API**」
2. 找到以下兩個值，先複製起來：
   - **Project URL**：`https://xxxxxxxxxxxxxxxx.supabase.co`
   - **anon public**（Publishable key）：`sb_publishable_...`

---

## 步驟五：建立後台管理員帳號

1. Supabase Dashboard → 左側「**Authentication**」→「**Users**」
2. 點「**Add user**」→「**Create new user**」
3. 填入 Email 和密碼（這是師父登入後台用的帳號）
4. 點「**Create user**」

---

## 步驟六：部署到 Vercel

1. 登入 [Vercel](https://vercel.com) → 點「**Add New Project**」
2. 選「**Import Git Repository**」→ 選你 Fork 的 `code` repo
3. 展開「**Environment Variables**」，新增以下兩個變數：

   | 變數名稱 | 值 |
   |----------|----|
   | `VITE_SUPABASE_URL` | 步驟四的 Project URL |
   | `VITE_SUPABASE_ANON_KEY` | 步驟四的 anon public key |

4. **Root Directory** 欄位保持空白（不要填）
5. 點「**Deploy**」，等待部署完成（約 1–2 分鐘）
6. 部署完成後，Vercel 會給你一個網址，例如：`https://你的專案名稱.vercel.app`

---

## 步驟七：確認系統正常運作

1. 開啟 Vercel 給你的網址
   - 應該看到「請刷學員證」的待機畫面 ✅
2. 開啟 `你的網址/admin/login`
   - 用步驟五建立的帳號登入
   - 應該能進入後台管理頁面 ✅

---

## 步驟八：建立第一場活動

1. 後台 → 「**活動管理**」→「**新增活動**」
2. 填寫活動名稱、日期
3. 存檔後，點活動進入「**動態欄位**」tab
4. 可以點「**套用預設模板**」快速建立常用欄位（身分別、交通方式等）
5. 欄位設定完成後，將活動狀態改為「**active**」

---

## 步驟九：匯入學員資料

1. 後台 → 「**學員管理**」→「**匯入學員**」
2. 準備一份 Excel 或 CSV 檔，欄位名稱為：
   - `學員編號`、`姓名`、`班級`、`組別`
3. 上傳後確認預覽資料正確，點「確認匯入」

> 若暫時沒有學員資料，可以先使用「**新增訪客**」功能手動登記，之後再匯入。

---

## 完成後的網址說明

| 用途 | 網址 |
|------|------|
| 前台刷卡報名（平板用） | `https://你的網址.vercel.app/` |
| 後台管理（師父用） | `https://你的網址.vercel.app/admin` |
| 現場報到打卡 | `https://你的網址.vercel.app/admin/events/活動ID/checkin` |

---

## 常見問題

**Q：刷卡後顯示「找不到學員」？**
A：確認學員資料已匯入，且 student_id 與 QR code 內容一致（QR code 只編碼學員編號數字）。

**Q：後台登入後看到空白或 404？**
A：Vercel 的路由設定需要 `vercel.json`，確認 repo 裡有這個檔案。

**Q：報名資料跨裝置不一致？**
A：系統已內建快取繞過機制，若仍有問題請強制重新整理瀏覽器（Ctrl+Shift+R）。

**Q：如何更新程式碼？**
A：原始專案有更新時，在 GitHub 上點「Sync fork」同步，Vercel 會自動重新部署。

---

> 如有問題，可請 Claude 協助排查，並說明在哪個步驟卡住。
