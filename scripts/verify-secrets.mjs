/**
 * Kiểm kho khoá của BẢN ĐÓNG GÓI.
 *
 * Phép kiểm quan trọng nhất không phải "đọc lại được key" mà là **soi thẳng `secrets.json` từ
 * Node và khẳng định trong đó KHÔNG có chuỗi key**. Chỉ có phép đó mới chứng minh là đã mã
 * hoá thật; "ghi vào rồi đọc ra khớp" thì bản lưu chữ thường cũng qua.
 *
 * Chạy hai lần: một lần bình thường (kỳ vọng `safeStorage` vì Windows có DPAPI), một lần với
 * `MV_TEST_NO_SAFE_STORAGE=1` để nghiệm thu đường "máy không có kho khoá" — đường đó phải
 * BÁO THẬT là đang lưu chữ thường chứ không giả vờ đã mã hoá.
 *
 * Usage: node scripts/verify-secrets.mjs [đường-dẫn-exe]
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { DIM, cdpEval, findExe, killApp, launch, report, wait } from './lib/appDriver.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 9413;
const PROBE_KEY = 'AIzaTEST-not-a-real-key-1234567890';
const SECRETS = path.join(os.homedir(), 'AppData', 'Roaming', 'MathVision', 'secrets.json');

const exe = findExe(root, process.argv[2]);
console.log('=== Kho khoá của bản đóng gói ===');
if (!exe) {
  console.log(`${DIM('BỎ QUA')} chưa có bản build — chạy "npm run electron:build" trước.`);
  process.exit(0);
}
console.log(DIM(`exe: ${exe}`));
console.log(DIM(`secrets: ${SECRETS}`));

const ROUND_TRIP = `(async () => {
  const b = window.mathvision;
  if (!b || typeof b.setApiKey !== 'function') return JSON.stringify({ bridge: false });
  const out = { bridge: true, fns: ['getApiKey','setApiKey','clearApiKey'].filter((k) => typeof b[k] === 'function') };
  await b.setApiKey(${JSON.stringify(PROBE_KEY)}, ['gemini-3.6-flash']);
  out.afterSet = await b.getApiKey();
  return JSON.stringify(out);
})()`;

const AFTER_CLEAR = `(async () => {
  await window.mathvision.clearApiKey();
  return JSON.stringify(await window.mathvision.getApiKey());
})()`;

const checks = [];
let child = null;

/** Một lượt: bật app, ghi key, soi file, xoá key, soi lại. */
async function round(label, env, expectEnc) {
  try {
    fs.rmSync(SECRETS, { force: true });
  } catch {
    /* chưa có thì thôi */
  }

  child = await launch(exe, PORT, env);
  const info = JSON.parse((await cdpEval(PORT, ROUND_TRIP)) ?? '{}');

  checks.push([`${label}: giao diện thấy cầu nối kho khoá`, info.bridge === true]);
  checks.push([
    `${label}: cầu nối đủ 3 hàm`,
    Array.isArray(info.fns) && info.fns.length === 3,
    Array.isArray(info.fns) ? info.fns.join(', ') : '',
  ]);
  checks.push([
    `${label}: đọc lại đúng key vừa ghi`,
    info.afterSet?.key === PROBE_KEY,
    `nhận ${JSON.stringify(info.afterSet?.key)}`,
  ]);
  checks.push([
    `${label}: enc = ${expectEnc}`,
    info.afterSet?.enc === expectEnc,
    `nhận ${info.afterSet?.enc}`,
  ]);
  checks.push([`${label}: khôi phục cả chuỗi model`, info.afterSet?.models?.[0] === 'gemini-3.6-flash']);

  // ── Phép kiểm THẬT SỰ quan trọng ────────────────────────────────────────────
  await wait(300);
  const raw = fs.existsSync(SECRETS) ? fs.readFileSync(SECRETS, 'utf8') : '';
  checks.push([`${label}: có file secrets.json`, raw.length > 0]);
  if (expectEnc === 'safeStorage') {
    checks.push([
      `${label}: secrets.json KHÔNG chứa key dạng đọc được`,
      raw.length > 0 && !raw.includes(PROBE_KEY),
      raw.includes(PROBE_KEY) ? 'key nằm nguyên văn trong file!' : '',
    ]);
  } else {
    // Đường plain phải TRUNG THỰC: key nằm chữ thường và enc nói rõ là 'plain'.
    checks.push([
      `${label}: thừa nhận lưu chữ thường (không giả vờ đã mã hoá)`,
      raw.includes(PROBE_KEY) && /"enc":\s*"plain"/.test(raw),
    ]);
  }

  const cleared = JSON.parse((await cdpEval(PORT, AFTER_CLEAR)) ?? '{}');
  checks.push([`${label}: xoá key -> enc = none`, cleared.enc === 'none', `nhận ${cleared.enc}`]);
  checks.push([`${label}: xoá key -> key rỗng`, cleared.key === '']);

  const after = fs.existsSync(SECRETS) ? fs.readFileSync(SECRETS, 'utf8') : '';
  checks.push([`${label}: sau khi xoá, file không còn dấu vết key`, !after.includes(PROBE_KEY)]);

  await killApp();
  try {
    child?.kill();
  } catch {
    /* thôi */
  }
  child = null;
}

try {
  await round('mã hoá', {}, 'safeStorage');
  // Không có cách nào làm DPAPI fail trên Windows, nên dùng cờ chỉ-để-test, cùng tinh thần
  // MV_TEST_SAVE_DIR.
  await round('không có kho khoá', { MV_TEST_NO_SAFE_STORAGE: '1' }, 'plain');

  // Nâng cấp lại: mục 'plain' còn trên đĩa, mở app KHÔNG có cờ thì phải tự mã hoá lại.
  fs.writeFileSync(
    SECRETS,
    JSON.stringify({ version: 1, apiKey: { enc: 'plain', value: PROBE_KEY } }, null, 2),
    'utf8',
  );
  child = await launch(exe, PORT, {});
  const up = JSON.parse(
    (await cdpEval(PORT, '(async () => JSON.stringify(await window.mathvision.getApiKey()))()')) ??
      '{}',
  );
  checks.push(['tự nâng cấp: plain -> safeStorage khi máy có kho khoá', up.enc === 'safeStorage', `nhận ${up.enc}`]);
  checks.push(['tự nâng cấp: vẫn đọc đúng key', up.key === PROBE_KEY]);
  await wait(300);
  const upRaw = fs.readFileSync(SECRETS, 'utf8');
  checks.push(['tự nâng cấp: file không còn key đọc được', !upRaw.includes(PROBE_KEY)]);
} catch (err) {
  console.log(`  LỖI ${err.message}`);
  checks.push(['chạy được bài kiểm', false, err.message]);
} finally {
  await killApp();
  try {
    child?.kill();
  } catch {
    /* thôi */
  }
  try {
    fs.rmSync(SECRETS, { force: true });
  } catch {
    /* thôi */
  }
}

process.exit(report(checks));
