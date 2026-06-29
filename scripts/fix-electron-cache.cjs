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
try {
  execSync(`"${builderBin}" --win --config.win.target=dir`, { stdio: 'pipe' });
} catch {
  // Expected to fail due to symlinks — we only needed the download+extraction attempt.
}

// ── Find the best partial extraction (temp numeric directory in cache). ───────
if (!fs.existsSync(CACHE_DIR)) {
  console.error('[fix-electron-cache] Cache dir not created — check network access and try again.');
  process.exit(1);
}

const partials = fs
  .readdirSync(CACHE_DIR)
  .filter((name) => /^\d+$/.test(name))
  .map((name) => path.join(CACHE_DIR, name))
  .filter((p) => fs.statSync(p).isDirectory() && fs.readdirSync(p).length > 3);

if (partials.length === 0) {
  console.error('[fix-electron-cache] No partial extraction found. Try running as Administrator once.');
  process.exit(1);
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
