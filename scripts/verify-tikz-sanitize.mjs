/**
 * Kiểm bộ lọc mã TikZ. Thuần Node, không cần DOM, không cần dữ liệu ngoài.
 *
 * Bốn thứ dưới đây ĐÃ ĐO là làm chết hẳn hình (`/probe-tikz.html`, 2026-08-11): mỗi ca ở đây
 * chốt lại rằng bộ lọc chặn được đúng thứ đó. Nguy hiểm nhất là byte ngoài ASCII — prompt của
 * app viết bằng tiếng Việt nên model rất hay chú thích tiếng Việt ngay trong mã, và hậu quả
 * là mất trọn 30 giây rồi rơi hình mà không log gì.
 *
 * Usage: node scripts/verify-tikz-sanitize.mjs
 */

import process from 'node:process';

import { sanitizeTikz, stripDiacritics } from '../src/utils/tikzSanitize.ts';
import { TIKZ_LIB_ALLOWLIST } from '../src/utils/tikzCapabilities.ts';

const GREEN = (s) => `\x1b[32m${s}\x1b[0m`;
const RED = (s) => `\x1b[31m${s}\x1b[0m`;

const PIC = '\\begin{tikzpicture}\n\\draw (0,0) -- (2,2);\n\\end{tikzpicture}';

const cases = [
  {
    name: 'giữ nguyên mã sạch',
    run: () => {
      const r = sanitizeTikz(PIC);
      return { code: r.code, usable: r.usable, notes: r.notes.length };
    },
    expect: { code: PIC, usable: true, notes: 0 },
  },
  {
    name: 'bỏ \\usepackage (đo được: treo 30 s rồi mất hình)',
    run: () => {
      const r = sanitizeTikz(`\\usepackage{pgfplots}\n${PIC}`);
      return { hasPkg: /usepackage/.test(r.code), usable: r.usable, noted: r.notes.some((n) => n.includes('usepackage')) };
    },
    expect: { hasPkg: false, usable: true, noted: true },
  },
  {
    name: 'bỏ thư viện ngoài allowlist, GIỮ thư viện có thật',
    run: () => {
      const r = sanitizeTikz(
        `\\usetikzlibrary{calc,decorations.pathreplacing,angles}\n${PIC}`,
      );
      return {
        code: (r.code.match(/\\usetikzlibrary\{[^}]*\}/) ?? [''])[0],
        noted: r.notes.some((n) => n.includes('decorations.pathreplacing')),
      };
    },
    expect: { code: '\\usetikzlibrary{calc,angles}', noted: true },
  },
  {
    name: 'bỏ hẳn dòng \\usetikzlibrary nếu không còn tên nào hợp lệ',
    run: () => {
      const r = sanitizeTikz(`\\usetikzlibrary{perspective}\n${PIC}`);
      return { hasLib: /usetikzlibrary/.test(r.code), usable: r.usable };
    },
    expect: { hasLib: false, usable: true },
  },
  {
    name: 'bỏ \\documentclass + \\begin{document}',
    run: () => {
      const r = sanitizeTikz(
        `\\documentclass{standalone}\n\\usepackage{tikz}\n\\begin{document}\n${PIC}\n\\end{document}`,
      );
      return { code: r.code, usable: r.usable };
    },
    expect: { code: PIC, usable: true },
  },
  {
    name: 'gỡ khối markdown ```tikz',
    run: () => sanitizeTikz('```tikz\n' + PIC + '\n```').code,
    expect: PIC,
  },
  // ── Byte ngoài ASCII: ca quan trọng nhất ───────────────────────────────────
  {
    name: 'bỏ dấu tiếng Việt trong NHÃN',
    run: () => {
      const r = sanitizeTikz(
        '\\begin{tikzpicture}\n\\draw (0,0) node {Số nhân viên};\n\\end{tikzpicture}',
      );
      return { code: r.code, ascii: !/[^\x00-\x7F]/.test(r.code) };
    },
    expect: {
      code: '\\begin{tikzpicture}\n\\draw (0,0) node {So nhan vien};\n\\end{tikzpicture}',
      ascii: true,
    },
  },
  {
    name: 'bỏ dấu tiếng Việt trong COMMENT (đo được: comment cũng giết hình)',
    run: () => {
      const r = sanitizeTikz('\\begin{tikzpicture}\n% Đường cao hạ từ đỉnh\n\\draw (0,0) -- (2,2);\n\\end{tikzpicture}');
      return { ascii: !/[^\x00-\x7F]/.test(r.code), keepsDraw: r.code.includes('\\draw (0,0) -- (2,2);') };
    },
    expect: { ascii: true, keepsDraw: true },
  },
  {
    name: 'đ/Đ không phân rã bằng NFD nên phải map tay',
    run: () => stripDiacritics('đường Đỉnh ưu tiên ơ'),
    expect: 'duong Dinh uu tien o',
  },
  {
    name: 'ký hiệu Unicode không quy được thì xoá, không để lọt',
    run: () => {
      const r = sanitizeTikz('\\begin{tikzpicture}\n\\draw (0,0) node {∡ 日};\n\\end{tikzpicture}');
      return { ascii: !/[^\x00-\x7F]/.test(r.code), noted: r.notes.some((n) => n.includes('không quy được')) };
    },
    expect: { ascii: true, noted: true },
  },
  {
    name: 'giữ nguyên toán ASCII và dấu gạch chéo LaTeX',
    run: () => sanitizeTikz('\\begin{tikzpicture}\n\\draw (0,0) node {$A_1 \\perp \\alpha$};\n\\end{tikzpicture}').code,
    expect: '\\begin{tikzpicture}\n\\draw (0,0) node {$A_1 \\perp \\alpha$};\n\\end{tikzpicture}',
  },
  // ── Cấu trúc ──────────────────────────────────────────────────────────────
  {
    name: 'thiếu \\begin{tikzpicture} -> không dùng được',
    run: () => sanitizeTikz('\\draw (0,0) -- (1,1);').usable,
    expect: false,
  },
  {
    name: 'lệch cặp begin/end -> không dùng được',
    run: () => sanitizeTikz('\\begin{tikzpicture}\n\\draw (0,0) -- (1,1);').usable,
    expect: false,
  },
  {
    name: 'allowlist khớp tikzCapabilities (không hardcode hai nơi)',
    run: () => {
      const r = sanitizeTikz(`\\usetikzlibrary{${TIKZ_LIB_ALLOWLIST.join(',')}}\n${PIC}`);
      return r.notes.filter((n) => n.startsWith('bỏ thư viện')).length;
    },
    expect: 0,
  },
];

console.log('=== Bộ lọc mã TikZ ===');
let ok = 0;
for (const c of cases) {
  let got;
  try {
    got = c.run();
  } catch (err) {
    got = `LỖI: ${err.message}`;
  }
  const pass = JSON.stringify(got) === JSON.stringify(c.expect);
  if (pass) ok++;
  else {
    console.log(`  ${RED('FAIL')} ${c.name}`);
    console.log(`      mong ${JSON.stringify(c.expect)}`);
    console.log(`      nhận ${JSON.stringify(got)}`);
  }
}
console.log(`${ok === cases.length ? GREEN('PASS') : RED('FAIL')}  ${ok}/${cases.length} tiêu chí`);
process.exit(ok === cases.length ? 0 : 2);
