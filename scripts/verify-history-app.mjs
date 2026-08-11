/**
 * Kiểm kho lịch sử của BẢN ĐÓNG GÓI (phần chạy trong tiến trình main).
 *
 * `verify-history.mjs` đã che phần logic thuần: serialize -> JSON -> deserialize -> xuất Word
 * ra `document.xml` trùng từng ký tự. File này che phần CÒN LẠI, thứ chỉ tồn tại trong bản
 * đóng gói: IPC, ghi/đọc đĩa, và hai chốt an toàn.
 *
 * Chốt quan trọng nhất: **id phải bị chặn nếu là đường dẫn**. Id hình do model sinh và nhánh
 * JSON dự phòng của `prompts.ts` từng nhận mọi chuỗi kể cả `../evil`; nếu id mục hoặc tên file
 * hình được dùng thẳng để ghi đĩa thì đó là đường ghi ra ngoài thư mục lịch sử.
 *
 * Usage: node scripts/verify-history-app.mjs [đường-dẫn-exe]
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { DIM, cdpEval, findExe, killApp, launch, report, wait } from './lib/appDriver.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 9414;
const APPDATA = process.env.APPDATA ?? '';
const HIST = path.join(APPDATA, 'MathVision', 'history');
const FIG_BYTES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

const exe = findExe(root, process.argv[2]);
console.log('=== Kho lịch sử của bản đóng gói ===');
if (!exe) {
  console.log(`${DIM('BỎ QUA')} chưa có bản build — chạy "npm run electron:build" trước.`);
  process.exit(0);
}
console.log(DIM(`exe: ${exe}`));
console.log(DIM(`history: ${HIST}`));

const EXPR = `(async () => {
  const b = window.mathvision;
  const fns = ['historyIndex','historySave','historyUpdate','historyLoad','historyThumbs','historyDelete','historyClear','historyStats']
    .filter((k) => typeof b?.[k] === 'function');
  if (fns.length < 8) return JSON.stringify({ fns });

  const id = 'zzz-test01';
  const preview = { fileName: 'de-test.pdf', mode: 'pdf-to-word', pageCount: 2, excerpt: 'x',
    searchText: 'de-test.pdf x', format: 'k11', figureCount: 1, errorCount: 0, warnCount: 0,
    hasThumb: false, figuresOmitted: false };
  const entry = { schema: 1, id, mmd: 'Cau 1. noi dung goc',
    figures: [{ id: 'p1_f1', file: 'fig-0.png', w: 4, h: 3, source: 'crop', bytes: 10 }] };

  const save = await b.historySave({ id, createdAt: 1, updatedAt: 1, schema: 1, preview, entry,
    figures: [{ file: 'fig-0.png', bytes: new Uint8Array(${JSON.stringify(FIG_BYTES)}) }] });
  const idx = await b.historyIndex();
  const loaded = await b.historyLoad(id);
  const figBytes = loaded.figures && loaded.figures[0] ? Array.from(loaded.figures[0].bytes) : null;

  // Sửa MMD: chỉ ghi lại entry.json, hình phải CÒN NGUYÊN.
  const upd = await b.historyUpdate({ id, updatedAt: 2, preview,
    entry: { ...entry, mmd: 'Cau 1. noi dung da sua' } });
  const reloaded = await b.historyLoad(id);
  const figsAfterUpdate = reloaded.figures ? reloaded.figures.length : 0;

  const stats = await b.historyStats();
  // Hai đường ghi ra ngoài thư mục: id dạng đường dẫn, và tên file hình dạng đường dẫn.
  const evilId = await b.historySave({ id: '../evil', createdAt: 1, updatedAt: 1, preview, entry, figures: [] });
  const evilFile = await b.historySave({ id: 'zzz-test02', createdAt: 1, updatedAt: 1, preview, entry,
    figures: [{ file: '../../evil.png', bytes: new Uint8Array([9]) }] });

  const del = await b.historyDelete(id);
  await b.historyClear();
  const idxAfter = await b.historyIndex();

  return JSON.stringify({ fns, save, rows: idx.rows && idx.rows.length,
    entryJson: loaded.entryJson, figBytes, upd, reloadedJson: reloaded.entryJson,
    figsAfterUpdate, stats, evilIdOk: evilId.ok, evilFileOk: evilFile.ok,
    del, rowsAfter: idxAfter.rows && idxAfter.rows.length });
})()`;

const checks = [];
let child = null;
try {
  fs.rmSync(HIST, { recursive: true, force: true });
  child = await launch(exe, PORT, {});
  const r = JSON.parse((await cdpEval(PORT, EXPR)) ?? '{}');

  checks.push(['cầu nối đủ 8 hàm lịch sử', r.fns?.length === 8, (r.fns ?? []).join(', ')]);
  checks.push(['ghi được một mục', r.save?.ok === true, r.save?.error]);
  checks.push(['index có đúng 1 dòng', r.rows === 1, `nhận ${r.rows}`]);
  checks.push(['đọc lại đúng MMD đã lưu', /Cau 1\. noi dung goc/.test(r.entryJson ?? '')]);
  checks.push([
    'bytes hình trùng TỪNG BYTE qua IPC',
    JSON.stringify(r.figBytes) === JSON.stringify(FIG_BYTES),
    JSON.stringify(r.figBytes),
  ]);

  checks.push(['sửa MMD ghi lại được', r.upd?.ok === true]);
  checks.push(['sửa MMD -> đọc ra bản mới', /da sua/.test(r.reloadedJson ?? '')]);
  // Đây là toàn bộ lý do tách entry.json khỏi figures/: sửa chữ không được ghi lại vài MB hình.
  checks.push(['sửa MMD KHÔNG làm mất hình', r.figsAfterUpdate === 1, `nhận ${r.figsAfterUpdate}`]);

  checks.push(['stats đếm đúng', r.stats?.count === 1 && r.stats?.bytes > 0]);
  checks.push(['CHẶN id dạng đường dẫn "../evil"', r.evilIdOk === false]);
  checks.push(['xoá được một mục', r.del?.ok === true]);
  checks.push(['xoá tất cả -> index rỗng', r.rowsAfter === 0, `nhận ${r.rowsAfter}`]);

  await wait(300);
  const parent = path.join(APPDATA, 'MathVision');
  checks.push(['không ghi thư mục lạ ra ngoài history', !fs.existsSync(path.join(parent, 'evil'))]);
  checks.push([
    'không ghi file hình ra ngoài history',
    !fs.existsSync(path.join(parent, 'evil.png')) && !fs.existsSync(path.join(APPDATA, 'evil.png')),
  ]);
  const left = fs.existsSync(HIST) ? fs.readdirSync(HIST).filter((n) => n !== 'index.json') : [];
  checks.push(['sau khi xoá không còn thư mục mồ côi', left.length === 0, left.join(', ')]);
} catch (err) {
  console.log(`  LỖI ${err.message}`);
  checks.push(['chạy được bài kiểm', false, err.message]);
} finally {
  await killApp();
  try {
    child?.kill();
  } catch {
    /* thôi */
  }
  try {
    fs.rmSync(HIST, { recursive: true, force: true });
  } catch {
    /* thôi */
  }
}

process.exit(report(checks));
