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
const { URL } = require('url');

const CFG = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const SUPABASE_URL = CFG.SUPABASE_URL;
const SUPABASE_ANON_KEY = CFG.SUPABASE_ANON_KEY;

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
  tokenHeadLeader: 'TEST_HEAD_LEADER_TOKEN',
  tokenChore: 'TEST_CHORE_TOKEN',
};

// ── 共用：直接呼叫 PostgREST table endpoint（測 RLS 用，不是走 RPC）──
function restRequest(method, tablePathWithQuery, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(SUPABASE_URL + '/rest/v1/' + tablePathWithQuery);
    const bodyBuf = body !== undefined ? Buffer.from(JSON.stringify(body), 'utf8') : null;
    const headers = {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
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
