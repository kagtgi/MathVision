/**
 * Probe THẬT cho đường sinh ảnh. Chạy tay, KHÔNG nằm trong `verify` — nó gọi mạng.
 *
 * Chứng minh đúng BA thứ mà chỉ mạng mới chứng minh được, và cả ba đều là điểm chịu lực:
 *   1. `gemini-3.1-flash-image` (hoặc bậc dự phòng) CÓ THẬT trên tài khoản này. Tên model là thứ
 *      không xác minh được từ máy dev, và Google đổi tên khá thường xuyên.
 *   2. `responseModalities` + `imageConfig` được API NHẬN (không 400) — nếu 400 thì thang hạ cấu
 *      hình trong `callGeminiImage` phải cứu được, và log sẽ cho thấy nó chạy ở bậc mấy.
 *   3. `inlineData` THẬT SỰ về, kèm mimeType thật. `resp.text` của SDK bỏ qua part không phải
 *      text, nên nếu đọc sai chỗ thì ảnh rơi âm thầm.
 *
 * Nửa còn lại (chuẩn hoá PNG, mười cửa tiền kiểm, ngữ cảnh đề, câu chữ cảnh báo) đã có
 * `verify-figure-gen.mjs` phủ, không cần mạng.
 *
 * Usage: GEMINI_API_KEY=... node scripts/probe-gen-figure.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { callGeminiImage, pickAspectRatio } from '../src/pipeline/geminiClient.ts';
import { figureGenPrompt } from '../src/utils/figureGenPrompts.ts';
import { makePng } from './lib/png.mjs';

const GREEN = (s) => `\x1b[32m${s}\x1b[0m`;
const RED = (s) => `\x1b[31m${s}\x1b[0m`;
const DIM = (s) => `\x1b[2m${s}\x1b[0m`;

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.log(RED('Thiếu GEMINI_API_KEY.'));
  console.log(DIM('  $env:GEMINI_API_KEY="..." ; node scripts/probe-gen-figure.mjs'));
  process.exit(2);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'demo', 'gen-figure');

/**
 * Ảnh cắt fixture. Dùng hình thật của bộ corpus nếu đã chạy `verify-tikz-render`, vì một PNG
 * xám trơn không cho model gì để vẽ lại — probe sẽ "chạy được" mà không nói gì về chất lượng.
 */
const fromCorpus = path.join(ROOT, 'demo', 'tikz-corpus', 'kg-hinh-non.png');
const cropBytes = fs.existsSync(fromCorpus)
  ? new Uint8Array(fs.readFileSync(fromCorpus))
  : makePng(420, 320, 3);
const cropSource = fs.existsSync(fromCorpus)
  ? 'demo/tikz-corpus/kg-hinh-non.png'
  : 'PNG xám tổng hợp (chạy verify-tikz-render trước để có hình thật)';

const CONTEXT = `Câu 12. Một chiếc phễu hình nón có bán kính miệng phễu là $r$ và chiều cao $h$.
Người ta rót nước vào phễu. Tính thể tích nước trong phễu khi mực nước cao $h/2$.`;

const toBase64 = (u8) => Buffer.from(u8).toString('base64');

console.log('=== Probe sinh ảnh (gọi mạng thật) ===');
console.log(DIM(`  ảnh cắt: ${cropSource}`));

const aspect = pickAspectRatio(420, 320);
console.log(DIM(`  khung chọn theo ảnh cắt: ${aspect}`));

const t0 = Date.now();
const res = await callGeminiImage(apiKey, {
  parts: figureGenPrompt({
    kind: 'model',
    cropBase64: toBase64(cropBytes),
    context: CONTEXT,
  }),
  aspectRatio: aspect,
  imageSize: '1K',
  label: 'probe',
  onLog: (l) => console.log(DIM(`  ${l}`)),
});
const ms = Date.now() - t0;

if (!res) {
  console.log(RED(`FAIL  không nhận được ảnh sau ${(ms / 1000).toFixed(1)}s.`));
  console.log(DIM('  Đọc log ở trên: 404 mọi model = tài khoản chưa có model ảnh; 400 = cấu hình'));
  console.log(DIM('  bị từ chối ở cả ba bậc, cần xem lại responseModalities/imageConfig.'));
  process.exit(2);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const ext = (res.mimeType.split('/')[1] ?? 'bin').replace(/[^\w]/g, '');
const outFile = path.join(OUT_DIR, `probe.${ext}`);
const bytes = Buffer.from(res.data, 'base64');
fs.writeFileSync(outFile, bytes);

// Giải mã bằng sharp (đã là devDependency) để biết kích thước thật — Node không có canvas.
let dims = 'không đọc được';
try {
  const sharp = (await import('sharp')).default;
  const meta = await sharp(bytes).metadata();
  dims = `${meta.width}x${meta.height} (${meta.format})`;
} catch (err) {
  dims = `sharp lỗi: ${err.message}`;
}

const checks = [
  ['có part ảnh trong câu trả lời', bytes.length > 1000, `${bytes.length} byte`],
  ['mimeType là image/*', /^image\//.test(res.mimeType), res.mimeType],
  ['giải mã được thành ảnh', !dims.startsWith('sharp lỗi'), dims],
];

console.log(DIM(`  model: ${res.model} · ${(ms / 1000).toFixed(1)}s · ${dims}`));
if (res.text) console.log(DIM(`  model nói thêm: ${res.text.slice(0, 200)}`));
console.log(DIM(`  ghi ra: ${path.relative(ROOT, outFile)}`));

let ok = 0;
for (const [name, pass, detail] of checks) {
  if (pass) ok++;
  else console.log(`  ${RED('FAIL')} ${name}${detail ? ` — ${detail}` : ''}`);
}
console.log(`${ok === checks.length ? GREEN('PASS') : RED('FAIL')}  ${ok}/${checks.length} tiêu chí`);
console.log(
  DIM('  Mở file vừa ghi và tự xem: probe chỉ chứng minh đường ống sống, không chấm chất lượng.'),
);
process.exit(ok === checks.length ? 0 : 2);
