/**
 * Kiểm luồng tải file của bản đóng gói: bấm Tải thì file PHẢI được ghi ra đĩa.
 *
 * Vì sao cần test riêng: bản trước khai `item.setSaveDialogOptions()` rồi tin rằng
 * Electron sẽ tự bung hộp thoại lưu. Thực tế hộp thoại KHÔNG hiện và cũng KHÔNG file nào
 * được ghi — người dùng bấm nút Tải và không có gì xảy ra. Không có bài kiểm nào bắt
 * được vì lỗi nằm ở tiến trình main của Electron, ngoài tầm của mọi harness thuần Node.
 *
 * Cách kiểm: dựng một app Electron thu nhỏ, nạp ĐÚNG hàm setupDownloads trích từ
 * electron/main.cjs, thay hộp thoại lưu bằng bản giả rồi tải thử một blob.
 *
 * Usage: node scripts/verify-download.mjs
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const GREEN = (s) => `\x1b[32m${s}\x1b[0m`;
const RED = (s) => `\x1b[31m${s}\x1b[0m`;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-dl-'));

/** Cắt trọn hàm setupDownloads ra khỏi main.cjs bằng cách đếm ngoặc nhọn. */
function extractHandler() {
  const src = fs.readFileSync(path.join(root, 'electron/main.cjs'), 'utf8');
  const start = src.indexOf('function setupDownloads');
  if (start < 0) throw new Error('không tìm thấy setupDownloads trong electron/main.cjs');
  const rest = src.slice(start);
  let depth = 0;
  let end = 0;
  for (let i = rest.indexOf('{'); i < rest.length; i++) {
    if (rest[i] === '{') depth++;
    else if (rest[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  return (
    "const { app, BrowserWindow, dialog, shell, session } = require('electron');\n" +
    "const fs = require('fs');\nconst path = require('path');\n" +
    rest.slice(0, end) +
    '\nmodule.exports = setupDownloads;\n'
  );
}

fs.writeFileSync(path.join(work, 'handler.cjs'), extractHandler());
fs.writeFileSync(
  path.join(work, 'main.cjs'),
  `const { app, BrowserWindow, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
let calls = 0;
dialog.showSaveDialogSync = (a, b) => {
  calls++;
  return path.join(OUT, path.basename((b ?? a).defaultPath));
};
shell.showItemInFolder = () => {};
const setupDownloads = require(path.join(__dirname, 'handler.cjs'));
app.whenReady().then(() => {
  // Phải gọi SAU khi app sẵn sàng: trước đó session.defaultSession chưa tồn tại.
  setupDownloads();
  const win = new BrowserWindow({ show: false, webPreferences: { webSecurity: false } });
  win.loadURL('data:text/html,<html><body>ok</body></html>');
  win.webContents.once('did-finish-load', async () => {
    await win.webContents.executeJavaScript(
      "const b=new Blob(['x'.repeat(1234)],{type:'application/octet-stream'});" +
      "const a=document.createElement('a');a.href=URL.createObjectURL(b);" +
      "a.download='de-thi.docx';document.body.appendChild(a);a.click();'ok';");
    setTimeout(() => {
      const files = fs.readdirSync(OUT).map((f) => ({ ten: f, bytes: fs.statSync(path.join(OUT, f)).size }));
      console.log('KET_QUA=' + JSON.stringify({ calls, files }));
      app.exit(0);
    }, 2500);
  });
});
`,
);

console.log('=== Luồng tải file (Electron) ===');

// Gọi thẳng binary Electron. Trên Windows + Node 24, spawnSync với `npx.cmd` ném EINVAL
// (siết bảo mật khi chạy file .cmd), còn package `electron` vốn export sẵn đường dẫn exe.
const { default: electronPath } = await import('electron');

let out = '';
try {
  out = execFileSync(electronPath, [path.join(work, 'main.cjs')], {
    cwd: root,
    encoding: 'utf8',
    timeout: 120000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch (err) {
  out = String(err.stdout ?? '') + String(err.stderr ?? '');
}

const m = out.match(/KET_QUA=(\{.*\})/);
if (!m) {
  console.log(`${RED('FAIL')}  không chạy được app kiểm thử`);
  console.log(out.split('\n').slice(-5).join('\n'));
  fs.rmSync(work, { recursive: true, force: true });
  process.exit(2);
}

const res = JSON.parse(m[1]);
const checks = [
  ['hộp thoại lưu được gọi đúng 1 lần', res.calls === 1],
  ['file được ghi ra đĩa', res.files.length === 1],
  ['file đúng tên đã chọn', res.files[0]?.ten === 'de-thi.docx'],
  ['file có nội dung (1234 byte)', res.files[0]?.bytes === 1234],
];

let ok = 0;
for (const [name, pass] of checks) {
  if (pass) ok++;
  else console.log(`  ${RED('FAIL')} ${name}`);
}
console.log(`${ok === checks.length ? GREEN('PASS') : RED('FAIL')}  ${ok}/${checks.length} tiêu chí`);
fs.rmSync(work, { recursive: true, force: true });
process.exit(ok === checks.length ? 0 : 2);
