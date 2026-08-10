/**
 * Kiểm luồng lưu file của BẢN ĐÓNG GÓI THẬT.
 *
 * Vì sao phải chạy đúng file .exe: hai lần sửa trước đều "đạt" ở bài kiểm giả lập rồi
 * vẫn hỏng ngoài đời, do bài kiểm thay mất chính thứ bị hỏng.
 *   - Lần 1: `item.setSaveDialogOptions()` — hộp thoại không hiện, không file nào ra.
 *   - Lần 2: `dialog.showSaveDialogSync()` trong `will-download` — treo tiến trình main,
 *     file kẹt lại dạng `.tmp` trong Downloads.
 * Bài kiểm này chạy exe thật, bấm đúng đường mà nút "Tải Word" đi, rồi soi đĩa.
 *
 * Hai phép kiểm:
 *   A. Đặt MV_TEST_SAVE_DIR -> bỏ qua hộp thoại, file phải ghi ra đúng thư mục đó, đúng
 *      từng byte. Chứng minh cả chuỗi renderer -> preload -> IPC -> ghi đĩa chạy thật.
 *   B. Không đặt biến -> hộp thoại lưu THẬT phải mở ra (đếm cửa sổ lớp #32770 của tiến
 *      trình MathVision). Chứng minh người dùng thật sự được hỏi chỗ lưu.
 *
 * Usage: node scripts/verify-download.mjs [đường-dẫn-exe]
 *        (không truyền thì tự dùng release-new/ hoặc release/)
 */

import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const GREEN = (s) => `\x1b[32m${s}\x1b[0m`;
const RED = (s) => `\x1b[31m${s}\x1b[0m`;
const DIM = (s) => `\x1b[2m${s}\x1b[0m`;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 9411;
const PAYLOAD = 'X'.repeat(4321);

function findExe() {
  if (process.argv[2]) return path.resolve(process.argv[2]);
  for (const d of ['release-new', 'release']) {
    const p = path.join(root, d, 'MathVision-1.0.0.exe');
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Đếm cửa sổ hộp thoại (lớp #32770) thuộc tiến trình MathVision. */
function countDialogWindows() {
  const ps = `
Add-Type @"
using System;using System.Text;using System.Runtime.InteropServices;
public class W {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  public delegate bool EnumProc(IntPtr h, IntPtr p);
}
"@
$pids = @(Get-Process -Name MathVision -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
$found = 0
$cb = [W+EnumProc]{ param($h,$p)
  $sb = New-Object System.Text.StringBuilder 256
  [void][W]::GetClassName($h, $sb, 256)
  if ($sb.ToString() -eq "#32770" -and [W]::IsWindowVisible($h)) {
    $out = 0; [void][W]::GetWindowThreadProcessId($h, [ref]$out)
    if ($pids -contains [int]$out) { $script:found++ }
  }
  return $true
}
[void][W]::EnumWindows($cb, [IntPtr]::Zero)
Write-Output $found`;
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command', ps], {
      encoding: 'utf8',
      timeout: 30000,
    });
    return parseInt(out.trim(), 10) || 0;
  } catch {
    return -1;
  }
}

function killApp() {
  try {
    execFileSync('taskkill', ['/F', '/IM', 'MathVision.exe'], { stdio: 'ignore' });
  } catch {
    /* không chạy thì thôi */
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

/** Bật app, chờ CDP sẵn sàng. */
async function launch(exe, env) {
  killApp();
  const child = spawn(exe, [`--remote-debugging-port=${PORT}`], {
    env: { ...process.env, ...env },
    stdio: 'ignore',
  });
  for (let i = 0; i < 60; i++) {
    await wait(500);
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      if (list.some((t) => t.type === 'page')) return child;
    } catch {
      /* chưa mở cổng */
    }
  }
  throw new Error('app không lên trong 30 giây');
}

/** Gọi ĐÚNG cầu nối mà nút Tải Word dùng. */
const SAVE_EXPR = `(async () => {
  if (!window.mathvision || !window.mathvision.saveFile) return 'KHONG-CO-CAU-NOI';
  const bytes = new TextEncoder().encode(${JSON.stringify(PAYLOAD)});
  const r = await window.mathvision.saveFile('kiem-tra.docx', bytes);
  return JSON.stringify(r);
})()`;

const exe = findExe();
console.log('=== Lưu file trong bản đóng gói ===');
if (!exe) {
  console.log(`${RED('BỎ QUA')} chưa có file exe — chạy "npm run electron:build" trước.`);
  process.exit(0);
}
console.log(DIM(`exe: ${exe}`));

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-save-'));
const checks = [];
let child = null;

try {
  // ── A. Ghi file thật (bỏ qua hộp thoại bằng biến môi trường dành cho kiểm thử) ──
  child = await launch(exe, { MV_TEST_SAVE_DIR: outDir });
  const raw = await cdpEval(SAVE_EXPR);
  checks.push(['giao diện thấy cầu nối window.mathvision', raw !== 'KHONG-CO-CAU-NOI']);

  let res = {};
  try {
    res = JSON.parse(raw ?? '{}');
  } catch {
    /* raw không phải JSON */
  }
  checks.push(['lưu báo thành công', res.ok === true]);

  await wait(500);
  const saved = path.join(outDir, 'kiem-tra.docx');
  checks.push(['file có thật trên đĩa', fs.existsSync(saved)]);
  checks.push([
    'nội dung đúng từng byte',
    fs.existsSync(saved) && fs.readFileSync(saved, 'utf8') === PAYLOAD,
  ]);
  killApp();
  await wait(800);

  // ── B. Hộp thoại lưu THẬT có mở ra không ──
  child = await launch(exe, {});
  const dialogsBefore = countDialogWindows();
  void cdpEval(SAVE_EXPR); // không chờ: hộp thoại sẽ giữ promise cho tới khi có người bấm
  await wait(4000);
  const dialogsAfter = countDialogWindows();
  checks.push([
    'hộp thoại chọn thư mục thật sự mở ra',
    dialogsAfter > dialogsBefore && dialogsAfter > 0,
  ]);
} catch (err) {
  console.log(`  ${RED('LỖI')} ${err.message}`);
  checks.push(['chạy được bài kiểm', false]);
} finally {
  killApp();
  try {
    if (child) child.kill();
  } catch {
    /* thôi */
  }
  fs.rmSync(outDir, { recursive: true, force: true });
}

let ok = 0;
for (const [name, pass] of checks) {
  if (pass) ok++;
  else console.log(`  ${RED('FAIL')} ${name}`);
}
console.log(`${ok === checks.length ? GREEN('PASS') : RED('FAIL')}  ${ok}/${checks.length} tiêu chí`);
process.exit(ok === checks.length ? 0 : 2);
