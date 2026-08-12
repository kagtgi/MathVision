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

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
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

console.log('=== Luồng cập nhật của bản đóng gói ===');

// ─── Phần THUẦN: chạy kể cả khi chưa build ──────────────────────────────────
//
// Hai hàm dưới đây quyết định app portable TẢI FILE NÀO và có CHẠY nó hay không. Sai chỗ nào
// cũng hỏng im lặng theo kiểu tệ nhất: chọn nhầm asset là tải bản CÀI rồi chạy như bản portable;
// đọc nhầm hash là hoặc chặn oan một file lành, hoặc tệ hơn — chạy một file chưa đối chiếu.

const { parseSha256, PORTABLE_ASSET, isNewer, swapCommand, encodeCommand } = await import(
  '../electron/updater.cjs'
).then((m) => m.default ?? m);

const SUMS = `${'a'.repeat(64)}  MathVision-1.3.0.exe
${'b'.repeat(64)}  MathVision-Setup.exe
`;

const pure = [
  ['chọn đúng file portable', PORTABLE_ASSET.test('MathVision-1.3.0.exe')],
  ['KHÔNG chọn nhầm bản cài', !PORTABLE_ASSET.test('MathVision-Setup.exe')],
  ['KHÔNG chọn nhầm bản cài có số', !PORTABLE_ASSET.test('MathVision-Setup-1.2.0.exe')],
  ['KHÔNG chọn nhầm blockmap', !PORTABLE_ASSET.test('MathVision-1.3.0.exe.blockmap')],
  ['đọc đúng hash của portable', parseSha256(SUMS, 'MathVision-1.3.0.exe') === 'a'.repeat(64)],
  ['đọc đúng hash của bản cài', parseSha256(SUMS, 'MathVision-Setup.exe') === 'b'.repeat(64)],
  // Không tìm được dòng thì PHẢI trả rỗng để bên gọi huỷ — trả bừa là chạy file chưa kiểm.
  ['không có dòng khớp -> chuỗi rỗng', parseSha256(SUMS, 'MathVision-9.9.9.exe') === ''],
  ['hash méo -> chuỗi rỗng', parseSha256(`zz  MathVision-1.3.0.exe`, 'MathVision-1.3.0.exe') === ''],
  ['file rỗng -> chuỗi rỗng', parseSha256('', 'MathVision-1.3.0.exe') === ''],
  ['1.3.0 mới hơn 1.2.0', isNewer('1.3.0', '1.2.0')],
  ['1.3.0 không mới hơn chính nó', !isNewer('1.3.0', '1.3.0')],
];

let pureOk = 0;
for (const [name, pass] of pure) {
  if (pass) pureOk++;
  else console.log(`  ${RED('FAIL')} ${name}`);
}
console.log(
  `${pureOk === pure.length ? GREEN('PASS') : RED('FAIL')}  ${pureOk}/${pure.length} tiêu chí chọn file + đối chiếu hash`,
);
if (pureOk !== pure.length) process.exit(2);

// ─── Thay file THẬT, trên một exe ĐANG CHẠY ─────────────────────────────────
//
// Đây là ca đắt nhất và cũng là ca duy nhất đáng tin. Bản portable tự cập nhật bằng cách giao
// cho PowerShell một lệnh chạy sau khi app thoát; toàn bộ tính năng đứng hay đổ ở lệnh đó, mà
// đọc mã thì không thấy được. Nên: chép `ping.exe` thành "bản cũ", CHẠY nó lên (file exe đang
// chạy bị Windows khoá — đúng cảnh thật), rồi bắt lệnh thay file làm việc của nó.
//
// Điều phải chứng minh không chỉ là "đổi được file", mà là **hỏng thì không mất app**: bản mới
// vào chỗ trước, bản cũ dọn sau.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-swap-'));
const SYS = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
const swap = [];

function runPs(src) {
  return spawnSync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-EncodedCommand',
    encodeCommand(src),
  ]);
}

try {
  // Đường dẫn CÓ DẤU TIẾNG VIỆT và có dấu cách — đúng cảnh `C:\Users\Nguyễn Văn A\Downloads`,
  // và chính là chỗ script `.cmd` bản trước hỏng vì bảng mã.
  const dir = path.join(tmp, 'Tệp tải về của Nguyễn');
  fs.mkdirSync(dir);
  const old = path.join(dir, 'MathVision-1.2.0.exe');
  const dest = path.join(dir, 'MathVision-1.3.0.exe');
  const dl = `${dest}.download`;
  fs.copyFileSync(path.join(SYS, 'ping.exe'), old);
  fs.writeFileSync(dl, 'BẢN MỚI');

  // Giữ bản cũ trong trạng thái BỊ KHOÁ vài giây, để bắt vòng lặp thử-lại phải thật sự đợi.
  const held = spawn(old, ['-n', '4', '127.0.0.1'], { stdio: 'ignore', detached: true });
  const r = runPs(
    swapCommand({ download: dl, dest, old }).replace(/^Start-Process .*$/m, '# (bỏ bước mở app)'),
  );
  try {
    held.kill();
  } catch {
    /* đã tự thoát */
  }

  swap.push(['lệnh thay file chạy trót lọt', r.status === 0]);
  swap.push(['bản mới vào đúng chỗ', fs.existsSync(dest)]);
  swap.push([
    'bản mới đúng nội dung đã tải',
    fs.existsSync(dest) && fs.readFileSync(dest, 'utf8') === 'BẢN MỚI',
  ]);
  swap.push(['đã dọn bản cũ dù nó bị khoá lúc đầu', !fs.existsSync(old)]);
  swap.push(['không để sót file .download', !fs.existsSync(dl)]);

  // Chép hỏng thì PHẢI còn nguyên bản cũ. Dựng cảnh hỏng bằng cách cho `dl` không tồn tại.
  const dir2 = path.join(tmp, 'hong');
  fs.mkdirSync(dir2);
  const old2 = path.join(dir2, 'MathVision-1.2.0.exe');
  fs.writeFileSync(old2, 'BẢN CŨ');
  const r2 = runPs(
    swapCommand({
      download: path.join(dir2, 'khong-he-co.exe.download'),
      dest: path.join(dir2, 'MathVision-1.3.0.exe'),
      old: old2,
    }),
  );
  swap.push(['chép hỏng thì báo lỗi', r2.status !== 0]);
  swap.push([
    'chép hỏng thì KHÔNG mất bản cũ',
    fs.existsSync(old2) && fs.readFileSync(old2, 'utf8') === 'BẢN CŨ',
  ]);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

let swapOk = 0;
for (const [name, pass] of swap) {
  if (pass) swapOk++;
  else console.log(`  ${RED('FAIL')} ${name}`);
}
console.log(
  `${swapOk === swap.length ? GREEN('PASS') : RED('FAIL')}  ${swapOk}/${swap.length} tiêu chí thay file portable (chạy thật)`,
);
if (swapOk !== swap.length) process.exit(2);

const buildDir = findBuildDir();
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
  // Tên bộ cài KHÔNG chứa version — đó là điều kiện để link tải trực tiếp trong README
  // (`/releases/latest/download/MathVision-Setup.exe`) không vỡ mỗi lần lên bản.
  checks.push(['có bộ cài MathVision-Setup.exe (tên không có version)', files.includes('MathVision-Setup.exe')]);
  checks.push([
    'tên bộ cài KHÔNG lẫn version',
    !files.some((f) => /^MathVision-Setup-\d/.test(f)),
    files.filter((f) => f.startsWith('MathVision-Setup')).join(', '),
  ]);
  checks.push([
    'latest.yml trỏ đúng tên không version',
    /url:\s*MathVision-Setup\.exe/.test(fs.readFileSync(path.join(buildDir, 'latest.yml'), 'utf8')),
  ]);
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
