/**
 * Dựng lại font Google Sans đã cắt gọn cho UI.
 *
 * Bản variable gốc nặng 4,5 MB mỗi file. Cắt còn Latin + dấu tiếng Việt + vài ký hiệu
 * toán dùng trong UI thì xuống ~110 KB mà vẫn giữ trục wght nên mọi độ đậm dùng được.
 *
 * Nguồn: tải "Google Sans" từ fonts.google.com, giải nén rồi trỏ tới thư mục chứa hai
 * file GoogleSans-*VariableFont_GRAD,opsz,wght.ttf.
 *
 * Usage: node scripts/build-fonts.mjs <thư-mục-Google_Sans>
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import subsetFont from 'subset-font';

const SRC = process.argv[2];
if (!SRC) {
  console.error('Usage: node scripts/build-fonts.mjs <thư-mục-Google_Sans>');
  process.exit(1);
}
const OUT = path.resolve('public/fonts');

const chars = [];
for (let c = 0x20; c <= 0x7e; c++) chars.push(String.fromCodePoint(c)); // ASCII
for (let c = 0xa0; c <= 0x24f; c++) chars.push(String.fromCodePoint(c)); // Latin-1 + Ext A/B
for (let c = 0x1e00; c <= 0x1eff; c++) chars.push(String.fromCodePoint(c)); // Ext Additional (tiếng Việt)
for (let c = 0x300; c <= 0x36f; c++) chars.push(String.fromCodePoint(c)); // dấu kết hợp
const text = chars.join('') + '∑∫√±×÷≤≥≠≈∞°→←↔⇒⇔…–—‘’“”•·§¶©®™№½¼¾²³';

const JOBS = [
  ['GoogleSans-VariableFont_GRAD,opsz,wght.ttf', 'GoogleSans.woff2'],
  ['GoogleSans-Italic-VariableFont_GRAD,opsz,wght.ttf', 'GoogleSans-Italic.woff2'],
];

fs.mkdirSync(OUT, { recursive: true });
for (const [src, out] of JOBS) {
  const file = path.join(SRC, src);
  if (!fs.existsSync(file)) {
    console.error(`Không thấy ${file}`);
    process.exit(1);
  }
  const buf = fs.readFileSync(file);
  const sub = await subsetFont(buf, text, {
    targetFormat: 'woff2',
    variationAxes: { opsz: { min: 14, max: 24, default: 17 } },
  });
  fs.writeFileSync(path.join(OUT, out), sub);
  console.log(`${out}  ${(buf.length / 1024 / 1024).toFixed(2)} MB -> ${(sub.length / 1024).toFixed(0)} KB`);
}
