/**
 * Cửa kiểm ảnh cắt: có bắt được ảnh chụp chữ đề, và có THA hình vẽ thật?
 *
 * Lỗi mà cửa này sinh ra để chặn: model khoanh bbox "đúng hình dạng, sai dòng". Đo thật trên đề
 * chuyên Lê Hồng Phong 2026 — model trả `[38.0, 33.1, 23.0, 15.5]`, hình thật ở
 * `[38, 62.2, 23, 15.5]`: ba trên bốn số trùng khít, chỉ `y` lệch 29 điểm. Ảnh chụp bảng số liệu
 * và mấy dòng phương án A-D đi thẳng vào Word.
 *
 * Ngưỡng `TEXT_BAND_LIMIT = 2` chọn từ số đo trên 14 hình thật (cao nhất 1) và 40 dải chữ
 * (33/40 đạt từ 2). Chạy lại phép đo đó bằng `node scripts/probe-crop-gate.mjs <file.pdf>`.
 *
 * Ở đây dựng mẫu bằng CODE chứ không commit ảnh: repo không có tiền lệ ảnh baseline, và cái cần
 * chốt là HÀNH VI của phép đếm dải, thứ dựng lại được chính xác bằng vài vòng lặp.
 *
 * Usage: node scripts/verify-crop-gate.mjs
 */

import process from 'node:process';
import { cropStats, textBlockReason, TEXT_BAND_LIMIT } from '../src/pipeline/cropGate.ts';
import { parseBboxReply } from '../src/pipeline/refineBbox.ts';

const GREEN = (s) => `\x1b[32m${s}\x1b[0m`;
const RED = (s) => `\x1b[31m${s}\x1b[0m`;

const W = 320;
const H = 330;

/** Trang trắng. */
const blank = (w = W, h = H) => new Uint8Array(w * h).fill(255);

/** Vẽ một khối đặc: dùng làm dòng chữ (thấp, dài) hay khối hình (cao). */
function fill(buf, { x, y, w, h, wide = W }) {
  for (let j = y; j < y + h; j++) {
    for (let i = x; i < x + w; i++) buf[j * wide + i] = 0;
  }
}

/** n dòng chữ: cao 8% ảnh, trải 80% bề rộng, cách nhau 6% — đúng dáng đề thi. */
function textLines(n) {
  const buf = blank();
  const lineH = Math.round(H * 0.08);
  const gap = Math.round(H * 0.06);
  for (let k = 0; k < n; k++) {
    fill(buf, { x: Math.round(W * 0.05), y: 10 + k * (lineH + gap), w: Math.round(W * 0.8), h: lineH });
  }
  return buf;
}

const cases = [];
const check = (name, pass, extra = '') => cases.push([name, pass, extra]);

// ── Bắt đúng ảnh chữ ────────────────────────────────────────────────────────
for (const n of [2, 3, 5, 7]) {
  const s = cropStats(textLines(n), W, H);
  check(`${n} dòng chữ -> đếm đúng ${n} dải`, s.textBands === n, `đếm ${s.textBands}`);
  check(`${n} dòng chữ -> bị chặn`, textBlockReason(s) !== null);
}
check('lý do có nêu số dòng', (textBlockReason(cropStats(textLines(4), W, H)) ?? '').includes('4'));

// ── THA hình vẽ thật: đây là phía đắt hơn, bắt oan là XOÁ hình có thật ───────
check('trang trắng -> tha', textBlockReason(cropStats(blank(), W, H)) === null);
check('đúng 1 dòng chữ -> tha (14 hình thật đo được tối đa 1)', textBlockReason(cropStats(textLines(1), W, H)) === null);

{
  // Bảng biến thiên: mấy đường kẻ ngang MẢNH trải hết bề rộng. Cao < 4% nên không phải dòng chữ.
  const buf = blank();
  for (const y of [30, 120, 210, 300]) fill(buf, { x: 5, y, w: W - 10, h: 3 });
  const s = cropStats(buf, W, H);
  check('4 đường kẻ ngang mảnh (bảng biến thiên) -> tha', textBlockReason(s) === null, `dải chữ ${s.textBands}`);
}
{
  // Nhãn điểm trên hình: thấp nhưng NGẮN. Nhiều nhãn cũng không được thành "chữ".
  const buf = blank();
  for (let k = 0; k < 6; k++) fill(buf, { x: 20 + k * 40, y: 20 + k * 45, w: 18, h: 22 });
  const s = cropStats(buf, W, H);
  check('6 nhãn điểm ngắn -> tha', textBlockReason(s) === null, `dải chữ ${s.textBands}`);
}
{
  // Khối hình liền: một dải mực CAO. Cao > 22% nên không phải dòng chữ.
  const buf = blank();
  fill(buf, { x: 40, y: 40, w: 240, h: Math.round(H * 0.6) });
  const s = cropStats(buf, W, H);
  check('khối hình cao liền -> tha', textBlockReason(s) === null, `dải chữ ${s.textBands}`);
}
{
  // HAI khối hình xếp trên nhau, mỗi khối cao 30% và trải rộng — dáng "hình trụ trên, hình nón
  // dưới" rất thường gặp. Đây là ca duy nhất chạm tới TRẦN chiều cao: bỏ trần thì hai khối này
  // bị đếm thành hai dòng chữ và một hình thật bị xoá khỏi đề.
  const buf = blank();
  fill(buf, { x: 30, y: 15, w: 260, h: Math.round(H * 0.3) });
  fill(buf, { x: 30, y: 15 + Math.round(H * 0.4), w: 260, h: Math.round(H * 0.3) });
  const s = cropStats(buf, W, H);
  check('2 khối hình cao xếp dọc -> tha', textBlockReason(s) === null, `dải chữ ${s.textBands}`);
}

// ── Đầu vào méo thì không được nổ ────────────────────────────────────────────
check('w=0 -> số 0, không ném', cropStats(blank(), 0, H).textBands === 0);
check('mảng ngắn hơn w*h -> số 0', cropStats(new Uint8Array(10), W, H).textBands === 0);
check('ngưỡng vẫn là 2', TEXT_BAND_LIMIT === 2);

// ── Đọc bbox khoanh lại: sai một chỗ là cắt vào hư không ─────────────────────
const R = [
  ['đọc được dòng thuần', 'bbox=38,62.2,23,15.5', [38, 62.2, 23, 15.5]],
  ['đọc được khi lẫn chữ', 'Hình ở đây: bbox = 10, 20, 30, 40 .', [10, 20, 30, 40]],
  ['KHONG-CO -> null', 'KHONG-CO', null],
  ['thiếu số -> null', 'bbox=38,62,23', null],
  ['âm -> null', 'bbox=-5,62,23,15', null],
  // Chỉ phép kiểm `Number.isFinite` chặn được ca này: `parseFloat('.')` ra NaN, mà NaN thì mọi
  // phép so sánh khác đều trả false nên nó lọt qua hết các cửa còn lại.
  ['toàn dấu chấm -> null', 'bbox=.,.,.,.', null],
  ['quá 100 -> null', 'bbox=38,162,23,15', null],
  ['rộng bằng 0 -> null', 'bbox=38,62,0,15', null],
  ['tràn khỏi trang -> null', 'bbox=90,62,30,15', null],
  ['trùm gần hết trang -> null', 'bbox=0,0,99,99', null],
  ['rỗng -> null', '', null],
];
for (const [name, text, want] of R) {
  const got = parseBboxReply(text);
  const ok = want === null ? got === null : got !== null && got.every((v, i) => v === want[i]);
  check(`bbox: ${name}`, ok, JSON.stringify(got));
}

console.log('=== Cửa kiểm ảnh cắt ===');
let ok = 0;
for (const [name, pass, extra] of cases) {
  if (pass) ok++;
  else console.log(`  ${RED('FAIL')} ${name}${extra ? `  (${extra})` : ''}`);
}
console.log(`${ok === cases.length ? GREEN('PASS') : RED('FAIL')}  ${ok}/${cases.length} tiêu chí`);
process.exit(ok === cases.length ? 0 : 2);
