/**
 * Chạy THẬT toàn bộ đường ống trên một đề PDF: gọi Gemini để đọc trang, tự giải, rồi
 * xuất MMD + docx. Đây là thứ duy nhất chứng minh được chất lượng OCR và chất lượng giải.
 *
 * Không có DOM nên bỏ hai việc cần canvas: cắt hình và dựng TikZ. Ảnh trang dựng bằng
 * pdftoppm (chép PDF sang đường dẫn ASCII trước vì pdftoppm không mở được đường dẫn có
 * dấu tiếng Việt).
 *
 * Key đọc từ biến môi trường GEMINI_API_KEY — không ghi vào file nào trong repo.
 *
 * Usage:
 *   GEMINI_API_KEY=... node scripts/run-real-exam.mjs <file.pdf> [--pages N] [--no-solve] [--out DIR]
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { Packer } from 'docx';
import { ocrPage } from '../src/pipeline/ocr.ts';
import { runTextPipeline } from '../src/pipeline/runPipeline.ts';
import { buildExamDocx } from '../src/pipeline/mmdToDocx.ts';
import { checkApiKey } from '../src/pipeline/geminiClient.ts';

const GREEN = (s) => `\x1b[32m${s}\x1b[0m`;
const RED = (s) => `\x1b[31m${s}\x1b[0m`;
const DIM = (s) => `\x1b[2m${s}\x1b[0m`;

const args = process.argv.slice(2);
const pdfPath = args.find((a) => !a.startsWith('--'));
const maxPages = Number(args.includes('--pages') ? args[args.indexOf('--pages') + 1] : 0) || 0;
const doSolve = !args.includes('--no-solve');
const outDir = path.resolve(args.includes('--out') ? args[args.indexOf('--out') + 1] : 'demo/real');

const apiKey = process.env.GEMINI_API_KEY;
if (!pdfPath || !apiKey) {
  console.error('Cần <file.pdf> và biến môi trường GEMINI_API_KEY.');
  process.exit(1);
}

/** pdftoppm không mở được đường dẫn có dấu tiếng Việt -> copy sang thư mục tạm ASCII. */
function renderPages(pdf, limit) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-real-'));
  fs.copyFileSync(pdf, path.join(tmp, 'in.pdf'));
  const cmd = ['-png', '-r', '150'];
  if (limit) cmd.push('-f', '1', '-l', String(limit));
  execFileSync('pdftoppm', [...cmd, path.join(tmp, 'in.pdf'), path.join(tmp, 'p')], { stdio: 'pipe' });
  const files = fs
    .readdirSync(tmp)
    .filter((f) => f.startsWith('p') && f.endsWith('.png'))
    .sort();
  return { tmp, files: files.map((f) => path.join(tmp, f)) };
}

const t0 = Date.now();
console.log(`Đề: ${path.basename(pdfPath)}`);

const key = await checkApiKey(apiKey);
if (!key.ok) {
  console.error(RED(`Key không dùng được: ${key.error}`));
  process.exit(1);
}
console.log(`Chuỗi model khả dụng: ${key.chain.join(' → ')}\n`);

const { tmp, files } = renderPages(pdfPath, maxPages);
console.log(`${files.length} trang đã dựng ảnh.\n`);

const logLines = [];
const onLog = (l) => {
  logLines.push(l);
  if (/bước sang|chờ|cắt|từ chối/.test(l)) console.log(DIM(`   ${l}`));
};

const pageMmds = [];
const figureRefs = [];
for (const [i, file] of files.entries()) {
  const b64 = fs.readFileSync(file).toString('base64');
  const tPage = Date.now();
  const res = await ocrPage(
    apiKey,
    {
      imageBase64: b64,
      mimeType: 'image/png',
      pageNumber: i + 1,
      totalPages: files.length,
      prevTail: pageMmds.join('\n\n'),
    },
    { onLog, models: key.chain },
  );
  pageMmds.push(res.mmd);
  figureRefs.push(...res.figures.map((f) => f.id));
  const lines = res.mmd.split('\n').length;
  console.log(
    `Trang ${i + 1}/${files.length}  ${((Date.now() - tPage) / 1000).toFixed(1)}s  ` +
      `${lines} dòng, ${res.figures.length} hình, model ${res.model}` +
      (res.truncated ? RED(' (bị cắt!)') : ''),
  );
}
fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\nĐang ${doSolve ? 'giải đề' : 'chuẩn hoá'}…`);
const tSolve = Date.now();
let solvedCount = 0;
const result = await runTextPipeline({
  pageMmds,
  // Không cắt được hình trong Node -> khai báo id để QC không báo thiếu dữ liệu ảnh.
  figureIds: new Set(figureRefs),
  examMode: true,
  autoSolve: doSolve,
  solveOptions: {
    apiKey,
    models: key.chain,
    onLog,
    doubleCheck: true,
    drawFigures: false,
    verifyFigures: false,
    concurrency: 4,
    onProgress: (done, total) => {
      if (done > solvedCount) {
        solvedCount = done;
        process.stdout.write(`\r   giải ${done}/${total}   `);
      }
    },
  },
});
process.stdout.write('\n');
console.log(`Giải xong trong ${((Date.now() - tSolve) / 1000).toFixed(0)}s`);

fs.mkdirSync(outDir, { recursive: true });
const stem = path.basename(pdfPath).replace(/\.pdf$/i, '');
fs.writeFileSync(path.join(outDir, `${stem}.mmd`), result.mmd, 'utf8');
const buf = await Packer.toBuffer(buildExamDocx(result.mmd));
fs.writeFileSync(path.join(outDir, `${stem}.docx`), buf);
fs.writeFileSync(path.join(outDir, `${stem}.log.txt`), logLines.join('\n'), 'utf8');

const errors = result.issues.filter((i) => i.severity === 'error');
const warns = result.issues.filter((i) => i.severity === 'warn');
const questions = result.solved.length;
const chosen = result.solved.filter((s) => s.chon && s.chon !== '?').length;
const unsure = result.solved.filter((s) => s.chon === '?').length;
const failed = result.solved.filter((s) => s.failed).length;

console.log('');
console.log(`${errors.length === 0 ? GREEN('QC SẠCH') : RED(`QC: ${errors.length} lỗi`)}  ` + `${warns.length} cảnh báo`);
for (const e of errors.slice(0, 10)) console.log(`   ${RED('•')} ${e.line ? `dòng ${e.line}: ` : ''}${e.message}`);
for (const w of warns.slice(0, 10)) console.log(`   ${DIM('•')} ${w.line ? `dòng ${w.line}: ` : ''}${w.message}`);
if (doSolve) {
  console.log(
    `Câu: ${questions}  ·  chốt đáp án ${chosen}  ·  Chọn ? ${unsure}  ·  giải lỗi ${failed}  ·  hai lượt lệch ${result.disagreements.length}`,
  );
}
for (const n of result.notes) console.log(`   ${DIM('·')} ${n}`);

// ── Đối chiếu đáp án với bản golden đã kiểm tay ──────────────────────────────
const goldenPath = args.includes('--compare') ? args[args.indexOf('--compare') + 1] : null;
if (goldenPath && fs.existsSync(goldenPath)) {
  /** Lấy đáp án theo VỊ TRÍ THỨ TỰ câu trong mục đáp án (số câu có thể trùng). */
  const answersOf = (mmd) => {
    const idx = mmd.search(/#\s*ĐÁP ÁN CHI TIẾT/);
    const part = idx >= 0 ? mmd.slice(idx) : mmd;
    const out = [];
    let cur = null;
    for (const line of part.split('\n')) {
      const q = line.match(/^\**Câu\s+(\d+)\s*[.:]/);
      if (q) {
        cur = { num: q[1], chon: null, dapSo: null };
        out.push(cur);
        continue;
      }
      if (!cur) continue;
      const c = line.match(/^Chọn\s+([A-D?])\.?\s*$/);
      if (c && !cur.chon) cur.chon = c[1];
      const d = line.match(/^Đáp số\s*:\s*(.+?)\s*$/);
      if (d && !cur.dapSo) cur.dapSo = d[1].replace(/\s/g, '').replace(/\$|\{|\}/g, '');
    }
    return out;
  };

  const mine = answersOf(result.mmd);
  const gold = answersOf(fs.readFileSync(goldenPath, 'utf8'));
  const n = Math.min(mine.length, gold.length);
  let same = 0;
  let diff = 0;
  let noRef = 0;
  const wrong = [];
  for (let i = 0; i < n; i++) {
    const a = mine[i].chon ?? mine[i].dapSo;
    const b = gold[i].chon ?? gold[i].dapSo;
    if (!b || b === '?') {
      noRef++;
      continue;
    }
    if (a === b) same++;
    else {
      diff++;
      wrong.push(`Câu ${gold[i].num}: máy=${a ?? '—'} golden=${b}`);
    }
  }
  const pct = same + diff ? Math.round((same / (same + diff)) * 100) : 0;
  console.log('');
  console.log(
    `${pct >= 90 ? GREEN('ĐỐI CHIẾU') : RED('ĐỐI CHIẾU')} với ${path.basename(goldenPath)}: ` +
      `${same}/${same + diff} khớp (${pct}%)` +
      (noRef ? `, ${noRef} câu golden không có đáp án để so` : '') +
      (mine.length !== gold.length ? RED(`, số câu lệch ${mine.length} vs ${gold.length}`) : ''),
  );
  for (const w of wrong.slice(0, 12)) console.log(`   ${RED('•')} ${w}`);
}

console.log(`\nGhi ra ${outDir}  (${(buf.length / 1024).toFixed(0)} KB docx)`);
console.log(`Tổng thời gian ${((Date.now() - t0) / 1000).toFixed(0)}s`);
