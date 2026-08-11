/**
 * Bật bản đóng gói THẬT rồi chạy mã trong renderer qua CDP.
 *
 * Dùng bởi `verify-secrets.mjs`. `verify-download.mjs` và `verify-update.mjs` vẫn còn bản
 * copy riêng của mấy hàm này — chuyển chúng sang đây sau khi có bản build để chạy lại được
 * (sửa harness mà không chạy được ngay thì không khác gì sửa mù).
 *
 * Cơ chế lắt nhắt nên đáng tách: chờ cổng CDP mở, và đợi tiến trình cũ thoát HẲN vì app giữ
 * single-instance lock.
 *
 * Vì sao phải chạy exe thật chứ không giả lập: hai lần sửa luồng lưu file trước đây đều
 * "đạt" ở bài kiểm giả lập rồi vẫn hỏng ngoài đời, do bài kiểm thay mất chính thứ bị hỏng.
 */

import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Đường dẫn bản portable của ĐÚNG version trong package.json. */
export function findExe(root, argvPath) {
  if (argvPath) return path.resolve(argvPath);
  // Đọc version từ package.json chứ đừng ghim số — ghim "1.0.0" thì mọi bản sau đều lặng lẽ
  // BỎ QUA và tưởng là pass.
  const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  for (const d of ['release-new', 'release']) {
    // Chỉ bản portable chạy trực tiếp được; bản Setup là bộ cài, không phải app.
    const p = path.join(root, d, `MathVision-${version}.exe`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Tắt app rồi ĐỢI tiến trình biến mất thật.
 *
 * Từ 1.1.0 app giữ single-instance lock (bản cài NSIS cần, để lần mở lại sau khi cập nhật
 * không chồng lên tiến trình cũ). Bật bản mới khi bản cũ chưa thoát hẳn thì bản mới lấy
 * không được lock và tự quit — harness sẽ hỏng thất thường chứ không phải do lỗi thật.
 */
export async function killApp() {
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
    await wait(250);
  }
}

/** Chạy một biểu thức trong renderer, chờ promise, trả giá trị. */
export async function cdpEval(port, expression, timeoutMs = 15000) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
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
    setTimeout(() => resolve({ timeout: true }), timeoutMs);
  });
  ws.close();
  return reply?.result?.result?.value;
}

/** Bật app, chờ CDP sẵn sàng. Trả tiến trình con để bên gọi kill. */
export async function launch(exe, port, env = {}) {
  await killApp();
  const child = spawn(exe, [`--remote-debugging-port=${port}`], {
    env: { ...process.env, ...env },
    stdio: 'ignore',
  });
  for (let i = 0; i < 60; i++) {
    await wait(500);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      if (list.some((t) => t.type === 'page')) return child;
    } catch {
      /* chưa mở cổng */
    }
  }
  throw new Error('app không lên trong 30 giây');
}

export const GREEN = (s) => `\x1b[32m${s}\x1b[0m`;
export const RED = (s) => `\x1b[31m${s}\x1b[0m`;
export const DIM = (s) => `\x1b[2m${s}\x1b[0m`;

/** In bảng kết quả và trả mã thoát. */
export function report(checks) {
  let ok = 0;
  for (const [name, pass, detail] of checks) {
    if (pass) ok++;
    else console.log(`  ${RED('FAIL')} ${name}${detail ? ` — ${detail}` : ''}`);
  }
  console.log(
    `${ok === checks.length ? GREEN('PASS') : RED('FAIL')}  ${ok}/${checks.length} tiêu chí`,
  );
  return ok === checks.length ? 0 : 2;
}
