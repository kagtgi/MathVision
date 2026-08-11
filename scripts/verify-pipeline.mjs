/**
 * Harness kiểm chứng pipeline TS với 25 file .mmd golden của session trước.
 *
 * (a) Idempotence — 25 file golden đã ở TRẠNG THÁI CUỐI, nên chạy lại full chain
 *     phải ra chính nó. Lệch một ký tự = port sai hoặc rule quá tay.
 * (b) Fixture conform — các ca lệch chuẩn mà mô hình OCR hay mắc.
 * (c) QC — liệt kê issue TS tìm được để đối chiếu với qc_mmd.js gốc.
 *
 * Usage: node scripts/verify-pipeline.mjs ["C:\\Users\\Win\\Downloads\\PDF TO WORD"]
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { conformMmd } from '../src/pipeline/conform.ts';
import { normalizeMmd, fixEscapes } from '../src/pipeline/normalize.ts';
import { applyExamTransforms } from '../src/pipeline/examTransforms.ts';
import { qcMmd } from '../src/pipeline/qc.ts';
import { extractFigures } from '../src/pipeline/prompts.ts';
import { stitchPages } from '../src/pipeline/stitchPages.ts';
import { padClampBbox } from '../src/pipeline/figures.ts';

const ROOT = process.argv[2] || 'C:\\Users\\Win\\Downloads\\PDF TO WORD';
const MMD_DIRS = ['MMD KTGK', 'MMD KTTX'].map((d) => path.join(ROOT, d));
const FIGURE_DIR = path.join(ROOT, 'figures');

const GREEN = (s) => `\x1b[32m${s}\x1b[0m`;
const RED = (s) => `\x1b[31m${s}\x1b[0m`;
const DIM = (s) => `\x1b[2m${s}\x1b[0m`;

function listMmd() {
  const out = [];
  for (const dir of MMD_DIRS) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.toLowerCase().endsWith('.mmd'))) {
      out.push(path.join(dir, f));
    }
  }
  return out;
}

function figureIds() {
  const ids = new Set();
  if (fs.existsSync(FIGURE_DIR)) {
    for (const f of fs.readdirSync(FIGURE_DIR)) ids.add(`figures/${f}`);
  }
  return ids;
}

/** Chuỗi biến đổi đầy đủ cho một file đã có sẵn lời giải (đường golden). */
function fullChain(raw) {
  const { mmd: conformed } = conformMmd(raw);
  let mmd = normalizeMmd(conformed);
  mmd = fixEscapes(mmd);
  const { mmd: final, report } = applyExamTransforms(mmd);
  return { mmd: final, report };
}

function firstDiff(a, b) {
  const la = a.split('\n');
  const lb = b.split('\n');
  const n = Math.max(la.length, lb.length);
  for (let i = 0; i < n; i++) {
    if (la[i] !== lb[i]) {
      return {
        line: i + 1,
        expected: la[i] === undefined ? '<hết file>' : JSON.stringify(la[i]),
        actual: lb[i] === undefined ? '<hết file>' : JSON.stringify(lb[i]),
      };
    }
  }
  return null;
}

// ─── (a) Idempotence ─────────────────────────────────────────────────────────
function testIdempotence(files, ids) {
  console.log('\n=== (a) Idempotence trên file golden ===');
  let ok = 0;
  const fails = [];
  for (const p of files) {
    const raw = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
    const { mmd } = fullChain(raw);
    // So sánh bỏ qua khác biệt duy nhất ở dấu xuống dòng cuối file.
    const norm = (s) => s.replace(/\n+$/, '\n');
    const d = firstDiff(norm(raw), norm(mmd));
    if (!d) {
      ok++;
    } else {
      fails.push({ file: path.basename(p), ...d });
    }
  }
  console.log(`${ok === files.length ? GREEN('PASS') : RED('FAIL')}  ${ok}/${files.length} file bất biến`);
  for (const f of fails.slice(0, 8)) {
    console.log(`  ${RED(f.file)} dòng ${f.line}`);
    console.log(`    ${DIM('gốc  ')} ${f.expected}`);
    console.log(`    ${DIM('mới  ')} ${f.actual}`);
  }
  if (fails.length > 8) console.log(`  ... và ${fails.length - 8} file nữa`);
  return fails.length === 0;
}

// ─── (b) Fixture conform ─────────────────────────────────────────────────────
const FIXTURES = [
  {
    name: 'bóc code fence',
    input: '```markdown\nCâu 1. Tính $x$.\n```',
    expect: 'Câu 1. Tính $x$.',
  },
  {
    name: '\\( \\) -> $ $',
    input: 'Cho \\(x^2 + 1\\) và \\[y = 2\\].',
    expect: 'Cho $x^2 + 1$ và $y = 2$.',
  },
  {
    name: '$$ giữa dòng -> $',
    input: 'Ta có $$x=1$$ nên đúng.',
    expect: 'Ta có $x=1$ nên đúng.',
  },
  {
    name: '$$ đứng riêng giữ nguyên cho normalize',
    input: '$$\nx = 1\n$$',
    expect: '$$\nx = 1\n$$',
  },
  {
    name: '### PHẦN -> dòng thường',
    input: '### PHẦN I. TRẮC NGHIỆM',
    expect: 'PHẦN I. TRẮC NGHIỆM',
  },
  {
    name: '#### Câu N -> dòng thường',
    input: '#### Câu 3. Tính.',
    expect: 'Câu 3. Tính.',
  },
  {
    name: 'HƯỚNG DẪN GIẢI -> ## HƯỚNG DẪN GIẢI',
    input: '**HƯỚNG DẪN GIẢI**',
    expect: '## HƯỚNG DẪN GIẢI',
  },
  {
    name: 'ĐÁP ÁN - ĐỀ 2 -> ## (giữ hậu tố mã đề)',
    input: 'ĐÁP ÁN - ĐỀ 2',
    expect: '## ĐÁP ÁN - ĐỀ 2',
  },
  {
    name: 'KHÔNG biến câu văn "Đáp án 0,98. ..." thành heading',
    input: 'Đáp án $0{,}98$. Giá trị còn lại là $3$ (tỉ đồng).',
    expect: 'Đáp án $0{,}98$. Giá trị còn lại là $3$ (tỉ đồng).',
  },
  {
    name: 'KHÔNG đụng # ĐÁP ÁN CHI TIẾT',
    input: '# ĐÁP ÁN CHI TIẾT',
    expect: '# ĐÁP ÁN CHI TIẾT',
  },
  {
    name: '4 phương án dồn 1 dòng',
    input: 'A. 50. B. 45. C. 55. D. 40.',
    expect: 'A. 50.\nB. 45.\nC. 55.\nD. 40.',
  },
  {
    name: 'phương án dồn dòng có math',
    input: 'A. $[14; 15)$. B. $[15; 16)$. C. $[16; 17)$. D. $[17; 18)$.',
    expect: 'A. $[14; 15)$.\nB. $[15; 16)$.\nC. $[16; 17)$.\nD. $[17; 18)$.',
  },
  {
    name: 'không cắt nhầm câu văn có chữ A.',
    input: 'Câu 5. Cho điểm A. Tính khoảng cách B đến C.',
    expect: 'Câu 5. Cho điểm A. Tính khoảng cách B đến C.',
  },
  {
    name: 'bullet trước phương án',
    input: '- A. 50.\n- B. 45.',
    expect: 'A. 50.\nB. 45.',
  },
  {
    name: 'KHÔNG đụng __A.__ (đáp án gạch chân)',
    input: '__A.__ 50.',
    expect: '__A.__ 50.',
  },
  {
    name: 'Câu 1) -> Câu 1. (giữ nguyên Câu 1: và số in trên đề)',
    input: 'Câu 1) Tính.\nCâu 2: Tính.\nCâu 07. Tính.',
    expect: 'Câu 1. Tính.\nCâu 2: Tính.\nCâu 07. Tính.',
  },
  {
    name: 'bảng đúng/sai nhiều hàng: chỉ chèn 1 separator sau hàng đầu',
    input: '| Phát biểu | Đ | S |\n| a) $u_{2}=6$. |  |  |\n| b) Sai. |  |  |',
    expect: '| Phát biểu | Đ | S |\n| :--- | :--- | :--- |\n| a) $u_{2}=6$. |  |  |\n| b) Sai. |  |  |',
  },
  {
    name: 'bảng thiếu dòng phân cách',
    input: '| Nhóm | Tần số |\n| $[40; 45)$ | 4 |',
    expect: '| Nhóm | Tần số |\n| :--- | :--- |\n| $[40; 45)$ | 4 |',
  },
  {
    name: 'bảng đã có phân cách -> giữ nguyên',
    input: '| Nhóm | Tần số |\n| :--- | :--- |\n| $[40; 45)$ | 4 |',
    expect: '| Nhóm | Tần số |\n| :--- | :--- |\n| $[40; 45)$ | 4 |',
  },
  // Ba ca dưới khoá lại lỗi thật gặp khi chạy đề 11CA3: solver viết \begin{cases},
  // MathType không nuốt được. Trong 25 file golden chỉ có \begin{array}.
  {
    name: 'cases -> \\left\\{\\begin{array}{l}',
    input: 'Ta có $\\begin{cases} 3x - 2y = 16 \\\\ 2x - 3y = -6 \\end{cases}$.',
    expect: 'Ta có $\\left\\{\\begin{array}{l}3x - 2y = 16 \\\\ 2x - 3y = -6\\end{array}\\right.$.',
  },
  {
    name: 'aligned -> array{l}, bỏ mốc căn &',
    input: '$\\begin{aligned} x &= 1 \\\\ y &= 2 \\end{aligned}$',
    expect: '$\\begin{array}{l}x = 1 \\\\ y = 2\\end{array}$',
  },
  {
    name: 'KHÔNG đụng \\begin{array} sẵn đúng chuẩn',
    input: '$\\left\\{\\begin{array}{l}u_{1}=3 \\\\ u_{n}=3 u_{n-1}\\end{array}\\right.$',
    expect: '$\\left\\{\\begin{array}{l}u_{1}=3 \\\\ u_{n}=3 u_{n-1}\\end{array}\\right.$',
  },
  {
    name: 'KHÔNG đụng \\begin{tabular} (mmd2docx dựng thành bảng Word)',
    input: '\\begin{tabular}{|c|c|}\n$x$ & $y$ \\\\\n\\end{tabular}',
    expect: '\\begin{tabular}{|c|c|}\n$x$ & $y$ \\\\\n\\end{tabular}',
  },
];

function testConformFixtures() {
  console.log('\n=== (b) Fixture conform ===');
  let ok = 0;
  for (const fx of FIXTURES) {
    const got = conformMmd(fx.input).mmd;
    const again = conformMmd(got).mmd; // idempotent
    const pass = got === fx.expect && again === got;
    if (pass) ok++;
    else {
      console.log(`  ${RED('FAIL')} ${fx.name}`);
      console.log(`    ${DIM('mong ')} ${JSON.stringify(fx.expect)}`);
      console.log(`    ${DIM('nhận ')} ${JSON.stringify(got)}`);
      if (again !== got) console.log(`    ${DIM('lần2 ')} ${JSON.stringify(again)} (không idempotent)`);
    }
  }
  console.log(`${ok === FIXTURES.length ? GREEN('PASS') : RED('FAIL')}  ${ok}/${FIXTURES.length} fixture`);
  return ok === FIXTURES.length;
}

// ─── (b2) Fixture ghép trang / bóc hình / crop ───────────────────────────────
function deepEq(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

const UNIT_TESTS = [
  {
    name: 'stitch: bỏ số trang',
    run: () => stitchPages(['Câu 1. A.\nTrang 1/4', 'Câu 2. B.']).mmd,
    expect: 'Câu 1. A.\n\nCâu 2. B.\n',
  },
  {
    name: 'stitch: bỏ đoạn model chép lặp từ ngữ cảnh (>=30 ký tự)',
    run: () =>
      stitchPages([
        'Câu 7. Cho cấp số nhân có công bội $q=3$.\nA. $u_{1}=2$.',
        'Câu 7. Cho cấp số nhân có công bội $q=3$.\nA. $u_{1}=2$.\nB. $u_{1}=4$.',
      ]).mmd,
    expect: 'Câu 7. Cho cấp số nhân có công bội $q=3$.\nA. $u_{1}=2$.\n\nB. $u_{1}=4$.\n',
  },
  {
    name: 'stitch: trùng ngắn (<30 ký tự) KHÔNG bị cắt nhầm',
    run: () => stitchPages(['Câu 1. X.\nA. 1.', 'A. 1.\nB. 2.']).mmd,
    expect: 'Câu 1. X.\nA. 1.\n\nA. 1.\nB. 2.\n',
  },
  {
    name: 'stitch: nối bảng bị cắt trang (bỏ hàng tiêu đề lặp)',
    run: () =>
      stitchPages([
        '| Nhóm | Tần số |\n| :--- | :--- |\n| $[40; 45)$ | 4 |',
        '| Nhóm | Tần số |\n| :--- | :--- |\n| $[45; 50)$ | 11 |',
      ]).mmd,
    expect: '| Nhóm | Tần số |\n| :--- | :--- |\n| $[40; 45)$ | 4 |\n| $[45; 50)$ | 11 |\n',
  },
  {
    name: 'stitch: bỏ tiêu đề đề thi in lại ở trang sau',
    run: () =>
      stitchPages([
        'SỞ GD&ĐT HÀ NỘI\nTRƯỜNG THPT A\nĐỀ KIỂM TRA\n\nCâu 1. X.',
        'SỞ GD&ĐT HÀ NỘI\nTRƯỜNG THPT A\n\nCâu 2. Y.',
      ]).mmd,
    expect: 'SỞ GD&ĐT HÀ NỘI\nTRƯỜNG THPT A\nĐỀ KIỂM TRA\n\nCâu 1. X.\n\nCâu 2. Y.\n',
  },
  {
    name: 'figures: bbox nhiều định dạng phân cách',
    run: () => extractFigures('![](#p2_f1){bbox=1.0; 2.0 , 30.0,40.0}').figures,
    expect: [{ id: 'p2_f1', bbox: [1, 2, 30, 40], kind: 've' }],
  },
  // Loại hình quyết định có dựng lại bằng TikZ hay không, nên phải đọc đúng.
  {
    name: 'figures: kind=anh -> ảnh chụp, giữ ảnh gốc',
    run: () => extractFigures('![](#p1_f1){bbox=1,2,30,40,kind=anh}').figures,
    expect: [{ id: 'p1_f1', bbox: [1, 2, 30, 40], kind: 'anh' }],
  },
  {
    name: 'figures: kind=ve -> hình vẽ (giá trị của MMD trước 1.2.0, vẫn phải đọc được)',
    run: () => extractFigures('![](#p1_f1){bbox=1,2,30,40,kind=ve}').figures,
    expect: [{ id: 'p1_f1', bbox: [1, 2, 30, 40], kind: 've' }],
  },
  // Từ 1.2.0 loại hình chia nhỏ để chọn đúng khối luật vẽ — bảng biến thiên và đồ thị cần
  // luật khác hẳn hình không gian.
  {
    name: 'figures: đọc được năm loại hình mới',
    run: () =>
      ['bbt', 'dothi', 'khonggian', 'phang', 'model'].map(
        (k) => extractFigures(`![](#p1_f1){bbox=1,2,3,4,kind=${k}}`).figures[0].kind,
      ),
    expect: ['bbt', 'dothi', 'khonggian', 'phang', 'model'],
  },
  {
    name: 'figures: kind lạ -> rơi về ve, vẫn dựng lại được',
    run: () => extractFigures('![](#p1_f1){bbox=1,2,3,4,kind=biểu-đồ-lạ}').figures[0].kind,
    expect: 've',
  },
  {
    name: 'figures: nhánh JSON dự phòng đọc kind chứ không hardcode ve',
    run: () => {
      const mmd =
        'X\n```json\n{"figures":[{"id":"p1_f9","bbox":[1,2,3,4],"kind":"anh"}]}\n```';
      return extractFigures(mmd).figures;
    },
    expect: [{ id: 'p1_f9', bbox: [1, 2, 3, 4], kind: 'anh' }],
  },
  {
    name: 'figures: nhánh JSON dự phòng lọc id không hợp lệ',
    run: () => {
      const mmd = 'X\n```json\n{"figures":[{"id":"../evil","bbox":[1,2,3,4]}]}\n```';
      const r = extractFigures(mmd);
      return { n: r.figures.length, warn: r.warnings.length };
    },
    expect: { n: 0, warn: 1 },
  },
  {
    name: 'figures: thiếu kind -> mặc định hình vẽ (ưu tiên TikZ)',
    run: () => extractFigures('![](#p1_f1){bbox=1,2,30,40}').figures,
    expect: [{ id: 'p1_f1', bbox: [1, 2, 30, 40], kind: 've' }],
  },
  {
    name: 'figures: hình thiếu bbox bị bỏ dòng kèm cảnh báo',
    run: () => {
      const r = extractFigures('X\n![](#p1_f7)\nY');
      return { mmd: r.mmd, warn: r.warnings.length };
    },
    expect: { mmd: 'X\nY', warn: 1 },
  },
  {
    name: 'crop: nới 2% và kẹp trong khung',
    run: () => padClampBbox([0, 0, 50, 50], 1000, 1000),
    expect: { x: 0, y: 0, w: 520, h: 520 },
  },
  {
    name: 'crop: bbox quá nhỏ -> bỏ',
    run: () => padClampBbox([10, 10, 0.5, 0.5], 200, 200),
    expect: null,
  },
];

function testUnits() {
  console.log('\n=== (b2) Ghép trang / bóc hình / crop ===');
  let ok = 0;
  for (const t of UNIT_TESTS) {
    let got;
    try {
      got = t.run();
    } catch (e) {
      got = `THROW ${e.message}`;
    }
    if (deepEq(got, t.expect)) ok++;
    else {
      console.log(`  ${RED('FAIL')} ${t.name}`);
      console.log(`    ${DIM('mong ')} ${JSON.stringify(t.expect)}`);
      console.log(`    ${DIM('nhận ')} ${JSON.stringify(got)}`);
    }
  }
  console.log(`${ok === UNIT_TESTS.length ? GREEN('PASS') : RED('FAIL')}  ${ok}/${UNIT_TESTS.length} ca`);
  return ok === UNIT_TESTS.length;
}

// ─── (c) QC ──────────────────────────────────────────────────────────────────
function testQc(files, ids) {
  console.log('\n=== (c) QC trên file golden ===');
  let errFiles = 0;
  let totalErr = 0;
  let totalWarn = 0;
  for (const p of files) {
    const raw = fs.readFileSync(p, 'utf8');
    const issues = qcMmd(raw, { figureIds: ids });
    const errs = issues.filter((i) => i.severity === 'error');
    const warns = issues.filter((i) => i.severity === 'warn');
    totalErr += errs.length;
    totalWarn += warns.length;
    if (errs.length) {
      errFiles++;
      console.log(`  ${RED(path.basename(p))}`);
      for (const e of errs.slice(0, 5)) {
        console.log(`    - ${e.line ? `dòng ${e.line}: ` : ''}${e.message}`);
      }
      if (errs.length > 5) console.log(`    ... ${errs.length - 5} lỗi nữa`);
    }
  }
  console.log(
    `${totalErr === 0 ? GREEN('PASS') : RED('FAIL')}  ${totalErr} lỗi / ${totalWarn} cảnh báo trên ${files.length} file (${errFiles} file có lỗi)`,
  );
  return totalErr === 0;
}

// ─── main ────────────────────────────────────────────────────────────────────
const files = listMmd();
if (!files.length) {
  console.error(RED(`Không tìm thấy .mmd nào trong ${MMD_DIRS.join(' | ')}`));
  process.exit(1);
}
const ids = figureIds();
console.log(`${files.length} file golden, ${ids.size} hình.`);

const a = testIdempotence(files, ids);
const b = testConformFixtures();
const b2 = testUnits();
const c = testQc(files, ids);

console.log('');
if (a && b && b2 && c) {
  console.log(GREEN('TẤT CẢ PASS'));
  process.exit(0);
}
console.log(RED('CÓ MỤC CHƯA PASS'));
process.exit(2);
