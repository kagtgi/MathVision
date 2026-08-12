/**
 * Dựng THẬT 47 hình đề thi qua `tikzToImage()`, rồi chấm bằng số đo.
 *
 * CHẠY TAY, KHÔNG vào `verify:ci`. Mỗi lượt dựng cấp 163,8 MB `WebAssembly.Memory` nên phải
 * chạy tuần tự, tổng ~4-6 phút; `verify:ci` là chuỗi `&&` không có `timeout-minutes` và chưa
 * từng bật browser lần nào, đưa vào đó là biến mỗi PR thành cửa 6 phút không chặn trên.
 * Cửa rẻ đứng trước nó là `verify-tikz-corpus.mjs` (thuần, dưới một giây, có trong CI).
 *
 * Chạy khi nào: trước mỗi PR đụng vào `figurePrompts.ts`, `tikzSanitize.ts`, `latexToImage.ts`,
 * hoặc bộ hình. Kết quả là căn cứ để cập nhật `tikzCapabilities.ts`.
 *
 * Cách chạy: node scripts/verify-tikz-render.mjs [--only=dothi] [--keep]
 *   --only=<họ>  chỉ chạy một họ (dothi | bbt | phang | khonggian)
 *   --keep       giữ Vite + Electron sống sau khi xong, để mở trang xem bằng mắt
 *
 * Sản phẩm: demo/tikz-corpus/<id>.png + report.html (demo/ đã gitignore). Repo KHÔNG giữ ảnh
 * đối chứng — chốt bằng số đo, vì không có tiền lệ baseline ảnh và một baseline pixel sẽ vỡ
 * theo mọi thay đổi vô hại của font.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CORPUS, CORPUS_GROUPS } from '../src/devtools/tikzCorpus/cases.ts';
import { judgeCorpusCase } from '../src/devtools/tikzCorpus/judge.ts';

const GREEN = (s) => `\x1b[32m${s}\x1b[0m`;
const RED = (s) => `\x1b[31m${s}\x1b[0m`;
const DIM = (s) => `\x1b[2m${s}\x1b[0m`;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'demo', 'tikz-corpus');
const VITE_PORT = 3007;
/** Dài hơn 30 s timeout nội bộ của `tikzToImage` để phân biệt "hình treo" với "trang chết". */
const CASE_BUDGET_MS = 45_000;
const TOTAL_BUDGET_MS = 12 * 60_000;

const argv = process.argv.slice(2);
const only = (argv.find((a) => a.startsWith('--only=')) ?? '').split('=')[1] || null;
const keep = argv.includes('--keep');

if (only && !CORPUS_GROUPS.includes(only)) {
  console.log(RED(`Không có họ nào tên "${only}". Chọn: ${CORPUS_GROUPS.join(', ')}.`));
  process.exit(2);
}

const expected = only ? CORPUS.filter((c) => c.group === only) : CORPUS;
const byId = new Map(CORPUS.map((c) => [c.id, c]));

// ─── Bồn nhận kết quả ────────────────────────────────────────────────────────

const received = new Map();
/** Kết quả tự kiểm máy dò đè nhãn — xem `selfTestOverlap` trong trang. */
let selfTest = null;
let doneResolve;
const done = new Promise((res) => {
  doneResolve = res;
});

const sink = http.createServer((req, res) => {
  // Trang gửi bằng `text/plain` nên không có preflight; vẫn trả header CORS cho chắc.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }
  let body = '';
  req.on('data', (c) => {
    body += c;
  });
  req.on('end', () => {
    try {
      const data = JSON.parse(body || '{}');
      if (req.url === '/case' && data.id) {
        received.set(data.id, data);
        const n = String(received.size).padStart(2, ' ');
        const mark = data.fails?.length ? RED('x') : GREEN('.');
        process.stdout.write(
          `  ${mark} ${n}/${expected.length} ${data.id}${DIM(` ${data.ms}ms`)}\n`,
        );
      } else if (req.url === '/selftest') {
        selfTest = data;
      } else if (req.url === '/done') {
        doneResolve('done');
      }
    } catch {
      // Gói méo thì bỏ, cuối lượt sẽ tính là ca thiếu.
    }
    res.writeHead(204).end();
  });
});

await new Promise((res) => sink.listen(0, '127.0.0.1', res));
const sinkPort = sink.address().port;

// ─── Vite + Electron ─────────────────────────────────────────────────────────

const children = [];
const kill = () => {
  for (const c of children) {
    try {
      c.kill();
    } catch {
      // Đã chết rồi thì thôi.
    }
  }
};

function spawnQuiet(cmd, args, label) {
  const child = spawn(cmd, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  const log = (buf) => {
    const s = String(buf);
    if (/error|Error|EADDRINUSE|ENOENT/.test(s)) process.stdout.write(DIM(`  [${label}] ${s}`));
  };
  child.stdout.on('data', log);
  child.stderr.on('data', log);
  return child;
}

async function waitForUrl(url, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch {
      // Chưa lên.
    }
    await new Promise((res) => setTimeout(res, 250));
  }
  return false;
}

const pageUrl =
  `http://localhost:${VITE_PORT}/tikz-corpus.html?sink=${sinkPort}` +
  (only ? `&only=${only}` : '');

console.log('=== Dựng thật bộ hình TikZ ===');
console.log(DIM(`  ${expected.length} hình · Vite :${VITE_PORT} · bồn :${sinkPort}`));

// `--strictPort` để cổng bị chiếm thì báo lỗi thay vì lặng lẽ nhảy cổng khác rồi trang 404.
spawnQuiet(
  process.execPath,
  ['node_modules/vite/bin/vite.js', '--port', String(VITE_PORT), '--strictPort'],
  'vite',
);

if (!(await waitForUrl(`http://localhost:${VITE_PORT}/tikz-corpus.html`, 60_000))) {
  console.log(RED('  Vite không lên trong 60 giây.'));
  kill();
  process.exit(2);
}

const electronExe = path.join(
  ROOT,
  'node_modules',
  'electron',
  'dist',
  fs.readFileSync(path.join(ROOT, 'node_modules', 'electron', 'path.txt'), 'utf8').trim(),
);
if (!fs.existsSync(electronExe)) {
  console.log(RED(`  Không thấy Electron ở ${electronExe} — chạy "npm ci" trước.`));
  kill();
  process.exit(2);
}
spawnQuiet(electronExe, ['scripts/lib/corpusMain.cjs', pageUrl], 'electron');

// ─── Đợi ─────────────────────────────────────────────────────────────────────

const budget = Math.min(TOTAL_BUDGET_MS, expected.length * CASE_BUDGET_MS);
const outcome = await Promise.race([
  done,
  new Promise((res) => setTimeout(() => res('timeout'), budget)),
]);

if (!keep) kill();

// ─── Chấm ────────────────────────────────────────────────────────────────────
//
// Driver CHAM LAI tu so do tho, khong tin truong `fails` ma trang gui ve: mot loi trong trang
// se lam moi ca "dat" ma khong ai thay. Trang va driver dung CUNG ham `judgeCorpusCase`.

fs.mkdirSync(OUT_DIR, { recursive: true });

const rows = [];

// Máy dò đè nhãn phải tự chứng minh nó dò được TRƯỚC khi ta tin những con số 0 nó trả về.
// `countLabelOverlaps` có `catch { return 0 }`, nên "sạch" và "hỏng" trông y hệt nhau.
rows.push([
  'tự kiểm máy dò đè nhãn',
  Boolean(selfTest) && selfTest.bad >= 1 && selfTest.good === 0,
  selfTest
    ? `hình cố tình đè ra ${selfTest.bad} (cần >=1), hình đặt đúng ra ${selfTest.good} (cần 0) · ${selfTest.diag ?? ''}`
    : 'trang không gửi kết quả tự kiểm',
]);

for (const c of expected) {
  const r = received.get(c.id);
  if (!r) {
    rows.push([c.id, false, outcome === 'timeout' ? 'quá thời gian, không có kết quả' : 'không nhận được kết quả']);
    continue;
  }
  const fails = judgeCorpusCase(c, r).map((f) =>
    f.includes('nhãn bị nét') && r.overlapLabels?.length
      ? `${f}: ${r.overlapLabels.join(', ')}`
      : f,
  );
  rows.push([c.id, fails.length === 0, fails.join(' | ')]);
  if (r.png) {
    fs.writeFileSync(
      path.join(OUT_DIR, `${c.id}.png`),
      Buffer.from(r.png.replace(/^data:image\/png;base64,/, ''), 'base64'),
    );
  }
}

// ─── Báo cáo cho người xem ───────────────────────────────────────────────────

const reportHtml = [
  '<!doctype html><meta charset="utf-8"><title>Bo hinh TikZ THPT</title>',
  '<style>body{font:13px/1.5 system-ui;margin:24px}h2{margin:24px 0 6px;font-size:14px;' +
    'text-transform:uppercase}table{border-collapse:collapse;width:100%}' +
    'td,th{border-bottom:1px solid #e3e3e3;padding:5px 8px;text-align:left;vertical-align:top}' +
    'tr.bad td{background:#fce8e6}img{max-width:280px;max-height:180px;border:1px solid #e3e3e3}' +
    '.dim{color:#5f6368;font-size:11.5px}.bad-txt{color:#c5221f}</style>',
  `<h1>Bộ hình TikZ theo chương trình THPT</h1><p class="dim">${
    rows.filter((r) => r[1]).length
  }/${rows.length} đạt</p>`,
  ...CORPUS_GROUPS.filter((g) => expected.some((c) => c.group === g)).map((g) => {
    const items = expected
      .filter((c) => c.group === g)
      .map((c) => {
        const r = received.get(c.id);
        const fails = r ? judgeCorpusCase(c, r) : ['không có kết quả'];
        return `<tr class="${fails.length ? 'bad' : ''}"><td><code>${c.id}</code><br>
          <span class="dim">${c.sgk}</span>${
            fails.length ? `<br><span class="bad-txt">${fails.join('<br>')}</span>` : ''
          }</td>
          <td class="dim">${r ? `${r.w}×${r.h} · mực ${(r.ink * 100).toFixed(2)}% · ${r.textNodes} nhãn · vào Word ${r.docxW}×${r.docxH}` : '—'}</td>
          <td>${r?.png ? `<img src="${c.id}.png">` : ''}</td></tr>`;
      })
      .join('');
    return `<h2>${g}</h2><table>${items}</table>`;
  }),
].join('\n');
fs.writeFileSync(path.join(OUT_DIR, 'report.html'), reportHtml);

// Số đo thô, để hiệu chỉnh `expectInk`/`minText` bằng SỐ ĐO thay vì phỏng đoán, và để so hai
// lượt chạy xem renderer có tất định hay không (tất định thì mới siết dải mực được).
fs.writeFileSync(
  path.join(OUT_DIR, 'results.json'),
  JSON.stringify(
    expected.map((c) => {
      const r = received.get(c.id);
      return r
        ? { id: c.id, ink: r.ink, textNodes: r.textNodes, w: r.w, h: r.h, docxH: r.docxH }
        : { id: c.id, missing: true };
    }),
    null,
    2,
  ),
);

// ─── Kết ─────────────────────────────────────────────────────────────────────

let ok = 0;
for (const [name, pass, detail] of rows) {
  if (pass) ok++;
  else console.log(`  ${RED('FAIL')} ${name}${detail ? ` — ${detail}` : ''}`);
}
console.log(DIM(`  ảnh + báo cáo: ${path.relative(ROOT, OUT_DIR)}/report.html`));
if (keep) {
  console.log(DIM(`  --keep: Vite còn sống, mở ${pageUrl.replace(`?sink=${sinkPort}`, '')} để xem`));
} else {
  sink.close();
}
console.log(`${ok === rows.length ? GREEN('PASS') : RED('FAIL')}  ${ok}/${rows.length} hình`);
if (!keep) process.exit(ok === rows.length ? 0 : 2);
