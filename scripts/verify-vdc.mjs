/**
 * Kiểm định dạng VDC: docx sinh ra phải khớp spec đo từ hai file mẫu của người dùng,
 * và .txt phải đúng luật của skill "vn-exam-extractor".
 *
 * Usage: node scripts/verify-vdc.mjs
 */

import process from 'node:process';
import { Packer } from 'docx';

import { buildVdcDocx } from '../src/pipeline/mmdToDocxVdc.ts';
import { buildExamDocx } from '../src/pipeline/mmdToDocx.ts';
import { mmdToVdcTxt } from '../src/pipeline/mmdToVdcTxt.ts';
import { applyVdcLatex } from '../src/pipeline/vdcLatex.ts';

const GREEN = (s) => `\x1b[32m${s}\x1b[0m`;
const RED = (s) => `\x1b[31m${s}\x1b[0m`;

const MMD = `PHẦN I. CÂU TRẮC NGHIỆM NHIỀU PHƯƠNG ÁN LỰA CHỌN

Câu 1. Cho hình chóp $S.ABCD$. Góc giữa $SC$ và $(ABCD)$ bằng
A. $30^{\\circ}$.
B. $45^{\\circ}$.
C. $60^{\\circ}$.
D. $90^{\\circ}$.

# ĐÁP ÁN CHI TIẾT

Câu 1. Cho hình chóp $S.ABCD$. Góc giữa $SC$ và $(ABCD)$ bằng
A. $30^{\\circ}$.
__B.__ $45^{\\circ}$.
C. $60^{\\circ}$.
D. $90^{\\circ}$.

Lời giải

Chọn B.

Ta có $SA \\perp (ABCD)$ nên góc bằng $45^{\\circ}$.

Câu 2. Xét tính đúng sai:

a) **Đúng**. Thay $n=1$ ta được $u_{1}=3$.
b) **Sai**. Đây là cấp số cộng.

Câu 3. Tính tổng.

Lời giải

Đáp số: 12,2
`;

// ── Kiểm docx ────────────────────────────────────────────────────────────────
const buf = await Packer.toBuffer(buildVdcDocx(applyVdcLatex(MMD)));
const xml = buf.toString('latin1');
// Nội dung tiếng Việt nằm trong zip đã nén, nên đọc XML thô không thấy chữ.
// Dùng bản không nén để soi: docx lib nén, ta bung bằng cách so trên chuỗi thuộc tính.
const { default: JSZip } = await import('jszip');
const zip = await JSZip.loadAsync(buf);
const doc = await zip.file('word/document.xml').async('string');
const header = (await zip.file('word/header1.xml')?.async('string')) ?? '';
const hasFooter = Object.keys(zip.files).some((f) => /footer\d*\.xml$/.test(f));

const checks = [
  ['font Palatino Linotype', () => /w:ascii="Palatino Linotype"/.test(doc)],
  ['cỡ chữ 23 (11.5pt)', () => /<w:sz w:val="23"\/>/.test(doc)],
  ['lề 850 bốn phía', () => /w:top="850"[^/]*w:right="850"[^/]*w:bottom="850"[^/]*w:left="850"/.test(doc)],
  ['khổ A4 11907x16840', () => /w:w="11907"[^/]*w:h="16840"/.test(doc)],
  ['KHÔNG in nhãn "Câu N."', () => !/>Câu \d/.test(doc)],
  ['tab phương án 3330/6030/8370', () => /w:pos="3330"/.test(doc) && /w:pos="6030"/.test(doc) && /w:pos="8370"/.test(doc)],
  ['phương án thụt 900', () => /<w:ind w:left="900"/.test(doc)],
  ['đáp án đúng đỏ FF0000', () => /<w:color w:val="FF0000"\/>/.test(doc)],
  ['đáp án đúng highlight vàng', () => /<w:highlight w:val="yellow"\/>/.test(doc)],
  ['đáp án đúng gạch chân', () => /<w:u /.test(doc)],
  ['chữ cái phương án xanh 0000FF', () => /<w:color w:val="0000FF"\/>/.test(doc)],
  ['KHÔNG có dòng "Chọn X."', () => !/>Chọn /.test(doc)],
  ['đúng/sai viết HOA', () => /ĐÚNG/.test(doc) && /SAI/.test(doc)],
  ['ô đáp án nền vàng FFFF00', () => /w:fill="FFFF00"/.test(doc)],
  ['ô đáp án rộng 360', () => /<w:tcW [^>]*w:w="360"/.test(doc)],
  ['có header của nhóm', () => /VDC Bhp/.test(header)],
  ['KHÔNG có footer', () => !hasFooter],
];

console.log('=== docx định dạng VDC ===');
let ok = 0;
for (const [name, fn] of checks) {
  let pass = false;
  try {
    pass = fn();
  } catch {
    pass = false;
  }
  if (pass) ok++;
  else console.log(`  ${RED('FAIL')} ${name}`);
}
console.log(`${ok === checks.length ? GREEN('PASS') : RED('FAIL')}  ${ok}/${checks.length} tiêu chí`);

// ── Kiểm .txt ────────────────────────────────────────────────────────────────
const txt = mmdToVdcTxt(applyVdcLatex(MMD));
const txtChecks = [
  ['bỏ nhãn "Câu N."', () => !/^Câu \d/m.test(txt)],
  ['mỗi phương án một dòng', () => /^A\. /m.test(txt) && /^B\. /m.test(txt) && /^D\. /m.test(txt)],
  ['ý đúng/sai dùng a) b)', () => /^a\) ĐÚNG/m.test(txt) && /^b\) SAI/m.test(txt)],
  ['có dòng trống giữa hai câu', () => /\n\n/.test(txt)],
  ['không có ba dòng trống liền', () => !/\n{3}/.test(txt)],
  ['không có dòng "Chọn"', () => !/Chọn/.test(txt)],
];

console.log('\n=== .txt theo skill ===');
let ok2 = 0;
for (const [name, fn] of txtChecks) {
  const pass = fn();
  if (pass) ok2++;
  else console.log(`  ${RED('FAIL')} ${name}`);
}
console.log(`${ok2 === txtChecks.length ? GREEN('PASS') : RED('FAIL')}  ${ok2}/${txtChecks.length} tiêu chí`);

// ── Quy ước LaTeX của VDC ────────────────────────────────────────────────────
const latexCases = [
  ['ngoặc tròn -> \\left( \\right)', '$f(x)$', '$f\\left(x\\right)$'],
  ['dấu phẩy trên -> {A}\'', "$A'B'$", "${A}'{B}'$"],
  ['tên hệ trục -> ${O}xyz$', '$Oxyz$', '${O}xyz$'],
  ['số trần bỏ $...$', 'xác suất $0{,}7$ là', 'xác suất 0,7 là'],
  ['tích phân -> \\int\\limits + bọc', '$\\int_{0}^{2} f(x) dx$', '$\\int\\limits_{0}^{2}{{f\\left(x\\right)}dx}$'],
  ['chạy 2 lần không đổi', '$f(x)$', null],
];

console.log('\n=== quy ước LaTeX VDC ===');
let ok3 = 0;
for (const [name, input, expect] of latexCases) {
  const got = applyVdcLatex(input);
  const twice = applyVdcLatex(got);
  const pass = expect === null ? twice === got : got === expect && twice === got;
  if (pass) ok3++;
  else {
    console.log(`  ${RED('FAIL')} ${name}`);
    console.log(`      mong ${JSON.stringify(expect)}`);
    console.log(`      nhận ${JSON.stringify(got)}${twice !== got ? ` (lần 2: ${JSON.stringify(twice)})` : ''}`);
  }
}
console.log(`${ok3 === latexCases.length ? GREEN('PASS') : RED('FAIL')}  ${ok3}/${latexCases.length} tiêu chí`);

// ── Định dạng K11 KHÔNG được đổi ─────────────────────────────────────────────
const k11zip = await JSZip.loadAsync(await Packer.toBuffer(buildExamDocx(MMD)));
const k11doc = await k11zip.file('word/document.xml').async('string');
// Font mặc định của K11 khai ở styles.xml (docDefaults), không lặp lại trong từng run.
const k11styles = await k11zip.file('word/styles.xml').async('string');
const k11ok =
  /Times New Roman/.test(k11styles) && /Câu 1\./.test(k11doc) && /Chọn B/.test(k11doc);
console.log(`\n${k11ok ? GREEN('PASS') : RED('FAIL')}  K11 vẫn giữ Times New Roman, "Câu N.", dòng "Chọn"`);

process.exit(ok === checks.length && ok2 === txtChecks.length && ok3 === latexCases.length && k11ok ? 0 : 2);
