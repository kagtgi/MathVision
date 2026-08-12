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
import { parseMmdBlocks } from '../src/pipeline/mmdBlocks.ts';
import { default as JSZip } from 'jszip';
import { makePng } from './lib/png.mjs';
import { conformMmd } from '../src/pipeline/conform.ts';
import { applyExamTransforms, asHeading, typeFromBody } from '../src/pipeline/examTransforms.ts';
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

// ─── Trình bày hình: trong ĐỀ khác trong LỜI GIẢI ────────────────────────────
//
// Hinh trong loi giai la duong MOI cua 1.3 (solver tu ve hinh minh hoa cho loi giai), va
// 25 de golden khong co ca nao — 12/12 dong anh cua chung deu o khoi de. Nen khong harness
// nao phu cho vi tri nay, phai chot o day.

const FIG_MMD = `Câu 1. Cho hình chóp $S.ABCD$.

![](#de_f1)

A. 1.
B. 2.
C. 3.
D. 4.

# ĐÁP ÁN CHI TIẾT

Câu 1. Cho hình chóp $S.ABCD$.

![](#de_f1)

__B.__ 2.

Lời giải

Chọn B.

![](#sol_c1_f1)

Ta có kết quả cần tìm.
`;

const figs = new Map([
  ['de_f1', { bytes: makePng(400, 300), w: 400, h: 300 }],
  // Cao ngoẵng có chủ ý: 200×1200 px là ca mà bản trước co theo chiều rộng KHÔNG chạm tới,
  // cho ra 3,97 × 23,81 cm — gần trọn 27,7 cm chiều cao chữ, một hình chiếm cả trang.
  ['sol_c1_f1', { bytes: makePng(200, 1200), w: 200, h: 1200 }],
]);
const figResolver = (ref) => figs.get(String(ref).replace(/^#/, '')) ?? null;

const figBlocks = parseMmdBlocks(FIG_MMD).filter((b) => b.kind === 'image');
const figZip = await JSZip.loadAsync(
  await Packer.toBuffer(buildExamDocx(FIG_MMD, figResolver)),
);
const figDoc = await figZip.file('word/document.xml').async('string');
/** Đoạn ảnh, theo thứ tự xuất hiện: đề, đề (in lại), lời giải. */
const imgParas = [...figDoc.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)]
  .map((m) => m[0])
  .filter((p) => p.includes('<w:drawing>'));
const extents = [...figDoc.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"\/>/g)].map((m) => ({
  w: Number(m[1]) / 9525,
  h: Number(m[2]) / 9525,
}));

const figChecks = [
  ['quét ra 3 dòng ảnh', () => figBlocks.length === 3],
  ['ảnh trong khối đề: inSolution = false', () => figBlocks.slice(0, 2).every((b) => !b.inSolution)],
  ['ảnh trong lời giải: inSolution = true', () => figBlocks[2].inSolution === true],
  ['docx có đúng 3 đoạn ảnh', () => imgParas.length === 3],
  // Hình đề giữ nguyên bản cũ: indent 0. Đây là thứ giữ cho 25 golden trùng từng byte.
  ['ảnh đề KHÔNG thụt lề', () => !/<w:ind /.test(imgParas[0])],
  ['ảnh lời giải thụt 992 (canh giữa theo cột lời giải)', () => /<w:ind w:left="992"/.test(imgParas[2])],
  ['ảnh lời giải có spacing riêng (before/after 80)', () => /w:before="80"/.test(imgParas[2])],
  ['trần cao 420: hình 200x1200 bị co', () => extents[2].h <= 420 + 1],
  ['co đúng tỉ lệ (200x1200 -> 70x420)', () => Math.abs(extents[2].w - 70) <= 1],
  ['hình đề 400x300 KHÔNG bị co (dưới cả hai trần)', () =>
    Math.abs(extents[0].w - 300) <= 1 && Math.abs(extents[0].h - 225) <= 1],
];

// ─── Đề chính thức THPT 2025 ─────────────────────────────────────────────────
//
// Ba tieu de duoi day chep NGUYEN VAN tu de chinh thuc 2025 ma 0101. Chay that mot ma de moi
// phat hien duoc bo dau: PHAN II khong nhan ra vi de viet "chon dung HOAC sai" (regex cu doi
// "dung-sai" lien), va PHAN III khong co tu khoa loai nao nen ca 6 cau tra loi ngan bi giai
// thanh tu luan — khong cau nao co dong "Dap so:". Mot luot chay that ton vai phut va vai chuc
// nghin token, nen phai chot lai o day.

const H2025 = {
  I: 'PHẦN I. Thí sinh trả lời từ câu 1 đến câu 12. Mỗi câu hỏi thí sinh chỉ chọn một phương án.',
  II: 'PHẦN II. Thí sinh trả lời từ câu 1 đến 4. Trong mỗi ý a), b), c), d) ở mỗi câu, thí sinh chọn đúng hoặc sai.',
  III: 'PHẦN III. Thí sinh trả lời từ câu 1 đến câu 6.',
};

const MMD_2025 = `${H2025.I}

Câu 1: Cho hình lăng trụ $ABC.A'B'C'$. Phát biểu nào sau đây là đúng?
A. 1.
B. 2.
C. 3.
D. 4.

${H2025.II}

Câu 1: Cho hàm số $f(x) = x^{3} - 12x - 8$.
a) Hàm số có đạo hàm $f'(x) = 3x^{2} - 12$.
b) Phương trình $f'(x) = 0$ có tập nghiệm $S = \\{2\\}$.

${H2025.III}

Câu 1: Bạn Nam chọn sáu số từ tập $S$. Giá trị của $\\frac{1}{a}$ bằng bao nhiêu?

Câu 2: Một vật chuyển động. Tính quãng đường (làm tròn đến hàng đơn vị).
`;

const t2025 = applyExamTransforms(MMD_2025).mmd;

const c2025 = [
  ['PHẦN I: nhận ra qua "phương án"', () => asHeading(H2025.I)?.type === 'TN'],
  // "chọn đúng HOẶC sai" — bản trước chỉ khớp "đúng-sai" liền nên trượt.
  ['PHẦN II: nhận ra "chọn đúng hoặc sai"', () => asHeading(H2025.II)?.type === 'DS'],
  // Là tiêu đề THẬT nhưng không nói loại: phải trả về heading với type null, KHÔNG phải null.
  ['PHẦN III: là tiêu đề, nhưng chưa rõ loại', () => {
    const h = asHeading(H2025.III);
    return h !== null && h.type === null;
  }],
  ['câu hỏi "bằng bao nhiêu" -> TLN', () => typeFromBody(['Giá trị của $x$ bằng bao nhiêu?']) === 'TLN'],
  ['câu hỏi "làm tròn đến" -> TLN', () => typeFromBody(['Tính quãng đường (làm tròn đến hàng đơn vị).']) === 'TLN'],
  ['câu tự luận thường vẫn là TL', () => typeFromBody(['Chứng minh rằng $AB \\perp CD$.']) === 'TL'],
  // Kết quả cuối: cả ba phần phải mang TÊN CHUẨN.
  ['đặt tên chuẩn cho cả ba phần', () =>
    /PHẦN I\. CÂU TRẮC NGHIỆM NHIỀU PHƯƠNG ÁN LỰA CHỌN/.test(t2025) &&
    /PHẦN II\. CÂU TRẮC NGHIỆM ĐÚNG SAI/.test(t2025) &&
    /PHẦN III\. CÂU TRẮC NGHIỆM TRẢ LỜI NGẮN/.test(t2025)],
  ['splitForSolving gán đúng loại cho câu của PHẦN III', () => {
    const refs = splitForSolving(t2025);
    return refs.filter((r) => r.type === 'TLN').length === 2;
  }],
];

console.log('\n=== Đề chính thức THPT 2025 (mã 0101) ===');
let ok5 = 0;
for (const [name, fn] of c2025) {
  let pass = false;
  try {
    pass = fn();
  } catch {
    pass = false;
  }
  if (pass) ok5++;
  else console.log(`  ${RED('FAIL')} ${name}`);
}
console.log(`${ok5 === c2025.length ? GREEN('PASS') : RED('FAIL')}  ${ok5}/${c2025.length} tiêu chí`);

// ─── Công tắc số trang ───────────────────────────────────────────────────────

const zipOf = async (opts) => JSZip.loadAsync(await Packer.toBuffer(buildExamDocx(FIG_MMD, figResolver, opts)));
const zipOn = await zipOf({});
const zipOff = await zipOf({ pageNumbers: false });
const footerFiles = (z) => Object.keys(z.files).filter((f) => /footer\d*\.xml$/.test(f));
const docOn = await zipOn.file('word/document.xml').async('string');
const docOff = await zipOff.file('word/document.xml').async('string');

const pageChecks = [
  // Mặc định BẬT là thứ giữ cho 25 đề golden trùng từng byte — đổi mặc định là vỡ verify-docx.
  ['mặc định có footer "Trang N"', () => footerFiles(zipOn).length === 1],
  ['tắt thì BỎ HẲN file footer, không phải footer rỗng', () => footerFiles(zipOff).length === 0],
  ['tắt thì document.xml không còn tham chiếu footer', () => !/<w:footerReference/.test(docOff)],
  ['bật thì document.xml CÓ tham chiếu footer', () => /<w:footerReference/.test(docOn)],
  // Chỉ footer đổi; lề, khổ giấy và toàn bộ nội dung phải y nguyên.
  ['tắt số trang KHÔNG đụng tới lề trang', () => {
    const m = (d) => (d.match(/<w:pgMar[^/]*\/>/) ?? [''])[0];
    return m(docOn) === m(docOff) && m(docOn).includes('w:left="851"');
  }],
];

console.log('\n=== Công tắc số trang ===');
let ok4 = 0;
for (const [name, fn] of pageChecks) {
  let pass = false;
  try {
    pass = fn();
  } catch {
    pass = false;
  }
  if (pass) ok4++;
  else console.log(`  ${RED('FAIL')} ${name}`);
}
console.log(`${ok4 === pageChecks.length ? GREEN('PASS') : RED('FAIL')}  ${ok4}/${pageChecks.length} tiêu chí`);

console.log('\n=== Trình bày hình: khối đề vs lời giải ===');
let ok3 = 0;
for (const [name, fn] of figChecks) {
  let pass = false;
  let why = '';
  try {
    pass = fn();
  } catch (e) {
    why = e.message;
  }
  if (pass) ok3++;
  else console.log(`  ${RED('FAIL')} ${name}${why ? ` (${why})` : ''}`);
}
console.log(`${ok3 === figChecks.length ? GREEN('PASS') : RED('FAIL')}  ${ok3}/${figChecks.length} tiêu chí`);

if (process.argv.includes('--print')) {
  console.log('\n--- MMD cuối ---\n' + final);
  console.log('\n--- MMD đề trộn loại ---\n' + mixedMmd);
}

const allOk =
  ok === checks.length &&
  errs.length === 0 &&
  docxOk &&
  ok2 === mixedChecks.length &&
  noStrayChon &&
  ok3 === figChecks.length &&
  ok4 === pageChecks.length &&
  ok5 === c2025.length;
process.exit(allOk ? 0 : 2);
