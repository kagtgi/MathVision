/**
 * Demo trên 5 đề PDF thật, chọn tất định (seed cố định để chạy lại ra cùng bộ).
 *
 * Chặng OCR và chặng tự giải cần API key của người dùng nên script này KHÔNG gọi Gemini.
 * Nó chứng minh phần còn lại của đường ống trên dữ liệu thật:
 *   1. Ảnh trang PDF -> PNG (đúng thứ chặng OCR nhận vào)  -> demo/de-*.png
 *   2. Cắt hình theo bbox từ chính trang đó                 -> demo/crop-*.png
 *   3. MMD đã kiểm chứng của cùng 5 đề -> .docx chuẩn       -> demo/*.docx
 *   4. QC trên cả 5 đề
 *
 * Usage: node scripts/demo-five-exams.mjs ["C:\\Users\\Win\\Downloads\\PDF TO WORD"]
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { Packer } from 'docx';
import { buildExamDocx, pngSize } from '../src/pipeline/mmdToDocx.ts';
import { qcMmd } from '../src/pipeline/qc.ts';
import { padClampBbox } from '../src/pipeline/figures.ts';

const ROOT = process.argv[2] || 'C:\\Users\\Win\\Downloads\\PDF TO WORD';
const OUT = path.resolve('demo');
const GREEN = (s) => `\x1b[32m${s}\x1b[0m`;
const RED = (s) => `\x1b[31m${s}\x1b[0m`;

const PAIRS = [
  ['FILE GỐC KTGK', 'MMD KTGK'],
  ['FILE GỐC KTTX', 'MMD KTTX'],
];

function listExams() {
  const out = [];
  for (const [pdfDir, mmdDir] of PAIRS) {
    const p = path.join(ROOT, pdfDir);
    const m = path.join(ROOT, mmdDir);
    if (!fs.existsSync(p) || !fs.existsSync(m)) continue;
    for (const f of fs.readdirSync(p).filter((x) => x.toLowerCase().endsWith('.pdf'))) {
      const stem = f.replace(/\.pdf$/i, '');
      const mmd = path.join(m, `${stem}.mmd`);
      if (fs.existsSync(mmd)) out.push({ stem, pdf: path.join(p, f), mmd });
    }
  }
  return out;
}

/** Bộ sinh số giả ngẫu nhiên có seed — chạy lại ra đúng 5 đề đó. */
function pickFive(items, seed = 20260810) {
  let s = seed;
  const rand = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const pool = [...items];
  const picked = [];
  while (picked.length < 5 && pool.length) {
    picked.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  }
  return picked;
}

/**
 * pdftoppm không mở được đường dẫn có dấu tiếng Việt — copy sang thư mục tạm ASCII trước
 * (bài học từ lần dựng hình TikZ của session trước).
 */
function renderPageToPng(pdfPath, pageNo, outPrefix, dpi = 140) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-'));
  const ascii = path.join(tmp, 'input.pdf');
  fs.copyFileSync(pdfPath, ascii);
  execFileSync('pdftoppm', ['-png', '-r', String(dpi), '-f', String(pageNo), '-l', String(pageNo), ascii, path.join(tmp, 'page')], { stdio: 'pipe' });
  const produced = fs.readdirSync(tmp).filter((f) => f.startsWith('page') && f.endsWith('.png'));
  if (!produced.length) throw new Error('pdftoppm không sinh được ảnh');
  const from = path.join(tmp, produced[0]);
  fs.copyFileSync(from, outPrefix);
  fs.rmSync(tmp, { recursive: true, force: true });
  return outPrefix;
}

/** Cắt một vùng ảnh PNG bằng sharp, dùng đúng phép nới/kẹp bbox của app. */
async function cropWithSharp(srcPng, bbox, outPng) {
  const sharp = (await import('sharp')).default;
  const meta = await sharp(srcPng).metadata();
  const rect = padClampBbox(bbox, meta.width, meta.height);
  if (!rect) return null;
  await sharp(srcPng).extract({ left: rect.x, top: rect.y, width: rect.w, height: rect.h }).toFile(outPng);
  return rect;
}

// ─── main ────────────────────────────────────────────────────────────────────
const all = listExams();
if (all.length < 5) {
  console.error(RED(`Chỉ tìm thấy ${all.length} cặp PDF+MMD trong ${ROOT}`));
  process.exit(1);
}
const five = pickFive(all);
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

console.log(`Đã chọn 5 đề (seed cố định) trong ${all.length} đề:\n`);
let fails = 0;

for (const [i, ex] of five.entries()) {
  const tag = `${i + 1}. ${ex.stem}`;
  try {
    // 1. Ảnh trang đề — đúng thứ mà chặng OCR nhận vào
    const pagePng = path.join(OUT, `de-${i + 1}-${ex.stem}.png`);
    renderPageToPng(ex.pdf, 1, pagePng);

    // 2. Cắt một vùng hình theo bbox phần trăm (mô phỏng bbox mô hình trả về)
    const cropPng = path.join(OUT, `crop-${i + 1}-${ex.stem}.png`);
    const rect = await cropWithSharp(pagePng, [8, 8, 84, 26], cropPng);

    // 3. MMD đã kiểm chứng -> docx chuẩn
    const mmd = fs.readFileSync(ex.mmd, 'utf8');
    const resolver = (ref) => {
      const cands = [
        path.resolve(path.dirname(ex.mmd), ref),
        path.resolve(path.dirname(ex.mmd), '..', ref),
      ];
      const f = cands.find((x) => fs.existsSync(x));
      if (!f) return null;
      const bytes = new Uint8Array(fs.readFileSync(f));
      return { bytes, ...pngSize(bytes) };
    };
    const buf = await Packer.toBuffer(buildExamDocx(mmd, resolver));
    const docxPath = path.join(OUT, `${ex.stem}.docx`);
    fs.writeFileSync(docxPath, buf);

    // 4. QC
    const issues = qcMmd(mmd);
    const errs = issues.filter((x) => x.severity === 'error').length;
    const warns = issues.filter((x) => x.severity === 'warn').length;

    const questions = (mmd.match(/(?:^|\n)\**Câu\s+\d+/g) || []).length;
    const equations = (mmd.match(/(?<!\\)\$/g) || []).length / 2;

    console.log(
      `${errs === 0 ? GREEN('OK  ') : RED('LỖI ')} ${tag}\n` +
        `      ảnh trang  ${path.basename(pagePng)}  (${(fs.statSync(pagePng).size / 1024).toFixed(0)} KB)\n` +
        `      ảnh cắt    ${path.basename(cropPng)}  (${rect ? `${rect.w}×${rect.h}px` : 'bỏ'})\n` +
        `      docx       ${path.basename(docxPath)}  (${(buf.length / 1024).toFixed(0)} KB, ${questions} câu, ~${equations} công thức)\n` +
        `      QC         ${errs} lỗi, ${warns} cảnh báo`,
    );
    if (errs) fails++;
  } catch (e) {
    console.log(`${RED('LỖI')} ${tag}: ${e.message}`);
    fails++;
  }
}

console.log(`\nKết quả nằm trong ${OUT}`);
process.exit(fails ? 2 : 0);
