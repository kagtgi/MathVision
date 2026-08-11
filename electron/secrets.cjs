'use strict';

/**
 * Kho khoá của app: API key Gemini và chuỗi model đã lọc.
 *
 * Trước 1.2.0 key nằm dạng chữ thường trong `localStorage` của renderer. Ở đây chuyển sang
 * một file trong `userData`, mã hoá bằng `safeStorage` của Electron (trên Windows là DPAPI,
 * khoá gắn với tài khoản Windows đang đăng nhập).
 *
 * BỐN ĐIỀU BẮT BUỘC, mỗi điều vì một cách hỏng cụ thể:
 *
 * 1. **`safeStorage` chỉ gọi được SAU `app.whenReady()`.** Gọi sớm hơn thì trên macOS trả
 *    `false` và ta sẽ tưởng máy không có kho khoá.
 *
 * 2. **Ghi qua file tạm rồi `rename`.** Ghi trực tiếp mà tiến trình chết giữa lúc ghi thì để
 *    lại file JSON cụt — lần sau đọc không được và người dùng MẤT KEY.
 *
 * 3. **Đường đọc không bao giờ được throw.** Ciphertext DPAPI gắn với tài khoản Windows, nên
 *    copy `%APPDATA%\MathVision` sang máy khác là khối không giải mã được. Gặp vậy thì trả
 *    chuỗi rỗng để app vẫn mở lên và hỏi key lại, chứ không phải crash lúc khởi động.
 *
 * 4. **Không giả vờ đã mã hoá.** Máy không có kho khoá thì ghi `enc:'plain'` và nói thật ra
 *    giao diện. Cũng KHÔNG rơi về `localStorage`: LevelDB của Chromium trong profile còn dễ
 *    đọc hơn một file `0600`.
 */

const { app, ipcMain, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

const FILE_VERSION = 1;

const filePath = () => path.join(app.getPath('userData'), 'secrets.json');

/**
 * `MV_TEST_NO_SAFE_STORAGE=1` buộc coi như máy không có kho khoá. Không có cách nào làm DPAPI
 * fail trên Windows, mà đường `plain` vẫn phải kiểm được — cùng tinh thần `MV_TEST_SAVE_DIR`.
 */
function encryptionAvailable() {
  if (process.env.MV_TEST_NO_SAFE_STORAGE === '1') return false;
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function readFileRaw() {
  try {
    const text = fs.readFileSync(filePath(), 'utf8');
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    // Không có file, hoặc file cụt vì lần ghi trước bị cắt — coi như chưa có gì.
    return null;
  }
}

function writeFileRaw(data) {
  const target = filePath();
  const tmp = target + '.tmp';
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, target);
}

/** Giải mã, tuyệt đối không throw. Trả `''` khi không đọc được. */
function decode(entry) {
  if (!entry || typeof entry.value !== 'string') return '';
  if (entry.enc === 'plain') return entry.value;
  if (entry.enc !== 'safeStorage') return '';
  try {
    return safeStorage.decryptString(Buffer.from(entry.value, 'base64'));
  } catch {
    return '';
  }
}

function encode(key) {
  if (!encryptionAvailable()) return { enc: 'plain', value: key };
  try {
    return { enc: 'safeStorage', value: safeStorage.encryptString(key).toString('base64') };
  } catch {
    return { enc: 'plain', value: key };
  }
}

function getState() {
  const file = readFileRaw();
  const available = encryptionAvailable();
  if (!file || !file.apiKey) {
    return { ok: true, key: '', enc: 'none', encryptionAvailable: available, path: filePath() };
  }

  const key = decode(file.apiKey);

  // Tự nâng cấp: lần trước ghi `plain` vì máy chưa có kho khoá, giờ có rồi thì mã hoá lại
  // ngay chứ đừng để mãi dạng chữ thường.
  if (key && file.apiKey.enc === 'plain' && available) {
    try {
      writeFileRaw({ ...file, apiKey: encode(key) });
      return {
        ok: true,
        key,
        enc: 'safeStorage',
        encryptionAvailable: available,
        models: file.models,
        upgraded: true,
        path: filePath(),
      };
    } catch {
      /* nâng cấp không xong thì vẫn dùng được key ở dạng cũ */
    }
  }

  return {
    ok: true,
    key,
    enc: key ? file.apiKey.enc : 'none',
    encryptionAvailable: available,
    models: Array.isArray(file.models) ? file.models : undefined,
    path: filePath(),
  };
}

function setKey(key, models) {
  try {
    const file = readFileRaw() ?? { version: FILE_VERSION };
    const next = { ...file, version: FILE_VERSION };
    if (key) {
      next.apiKey = encode(String(key));
    } else {
      delete next.apiKey;
    }
    if (Array.isArray(models)) {
      next.models = models.filter((m) => typeof m === 'string');
      next.modelsCheckedAt = Date.now();
    }
    writeFileRaw(next);
    return { ok: true, enc: next.apiKey ? next.apiKey.enc : 'none', path: filePath() };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

function clearKey() {
  try {
    const file = readFileRaw();
    if (!file) return { ok: true };
    delete file.apiKey;
    delete file.models;
    delete file.modelsCheckedAt;
    writeFileRaw({ ...file, version: FILE_VERSION });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

function setupSecretStore() {
  ipcMain.handle('mv:key-get', () => getState());
  ipcMain.handle('mv:key-set', (_e, key, models) => setKey(key, models));
  ipcMain.handle('mv:key-clear', () => clearKey());
}

module.exports = { setupSecretStore, getState, setKey, clearKey, encryptionAvailable };
