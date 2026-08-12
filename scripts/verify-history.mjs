/**
 * Kiểm vòng đời lịch sử: lưu -> đọc lại -> xuất Word phải RA Y NHƯ CŨ.
 *
 * Đây là harness duy nhất chứng minh được lời hứa của tính năng lịch sử. Tự chứa, không cần
 * dữ liệu ngoài, không thêm dependency (`jszip` đã là dependency trực tiếp của `docx`).
 *
 * PHÉP SO "GIỐNG NHAU" LÀ GÌ, và vì sao KHÔNG so byte cả file:
 * `docx@9.6.1` sinh `dcterms:created`/`dcterms:modified` từ `new Date()` và
 * `IPropertiesOptions` không có tuỳ chọn nào để ghim; JSZip cũng dập mtime từng entry. Nên
 * byte cả file KHÔNG BAO GIỜ trùng giữa hai lần build. Nhưng `ImageRun` đặt tên
 * `word/media/<sha1-của-bytes>.png`, còn `uniqueId()` (nanoid) chỉ dùng cho hyperlink và VML
 * `pict` — hai thứ đường ống này không sinh. Vậy `word/document.xml` VÀ TẬP TÊN FILE MEDIA là
 * tất định. Đó đúng là định nghĩa `verify-docx.mjs` đang dùng.
 *
 * Và vì tên media là hash nội dung, **sai một byte hình sẽ hiện ra thành tên file khác trong
 * `document.xml`** — nên phép so này bắt được cả lỗi hỏng bytes hình.
 *
 * Usage: node scripts/verify-history.mjs
 */

import crypto from 'node:crypto';
import process from 'node:process';

import JSZip from 'jszip';
import { Packer } from 'docx';

import { buildExamDocx, pngSize } from '../src/pipeline/mmdToDocx.ts';
import { buildVdcDocx } from '../src/pipeline/mmdToDocxVdc.ts';
import { makeFigureResolver } from '../src/pipeline/figures.ts';
import { qcMmd } from '../src/pipeline/qc.ts';
import {
  buildPreview,
  figureMapToRecords,
  plainExcerpt,
  recordsToFigureMap,
  totalFigureBytes,
} from '../src/history/serialize.ts';

const GREEN = (s) => `\x1b[32m${s}\x1b[0m`;
const RED = (s) => `\x1b[31m${s}\x1b[0m`;

// PNG fixture dùng chung ba harness — xem `scripts/lib/png.mjs`.
const { makePng } = await import('./lib/png.mjs');
const { DEFAULT_TOGGLES, normalizeToggles } = await import('../src/pipeline/toggles.ts');
const { DEFAULT_WORD_OPTIONS, normalizeWordOptions } = await import('../src/pipeline/wordOptions.ts');

const sha = (u8) => crypto.createHash('sha256').update(u8).digest('hex');

// ─── Dữ liệu thử ─────────────────────────────────────────────────────────────

const figA = makePng(40, 30, 1);
const figB = makePng(24, 24, 2);
const figC = makePng(60, 20, 3);

/**
 * Id thứ ba CỐ Ý là dạng chưa lọc mà nhánh JSON dự phòng của `prompts.ts` từng cho qua.
 * Nó phải KHÔNG được dùng làm tên file.
 */
const BAD_ID = '../evil';

const sourceMap = new Map([
  ['p1_f1', { bytes: figA, w: 40, h: 30, source: 'crop' }],
  // `genai` là giá trị thứ ba của `FigureSource`, thêm ở 1.3. Round-trip nó ở đây để việc mở
  // rộng union không âm thầm làm mất nhãn nguồn khi mở lại mục lịch sử.
  ['p2_f1', { bytes: figB, w: 24, h: 24, source: 'genai' }],
  [BAD_ID, { bytes: figC, w: 60, h: 20, source: 'tikz' }],
]);

const MMD = `PHẦN I. CÂU TRẮC NGHIỆM NHIỀU PHƯƠNG ÁN LỰA CHỌN

Câu 1. Cho hình chóp $S.ABCD$ như hình bên.

![](#p1_f1)

A. $30^{\\circ}$.
B. $45^{\\circ}$.
C. $60^{\\circ}$.
D. $90^{\\circ}$.

Câu 2. Đồ thị hàm số $y=f(x)$ cho như hình.

![](#p2_f1)

A. $1$.
B. $2$.
C. $3$.
D. $4$.

Câu 3. Xét hình vẽ.

![](#${BAD_ID})

A. $a$.
B. $b$.
C. $c$.
D. $d$.
`;

const ISSUES = [
  { severity: 'warn', message: 'Câu 2: hai lượt giải cho kết quả khác nhau — cần kiểm tra', line: 12 },
];
const DISAGREEMENTS = ['Câu 2'];

// ─── So sánh docx theo đúng định nghĩa của project ───────────────────────────

async function docxFingerprint(buf) {
  const zip = await JSZip.loadAsync(buf);
  const doc = await zip.file('word/document.xml').async('string');
  const media = Object.keys(zip.files)
    .filter((n) => n.startsWith('word/media/') && !zip.files[n].dir)
    .sort();
  const hashes = {};
  for (const n of media) hashes[n] = sha(new Uint8Array(await zip.file(n).async('nodebuffer')));
  return { doc, media, hashes };
}

const checks = [];
const push = (name, pass, detail) => checks.push([name, pass, detail]);

// ─── 1. Vòng tròn serialize ──────────────────────────────────────────────────

const { records, blobs } = figureMapToRecords(sourceMap);

push(
  'tên file theo chỉ mục, KHÔNG lấy từ id',
  records.every((r) => /^fig-\d+\.png$/.test(r.file)),
  records.map((r) => r.file).join(', '),
);
push(
  'id độc hại không lọt vào tên file',
  !records.some((r) => r.file.includes('..')) && !blobs.some((b) => b.file.includes('..')),
);

// Đi qua JSON đúng như khi ghi ra đĩa rồi đọc lại.
const manifest = JSON.parse(
  JSON.stringify({
    schema: 1,
    id: 'test',
    createdAt: 1,
    updatedAt: 1,
    mode: 'pdf-to-word',
    fileName: 'de-thi-01.pdf',
    pageCount: 3,
    mmd: MMD,
    notes: ['ghi chú 1'],
    issues: ISSUES,
    disagreements: DISAGREEMENTS,
    wordOptions: { format: 'k11', fontId: null, startNumber: 1 },
    // CỐ Ý thiếu `genFigureImage`: đây là hình dạng của mọi mục lưu TRƯỚC 1.3, và là dân số mà
    // `normalizeToggles` phải vá. Xem nhóm kiểm ở cuối file.
    toggles: { examMode: true, autoSolve: true, doubleCheck: true, drawFigures: true, redrawTikz: true },
    figures: records,
    figuresOmitted: false,
  }),
);

push('round-trip JSON giữ nguyên disagreements', JSON.stringify(manifest.disagreements) === JSON.stringify(DISAGREEMENTS));
push('round-trip JSON giữ nguyên issues', JSON.stringify(manifest.issues) === JSON.stringify(ISSUES));

const restored = recordsToFigureMap(manifest.figures, blobs);

push(
  'khôi phục đúng bộ khoá, kể cả id lạ',
  JSON.stringify([...restored.keys()]) === JSON.stringify([...sourceMap.keys()]),
  [...restored.keys()].join(', '),
);
push(
  'bytes từng hình trùng SHA-256',
  [...sourceMap].every(([id, f]) => restored.has(id) && sha(restored.get(id).bytes) === sha(f.bytes)),
);
push(
  'pngSize trên bản khôi phục khớp w/h đã lưu',
  [...restored].every(([, f]) => {
    const s = pngSize(f.bytes);
    return s.w === f.w && s.h === f.h;
  }),
);
push(
  'giữ nguyên nguồn hình (crop / tikz)',
  restored.get('p1_f1').source === 'crop' && restored.get(BAD_ID).source === 'tikz',
);

// ─── 2. Xuất Word: bản gốc vs bản khôi phục ──────────────────────────────────

for (const [label, build, opts] of [
  ['định dạng thường', buildExamDocx, {}],
  ['định dạng VDC, số câu bắt đầu 65', buildVdcDocx, { startNumber: 65 }],
]) {
  const a = await docxFingerprint(await Packer.toBuffer(build(MMD, makeFigureResolver(sourceMap), opts)));
  const b = await docxFingerprint(await Packer.toBuffer(build(MMD, makeFigureResolver(restored), opts)));

  push(`${label}: document.xml trùng TỪNG KÝ TỰ`, a.doc === b.doc,
    a.doc === b.doc ? '' : `lệch ở ký tự ${[...a.doc].findIndex((c, i) => c !== b.doc[i])}`);
  push(`${label}: tập tên file media trùng`, JSON.stringify(a.media) === JSON.stringify(b.media));
  push(`${label}: byte từng ảnh trùng`, JSON.stringify(a.hashes) === JSON.stringify(b.hashes));
  push(`${label}: có chèn đủ 3 ảnh`, a.media.length === 3, `nhận ${a.media.length}`);
}

// ─── 3. QC phải cho cùng kết quả với map khôi phục ───────────────────────────

const qcSource = qcMmd(MMD, { figureIds: new Set(sourceMap.keys()), disagreements: DISAGREEMENTS });
const qcRestored = qcMmd(MMD, { figureIds: new Set(restored.keys()), disagreements: manifest.disagreements });
push(
  'QC trên map khôi phục cho đúng danh sách như map gốc',
  JSON.stringify(qcSource) === JSON.stringify(qcRestored),
);
push(
  'QC không báo "Hình không có dữ liệu" cho hình đã khôi phục',
  !qcRestored.some((i) => i.message.includes('Hình không có dữ liệu')),
  qcRestored.map((i) => i.message).join(' | '),
);

// ─── 4. Preview cho danh sách ────────────────────────────────────────────────

const preview = buildPreview({
  fileName: 'de-thi-01.pdf',
  mode: 'pdf-to-word',
  pageCount: 3,
  mmd: MMD,
  format: 'k11',
  figureCount: 3,
  errorCount: 0,
  warnCount: 1,
  hasThumb: true,
  figuresOmitted: false,
});

push('excerpt bỏ hết math và dòng hình', !/\$|!\[/.test(preview.excerpt), preview.excerpt);
push('excerpt không quá 160 ký tự', preview.excerpt.length <= 160, String(preview.excerpt.length));
push('searchText đã hạ chữ thường và có tên file', preview.searchText.includes('de-thi-01.pdf') && preview.searchText === preview.searchText.toLowerCase());
push('excerpt cắt dài thì có dấu …', plainExcerpt('x'.repeat(400)).endsWith('…'));
push('totalFigureBytes đếm đúng', totalFigureBytes(sourceMap) === figA.length + figB.length + figC.length);

// ─── Vá công tắc của mục lịch sử cũ ──────────────────────────────────────────
//
// Đây là guard tự động DUY NHẤT cho lớp bug `store.ts` khôi phục `toggles` mà không có default:
// mục lưu trước khi một công tắc ra đời cho `undefined`, rồi `OptionToggles` truyền
// `checked={undefined}` vào input — React đổi input sang controlled và ô tích CHẾT CỨNG mà không
// hiện disabled. `load()` cần cầu nối Electron nên chỉ kiểm được qua hàm thuần này.

const allBool = (t) => Object.values(t).every((v) => typeof v === 'boolean');
const keysOf = (t) => Object.keys(t).sort().join(',');

push(
  'vá được manifest thiếu công tắc mới (đúng ca của mọi mục lưu trước 1.3)',
  (() => {
    const t = normalizeToggles(manifest.toggles);
    return allBool(t) && t.genFigureImage === DEFAULT_TOGGLES.genFigureImage;
  })(),
);
push('vá được toggles undefined', allBool(normalizeToggles(undefined)));
push('vá được toggles null', allBool(normalizeToggles(null)));
push(
  'giá trị không phải boolean thì rơi về mặc định, không lọt ra ngoài',
  (() => {
    const t = normalizeToggles({ examMode: 'yes', autoSolve: 0, redrawTikz: false });
    return allBool(t) && t.examMode === true && t.autoSolve === true && t.redrawTikz === false;
  })(),
);
push(
  'luôn trả ĐỦ mọi khoá của DEFAULT_TOGGLES',
  keysOf(normalizeToggles({})) === keysOf(DEFAULT_TOGGLES),
);
push(
  'giữ nguyên lựa chọn thật của người dùng',
  normalizeToggles({ ...DEFAULT_TOGGLES, doubleCheck: false }).doubleCheck === false,
);

// `wordOptions` cũng được lưu vào lịch sử, và 1.3 thêm `pageNumbers` vào đó — ĐÚNG cùng một lớp
// bug. Suýt quên vá: bài học rút ra ở `toggles` mà không áp sang trường mới của chính bản này.
push(
  'vá được wordOptions thiếu pageNumbers (mục lưu trước 1.3)',
  (() => {
    const w = normalizeWordOptions({ format: 'k11', fontId: null, startNumber: 1 });
    return w.pageNumbers === true && w.format === 'k11';
  })(),
);
push('vá được wordOptions undefined', normalizeWordOptions(undefined).format === 'k11');
push(
  'giữ nguyên lựa chọn thật của người dùng (tắt số trang)',
  normalizeWordOptions({ ...DEFAULT_WORD_OPTIONS, pageNumbers: false }).pageNumbers === false,
);
push(
  'startNumber sai kiểu thì rơi về mặc định',
  normalizeWordOptions({ startNumber: 'nhiều' }).startNumber === 1,
);

// ─── Kết ─────────────────────────────────────────────────────────────────────

console.log('=== Lịch sử: lưu -> mở lại -> xuất y như cũ ===');
let ok = 0;
for (const [name, pass, detail] of checks) {
  if (pass) ok++;
  else console.log(`  ${RED('FAIL')} ${name}${detail ? ` — ${detail}` : ''}`);
}
console.log(`${ok === checks.length ? GREEN('PASS') : RED('FAIL')}  ${ok}/${checks.length} tiêu chí`);
process.exit(ok === checks.length ? 0 : 2);
