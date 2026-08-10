/**
 * Kiểm chứng giả định cốt lõi của Phần 2: khối MMD do solver sinh ra phải chạy lọt
 * qua `restructureAnswers` (port nguyên văn từ restructure_answers.js) và cho ra đúng
 * bố cục file mẫu — câu lặp lại, đáp án đúng gạch chân __X.__, dòng "Lời giải",
 * "Chọn X." / "Đáp số: v", ý đúng/sai.
 *
 * Không gọi Gemini: lời giải ở đây là dữ liệu giả, mục đích là kiểm HÌNH DẠNG.
 *
 * Usage: node scripts/verify-solver-shape.mjs
 */

import process from 'node:process';

import { splitForSolving, renderSolutionsMmd } from '../src/pipeline/solveExam.ts';
import { conformMmd } from '../src/pipeline/conform.ts';
import { applyExamTransforms } from '../src/pipeline/examTransforms.ts';
import { qcMmd } from '../src/pipeline/qc.ts';
import { buildExamDocx } from '../src/pipeline/mmdToDocx.ts';
import { Packer } from 'docx';

const GREEN = (s) => `\x1b[32m${s}\x1b[0m`;
const RED = (s) => `\x1b[31m${s}\x1b[0m`;

const EXAM = `PHẦN I. CÂU TRẮC NGHIỆM NHIỀU PHƯƠNG ÁN LỰA CHỌN

Câu 1. Cho cấp số cộng $\\left(u_{n}\\right)$ có $u_{1}=3$, công sai $d=2$. Số hạng $u_{5}$ bằng
A. 9.
B. 11.
C. 13.
D. 15.

Câu 2. Cho hình chóp $S.ABCD$ có đáy là hình vuông cạnh $a$. Góc giữa $SC$ và $(ABCD)$ bằng
A. $30^{\\circ}$.
B. $45^{\\circ}$.
C. $60^{\\circ}$.
D. $90^{\\circ}$.

PHẦN II. CÂU TRẮC NGHIỆM ĐÚNG SAI

Câu 1. Cho dãy số $\\left(u_{n}\\right)$ với $u_{n}=2n+1$.

a) $u_{1}=3$.
b) Dãy số là cấp số nhân.

PHẦN III. CÂU TRẮC NGHIỆM TRẢ LỜI NGẮN

Câu 1. Tính tổng 10 số hạng đầu của cấp số cộng $1; 3; 5; \\ldots$
`;

const refs = splitForSolving(EXAM);

const FAKE = {
  'I|1': { chon: 'B', loiGiai: ['Ta có $u_{5}=u_{1}+4d=3+8=11$.', 'Vậy $u_{5}=11$.'] },
  'I|2': { chon: 'B', loiGiai: ['Ta có $SA \\perp (ABCD)$ nên góc cần tìm là $45^{\\circ}$.', 'Vậy chọn $45^{\\circ}$.'] },
  'II|1': {
    yKien: [
      { y: 'a', dung: true, giaiThich: 'Thay $n=1$ ta được $u_{1}=3$.' },
      { y: 'b', dung: false, giaiThich: 'Hiệu hai số hạng liên tiếp không đổi nên đây là cấp số cộng.' },
    ],
    loiGiai: [],
  },
  'III|1': { dapSo: '100', loiGiai: ['Ta có $S_{10}=\\frac{10(1+19)}{2}=100$.', 'Vậy tổng bằng $100$.'] },
};

const ROMAN = ['I', 'II', 'III', 'IV'];
const solved = refs.map((ref) => {
  const key = `${ROMAN[ref.partIndex - (refs[0].partIndex ?? 0)] ?? ref.partIndex}|${ref.num}`;
  const f = FAKE[key] ?? FAKE[`${ROMAN[ref.partKey - 1]}|${ref.num}`] ?? {};
  return {
    ref,
    chon: f.chon ?? null,
    yKien: f.yKien ?? null,
    dapSo: f.dapSo ?? null,
    loiGiai: f.loiGiai ?? [],
    figureId: null,
    figureReason: null,
    disagreement: false,
    failed: false,
  };
});

// Lời giải đi qua conform y như trong runPipeline — bảng `## ĐÁP ÁN` phải giữ hàng
// "Câu" và "Đáp án" sát nhau, nếu bị chèn dòng phân cách thì mất hết "Đáp số:".
const solutionsMmd = conformMmd(renderSolutionsMmd(solved), { insertTableSeparators: false }).mmd;
const combined = EXAM.trimEnd() + '\n\n' + solutionsMmd;
const { mmd: final, report } = applyExamTransforms(combined);

const checks = [
  ['có mục ĐÁP ÁN CHI TIẾT', () => final.includes('# ĐÁP ÁN CHI TIẾT')],
  ['gạch chân đáp án đúng câu I.1', () => /__B\.__ 11\./.test(final)],
  ['gạch chân đáp án đúng câu I.2', () => /__B\.__ \$45\^\{\\circ\}\$\./.test(final)],
  ['có dòng "Lời giải" cho mỗi câu', () => (final.match(/^Lời giải$/gm) || []).length === refs.length],
  ['có dòng "Chọn B."', () => /^Chọn B\.$/m.test(final)],
  ['câu đúng/sai KHÔNG có dòng Chọn', () => !/Chọn\s*\.\s*$/m.test(final)],
  ['ý đúng/sai dạng a) **Đúng**.', () => /a\) \*\*Đúng\*\*\./.test(final)],
  ['câu trả lời ngắn có "Đáp số: 100"', () => /^Đáp số: 100$/m.test(final)],
  ['KHÔNG còn bảng đáp án tổng hợp trong output', () => !/\|\s*Đáp án\s*\|/.test(final)],
  ['tiêu đề phần được chuẩn hoá', () => /^PHẦN III\. CÂU TRẮC NGHIỆM TRẢ LỜI NGẮN$/m.test(final)],
  ['không câu nào bị thiếu lời giải', () => (report.restructure?.missing.length ?? 0) === 0],
];

console.log('=== Solver -> restructureAnswers ===');
let ok = 0;
for (const [name, fn] of checks) {
  let pass = false;
  try {
    pass = fn();
  } catch (e) {
    pass = false;
  }
  if (pass) ok++;
  else console.log(`  ${RED('FAIL')} ${name}`);
}
console.log(`${ok === checks.length ? GREEN('PASS') : RED('FAIL')}  ${ok}/${checks.length} tiêu chí`);

const issues = qcMmd(final);
const errs = issues.filter((i) => i.severity === 'error');
console.log(`${errs.length === 0 ? GREEN('PASS') : RED('FAIL')}  QC: ${errs.length} lỗi, ${issues.filter((i) => i.severity === 'warn').length} cảnh báo`);
for (const e of errs) console.log(`    - ${e.line ? `dòng ${e.line}: ` : ''}${e.message}`);

// Sinh thử docx để chắc chắn không ném lỗi
let docxOk = false;
try {
  const buf = await Packer.toBuffer(buildExamDocx(final));
  docxOk = buf.length > 5000;
} catch (e) {
  console.log(`  ${RED('FAIL')} sinh docx: ${e.message}`);
}
console.log(`${docxOk ? GREEN('PASS') : RED('FAIL')}  sinh được .docx`);

// ─── Đề KHÔNG có tiêu đề PHẦN, trộn trắc nghiệm với tự luận ──────────────────
//
// Hình dạng này lấy từ đề thật 11CA3_KTTX3_HK1: kiểm tra thường xuyên nên không chia
// phần, câu 1 có phương án còn câu 2 là bài tự luận. Trước đây cả khối bị gán chung
// một loại nên câu tự luận cũng bị coi là trắc nghiệm và nhận dòng "Chọn ?." vô nghĩa.

const MIXED = `Câu 1. Số hạng $u_{5}$ của cấp số cộng $1; 3; 5; \\ldots$ bằng
A. 7.
B. 9.
C. 11.
D. 13.

Câu 2. Cho mẫu số liệu ghép nhóm có số trung bình $8{,}1$ và mốt $7{,}75$. Tìm $x+y$.

Câu 3. Cho dãy số $\\left(u_{n}\\right)$ với $u_{n}=2n+1$.

a) $u_{1}=3$.
b) Dãy số là cấp số nhân.
`;

const mixedRefs = splitForSolving(MIXED);
const typeOf = (n) => mixedRefs.find((r) => Number(r.num) === n)?.type;

const mixedChecks = [
  ['tách đúng 3 câu', () => mixedRefs.length === 3],
  ['câu có phương án -> TN', () => typeOf(1) === 'TN'],
  ['câu không phương án -> TL (không phải TN)', () => typeOf(2) === 'TL'],
  ['câu có ý a)/b) -> DS', () => typeOf(3) === 'DS'],
];

console.log('\n=== Đề không có tiêu đề PHẦN (trộn loại câu) ===');
let ok2 = 0;
for (const [name, fn] of mixedChecks) {
  let pass = false;
  try {
    pass = fn();
  } catch {
    pass = false;
  }
  if (pass) ok2++;
  else console.log(`  ${RED('FAIL')} ${name} (nhận: ${mixedRefs.map((r) => `${r.num}=${r.type}`).join(' ')})`);
}
console.log(`${ok2 === mixedChecks.length ? GREEN('PASS') : RED('FAIL')}  ${ok2}/${mixedChecks.length} tiêu chí`);

// Câu tự luận không được sinh dòng "Chọn".
const mixedSolved = mixedRefs.map((ref) => ({
  ref,
  chon: ref.type === 'TN' ? 'B' : null,
  yKien:
    ref.type === 'DS'
      ? [{ y: 'a', dung: true, giaiThich: 'Thay $n=1$.' }, { y: 'b', dung: false, giaiThich: 'Là cấp số cộng.' }]
      : null,
  dapSo: null,
  loiGiai: ['Ta có kết quả cần tìm.', 'Vậy xong.'],
  figureId: null,
  figureReason: null,
  disagreement: false,
  failed: false,
}));
const mixedMmd = renderSolutionsMmd(mixedSolved);
const noStrayChon = !/Chọn \?/.test(mixedMmd);
console.log(
  `${noStrayChon ? GREEN('PASS') : RED('FAIL')}  không sinh "Chọn ?." cho câu tự luận`,
);

if (process.argv.includes('--print')) {
  console.log('\n--- MMD cuối ---\n' + final);
  console.log('\n--- MMD đề trộn loại ---\n' + mixedMmd);
}

const allOk = ok === checks.length && errs.length === 0 && docxOk && ok2 === mixedChecks.length && noStrayChon;
process.exit(allOk ? 0 : 2);
