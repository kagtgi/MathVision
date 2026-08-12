/**
 * Đo đường nâng chất hình trên ĐỀ THẬT: cắt hình từ PDF rồi chạy đúng `upgradeFigure` của app.
 *
 * Chạy tay, gọi mạng thật. Đây là thứ trả lời câu hỏi mà `run-real-exam.mjs` KHÔNG trả lời được:
 * hình trong file Word toàn ảnh cắt là vì TikZ kém, hay vì đường TikZ không hề chạy?
 * (`run-real-exam` chạy trong Node nên `tikzToImage` không chạy được — nó luôn ra ảnh cắt, bất kể
 * TikZ tốt hay xấu.)
 *
 * Usage:
 *   node scripts/probe-figure-pipeline.mjs <de.pdf> [--pages N] [--no-gen] [--keep]
 *
 * Khoá đọc từ GEMINI_API_KEY và truyền thẳng cho trang qua query — không in ra, không ghi file.
 */

import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';
import { ocrPage } from '../src/pipeline/ocr.ts';
import { padClampBbox } from '../src/pipeline/figures.ts';
import { buildFigureContexts } from '../src/pipeline/figureContext.ts';
import { isRedrawable } from '../src/utils/figurePrompts.ts';

const GREEN = (s) => `\x1b[32m${s}\x1b[0m`;
const RED = (s) => `\x1b[31m${s}\x1b[0m`;
const DIM = (s) => `\x1b[2m${s}\x1b[0m`;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VITE_PORT = 3008;
/** Ảnh cắt phải nằm dưới `public/` thì Vite mới phục vụ được cho trang. */
const PUB_DIR = path.join(ROOT, 'public', 'probe-figs');

const argv = process.argv.slice(2);
const pdfPath = argv.find((a) => !a.startsWith('--'));
const maxPages = Number(argv.includes('--pages') ? argv[argv.indexOf('--pages') + 1] : 0) || 0;
const allowGen = !argv.includes('--no-gen');
const keep = argv.includes('--keep');
const apiKey = process.env.GEMINI_API_KEY;

if (!pdfPath || !apiKey) {
  console.error('Cần <file.pdf> và biến môi trường GEMINI_API_KEY.');
  process.exit(2);
}

// ─── 1. Dựng ảnh trang + OCR để lấy bbox hình ───────────────────────────────

console.log('=== Đo đường nâng chất hình (gọi mạng thật) ===');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-fig-'));
fs.copyFileSync(pdfPath, path.join(tmp, 'in.pdf'));
const ppmArgs = ['-png', '-r', '150'];
if (maxPages) ppmArgs.push('-f', '1', '-l', String(maxPages));
execFileSync('pdftoppm', [...ppmArgs, path.join(tmp, 'in.pdf'), path.join(tmp, 'p')], {
  stdio: 'pipe',
});
const pageFiles = fs
  .readdirSync(tmp)
  .filter((f) => f.startsWith('p') && f.endsWith('.png'))
  .sort()
  .map((f) => path.join(tmp, f));
console.log(DIM(`  ${pageFiles.length} trang`));

const pageMmds = [];
const jobs = [];
for (const [i, file] of pageFiles.entries()) {
  const res = await ocrPage(apiKey, {
    imageBase64: fs.readFileSync(file).toString('base64'),
    mimeType: 'image/png',
    pageNumber: i + 1,
    totalPages: pageFiles.length,
    prevTail: pageMmds.join('\n\n'),
  });
  pageMmds.push(res.mmd);
  for (const f of res.figures) jobs.push({ id: f.id, page: i, bbox: f.bbox, kind: f.kind });
  console.log(DIM(`  trang ${i + 1}: ${res.figures.length} hình`));
}

const contexts = buildFigureContexts(pageMmds);

// ─── 2. Cắt hình ra public/ ─────────────────────────────────────────────────

fs.rmSync(PUB_DIR, { recursive: true, force: true });
fs.mkdirSync(PUB_DIR, { recursive: true });
// Dọn KỂ CẢ khi script chết giữa chừng: `public/` được Vite copy nguyên vào `dist/`, nên hình đề
// thi còn sót lại sẽ đi thẳng vào bản đóng gói.
process.on('exit', () => {
  if (!keep) fs.rmSync(PUB_DIR, { recursive: true, force: true });
});

const pageJobs = [];
for (const job of jobs) {
  // Chỉ hình VẼ mới đi qua đường nâng chất; ảnh chụp vật thật giữ nguyên (`isRedrawable`).
  if (!isRedrawable(job.kind)) {
    console.log(DIM(`  bỏ ${job.id} (${job.kind}): ảnh chụp vật thật, giữ ảnh gốc`));
    continue;
  }
  const meta = await sharp(pageFiles[job.page]).metadata();
  const rect = padClampBbox(job.bbox, meta.width, meta.height);
  if (!rect) continue;
  const file = `${job.id}.png`;
  await sharp(pageFiles[job.page])
    .extract({ left: rect.x, top: rect.y, width: rect.w, height: rect.h })
    .png()
    .toFile(path.join(PUB_DIR, file));
  const ctx = contexts.get(job.id);
  pageJobs.push({
    id: job.id,
    url: `/probe-figs/${file}`,
    kind: job.kind,
    context: ctx?.text ?? '',
    num: ctx?.num ?? null,
  });
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(DIM(`  cắt ${pageJobs.length} hình vẽ`));
if (!pageJobs.length) {
  console.log(RED('Không có hình vẽ nào để đo.'));
  process.exit(2);
}

// ─── 3. Bồn + Vite + Electron ───────────────────────────────────────────────

const received = [];
let doneResolve;
const done = new Promise((r) => {
  doneResolve = r;
});
let finalLogs = [];

const sink = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    try {
      const d = JSON.parse(body || '{}');
      if (req.url === '/case') {
        received.push(d);
        const mark = d.used === 'crop' ? RED('x') : GREEN('.');
        console.log(`  ${mark} ${received.length}/${pageJobs.length} ${d.id} -> ${d.used}`);
      } else if (req.url === '/done') {
        finalLogs = d.logs ?? [];
        doneResolve('done');
      }
    } catch {
      // gói méo thì bỏ
    }
    res.writeHead(204).end();
  });
});
await new Promise((r) => sink.listen(0, '127.0.0.1', r));
const sinkPort = sink.address().port;

const children = [];
const kill = () => children.forEach((c) => { try { c.kill(); } catch { /* đã chết */ } });
const spawnQuiet = (cmd, args, label) => {
  const ch = spawn(cmd, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(ch);
  const log = (b) => {
    const s = String(b);
    if (/error|Error|EADDRINUSE/.test(s)) process.stdout.write(DIM(`  [${label}] ${s}`));
  };
  ch.stdout.on('data', log);
  ch.stderr.on('data', log);
  return ch;
};

spawnQuiet(
  process.execPath,
  ['node_modules/vite/bin/vite.js', '--port', String(VITE_PORT), '--strictPort'],
  'vite',
);
const t0 = Date.now();
while (Date.now() - t0 < 60_000) {
  try {
    if ((await fetch(`http://localhost:${VITE_PORT}/figure-pipeline.html`)).ok) break;
  } catch {
    // chưa lên
  }
  await new Promise((r) => setTimeout(r, 250));
}

const electronExe = path.join(
  ROOT,
  'node_modules',
  'electron',
  'dist',
  fs.readFileSync(path.join(ROOT, 'node_modules', 'electron', 'path.txt'), 'utf8').trim(),
);
const url =
  `http://localhost:${VITE_PORT}/figure-pipeline.html?sink=${sinkPort}` +
  `&key=${encodeURIComponent(apiKey)}&gen=${allowGen ? 1 : 0}` +
  `&jobs=${encodeURIComponent(JSON.stringify(pageJobs))}`;
spawnQuiet(electronExe, ['scripts/lib/corpusMain.cjs', url], 'electron');

// Mỗi hình: 2-3 lượt gọi TikZ + 1 lượt chấm + có thể 2 lượt sinh ảnh. Cho rộng tay.
const outcome = await Promise.race([
  done,
  new Promise((r) => setTimeout(() => r('timeout'), pageJobs.length * 180_000 + 120_000)),
]);
if (!keep) kill();

// ─── 4. Kết ─────────────────────────────────────────────────────────────────

const count = (k) => received.filter((r) => r.used === k).length;
console.log('');
console.log(`TikZ thắng     ${count('tikz')}/${pageJobs.length}`);
console.log(`AI sinh ảnh    ${count('genai')}/${pageJobs.length}`);
console.log(`giữ ảnh cắt    ${count('crop')}/${pageJobs.length}`);
if (outcome === 'timeout') console.log(RED('  (quá thời gian, có hình chưa chạy xong)'));

console.log('\nVì sao thua — theo từng hình:');
for (const r of received.filter((x) => x.used === 'crop')) {
  console.log(`  ${r.id}: ${r.tried.map((t) => `${t.step}: ${t.why}`).join(' | ') || 'không thử bước nào'}`);
}

const outDir = path.join(ROOT, 'demo', 'figure-pipeline');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, 'results.json'),
  JSON.stringify(received.map(({ cropPng, outPng, ...r }) => r), null, 2),
);
for (const r of received) {
  if (r.outPng) {
    fs.writeFileSync(
      path.join(outDir, `${r.id}-${r.used}.png`),
      Buffer.from(r.outPng.replace(/^data:image\/png;base64,/, ''), 'base64'),
    );
  }
  if (r.cropPng) {
    fs.writeFileSync(
      path.join(outDir, `${r.id}-crop.png`),
      Buffer.from(r.cropPng.replace(/^data:image\/png;base64,/, ''), 'base64'),
    );
  }
}
fs.writeFileSync(path.join(outDir, 'log.txt'), finalLogs.join('\n'), 'utf8');
console.log(DIM(`\nẢnh + nhật ký: ${path.relative(ROOT, outDir)}`));

if (!keep) {
  fs.rmSync(PUB_DIR, { recursive: true, force: true });
  sink.close();
  process.exit(received.length === pageJobs.length ? 0 : 2);
}
