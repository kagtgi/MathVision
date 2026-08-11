/**
 * Kiểm luồng cập nhật của BẢN ĐÓNG GÓI.
 *
 * Ba thứ dưới đây đều là loại lỗi "chạy dev thì được, bản đóng gói thì chết", nên phải soi
 * chính sản phẩm build ra chứ không phải mã nguồn:
 *
 *   A. `electron-updater` có thật trong app.asar. `build.files` có dòng `!node_modules/**`
 *      nên nếu không mở lại đúng nhánh phụ thuộc thì module bị loại khỏi gói và app chỉ
 *      chết lúc gọi require — không có cảnh báo nào ở bước build.
 *   B. `resources/app-update.yml` có tồn tại và trỏ đúng repo. Thiếu key `publish` trong
 *      package.json thì electron-builder không sinh file này, và autoUpdater sẽ ném lỗi
 *      "provider is not specified" ngay lần kiểm đầu.
 *   C. `latest.yml` được sinh cạnh artifact. Đây là file duy nhất electron-updater đi tìm
 *      trên feed; target `portable` không sinh nó, chỉ `nsis` mới có.
 *
 * Cộng một phép kiểm chạy thật: bật app lên, soi cầu nối `window.mathvision` có đủ các hàm
 * cập nhật và `getVersion()` trả đúng số của package.json.
 *
 * Usage: node scripts/verify-update.mjs
 */

import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const GREEN = (s) => `\x1b[32m${s}\x1b[0m`;
const RED = (s) => `\x1b[31m${s}\x1b[0m`;
const DIM = (s) => `\x1b[2m${s}\x1b[0m`;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 9412;
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Thư mục build gần nhất có chứa bản portable của đúng version này. */
function findBuildDir() {
  for (const d of ['release-new', 'release']) {
    if (fs.existsSync(path.join(root, d, `MathVision-${version}.exe`))) return path.join(root, d);
  }
  return null;
}

const buildDir = findBuildDir();
console.log('=== Luồng cập nhật của bản đóng gói ===');
if (!buildDir) {
  console.log(
    `${DIM('BỎ QUA')} chưa có bản build ${version} — chạy "npm run electron:build" trước.`,
  );
  process.exit(0);
}
console.log(DIM(`build: ${buildDir}`));

const checks = [];
const unpacked = path.join(buildDir, 'win-unpacked');
const resources = path.join(unpacked, 'resources');

// ── A. electron-updater nằm trong asar ───────────────────────────────────────
{
  const asar = path.join(resources, 'app.asar');
  let listing = '';
  if (fs.existsSync(asar)) {
    try {
      listing = execFileSync('npx', ['--yes', 'asar', 'list', asar], {
        encoding: 'utf8',
        cwd: root,
        shell: true,
        timeout: 120000,
      });
    } catch (err) {
      console.log(`  ${DIM('không đọc được asar')} ${err.message}`);
    }
  }
  checks.push(['có app.asar', fs.existsSync(asar)]);
  checks.push([
    'electron-updater nằm trong asar (dòng "!node_modules/**" không loại nó ra)',
    /node_modules[\\/]electron-updater[\\/]/.test(listing),
  ]);
  checks.push([
    'kèm cả builder-util-runtime (phụ thuộc bắt buộc)',
    /node_modules[\\/]builder-util-runtime[\\/]/.test(listing),
  ]);
}

// ── B. app-update.yml ────────────────────────────────────────────────────────
{
  const feed = path.join(resources, 'app-update.yml');
  const text = fs.existsSync(feed) ? fs.readFileSync(feed, 'utf8') : '';
  checks.push(['có resources/app-update.yml', fs.existsSync(feed)]);
  checks.push(['app-update.yml dùng provider github', /provider:\s*github/.test(text)]);
  checks.push([
    'app-update.yml trỏ đúng kagtgi/MathVision',
    /owner:\s*kagtgi/.test(text) && /repo:\s*MathVision/.test(text),
  ]);
}

// ── C. Artifact cho feed ─────────────────────────────────────────────────────
{
  const files = fs.readdirSync(buildDir);
  checks.push(['có latest.yml (file electron-updater đi tìm)', files.includes('latest.yml')]);
  checks.push([`có bộ cài MathVision-Setup-${version}.exe`, files.includes(`MathVision-Setup-${version}.exe`)]);
  checks.push([`vẫn có bản portable MathVision-${version}.exe`, files.includes(`MathVision-${version}.exe`)]);
  checks.push(['có .blockmap cho cập nhật vi phân', files.some((f) => f.endsWith('.blockmap'))]);
}

// ── D. Cầu nối trong app thật ────────────────────────────────────────────────
/** Tắt app rồi đợi tiến trình biến mất — app giữ single-instance lock, xem verify-download.mjs. */
function killApp() {
  try {
    execFileSync('taskkill', ['/F', '/IM', 'MathVision.exe'], { stdio: 'ignore' });
  } catch {
    /* không chạy thì thôi */
  }
  for (let i = 0; i < 20; i++) {
    try {
      const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq MathVision.exe'], {
        encoding: 'utf8',
      });
      if (!/MathVision\.exe/i.test(out)) return;
    } catch {
      return;
    }
    execFileSync('powershell', ['-NoProfile', '-Command', 'Start-Sleep -Milliseconds 250'], {
      stdio: 'ignore',
    });
  }
}

async function cdpEval(expression) {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('không thấy trang nào qua CDP');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  const reply = await new Promise((resolve) => {
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id === 1) resolve(m);
    };
    ws.send(
      JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true },
      }),
    );
    setTimeout(() => resolve({ timeout: true }), 15000);
  });
  ws.close();
  return reply?.result?.result?.value;
}

const BRIDGE_EXPR = `(async () => {
  const b = window.mathvision;
  if (!b) return JSON.stringify({ bridge: false });
  const out = {
    bridge: true,
    fns: ['getVersion','getUpdateState','checkUpdates','applyUpdate','onUpdateState']
      .filter((k) => typeof b[k] === 'function'),
  };
  try { out.version = await b.getVersion(); } catch (e) { out.versionError = String(e); }
  try { out.state = await b.getUpdateState(); } catch (e) { out.stateError = String(e); }
  return JSON.stringify(out);
})()`;

let child = null;
try {
  killApp();
  child = spawn(path.join(buildDir, `MathVision-${version}.exe`), [
    `--remote-debugging-port=${PORT}`,
  ], { env: { ...process.env }, stdio: 'ignore' });
  let up = false;
  for (let i = 0; i < 60; i++) {
    await wait(500);
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      if (list.some((t) => t.type === 'page')) {
        up = true;
        break;
      }
    } catch {
      /* chưa mở cổng */
    }
  }
  if (!up) throw new Error('app không lên trong 30 giây');

  const info = JSON.parse((await cdpEval(BRIDGE_EXPR)) ?? '{}');
  checks.push(['giao diện thấy cầu nối window.mathvision', info.bridge === true]);
  checks.push([
    'cầu nối đủ 5 hàm cập nhật',
    Array.isArray(info.fns) && info.fns.length === 5,
    Array.isArray(info.fns) ? `có ${info.fns.join(', ')}` : '',
  ]);
  checks.push([`getVersion() trả ${version}`, info.version === version, `nhận ${info.version}`]);
  checks.push([
    'getUpdateState() trả về trạng thái, và nhận ra đây là bản portable',
    info.state && typeof info.state === 'object' && info.state.portable === true,
    `nhận ${JSON.stringify(info.state)}`,
  ]);
} catch (err) {
  console.log(`  ${RED('LỖI')} ${err.message}`);
  checks.push(['chạy được app để soi cầu nối', false]);
} finally {
  killApp();
  try {
    if (child) child.kill();
  } catch {
    /* thôi */
  }
}

let ok = 0;
for (const [name, pass, detail] of checks) {
  if (pass) ok++;
  else console.log(`  ${RED('FAIL')} ${name}${detail ? ` — ${detail}` : ''}`);
}
console.log(`${ok === checks.length ? GREEN('PASS') : RED('FAIL')}  ${ok}/${checks.length} tiêu chí`);
process.exit(ok === checks.length ? 0 : 2);
