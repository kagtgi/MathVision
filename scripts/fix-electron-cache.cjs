/**
 * Pre-build script: ensure the electron-builder winCodeSign cache works on Windows.
 *
 * Problem: winCodeSign-2.6.0.7z contains macOS symlinks (libcrypto.dylib, libssl.dylib).
 * Windows 7za.exe cannot create them without the SeCreateSymbolicLinkPrivilege (requires
 * Developer Mode or Administrator), causing electron-builder to abort.
 *
 * Fix: trigger the download+partial extraction, then create empty placeholder files for
 * the two missing macOS symlinks so the cache directory is considered valid.
 *
 * This script is idempotent — safe to run multiple times.
 *
 * KHÔNG BAO GIỜ exit khác 0. Đây là bản VÁ cho hạn chế của máy Windows cục bộ, không phải
 * điều kiện để build. Runner của GitHub Actions tạo symlink được nên chẳng có "partial
 * extraction" nào để vá — bản trước exit 1 ở đúng chỗ đó và giết luôn workflow release ngay
 * lần chạy đầu tiên, kèm câu báo "Try running as Administrator" vô nghĩa trên CI. Vá được thì
 * vá, không thì để electron-builder tự chạy và tự báo lỗi thật của nó.
 */

'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CACHE_DIR = path.join(os.homedir(), 'AppData', 'Local', 'electron-builder', 'Cache', 'winCodeSign');
const FINAL_CACHE = path.join(CACHE_DIR, 'winCodeSign-2.6.0');

// These two files are macOS symlinks that 7za cannot create without SeCreateSymbolicLinkPrivilege
const MISSING_SYMLINKS = [
  'darwin\\10.12\\lib\\libcrypto.dylib',
  'darwin\\10.12\\lib\\libssl.dylib',
];

function touchFile(p) {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(p)) fs.writeFileSync(p, '');
}

function isCacheComplete(dir) {
  return MISSING_SYMLINKS.every((rel) => fs.existsSync(path.join(dir, rel)));
}

// ── Already have a valid cache? Done. ────────────────────────────────────────
if (fs.existsSync(FINAL_CACHE) && isCacheComplete(FINAL_CACHE)) {
  console.log('[fix-electron-cache] winCodeSign-2.6.0 cache OK — skipping.');
  process.exit(0);
}

// ── Run electron-builder once to trigger download + partial extraction. ──────
const builderBin = process.platform === 'win32'
  ? path.resolve('node_modules', '.bin', 'electron-builder.cmd')
  : path.resolve('node_modules', '.bin', 'electron-builder');

console.log('[fix-electron-cache] Downloading winCodeSign (may take ~30s on first run)...');
let probeOutput = '';
try {
  // `--publish never`: file này chỉ để kéo cache về. Không có nó thì trên build theo tag,
  // electron-builder thấy key `publish` và cố đẩy lên Release ngay ở bước dò này — không có
  // GH_TOKEN nên chết, mà `stdio: 'pipe'` lại nuốt mất lỗi.
  execSync(`"${builderBin}" --win --config.win.target=dir --publish never`, {
    stdio: 'pipe',
    encoding: 'utf8',
  });
} catch (err) {
  // Bước này ĐƯỢC PHÉP fail (symlink) — chỉ cần nó đã tải và giải nén xong.
  probeOutput = String(err && (err.stderr || err.stdout) ? err.stderr || err.stdout : err);
}

// ── Find the best partial extraction (temp numeric directory in cache). ───────
if (!fs.existsSync(CACHE_DIR)) {
  console.log('[fix-electron-cache] Chưa có thư mục cache — để electron-builder tự tải.');
  if (probeOutput) console.log(probeOutput.split('\n').slice(-12).join('\n'));
  process.exit(0);
}

const partials = fs
  .readdirSync(CACHE_DIR)
  .filter((name) => /^\d+$/.test(name))
  .map((name) => path.join(CACHE_DIR, name))
  .filter((p) => fs.statSync(p).isDirectory() && fs.readdirSync(p).length > 3);

if (partials.length === 0) {
  // Máy tạo được symlink (đúng trường hợp runner GitHub) thì không có gì để vá — bình thường.
  console.log('[fix-electron-cache] Không có bản giải nén dở — máy này tạo symlink được, bỏ qua.');
  if (probeOutput) console.log(probeOutput.split('\n').slice(-12).join('\n'));
  process.exit(0);
}

// Pick the most complete extraction (most top-level entries)
const bestPartial = partials.sort((a, b) => fs.readdirSync(b).length - fs.readdirSync(a).length)[0];
console.log(`[fix-electron-cache] Patching partial extraction: ${path.basename(bestPartial)}`);

// ── Create empty placeholder files for the two missing macOS symlinks. ───────
for (const rel of MISSING_SYMLINKS) {
  touchFile(path.join(bestPartial, rel));
}

// ── Copy to the final named cache location. ──────────────────────────────────
if (fs.existsSync(FINAL_CACHE)) fs.rmSync(FINAL_CACHE, { recursive: true, force: true });
fs.cpSync(bestPartial, FINAL_CACHE, { recursive: true });
console.log(`[fix-electron-cache] Cache ready at: ${FINAL_CACHE}`);
