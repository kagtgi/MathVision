/**
 * Đo lại ngưỡng của `cropGate` trên một đề THẬT — cần mạng, nên KHÔNG vào `verify:ci`.
 *
 * Chạy: `GEMINI_API_KEY=... node scripts/probe-crop-gate.mjs <file.pdf> [nhãn]`
 *
 * Dương = hình model khoanh trên 5 trang đầu; âm = dải chữ lấy tuỳ ý cùng khổ hình. Đo bằng
 * ĐÚNG `cropStats` của app, trên HỘP GỐC model khai (pad = 0) — đo trên hộp đã nới lề là kéo
 * dòng chữ kề bên vào rồi bắt oan hình thật, chính là bẫy đã sập một lần khi dựng cửa này.
 *
 * Con số cần trông: **bắt oan phải là 0**. Mọi ca dương tính đạt >= 2 đều được ghi ra ảnh
 * `look-<nhãn>-<id>.png` để xem tận mắt — hoặc hộp đó thật sự sai, hoặc ngưỡng phải nới.
 *
 * Số đo tham chiếu (2026-08-12, hai đề: chuyên Lê Hồng Phong 2026 + chính thức THPT 2025):
 * 13 hình thật cao nhất 1 dải chữ, bắt oan 0/13; 40 dải chữ bắt được 30/40.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { ocrPage } from '../src/pipeline/ocr.ts';
import { padClampBbox } from '../src/pipeline/figures.ts';
import { cropStats, textBlockReason } from '../src/pipeline/cropGate.ts';

const PDF = process.argv[2];
const TAG = process.argv[3] ?? 'x';
const SP = 'C:/Users/Win/AppData/Local/Temp/claude/C--Users-Win-Downloads-PDF-TO-WORD/6c481f12-cb93-4aa0-ba47-302b70507d68/scratchpad';
const PAGES = 5;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-f2-'));
fs.copyFileSync(PDF, path.join(tmp, 'in.pdf'));
execFileSync('pdftoppm', ['-png', '-r', '144', '-f', '1', '-l', String(PAGES), path.join(tmp, 'in.pdf'), path.join(tmp, 'p')]);
const files = fs.readdirSync(tmp).filter((f) => f.endsWith('.png')).sort().map((f) => path.join(tmp, f));

const at = async (file, rect) => {
  const { data, info } = await sharp(file)
    .extract({ left: rect.x, top: rect.y, width: rect.w, height: rect.h })
    .grayscale().raw().toBuffer({ resolveWithObject: true });
  return cropStats(data, info.width, info.height);
};

const res = await Promise.all(
  files.map((file, i) =>
    ocrPage(process.env.GEMINI_API_KEY, {
      imageBase64: fs.readFileSync(file).toString('base64'), mimeType: 'image/png',
      pageNumber: i + 1, totalPages: 7, prevTail: '',
    }, { onLog: () => {} }).then((r) => ({ i, r })).catch((e) => { console.log('  loi trang', i + 1, e.message); return null; }),
  ),
);

const pos = [];
console.log('=== DƯƠNG: hình thật, đo trên HỘP GỐC ===');
for (const item of res.filter(Boolean)) {
  const meta = await sharp(files[item.i]).metadata();
  for (const f of item.r.figures) {
    const raw = padClampBbox(f.bbox, meta.width, meta.height, 0);
    const padded = padClampBbox(f.bbox, meta.width, meta.height);
    if (!raw || !padded) continue;
    const s = await at(files[item.i], raw);
    const sp = await at(files[item.i], padded);
    pos.push(s.textBands);
    const flag = textBlockReason(s) ? ' <<< BỊ CHẶN' : '';
    console.log(`  ${f.id} ${f.kind.padEnd(10)} bbox=[${f.bbox.join(',')}]  gốc:dảiChữ=${s.textBands}  nới:dảiChữ=${sp.textBands}${flag}`);
    if (s.textBands >= 2) {
      await sharp(files[item.i]).extract(padded).png().toFile(`${SP}/look-${TAG}-${f.id}.png`);
    }
  }
}

const neg = [];
for (const [i, file] of files.entries()) {
  const meta = await sharp(file).metadata();
  for (const y of [20, 33, 45, 55]) {
    const raw = padClampBbox([36, y, 23, 15.5], meta.width, meta.height, 0);
    const s = await at(file, raw);
    if (s.ink < 0.005) continue;
    neg.push(s.textBands);
  }
}
const q = (a) => a.slice().sort((x, y) => x - y).join(', ');
console.log(`\ndương (${pos.length} hình): [${q(pos)}]`);
console.log(`âm    (${neg.length} dải chữ): [${q(neg)}]`);
console.log(`bắt oan: ${pos.filter((v) => v >= 2).length}/${pos.length}   bắt được: ${neg.filter((v) => v >= 2).length}/${neg.length}`);
fs.rmSync(tmp, { recursive: true, force: true });
