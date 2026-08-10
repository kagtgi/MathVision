/**
 * So sánh docx sinh bởi bản TS với docx sinh bởi tools/mmd2docx.js GỐC.
 *
 * Bản gốc được copy nguyên xi sang scripts/ref-mmd2docx.cjs để cả hai phía dùng CÙNG
 * một build docx (9.6.1) — nếu chạy bản trong "PDF TO WORD/tools" thì nó dùng
 * docx 9.0.2 và khác biệt serializer sẽ lấn át khác biệt thật.
 *
 * KHÔNG so với WORD KTGK/KTTX: những file đó đã bị MathType Toggle TeX biến đổi.
 *
 * Khác biệt DUY NHẤT được phép: bản mới bỏ header (yêu cầu người dùng), nên
 * `<w:headerReference/>` bị loại khỏi bản tham chiếu trước khi so.
 *
 * Usage: node scripts/verify-docx.mjs ["C:\\Users\\Win\\Downloads\\PDF TO WORD"]
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import JSZip from 'jszip';
import { Packer } from 'docx';

import { buildExamDocx, pngSize } from '../src/pipeline/mmdToDocx.ts';

const ROOT = process.argv[2] || 'C:\\Users\\Win\\Downloads\\PDF TO WORD';
const MMD_DIRS = ['MMD KTGK', 'MMD KTTX'].map((d) => path.join(ROOT, d));
const TMP = path.join(os.tmpdir(), 'mathvision-docx-parity');

const GREEN = (s) => `\x1b[32m${s}\x1b[0m`;
const RED = (s) => `\x1b[31m${s}\x1b[0m`;
const DIM = (s) => `\x1b[2m${s}\x1b[0m`;

/** Ảnh: bản gốc dò 3 vị trí; ở đây file .mmd nằm trong "MMD X/" nên ảnh ở "../figures". */
function makeResolver(mmdPath) {
  return (ref) => {
    const candidates = [
      path.resolve(path.dirname(mmdPath), ref),
      path.resolve(path.dirname(mmdPath), '..', ref),
    ];
    const file = candidates.find((p) => fs.existsSync(p));
    if (!file) return null;
    const buf = fs.readFileSync(file);
    const bytes = new Uint8Array(buf);
    return { bytes, ...pngSize(bytes) };
  };
}

async function documentXml(buf) {
  const zip = await JSZip.loadAsync(buf);
  const entry = zip.file('word/document.xml');
  if (!entry) throw new Error('không có word/document.xml');
  return entry.async('string');
}

async function mediaNames(buf) {
  const zip = await JSZip.loadAsync(buf);
  return Object.keys(zip.files)
    .filter((n) => n.startsWith('word/media/') && !zip.files[n].dir)
    .sort();
}

/** Bỏ khác biệt được phép: header reference + đánh số rId (ref có thêm 1 quan hệ header). */
function normalizeXml(xml, { dropHeader }) {
  let s = xml;
  if (dropHeader) s = s.replace(/<w:headerReference[^>]*\/>/g, '');
  s = s.replace(/r:embed="rId\d+"/g, 'r:embed="rId#"');
  s = s.replace(/r:id="rId\d+"/g, 'r:id="rId#"');
  return s;
}

function firstXmlDiff(a, b) {
  const n = Math.min(a.length, b.length);
  let at = -1;
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) {
      at = i;
      break;
    }
  }
  if (at === -1 && a.length === b.length) return null;
  if (at === -1) at = n;
  const from = Math.max(0, at - 120);
  return {
    at,
    ref: a.slice(from, at + 160),
    ts: b.slice(from, at + 160),
  };
}

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

// ─── build bản tham chiếu bằng script gốc ────────────────────────────────────
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
const refScript = path.resolve('scripts/ref-mmd2docx.cjs');
for (const dir of MMD_DIRS) {
  if (!fs.existsSync(dir)) continue;
  const outDir = path.join(TMP, path.basename(dir));
  execFileSync(process.execPath, [refScript, dir, outDir], { stdio: 'pipe' });
}

// ─── so từng file ────────────────────────────────────────────────────────────
const files = listMmd();
let ok = 0;
const fails = [];

for (const p of files) {
  const name = path.basename(p);
  const refPath = path.join(TMP, path.basename(path.dirname(p)), name.replace(/\.mmd$/i, '.docx'));
  if (!fs.existsSync(refPath)) {
    fails.push({ name, reason: 'bản tham chiếu không sinh được' });
    continue;
  }
  const mmd = fs.readFileSync(p, 'utf8');
  const doc = buildExamDocx(mmd, makeResolver(p));
  const tsBuf = await Packer.toBuffer(doc);
  const refBuf = fs.readFileSync(refPath);

  const refXml = normalizeXml(await documentXml(refBuf), { dropHeader: true });
  const tsXml = normalizeXml(await documentXml(tsBuf), { dropHeader: false });

  const refMedia = await mediaNames(refBuf);
  const tsMedia = await mediaNames(tsBuf);

  const d = firstXmlDiff(refXml, tsXml);
  const mediaOk = refMedia.length === tsMedia.length;
  // ImageRun thiếu `type` -> docx đặt tên word/media/image1.undefined và Word không mở được.
  const badExt = tsMedia.filter((n) => !n.toLowerCase().endsWith('.png'));
  if (badExt.length) {
    fails.push({ name, reason: `ảnh sai đuôi: ${badExt.join(', ')}` });
    continue;
  }
  if (!d && mediaOk) {
    ok++;
  } else {
    fails.push({
      name,
      reason: d ? `document.xml lệch tại ký tự ${d.at}` : `số ảnh lệch ${refMedia.length} vs ${tsMedia.length}`,
      diff: d,
    });
  }
}

console.log(`\n=== Đối chiếu docx với bản gốc (docx@9.6.1 cả hai phía) ===`);
console.log(`${ok === files.length ? GREEN('PASS') : RED('FAIL')}  ${ok}/${files.length} file trùng khớp`);
for (const f of fails.slice(0, 5)) {
  console.log(`  ${RED(f.name)} — ${f.reason}`);
  if (f.diff) {
    console.log(`    ${DIM('gốc')} …${f.diff.ref}`);
    console.log(`    ${DIM('mới')} …${f.diff.ts}`);
  }
}
if (fails.length > 5) console.log(`  ... và ${fails.length - 5} file nữa`);

process.exit(fails.length ? 2 : 0);
