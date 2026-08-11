'use strict';

/**
 * Kho lịch sử chuyển đổi trên đĩa.
 *
 * Main process ở đây là một **kho blob "ngu"**: nó chỉ biết id, tên file, số byte và trần lưu
 * trữ. Nó KHÔNG parse `preview` hay `entry.json` — mọi hiểu biết về lược đồ nằm ở renderer
 * (`src/history/schema.ts`). Nhờ vậy lược đồ đổi thì main không phải sửa theo.
 *
 * Bố cục:
 *   history/index.json          ~1 KB một dòng
 *   history/<id>/entry.json     MMD + metadata, 50-400 KB
 *   history/<id>/thumb.jpg      ảnh nhỏ trang 1
 *   history/<id>/figures/*.png  bytes hình, nguyên xi
 *
 * Tách file để lúc người dùng sửa MMD thì chỉ ghi lại `entry.json`, KHÔNG ghi lại vài MB hình.
 *
 * Prune chạy ở ĐÂY, không ở renderer: main sở hữu đĩa nên phải tự giữ trần kể cả khi renderer
 * có bug hay bị đóng giữa lúc lưu.
 */

const { app, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

const MAX_ENTRIES = 40;
const MAX_TOTAL_BYTES = 250 * 1024 * 1024;

const root = () => path.join(app.getPath('userData'), 'history');
const dirOf = (id) => path.join(root(), id);
const indexPath = () => path.join(root(), 'index.json');

/** Chỉ nhận id do renderer sinh dạng `<base36>-<6 ký tự>`; chặn hẳn đường ra ngoài thư mục. */
const SAFE_ID = /^[a-z0-9]{1,16}-[a-z0-9]{4,12}$/;
const safeId = (id) => typeof id === 'string' && SAFE_ID.test(id);
/** Tên file hình do renderer sinh theo chỉ mục — kiểm lại ở đây, đừng tin đầu vào. */
const SAFE_FILE = /^fig-\d{1,4}\.png$/;

function writeJsonAtomic(target, data) {
  const tmp = target + '.tmp';
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
  fs.renameSync(tmp, target);
}

function readIndex() {
  try {
    const rows = JSON.parse(fs.readFileSync(indexPath(), 'utf8'));
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function dirBytes(dir) {
  let total = 0;
  const walk = (d) => {
    let items = [];
    try {
      items = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const it of items) {
      const p = path.join(d, it.name);
      if (it.isDirectory()) walk(p);
      else {
        try {
          total += fs.statSync(p).size;
        } catch {
          /* file vừa bị xoá */
        }
      }
    }
  };
  walk(dir);
  return total;
}

function removeEntry(id) {
  if (!safeId(id)) return;
  try {
    fs.rmSync(dirOf(id), { recursive: true, force: true });
  } catch {
    /* thôi */
  }
}

/** Cắt về trong trần, cũ nhất trước. Trả danh sách id đã xoá. */
function prune(rows) {
  const sorted = [...rows].sort((a, b) => b.updatedAt - a.updatedAt);
  const kept = [];
  const dropped = [];
  let bytes = 0;
  for (const r of sorted) {
    const over = kept.length >= MAX_ENTRIES || bytes + (r.bytes || 0) > MAX_TOTAL_BYTES;
    if (over) dropped.push(r.id);
    else {
      kept.push(r);
      bytes += r.bytes || 0;
    }
  }
  for (const id of dropped) removeEntry(id);
  // Dọn cả thư mục mồ côi: index và đĩa lệch nhau nếu có lần ghi bị cắt giữa.
  try {
    const known = new Set(kept.map((r) => r.id));
    for (const name of fs.readdirSync(root())) {
      if (name === 'index.json' || name.endsWith('.tmp')) continue;
      if (!known.has(name)) {
        removeEntry(name);
        if (!dropped.includes(name)) dropped.push(name);
      }
    }
  } catch {
    /* chưa có thư mục thì thôi */
  }
  return { kept, dropped };
}

function save(payload) {
  const { id, createdAt, updatedAt, preview, entry, thumb, figures } = payload;
  if (!safeId(id)) return { ok: false, error: 'id không hợp lệ' };

  const dir = dirOf(id);
  fs.mkdirSync(path.join(dir, 'figures'), { recursive: true });

  writeJsonAtomic(path.join(dir, 'entry.json'), entry);
  if (thumb && thumb.length) {
    fs.writeFileSync(path.join(dir, 'thumb.jpg'), Buffer.from(thumb));
  }
  for (const f of figures ?? []) {
    if (!SAFE_FILE.test(f.file)) continue;
    fs.writeFileSync(path.join(dir, 'figures', f.file), Buffer.from(f.bytes));
  }

  const bytes = dirBytes(dir);
  const rows = readIndex().filter((r) => r.id !== id);
  rows.push({ id, createdAt, updatedAt, bytes, schema: payload.schema ?? 1, preview });
  const { kept, dropped } = prune(rows);
  writeJsonAtomic(indexPath(), kept);
  return { ok: true, id, bytes, pruned: dropped };
}

/** Chỉ ghi lại `entry.json` + dòng index. KHÔNG đụng `figures/` — đó là cả ý nghĩa của việc tách file. */
function update(payload) {
  const { id, updatedAt, preview, entry } = payload;
  if (!safeId(id)) return { ok: false, error: 'id không hợp lệ' };
  const dir = dirOf(id);
  if (!fs.existsSync(dir)) return { ok: false, error: 'mục đã bị xoá' };

  writeJsonAtomic(path.join(dir, 'entry.json'), entry);
  const bytes = dirBytes(dir);
  const rows = readIndex().map((r) =>
    r.id === id ? { ...r, updatedAt, bytes, preview: preview ?? r.preview } : r,
  );
  writeJsonAtomic(indexPath(), rows);
  return { ok: true, bytes };
}

function load(id) {
  if (!safeId(id)) return { ok: false, error: 'id không hợp lệ' };
  const dir = dirOf(id);
  try {
    const entryJson = fs.readFileSync(path.join(dir, 'entry.json'), 'utf8');
    const figDir = path.join(dir, 'figures');
    const figures = [];
    if (fs.existsSync(figDir)) {
      for (const name of fs.readdirSync(figDir)) {
        if (!SAFE_FILE.test(name)) continue;
        figures.push({ file: name, bytes: fs.readFileSync(path.join(figDir, name)) });
      }
    }
    return { ok: true, entryJson, figures };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

function thumbs(ids) {
  const out = [];
  for (const id of (ids ?? []).slice(0, 24)) {
    if (!safeId(id)) continue;
    try {
      out.push({ id, bytes: fs.readFileSync(path.join(dirOf(id), 'thumb.jpg')) });
    } catch {
      /* mục không có thumbnail */
    }
  }
  return { ok: true, thumbs: out };
}

function stats() {
  const rows = readIndex();
  return {
    ok: true,
    count: rows.length,
    bytes: rows.reduce((n, r) => n + (r.bytes || 0), 0),
    maxEntries: MAX_ENTRIES,
    maxBytes: MAX_TOTAL_BYTES,
  };
}

function setupHistoryStore() {
  ipcMain.handle('mv:hist-index', () => ({ ok: true, rows: readIndex() }));
  ipcMain.handle('mv:hist-save', (_e, payload) => save(payload));
  ipcMain.handle('mv:hist-update', (_e, payload) => update(payload));
  ipcMain.handle('mv:hist-load', (_e, id) => load(id));
  ipcMain.handle('mv:hist-thumbs', (_e, ids) => thumbs(ids));
  ipcMain.handle('mv:hist-delete', (_e, id) => {
    if (!safeId(id)) return { ok: false, error: 'id không hợp lệ' };
    removeEntry(id);
    writeJsonAtomic(indexPath(), readIndex().filter((r) => r.id !== id));
    return { ok: true };
  });
  ipcMain.handle('mv:hist-clear', () => {
    for (const r of readIndex()) removeEntry(r.id);
    writeJsonAtomic(indexPath(), []);
    return { ok: true };
  });
  ipcMain.handle('mv:hist-stats', () => stats());
}

module.exports = { setupHistoryStore };
