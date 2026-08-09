'use strict';
// 職責：報名系統自動化測試 runner ── 呼叫「測試 Supabase 專案」的 RPC，比對預期結果。
// 執行：本機雙擊 run.bat（或指令 node run.js，這台電腦本來就有裝 node，不用另外綁 node.exe）
// 只用 Node 內建 https 模組，不裝任何 npm 套件（比照補課系統 test/run.js 的寫法）。
//
// ⚠️ 這支腳本只能對著「測試專案」跑，絕對不能對正式環境跑！
//    正式環境是報名系統跟補課系統共用的那個 Supabase 專案（yiowkvxwvwpzebdriksu），
//    config.json 指向哪個專案由 test/config.json 決定，下面會自動擋掉正式環境的網址。
//
// 前提（第一次用，或測試專案重建過，才需要重做）：
//   1) 到測試專案的 SQL Editor 貼過 code/sql/full_setup_all_in_one.sql（建表 + 建函式）
//   2) 到測試專案的 SQL Editor 貼過 test/seed.sql（灌測試資料，用固定 UUID/token，可重複執行）
//   3) test/config.json 填的是測試專案的 URL/anon key（不是正式環境的）
//
// 以後要加新測試案例：抄下面 test(...) 的寫法複製一段改內容即可。
// 種子資料用的是固定 UUID（見 seed.sql 開頭註解），不用另外查 id。

const fs = require('fs');
const path = require('path');
const https = require('https');
const { URL, pathToFileURL } = require('url');

const CFG = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const SUPABASE_URL = CFG.SUPABASE_URL;
const SUPABASE_ANON_KEY = CFG.SUPABASE_ANON_KEY;
// service_role key：只給「分時段（multi_slot_transport）整合測試」這個新區塊用，繞過 RLS
// 直接驗證 event_fields／car_assignments 的寫入結果（這兩張表的寫入函式要 authenticated
// 角色才能呼叫，run.js 原本只有 anon key，測不到）。沒填這個欄位時，新區塊會整段跳過，
// 不影響前面所有既有測試案例的執行方式。
const SUPABASE_SERVICE_ROLE_KEY = CFG.SUPABASE_SERVICE_ROLE_KEY || null;

// ── 安全防呆：擋掉正式環境（報名系統+補課系統共用正式專案 ID 的固定字串）──
if (!SUPABASE_URL || SUPABASE_URL.includes('yiowkvxwvwpzebdriksu')) {
  console.error('❌ config.json 指向的不是測試專案（疑似正式環境），已中止執行！');
  console.error('   測試絕對不能跑在正式環境的 Supabase 專案上。');
  process.exit(1);
}

// ── 種子資料固定 id/token（跟 seed.sql 完全對應，改動請兩邊一起改）──────
const SEED = {
  eventActive: '00000000-0000-0000-0000-0000000000a1',
  eventExpired: '00000000-0000-0000-0000-0000000000a2',
  carActive: '00000000-0000-0000-0000-0000000000b1',
  carExpired: '00000000-0000-0000-0000-0000000000b2',
  regDriver: '00000000-0000-0000-0000-0000000000c1',
  regPassenger: '00000000-0000-0000-0000-0000000000c2',
  carMonk: '00000000-0000-0000-0000-0000000000e1',
  choreId: '00000000-0000-0000-0000-0000000000a9',
  studentDriver: 'TESTSTU001',
  tokenCarActive: 'TEST_CAR_TOKEN_ACTIVE',
  tokenCarExpired: 'TEST_CAR_TOKEN_EXPIRED',
  carSvcDatePast: '00000000-0000-0000-0000-0000000000b3',
  carSvcDateFuture: '00000000-0000-0000-0000-0000000000b4',
  tokenCarSvcDatePast: 'TEST_CAR_TOKEN_SVCDATE_PAST',
  tokenCarSvcDateFuture: 'TEST_CAR_TOKEN_SVCDATE_FUTURE',
  tokenHeadLeader: 'TEST_HEAD_LEADER_TOKEN',
  tokenChore: 'TEST_CHORE_TOKEN',
  // 分時段（multi_slot_transport）整合測試 fixture，見 seed.sql 第 8 節
  eventSlot: '00000000-0000-0000-0000-0000000000e2',
  regSlotOneDay: '00000000-0000-0000-0000-0000000000e3',  // 只填 day1
  regSlotTwoDay: '00000000-0000-0000-0000-0000000000e4',  // 填兩天，掛單
  carSlot: '00000000-0000-0000-0000-0000000000e5',
};

// ── 分時段整合測試專用：service_role 版的 GET/POST/DELETE（繞過 RLS）──
// 這幾支不是 supabase.js 裡 syncTimeSlotFields／saveCarArrangement／getCarArrangement／
// cleanupOppositeMultiDayFields 的直接呼叫（那幾支是 Vite ESM 模組，用到 import.meta.env，
// 純 Node 環境沒有 bundler 沒辦法直接 import 執行），而是照這幾支函式實際送出的
// PostgREST 請求原樣重現，直接對真正的資料庫斷言寫入/讀取結果——尤其是
// service_date／time_slot 的 NULL 比對（.is() vs .eq()）這個風險點，這樣測法能
// 100% 反映真實資料庫行為，不是只測 mock。
function adminGet(pathQuery) {
  return restRequest('GET', pathQuery, undefined, SUPABASE_SERVICE_ROLE_KEY).then(res => {
    if (res.status >= 400) throw new Error(`admin GET ${pathQuery} 回傳 ${res.status}：${JSON.stringify(res.body)}`);
    return res.body;
  });
}
function adminPost(pathQuery, body) {
  return restRequest('POST', pathQuery, body, SUPABASE_SERVICE_ROLE_KEY).then(res => {
    if (res.status >= 400) throw new Error(`admin POST ${pathQuery} 回傳 ${res.status}：${JSON.stringify(res.body)}`);
    return res.body;
  });
}
function adminDelete(pathQuery) {
  return restRequest('DELETE', pathQuery, undefined, SUPABASE_SERVICE_ROLE_KEY).then(res => {
    if (res.status >= 400) throw new Error(`admin DELETE ${pathQuery} 回傳 ${res.status}：${JSON.stringify(res.body)}`);
    return res.body;
  });
}

// ── 共用：直接呼叫 PostgREST table endpoint（測 RLS 用，不是走 RPC）──
// apiKey 不傳時沿用原本行為（anon key），既有測試呼叫方式完全不受影響；
// 分時段整合測試會明確傳入 SUPABASE_SERVICE_ROLE_KEY 繞過 RLS。
function restRequest(method, tablePathWithQuery, body, apiKey) {
  const key = apiKey || SUPABASE_ANON_KEY;
  return new Promise((resolve, reject) => {
    const u = new URL(SUPABASE_URL + '/rest/v1/' + tablePathWithQuery);
    const bodyBuf = body !== undefined ? Buffer.from(JSON.stringify(body), 'utf8') : null;
    const headers = {
      'apikey': key,
      'Authorization': 'Bearer ' + key,
      'Content-Type': 'application/json',
    };
    if (bodyBuf) headers['Content-Length'] = bodyBuf.length;
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method,
      headers,
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json;
        try { json = JSON.parse(text); } catch (e) { json = text; }
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('連線逾時（15 秒）')));
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

// ── 共用：呼叫 Supabase RPC ──────────────────────────────
function rpc(name, params) {
  return new Promise((resolve, reject) => {
    const u = new URL(SUPABASE_URL + '/rest/v1/rpc/' + name);
    const body = Buffer.from(JSON.stringify(params || {}), 'utf8');
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname,
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
        'Content-Length': body.length,
      },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json;
        try { json = JSON.parse(text); } catch (e) { json = text; }
        if (res.statusCode >= 400) {
          const msg = (json && json.message) ? json.message : text;
          reject(new Error(`RPC ${name} 回傳 ${res.statusCode}：${msg}`));
        } else {
          resolve(json);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('連線逾時（15 秒）')));
    req.write(body);
    req.end();
  });
}

// ── 測試小工具 ──────────────────────────────
let pass = 0, fail = 0;
async function test(name, fn) {
  try {
    await fn();
    pass++;
    console.log('✅ ' + name);
  } catch (e) {
    fail++;
    console.log('❌ ' + name);
    console.log('   ' + e.message);
  }
}
function assertEqual(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error((label || '') + ' 預期 ' + e + '，實際拿到 ' + a);
}
function assertTrue(cond, label) {
  if (!cond) throw new Error(label || '預期為真，實際為假');
}
async function assertThrows(fn, messageIncludes, label) {
  try {
    await fn();
  } catch (e) {
    if (messageIncludes && !e.message.includes(messageIncludes)) {
      throw new Error((label || '') + ` 有丟出錯誤，但訊息不含「${messageIncludes}」，實際訊息：${e.message}`);
    }
    return;
  }
  throw new Error((label || '') + ' 預期會丟出錯誤，但沒有');
}

// ── 主流程 ──────────────────────────────
(async () => {
  console.log('=== 報名系統自動化測試 ===');
  console.log('對象專案：' + SUPABASE_URL);
  console.log('');

  await test('連線 + get_car_by_token：進行中活動的車能查到資料', async () => {
    const car = await rpc('get_car_by_token', { p_token: SEED.tokenCarActive });
    if (!car) throw new Error('查無資料，請先到測試專案 SQL Editor 貼過 test/seed.sql');
    assertEqual(car.car_name, '測試車1號', 'car_name');
    assertEqual((car.car_members || []).length, 2, 'car_members 人數');
    assertEqual((car.car_leaders || [])[0].registration_id, SEED.regDriver, '領隊 registration_id');
    assertEqual((car.car_monks || [])[0].temple_monks.name, '測試法師', '車上法師姓名');
  });

  await test('get_car_by_token：活動已結束的車查不到資料（自動鎖住）', async () => {
    const car = await rpc('get_car_by_token', { p_token: SEED.tokenCarExpired });
    assertEqual(car, null, '已結束活動應回傳 null');
  });

  await test('get_leader_cars：用車輛自己的 token 能查到同活動底下指定的車（前端「切換方向」Tab 用車 token 查，不是 head_leader token）', async () => {
    const cars = await rpc('get_leader_cars', { p_token: SEED.tokenCarActive, p_car_ids: [SEED.carActive] });
    assertEqual((cars || []).length, 1, '車輛數');
    assertEqual(cars[0].car_name, '測試車1號', 'car_name');
  });

  // ── 多日回山排車：service_date 優先於 date_end 的鎖定判斷（2026-08-04）──
  await test('get_car_by_token：service_date 已過的車即使活動本身還「進行中」也應該鎖住', async () => {
    const car = await rpc('get_car_by_token', { p_token: SEED.tokenCarSvcDatePast });
    assertEqual(car, null, 'service_date 已過應回傳 null（即使活動 date_end 還沒到）');
  });

  await test('get_car_by_token：service_date 還沒到的車即使活動本身已「結束」也應該維持開放', async () => {
    const car = await rpc('get_car_by_token', { p_token: SEED.tokenCarSvcDateFuture });
    if (!car) throw new Error('service_date 還沒到，不該被鎖住，但查無資料');
    assertEqual(car.car_name, '測試車4號（service_date 未到）', 'car_name');
  });

  await test('get_leader_cars：service_date 已過的車即使活動本身還「進行中」也應該被排除', async () => {
    const cars = await rpc('get_leader_cars', { p_token: SEED.tokenCarSvcDatePast, p_car_ids: [SEED.carSvcDatePast] });
    assertEqual((cars || []).length, 0, 'service_date 已過的車不應出現在結果中');
  });

  await test('checkin_car_member：service_date 已過的車即使活動 date_end 還沒到也應該擋下報到（補件：鎖定判斷套用到報到三支）', async () => {
    await assertThrows(
      () => rpc('checkin_car_member', {
        p_token: SEED.tokenCarSvcDatePast, p_car_id: SEED.carSvcDatePast,
        p_registration_id: SEED.regDriver, p_check_in: true,
      }),
      '活動已結束',
      'checkin_car_member 對 service_date 已過的車'
    );
  });

  await test('checkin_car_member：單筆報到後 checked_in_at 有值', async () => {
    await rpc('checkin_car_member', {
      p_token: SEED.tokenCarActive, p_car_id: SEED.carActive,
      p_registration_id: SEED.regPassenger, p_check_in: true,
    });
    const car = await rpc('get_car_by_token', { p_token: SEED.tokenCarActive });
    const m = (car.car_members || []).find(x => x.registration_id === SEED.regPassenger);
    assertTrue(m && m.checked_in_at, '乘客報到後 checked_in_at 應該有值');
  });

  await test('checkin_car_member：用 head_leader token 也能報到（07-15 修過的 bug，防止再活過來）', async () => {
    await rpc('checkin_car_member', {
      p_token: SEED.tokenHeadLeader, p_car_id: SEED.carActive,
      p_registration_id: SEED.regDriver, p_check_in: true,
    });
    const car = await rpc('get_car_by_token', { p_token: SEED.tokenCarActive });
    const m = (car.car_members || []).find(x => x.registration_id === SEED.regDriver);
    assertTrue(m && m.checked_in_at, '用總領隊 token 報到駕駛後 checked_in_at 應該有值');
  });

  await test('checkin_all_car：一鍵全車報到，剩下沒報到的人會被補上', async () => {
    await rpc('checkin_all_car', { p_token: SEED.tokenCarActive, p_car_id: SEED.carActive });
    const car = await rpc('get_car_by_token', { p_token: SEED.tokenCarActive });
    const allCheckedIn = (car.car_members || []).every(x => x.checked_in_at);
    assertTrue(allCheckedIn, '全車報到後每個人都應該有 checked_in_at');
  });

  await test('checkin_car_monk：車上法師報到', async () => {
    await rpc('checkin_car_monk', { p_token: SEED.tokenCarActive, p_car_monk_id: SEED.carMonk, p_check_in: true });
    const car = await rpc('get_car_by_token', { p_token: SEED.tokenCarActive });
    const monk = (car.car_monks || [])[0];
    assertTrue(monk && monk.checked_in_at, '法師報到後 checked_in_at 應該有值');
  });

  await test('checkin_car_member：活動已結束禁止寫入', async () => {
    await assertThrows(
      () => rpc('checkin_car_member', {
        p_token: SEED.tokenCarExpired, p_car_id: SEED.carExpired,
        p_registration_id: SEED.regDriver, p_check_in: true,
      }),
      '活動已結束',
      'checkin_car_member 對已結束活動'
    );
  });

  await test('get_chore_by_token：坡務資料能查到、車次資訊正確帶出', async () => {
    const chore = await rpc('get_chore_by_token', { p_token: SEED.tokenChore });
    if (!chore) throw new Error('查無資料，請先確認 seed.sql 有貼過');
    assertEqual((chore.members || []).length, 1, '坡務成員人數');
    assertEqual(chore.members[0].name, '測試學員甲', '成員姓名');
    assertEqual(chore.members[0].car_name, '測試車1號', '成員上山車次（驗證 direction=up 才會帶出車名）');
  });

  await test('get_chore_locations_by_event：依 registration_id 分組回傳上午/下午地點', async () => {
    const result = await rpc('get_chore_locations_by_event', { p_event_id: SEED.eventActive });
    const entry = result && result[SEED.regDriver];
    if (!entry) throw new Error('查無測試學員甲的坡務地點資料');
    assertEqual(entry['上午'].location, '大殿', '上午坡務地點');
  });

  await test('kiosk_get_registrations_for_student：查得到報名記錄，且 guest_phone 被遮掉', async () => {
    const rows = await rpc('kiosk_get_registrations_for_student', {
      p_student_id: SEED.studentDriver, p_event_ids: [SEED.eventActive],
    });
    assertEqual((rows || []).length, 1, '報名記錄筆數');
    const answers = rows[0].answers || {};
    assertTrue(!('guest_phone' in answers), 'answers 不應該包含 guest_phone（應被遮掉）');
    assertEqual(answers.note, '測試備註', '其他欄位應該正常保留');
  });

  // ── event_donors anon RLS 封鎖驗證（fix_rls_clean.sql／fix_event_donors_anon_leak.sql）──
  // 四個都要「預期失敗（4xx）才算測試通過」，跟前面案例的斷言方向相反。
  // 用 status >= 400 判斷，不是看 body 有沒有資料——REVOKE ALL 後 Postgres 在權限檢查階段
  // 就會擋下（42501 permission denied），PostgREST 一律回 4xx，不會有「200 + 空陣列」這種
  // 半吊子結果，因此不會誤把「查得到但剛好沒資料」跟「真的被擋下」搞混。
  const DUMMY_DONOR_ID = '00000000-0000-0000-0000-000000000000';

  await test('event_donors：anon SELECT 應該被擋下（RLS/GRANT 已封鎖）', async () => {
    const res = await restRequest('GET', 'event_donors?select=*&limit=1');
    assertTrue(res.status >= 400, 'anon SELECT event_donors 應該回傳錯誤狀態碼，實際：' + res.status + '，body：' + JSON.stringify(res.body));
  });

  await test('event_donors：anon INSERT 應該被擋下', async () => {
    const res = await restRequest('POST', 'event_donors', { event_id: SEED.eventActive, name: '測試外洩探測' });
    assertTrue(res.status >= 400, 'anon INSERT event_donors 應該回傳錯誤狀態碼，實際：' + res.status + '，body：' + JSON.stringify(res.body));
  });

  await test('event_donors：anon UPDATE 應該被擋下', async () => {
    const res = await restRequest('PATCH', 'event_donors?donor_id=eq.' + DUMMY_DONOR_ID, { name: '被竄改' });
    assertTrue(res.status >= 400, 'anon UPDATE event_donors 應該回傳錯誤狀態碼，實際：' + res.status + '，body：' + JSON.stringify(res.body));
  });

  await test('event_donors：anon DELETE 應該被擋下', async () => {
    const res = await restRequest('DELETE', 'event_donors?donor_id=eq.' + DUMMY_DONOR_ID);
    assertTrue(res.status >= 400, 'anon DELETE event_donors 應該回傳錯誤狀態碼，實際：' + res.status + '，body：' + JSON.stringify(res.body));
  });

  // ── 分時段（multi_slot_transport）整合測試：真正寫/讀資料庫 ──────────────
  // 只有 config.json 有填 SUPABASE_SERVICE_ROLE_KEY 才會跑（見上面 adminGet/adminPost/
  // adminDelete 註解）；沒填的話整段跳過，不影響上面所有既有測試案例。
  //
  // ⚠️ 涵蓋範圍務必看清楚：這個區塊是用 REST（service_role）「重現」
  // syncTimeSlotFields／saveCarArrangement／getCarArrangement／
  // cleanupOppositeMultiDayFields 這四支函式送出的 PostgREST 請求，藉此驗證
  // 資料庫端的規則（RLS、event_fields／car_assignments 的實際資料形狀、
  // service_date／time_slot 的 NULL 比對），不是直接呼叫這四支函式本身。
  // 原因：這四支函式在 src/lib/supabase.js，是 Vite ESM 模組、開頭讀
  // import.meta.env 取 SUPABASE_URL/KEY，這個物件在純 Node（沒有 Vite/bundler）
  // 環境下是 undefined，直接 import 會在模組頂層就丟出 TypeError，沒辦法安全繞過
  // （需要在 import 前用 loader 竄改原始碼文字才能塞值進去，改動與風險都不小，
  // 這裡刻意不做）。
  // 實務影響：**如果之後只改這四支函式「內部邏輯」（例如改寫法、調整判斷順序），
  // 但沒有動到它們送出的資料庫規則或資料形狀，這批測試不會自動抓到**，仍然要
  // 靠人工核對程式碼或之後補上真正的函式呼叫能力。
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    console.log('');
    console.log('⚠️ 略過「分時段整合測試」：config.json 沒有 SUPABASE_SERVICE_ROLE_KEY');
    console.log('   （event_fields／car_assignments 寫入要 authenticated 角色，anon key 測不到）');
  } else {
    console.log('');
    console.log('=== 分時段（multi_slot_transport）整合測試 ===');

    // src/lib/attendDateHelpers.js 沒有任何 import，是唯一能在純 Node 安全動態
    // import 的來源檔（不會踩到 import.meta.env，也不會踩到 carSlotHelpers.js/
    // carrangeHelpers.js 那種無副檔名 relative import 才需要的 loader）。
    // 全區塊共用同一份，下面每個測試案例不要各自重複 import。
    const helpers = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'lib', 'attendDateHelpers.js')).href);

    // 用 REST（service_role）自建 event + registrations，不依賴人工先手動貼過 seed.sql
    // 第 8 節（那份 fixture 仍然保留給「以後 run.js 有 Auth 登入能力」時比對用，見 README）。
    // 日期全程用 UTC 運算，避免本地時區退一天（同 attendDateHelpers.eachDateInRange 的教訓）。
    let day1 = null, day2 = null;
    await test('分時段整合：準備 fixture（event + 兩筆報名，用 REST 直接自建）', async () => {
      const now = new Date();
      const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
      const toISO = ms => new Date(ms).toISOString().slice(0, 10);
      day1 = toISO(base + 5 * 86400000);
      day2 = toISO(base + 6 * 86400000);

      // 清乾淨舊的（子表先刪，events 本身最後刪，重新建立一份乾淨的）
      await adminDelete(`event_fields?event_id=eq.${SEED.eventSlot}`);
      await adminDelete(`car_assignments?event_id=eq.${SEED.eventSlot}`);
      await adminDelete(`registrations?event_id=eq.${SEED.eventSlot}`);
      await adminDelete(`events?event_id=eq.${SEED.eventSlot}`);

      await adminPost('events', {
        event_id: SEED.eventSlot, name: '測試活動-分時段回山（run.js 自建）',
        date_start: day1, date_end: day2, location: '普宜精舍', event_type: 'mountain',
        status: 'active', is_dharma: false, multi_day_transport: true,
      });
      await adminPost('registrations', {
        registration_id: SEED.regSlotOneDay, event_id: SEED.eventSlot, student_id: 'TESTSTU001', is_driver: false,
        answers: { [`slot_up_${day1}`]: '上午', [`slot_down_${day1}`]: '下午' },
      });
      await adminPost('registrations', {
        registration_id: SEED.regSlotTwoDay, event_id: SEED.eventSlot, student_id: 'TESTSTU002', is_driver: false,
        answers: { [`slot_up_${day1}`]: '上午', [`slot_down_${day2}`]: '下午', is_lodging: true },
      });

      const rows = await adminGet(`events?event_id=eq.${SEED.eventSlot}&select=date_start,date_end`);
      assertEqual(rows.length, 1, '活動應該建立成功');
      assertEqual([rows[0].date_start, rows[0].date_end], [day1, day2], '活動日期應該符合預期');
    });

    // ── 1) 模擬 syncTimeSlotFields：清空後重新生成，斷言 event_fields 形狀正確 ──
    await test('分時段整合：模擬 syncTimeSlotFields，event_fields 正確生成 slot_up/slot_down（無 attend_dates）', async () => {
      await adminDelete(`event_fields?event_id=eq.${SEED.eventSlot}`);
      // field_label 用 helpers.formatDateWithWeekday 動態算，跟 supabase.js 的
      // syncTimeSlotFields 實際組字串的方式（`${formatDateWithWeekday(d)} 去程時段`）
      // 完全一致，不要手寫死格式，否則本尊格式一改，這個斷言測不出來
      const label1 = helpers.formatDateWithWeekday(day1);
      const label2 = helpers.formatDateWithWeekday(day2);
      const specs = [
        { field_key: `slot_up_${day1}`,   field_label: `${label1} 去程時段`, options: ['上午', '中午'] },
        { field_key: `slot_down_${day1}`, field_label: `${label1} 回程時段`, options: ['中午', '下午'] },
        { field_key: `slot_up_${day2}`,   field_label: `${label2} 去程時段`, options: ['上午', '中午'] },
        { field_key: `slot_down_${day2}`, field_label: `${label2} 回程時段`, options: ['中午', '下午'] },
      ];
      for (const spec of specs) {
        await adminPost('event_fields', {
          event_id: SEED.eventSlot, field_key: spec.field_key, field_label: spec.field_label,
          field_type: 'radio', options: spec.options, required: false, sort_order: -100,
        });
      }
      await adminPost('event_fields', {
        event_id: SEED.eventSlot, field_key: 'is_lodging', field_label: '是否掛單（中間留宿）',
        field_type: 'boolean', options: [], required: true, sort_order: -1,
      });

      const rows = await adminGet(`event_fields?event_id=eq.${SEED.eventSlot}&select=field_key,field_label,field_type,options&order=sort_order.asc`);
      const slotRows = rows.filter(r => /^slot_(up|down)_\d{4}-\d{2}-\d{2}$/.test(r.field_key));
      assertEqual(slotRows.length, 4, 'slot_up/slot_down 欄位數量');
      const up1 = rows.find(r => r.field_key === `slot_up_${day1}`);
      assertEqual(up1.field_label, `${label1} 去程時段`, 'day1 去程 field_label');
      assertEqual(up1.options, ['上午', '中午'], 'day1 去程 options');
      assertTrue(!rows.some(r => r.field_key === 'attend_dates'), '不應該有 attend_dates 欄位');
      assertTrue(rows.some(r => r.field_key === 'is_lodging'), '應該有 is_lodging 欄位');
    });

    // ── 2) is_lodging 顯示/必填門檻：用 fixture 真實報名答案跑 attendDateHelpers 實際函式 ──
    await test('分時段整合：只填一天的報名（e3），is_lodging 不進必填清單', async () => {
      const fieldRows = await adminGet(`event_fields?event_id=eq.${SEED.eventSlot}&select=field_key,field_label,field_type,required`);
      const regRows = await adminGet(`registrations?registration_id=eq.${SEED.regSlotOneDay}&select=answers`);
      const answers = regRows[0].answers;
      assertEqual(helpers.countDistinctSlotDays(answers), 1, 'e3 只填一天');
      const required = helpers.getVisibleRequiredFields(fieldRows, answers);
      assertTrue(!required.some(f => f.field_key === 'is_lodging'), 'is_lodging 不該出現在必填清單');
    });

    await test('分時段整合：填兩天的報名（e4），is_lodging 進必填清單', async () => {
      const fieldRows = await adminGet(`event_fields?event_id=eq.${SEED.eventSlot}&select=field_key,field_label,field_type,required`);
      const regRows = await adminGet(`registrations?registration_id=eq.${SEED.regSlotTwoDay}&select=answers`);
      const answers = regRows[0].answers;
      assertEqual(helpers.countDistinctSlotDays(answers), 2, 'e4 填兩天');
      const required = helpers.getVisibleRequiredFields(fieldRows, answers);
      assertTrue(required.some(f => f.field_key === 'is_lodging'), 'is_lodging 應該出現在必填清單');
    });

    // ── 3) 最重要：saveCarArrangement／getCarArrangement 的 time_slot NULL 比對 ──
    //    car_assignments.time_slot 是新欄位，這組測試需要 sql/add_multi_slot_transport.sql
    //    已經套用到這個測試專案，沒套用會在第一個 adminPost 就丟出 42703 column does not exist。
    await test('分時段整合：不同 timeSlot 存兩筆排車，彼此不互相污染（time_slot NULL 比對風險點）', async () => {
      // 清乾淨這個活動 direction=up 的既有車輛（含 seed.sql 灌的 e5），重新灌三筆：
      // A：time_slot=上午、B：time_slot=中午、C：time_slot=NULL（模擬非分時段的存法）
      await adminDelete(`car_assignments?event_id=eq.${SEED.eventSlot}&direction=eq.up`);
      await adminPost('car_assignments', {
        event_id: SEED.eventSlot, car_name: 'A-上午', seats: 20, car_type: 'large',
        direction: 'up', service_date: day1, time_slot: '上午',
      });
      await adminPost('car_assignments', {
        event_id: SEED.eventSlot, car_name: 'B-中午', seats: 20, car_type: 'large',
        direction: 'up', service_date: day1, time_slot: '中午',
      });
      await adminPost('car_assignments', {
        event_id: SEED.eventSlot, car_name: 'C-無時段', seats: 20, car_type: 'large',
        direction: 'up', service_date: day1, time_slot: null,
      });

      // getCarArrangement 的等效查詢：time_slot=null 用 is.null，其餘用 eq.xxx（不能用 eq.null）
      const amRows = await adminGet(`car_assignments?event_id=eq.${SEED.eventSlot}&direction=eq.up&service_date=eq.${day1}&time_slot=eq.${encodeURIComponent('上午')}&select=car_name,time_slot`);
      assertEqual(amRows.map(r => r.car_name), ['A-上午'], 'time_slot=上午 應該只查到 A');
      const noonRows = await adminGet(`car_assignments?event_id=eq.${SEED.eventSlot}&direction=eq.up&service_date=eq.${day1}&time_slot=eq.${encodeURIComponent('中午')}&select=car_name,time_slot`);
      assertEqual(noonRows.map(r => r.car_name), ['B-中午'], 'time_slot=中午 應該只查到 B');
      const nullRows = await adminGet(`car_assignments?event_id=eq.${SEED.eventSlot}&direction=eq.up&service_date=eq.${day1}&time_slot=is.null&select=car_name,time_slot`);
      assertEqual(nullRows.map(r => r.car_name), ['C-無時段'], 'time_slot IS NULL 應該只查到 C（不能混到 A/B）');

      // saveCarArrangement 的等效刪除：只刪 time_slot=上午 那筆，B／C 不能被波及
      // （若誤用 time_slot = $1 而非 IS NOT DISTINCT FROM／is./eq. 分流寫法，這步最容易錯）
      await adminDelete(`car_assignments?event_id=eq.${SEED.eventSlot}&direction=eq.up&service_date=eq.${day1}&time_slot=eq.${encodeURIComponent('上午')}`);
      const afterDelete = await adminGet(`car_assignments?event_id=eq.${SEED.eventSlot}&direction=eq.up&service_date=eq.${day1}&select=car_name,time_slot&order=car_name.asc`);
      assertEqual(afterDelete.map(r => r.car_name).sort(), ['B-中午', 'C-無時段'], '刪 time_slot=上午 後應該只剩 B 和 C，不能誤刪或漏刪');
    });

    // ── 4) cleanupOppositeMultiDayFields：切換模式後舊欄位要被清掉 ──
    await test('分時段整合：cleanupOppositeMultiDayFields(useSlotMode=false) 清掉 slot_up/slot_down，保留 is_lodging', async () => {
      const allFields = await adminGet(`event_fields?event_id=eq.${SEED.eventSlot}&select=field_id,field_key`);
      const staleIds = allFields.filter(f => /^slot_(up|down)_\d{4}-\d{2}-\d{2}$/.test(f.field_key)).map(f => f.field_id);
      assertTrue(staleIds.length > 0, '切換前應該還有 slot_up/slot_down 欄位可清（若這裡是 0，代表前面 syncTimeSlotFields 那項測試沒先跑過）');
      await adminDelete(`event_fields?field_id=in.(${staleIds.join(',')})`);

      const afterRows = await adminGet(`event_fields?event_id=eq.${SEED.eventSlot}&select=field_key`);
      assertTrue(!afterRows.some(r => /^slot_(up|down)_\d{4}-\d{2}-\d{2}$/.test(r.field_key)), 'slot_up/slot_down 欄位應該都被刪掉');
      assertTrue(afterRows.some(r => r.field_key === 'is_lodging'), 'is_lodging 不屬於分時段專屬欄位，不該被這支函式刪掉');
    });

    await test('分時段整合：cleanupOppositeMultiDayFields(useSlotMode=true) 清掉 attend_dates', async () => {
      await adminPost('event_fields', {
        event_id: SEED.eventSlot, field_key: 'attend_dates', field_label: '參加日期',
        field_type: 'checkbox', options: [day1, day2], required: true, sort_order: -2,
      });
      await adminDelete(`event_fields?event_id=eq.${SEED.eventSlot}&field_key=eq.attend_dates`);
      const afterRows = await adminGet(`event_fields?event_id=eq.${SEED.eventSlot}&select=field_key`);
      assertTrue(!afterRows.some(r => r.field_key === 'attend_dates'), 'attend_dates 欄位應該被刪掉');
    });
  }

  console.log('');
  console.log('=== 結果：' + pass + ' 過、' + fail + ' 沒過 ===');
  if (fail > 0) {
    console.log('（有測試沒過，先不要把對應的 SQL 貼到正式環境，回報給 Claude 一起看）');
    console.log('（若一開始就整批失敗，先確認 seed.sql 有沒有貼過、或是不是要重貼一次讓資料重置）');
  }
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => {
  console.error('測試腳本本身出錯：', e);
  process.exit(1);
});
