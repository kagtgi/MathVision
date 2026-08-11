/**
 * Kiểm nhãn "Câu N." được dựng bằng NUMBERING thật của Word.
 *
 * Vì sao cần một harness riêng: `verify-docx.mjs` so từng ký tự `document.xml` với oracle
 * đóng băng `ref-mmd2docx.cjs` (bản in nhãn thành chữ), nên nó chạy với
 * `autoNumberCau: false`. Toàn bộ phần numbering không có gì che — chính là file này.
 *
 * Spec đối chiếu đo trực tiếp từ hai file mẫu của người dùng:
 *   K11-Đề-tặng-kèm-số-1  lvlText "Câu %1."  ind 992/992  b + 0000FF
 *   65-68_Mitu (VDC)      lvlText "Câu %1."  start 65     + Palatino sz23
 *
 * Phần chạy trên 25 đề golden tự bỏ qua khi không có dữ liệu (CI dùng được), phần fixture
 * inline thì luôn chạy.
 *
 * Usage: node scripts/verify-numbering.mjs ["C:\\Users\\Win\\Downloads\\PDF TO WORD"]
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import JSZip from 'jszip';
import { Packer } from 'docx';

import { buildExamDocx, pngSize } from '../src/pipeline/mmdToDocx.ts';
import { buildVdcDocx } from '../src/pipeline/mmdToDocxVdc.ts';
import { parseMmdBlocks } from '../src/pipeline/mmdBlocks.ts';
import { planCauNumbering } from '../src/pipeline/cauNumbering.ts';
import { fontPreset } from '../src/pipeline/fonts.ts';

const ROOT = process.argv[2] || 'C:\\Users\\Win\\Downloads\\PDF TO WORD';
const MMD_DIRS = ['MMD KTGK', 'MMD KTTX'].map((d) => path.join(ROOT, d));

const GREEN = (s) => `\x1b[32m${s}\x1b[0m`;
const RED = (s) => `\x1b[31m${s}\x1b[0m`;
const DIM = (s) => `\x1b[2m${s}\x1b[0m`;

function makeResolver(mmdPath) {
  return (ref) => {
    const file = [
      path.resolve(path.dirname(mmdPath), ref),
      path.resolve(path.dirname(mmdPath), '..', ref),
    ].find((p) => fs.existsSync(p));
    if (!file) return null;
    const bytes = new Uint8Array(fs.readFileSync(file));
    return { bytes, ...pngSize(bytes) };
  };
}

/** Bóc `document.xml` + `numbering.xml` và các mảnh cần soi. */
async function parts(buf) {
  const zip = await JSZip.loadAsync(buf);
  const doc = await zip.file('word/document.xml').async('string');
  const num = (await zip.file('word/numbering.xml')?.async('string')) ?? '';

  const abstracts = [...num.matchAll(/<w:abstractNum w:abstractNumId="(\d+)"[\s\S]*?<\/w:abstractNum>/g)]
    .map((m) => {
      const lvl = m[0].match(/<w:lvl w:ilvl="0"[\s\S]*?<\/w:lvl>/)?.[0] ?? '';
      return {
        id: m[1],
        lvl,
        text: lvl.match(/<w:lvlText w:val="([^"]*)"/)?.[1] ?? '',
        start: Number(lvl.match(/<w:start w:val="(\d+)"/)?.[1] ?? NaN),
        fmt: lvl.match(/<w:numFmt w:val="([^"]*)"/)?.[1] ?? '',
      };
    })
    .filter((a) => /^Câu %1/.test(a.text));

  const concretes = [...num.matchAll(/<w:num w:numId="(\d+)"[^>]*>([\s\S]*?)<\/w:num>/g)].map((m) => ({
    numId: m[1],
    abstractId: m[2].match(/<w:abstractNumId w:val="(\d+)"/)?.[1] ?? '',
    startOverride: Number(m[2].match(/<w:startOverride w:val="(\d+)"/)?.[1] ?? NaN),
  }));

  const usedNumIds = [...doc.matchAll(/<w:numId w:val="(\d+)"\/>/g)].map((m) => m[1]);

  return { doc, num, abstracts, concretes, usedNumIds };
}

const fails = [];
let checked = 0;
function expect(name, cond, detail) {
  checked++;
  if (!cond) fails.push(detail ? `${name} — ${detail}` : name);
}

// ─── Phần 1: fixture inline (luôn chạy) ──────────────────────────────────────
console.log('=== numbering trên fixture ===');

// Ba PHẦN: restart 1-2, liên tục 3-4, và một dãy số TRÙNG phải rơi về chữ.
const FIXTURE = `PHẦN I. CÂU TRẮC NGHIỆM NHIỀU PHƯƠNG ÁN LỰA CHỌN

Câu 1. Câu một.
Câu 2. Câu hai.

PHẦN II. CÂU TRẮC NGHIỆM ĐÚNG SAI

Câu 3. Câu ba.
Câu 4. Câu bốn.

PHẦN III. CÂU TRẮC NGHIỆM TRẢ LỜI NGẮN

Câu 1. Câu một lần nữa.
Câu 2. Câu hai lần nữa.
Câu 2. Câu hai bị in trùng số.
`;

{
  const blocks = parseMmdBlocks(FIXTURE);
  const plan = planCauNumbering(blocks);
  expect('fixture: 2 dãy đánh số được', plan.runs.length === 2, `nhận ${plan.runs.length}`);
  expect('fixture: dãy 1 start=1', plan.runs[0]?.start === 1, `nhận ${plan.runs[0]?.start}`);
  expect('fixture: dãy 2 start=3 (liên tục qua PHẦN)', plan.runs[1]?.start === 3, `nhận ${plan.runs[1]?.start}`);
  expect('fixture: 4 câu được đánh số', plan.numberedCount === 4, `nhận ${plan.numberedCount}`);

  const { doc, abstracts, concretes, usedNumIds } = await parts(
    await Packer.toBuffer(buildExamDocx(FIXTURE)),
  );
  expect('fixture: 2 abstractNum nhãn Câu', abstracts.length === 2, `nhận ${abstracts.length}`);
  expect('fixture: numFmt decimal', abstracts.every((a) => a.fmt === 'decimal'));
  expect('fixture: lvlText "Câu %1."', abstracts.every((a) => a.text === 'Câu %1.'));
  expect(
    'fixture: w:start = số đầu dãy (1 và 3)',
    JSON.stringify(abstracts.map((a) => a.start).sort((x, y) => x - y)) === '[1,3]',
    `nhận ${JSON.stringify(abstracts.map((a) => a.start))}`,
  );
  expect(
    'fixture: startOverride khớp start',
    abstracts.every((a) => {
      const c = concretes.find((x) => x.abstractId === a.id);
      return c && c.startOverride === a.start;
    }),
  );
  expect('fixture: 4 đoạn mang numPr', (doc.match(/<w:numPr>/g) ?? []).length === 4);
  expect(
    'fixture: mọi numId dùng trong document đều được định nghĩa',
    usedNumIds.every((id) => concretes.some((c) => c.numId === id)),
  );
  // Dãy `1 2 2` của PHẦN III phải giữ nguyên bản in sai, dạng chữ.
  expect('fixture: dãy số trùng rơi về chữ', /Câu 2\./.test(doc) && /Câu 1\./.test(doc));
  expect('fixture: nhãn K11 đậm + xanh 0000FF', abstracts.every((a) => /<w:b\/>/.test(a.lvl) && /<w:color w:val="0000FF"\/>/.test(a.lvl)));
  expect('fixture: nhãn thụt 992/992', abstracts.every((a) => /w:left="992"/.test(a.lvl) && /w:hanging="992"/.test(a.lvl)));
}

// Số có 0 đứng đầu: decimal chỉ in được "7", nên phải rơi về chữ.
{
  const plan = planCauNumbering(parseMmdBlocks('Câu 07. Câu bảy.\nCâu 08. Câu tám.\n'));
  expect('fixture: `Câu 07.` rơi về chữ', plan.runs.length === 0, `nhận ${plan.runs.length} dãy`);
  const { doc } = await parts(await Packer.toBuffer(buildExamDocx('Câu 07. Câu bảy.\n')));
  expect('fixture: `Câu 07.` in nguyên văn', /Câu 07\./.test(doc));
}

// Dấu không nhất quán trong cùng dãy.
{
  const plan = planCauNumbering(parseMmdBlocks('Câu 1. Một.\nCâu 2: Hai.\n'));
  expect('fixture: dãy lẫn dấu . và : rơi về chữ', plan.runs.length === 0, `nhận ${plan.runs.length} dãy`);
}

// Dãy toàn dấu `:` (202 lần trong bộ golden) phải dùng lvlText "Câu %1:".
{
  const { abstracts } = await parts(
    await Packer.toBuffer(buildExamDocx('Câu 1: Một.\nCâu 2: Hai.\n')),
  );
  expect('fixture: dãy dấu `:` dùng lvlText "Câu %1:"', abstracts[0]?.text === 'Câu %1:', `nhận ${JSON.stringify(abstracts[0]?.text)}`);
}

// VDC: số câu bắt đầu do người dùng nhập -> offset cho mọi dãy.
{
  const mmd = 'Câu 1. Một.\nCâu 2. Hai.\nCâu 3. Ba.\nCâu 4. Bốn.\n';
  const { abstracts, concretes } = await parts(
    await Packer.toBuffer(buildVdcDocx(mmd, undefined, { startNumber: 65 })),
  );
  expect('VDC: startNumber=65 -> w:start=65', abstracts[0]?.start === 65, `nhận ${abstracts[0]?.start}`);
  expect('VDC: startOverride=65', concretes.some((c) => c.startOverride === 65));
  expect(
    'VDC: nhãn Palatino sz23',
    /w:ascii="Palatino Linotype"/.test(abstracts[0]?.lvl ?? '') &&
      /<w:sz w:val="23"\/>/.test(abstracts[0]?.lvl ?? ''),
  );

  // Mục đáp án restart về 1 trong nguồn -> phải dịch về 65 theo cùng offset.
  const twoPass = `${mmd}\n# ĐÁP ÁN CHI TIẾT\n\n${mmd}`;
  const p2 = planCauNumbering(parseMmdBlocks(twoPass), { startNumber: 65 });
  expect('VDC: mục đáp án cũng bắt đầu ở 65', p2.runs.length === 2 && p2.runs[1].start === 65, `nhận ${JSON.stringify(p2.runs.map((r) => r.start))}`);
}

// Font preset đổi được cả ở nhãn.
{
  const { abstracts } = await parts(
    await Packer.toBuffer(buildExamDocx('Câu 1. Một.\n', undefined, { font: fontPreset('myriad') })),
  );
  expect('preset font: nhãn dùng Myriad Pro sz23', /w:ascii="Myriad Pro"/.test(abstracts[0]?.lvl ?? '') && /<w:sz w:val="23"\/>/.test(abstracts[0]?.lvl ?? ''));
}

// Tắt numbering thì trở lại đúng hành vi cũ (đường mà verify-docx.mjs dùng).
{
  const { doc, abstracts } = await parts(
    await Packer.toBuffer(buildExamDocx('Câu 1. Một.\n', undefined, { autoNumberCau: false })),
  );
  expect('autoNumberCau:false -> không có abstractNum nhãn Câu', abstracts.length === 0);
  expect('autoNumberCau:false -> in nhãn thành chữ', /Câu 1\./.test(doc));
  expect('autoNumberCau:false -> không có numPr', !/<w:numPr>/.test(doc));
}

console.log(
  `${fails.length === 0 ? GREEN('PASS') : RED('FAIL')}  ${checked - fails.length}/${checked} tiêu chí`,
);
for (const f of fails) console.log(`  ${RED('FAIL')} ${f}`);

// ─── Phần 2: 25 đề golden (bỏ qua nếu không có dữ liệu) ──────────────────────
const goldens = MMD_DIRS.flatMap((d) =>
  fs.existsSync(d)
    ? fs.readdirSync(d).filter((f) => f.toLowerCase().endsWith('.mmd')).map((f) => path.join(d, f))
    : [],
);

let goldenFails = [];
if (!goldens.length) {
  console.log(`\n${DIM('BỎ QUA')}  25 đề golden — không tìm thấy "MMD KTGK"/"MMD KTTX" ở ${ROOT}`);
} else {
  console.log(`\n=== numbering trên ${goldens.length} đề golden ===`);
  let totalRuns = 0;
  let totalNumbered = 0;
  let totalCau = 0;

  for (const p of goldens) {
    const name = path.basename(p);
    const mmd = fs.readFileSync(p, 'utf8');
    const blocks = parseMmdBlocks(mmd);
    const plan = planCauNumbering(blocks);
    const cauCount = blocks.filter((b) => b.kind === 'cau').length;
    totalRuns += plan.runs.length;
    totalNumbered += plan.numberedCount;
    totalCau += cauCount;

    const { doc, abstracts, concretes, usedNumIds } = await parts(
      await Packer.toBuffer(buildExamDocx(mmd, makeResolver(p))),
    );

    const bad = [];
    if (abstracts.length !== plan.runs.length) {
      bad.push(`abstractNum ${abstracts.length} != ${plan.runs.length} dãy`);
    }
    const numPrCount = (doc.match(/<w:numPr>/g) ?? []).length;
    if (numPrCount !== plan.numberedCount) {
      bad.push(`numPr ${numPrCount} != ${plan.numberedCount} câu đánh số`);
    }
    const dangling = usedNumIds.filter((id) => !concretes.some((c) => c.numId === id));
    if (dangling.length) bad.push(`numId không có định nghĩa: ${dangling.join(',')}`);
    if (!abstracts.every((a) => a.fmt === 'decimal' && /^Câu %1[.:]?$/.test(a.text))) {
      bad.push('lvlText/numFmt sai');
    }
    // Số đầu mỗi dãy trong plan phải khớp w:start có trong file.
    const planStarts = plan.runs.map((r) => r.start).sort((x, y) => x - y);
    const xmlStarts = abstracts.map((a) => a.start).sort((x, y) => x - y);
    if (JSON.stringify(planStarts) !== JSON.stringify(xmlStarts)) {
      bad.push(`w:start ${JSON.stringify(xmlStarts)} != ${JSON.stringify(planStarts)}`);
    }
    // Câu KHÔNG thuộc dãy đánh số được thì phải còn nhãn dạng chữ.
    const fallback = cauCount - plan.numberedCount;
    if (fallback > 0 && !/>Câu \d/.test(doc)) bad.push(`${fallback} câu fallback nhưng không thấy nhãn chữ`);
    if (fallback === 0 && />Câu \d/.test(doc)) bad.push('không có câu fallback nhưng vẫn thấy nhãn chữ');

    if (bad.length) goldenFails.push({ name, bad });
  }

  console.log(
    `${goldenFails.length === 0 ? GREEN('PASS') : RED('FAIL')}  ${goldens.length - goldenFails.length}/${goldens.length} file`,
  );
  console.log(
    DIM(`      ${totalRuns} dãy · ${totalNumbered}/${totalCau} câu đánh số tự động · ${totalCau - totalNumbered} câu giữ nhãn chữ`),
  );
  for (const f of goldenFails) console.log(`  ${RED('FAIL')} ${f.name}: ${f.bad.join('; ')}`);
}

process.exit(fails.length === 0 && goldenFails.length === 0 ? 0 : 2);
