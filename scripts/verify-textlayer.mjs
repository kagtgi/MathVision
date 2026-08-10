/**
 * Kiểm lớp đối chiếu văn bản PDF: phải bắt được lỗi thật và KHÔNG báo oan.
 *
 * Các ca dưới đây lấy đúng từ những bẫy đã đo được khi khảo sát pdf.js + PDF LaTeX.
 *
 * Usage: node scripts/verify-textlayer.mjs
 */

import process from 'node:process';
import { crossCheckPage, normalizeForCompare } from '../src/pipeline/textLayerCheck.ts';

const GREEN = (s) => `\x1b[32m${s}\x1b[0m`;
const RED = (s) => `\x1b[31m${s}\x1b[0m`;

/** Trang mẫu đủ dài để vượt ngưỡng 150 ký tự và 40 từ văn xuôi. */
const FULL = `Câu 1. Cho hàm số bậc hai xác định trên tập số thực và liên tục tại mọi điểm.
Tính giá trị nhỏ nhất của biểu thức đã cho khi tham số thay đổi trong khoảng cho phép.
Câu 2. Một trang báo điện tử thống kê thời gian người dùng đọc thông tin trên trang
trong mỗi lần truy cập, tổng cộng 1250 lượt trong tháng vừa qua của năm 2025.
Câu 3. Cho hình chóp có đáy là hình bình hành tâm O, gọi M là trung điểm của cạnh bên.`;

const cases = [
  {
    name: 'bản đọc trung thực -> không báo gì',
    text: FULL,
    mmd: FULL,
    expect: (is) => is.length === 0,
  },
  {
    name: 'bỏ mất Câu 2 -> báo lỗi',
    text: FULL,
    mmd: FULL.split('Câu 2.')[0] + FULL.split('Câu 3.')[1],
    expect: (is) => is.some((i) => i.severity === 'error' && /Câu 2/.test(i.message)),
  },
  {
    name: 'đổi số 1250 -> 1350 -> báo cảnh báo',
    text: FULL,
    mmd: FULL.replace('1250', '1350'),
    expect: (is) => is.some((i) => /1250/.test(i.message)),
  },
  {
    name: 'PDF quét (ít chữ) -> bỏ qua, không báo',
    text: 'Trang 1',
    mmd: 'Nội dung gì đó hoàn toàn khác biệt so với trang.',
    expect: (is) => is.length === 0,
  },
  {
    name: 'dấu tiếng Việt rời (LaTeX cũ) -> bỏ qua trang, chỉ cảnh báo',
    text: FULL.replace('Cho hàm', '´o Cho hàm'),
    mmd: 'khác hẳn',
    expect: (is) => is.length === 1 && is[0].severity === 'warn' && /dấu tiếng Việt rời/.test(is[0].message),
  },
  {
    name: 'công thức toán khác nhau KHÔNG bị tính là sai',
    text: FULL,
    mmd: FULL + '\n$\\frac{a}{b} = \\sqrt{x^2+1}$',
    expect: (is) => is.length === 0,
  },
  {
    name: 'kiểu đặt dấu hoà/hòa KHÔNG bị báo oan',
    text: FULL + ' hoà bình thuỷ triều',
    mmd: FULL + ' hòa bình thủy triều',
    expect: (is) => is.length === 0,
  },
  {
    name: 'chỉ số trên 5^2 -> "52" KHÔNG gây báo số thiếu',
    text: FULL + ' 52',
    mmd: FULL + ' $5^{2}$',
    expect: (is) => !is.some((i) => /không thấy trong bản đọc/.test(i.message)),
  },
];

console.log('=== Đối chiếu lớp văn bản PDF ===');
let ok = 0;
for (const c of cases) {
  const issues = crossCheckPage({ pageText: c.text, mmd: c.mmd, pageNumber: 1 });
  const pass = c.expect(issues);
  if (pass) ok++;
  else {
    console.log(`  ${RED('FAIL')} ${c.name}`);
    console.log(`      nhận: ${JSON.stringify(issues.map((i) => `${i.severity}: ${i.message}`))}`);
  }
}
console.log(`${ok === cases.length ? GREEN('PASS') : RED('FAIL')}  ${ok}/${cases.length} ca`);

// Chuẩn hoá phải gộp được hai kiểu đặt dấu.
const normOk = normalizeForCompare('hoà') === normalizeForCompare('hòa')
  && normalizeForCompare('thuỷ') === normalizeForCompare('thủy');
console.log(`${normOk ? GREEN('PASS') : RED('FAIL')}  quy dấu hoà=hòa, thuỷ=thủy`);

process.exit(ok === cases.length && normOk ? 0 : 2);
