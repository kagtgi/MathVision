'use strict';

const { app, BrowserWindow, dialog, ipcMain, shell, session } = require('electron');
const fs = require('fs');
const path = require('path');

const { createUpdater } = require('./updater.cjs');

// PHẢI gọi trước mọi `app.getPath('userData')`. Không gọi thì `app.name` rơi về
// `"name": "math-vision"` trong package.json, còn bản electron-builder dùng `productName`
// -> `MathVision`. Hệ quả: `electron:preview` ghi vào %APPDATA%\math-vision còn bản đóng gói
// ghi %APPDATA%\MathVision, nên key và lịch sử âm thầm không mang sang được.
app.setName('MathVision');

/** Thư mục lưu lần trước — giáo viên thường lưu cả loạt đề vào cùng một chỗ. */
let lastSaveDir = null;

/** Giữ cửa sổ ở phạm vi module để bộ cập nhật đẩy được trạng thái sang giao diện. */
let mainWindow = null;

const updater = createUpdater({
  send: (channel, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
  },
  log: (msg) => console.log('[updater]', msg),
});

function setupUpdates() {
  ipcMain.handle('mv:get-version', () => app.getVersion());
  ipcMain.handle('mv:update-state', () => updater.getState());
  ipcMain.handle('mv:check-updates', async () => {
    await updater.check();
    return updater.getState();
  });
  ipcMain.handle('mv:apply-update', () => updater.apply());
  updater.start();
}

/**
 * Lưu file theo yêu cầu của giao diện: hỏi chỗ lưu, ghi ra đĩa, mở thư mục.
 *
 * KHÔNG dùng cơ chế tải của trình duyệt (blob + thẻ `<a download>`). Đã thử hai cách và
 * cả hai đều hỏng ngoài đời thật:
 *   1. `item.setSaveDialogOptions()` rồi để Electron tự bung hộp thoại — hộp thoại không
 *      hiện, không file nào được ghi.
 *   2. Tự gọi `dialog.showSaveDialogSync()` bên trong `will-download` — treo tiến trình
 *      main, download nằm lại dạng `.tmp` trong Downloads và không bao giờ hoàn tất.
 * Nguyên nhân chung: `will-download` bắt buộc quyết đường dẫn NGAY, không cho mở hộp
 * thoại modal ở đó. Đi qua IPC thì không vướng ràng buộc nào.
 */
function setupFileSaving() {
  ipcMain.handle('mv:save-file', async (event, suggestedName, data) => {
    try {
      const bytes = Buffer.from(data);
      const name = String(suggestedName || 'tai-lieu.docx');
      const ext = path.extname(name).toLowerCase();

      // Lối tắt CHỈ dành cho kiểm thử tự động (scripts/verify-download.mjs): bỏ qua hộp
      // thoại để chạy được không cần người bấm. Không đặt biến này thì không có tác dụng.
      const testDir = process.env.MV_TEST_SAVE_DIR;
      let target;
      if (testDir) {
        target = path.join(testDir, name);
      } else {
        const dir = lastSaveDir && fs.existsSync(lastSaveDir) ? lastSaveDir : app.getPath('downloads');
        const filters =
          ext === '.txt'
            ? [{ name: 'Văn bản', extensions: ['txt'] }]
            : [{ name: 'Tài liệu Word', extensions: ['docx'] }];
        const win = BrowserWindow.fromWebContents(event.sender);
        const result = await dialog.showSaveDialog(win ?? undefined, {
          title: 'Lưu file',
          defaultPath: path.join(dir, name),
          filters: [...filters, { name: 'Tất cả', extensions: ['*'] }],
          buttonLabel: 'Lưu',
        });
        if (result.canceled || !result.filePath) return { ok: false, canceled: true };
        target = result.filePath;
      }

      await fs.promises.writeFile(target, bytes);
      lastSaveDir = path.dirname(target);
      shell.showItemInFolder(target);
      return { ok: true, path: target };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  });
}

/**
 * Lưới an toàn cho mọi tải file đi đường trình duyệt (giao diện lẽ ra không dùng nữa).
 * Đặt đường dẫn NGAY, tuyệt đối không mở hộp thoại ở đây.
 */
function setupDownloads() {
  session.defaultSession.on('will-download', (_event, item) => {
    const dir = lastSaveDir && fs.existsSync(lastSaveDir) ? lastSaveDir : app.getPath('downloads');
    const target = path.join(dir, item.getFilename());
    item.setSavePath(target);
    item.once('done', (_e, state) => {
      if (state === 'completed') shell.showItemInFolder(target);
    });
  });
}

function createWindow() {
  const win = (mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false, // allow fetch() to external APIs from file:// origin
      preload: path.join(__dirname, 'preload.cjs'),
    },
    title: 'MathVision',
    show: false,
  }));

  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  // Open all external links in the system browser, not inside Electron
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
}

// Một bản chạy một lần. Bản cài NSIS thay file rồi tự mở lại, không khoá thì lần mở lại
// có thể chồng lên tiến trình cũ chưa thoát hẳn.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.whenReady().then(() => {
  if (!gotLock) return;

  // Fix fetch() from file:// origin:
  // Replace null/missing Origin so Google's API accepts the request,
  // and add permissive CORS headers on responses so Chromium doesn't block them.
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders };
    if (!headers['Origin'] || headers['Origin'] === 'null') {
      headers['Origin'] = 'https://localhost';
    }
    callback({ requestHeaders: headers });
  });

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    headers['Access-Control-Allow-Origin'] = ['*'];
    headers['Access-Control-Allow-Methods'] = ['GET, POST, PUT, DELETE, OPTIONS'];
    headers['Access-Control-Allow-Headers'] = ['Content-Type, Authorization, x-goog-api-key, Accept'];
    callback({ responseHeaders: headers });
  });

  setupFileSaving();
  setupDownloads();
  createWindow();
  setupUpdates();
});

app.on('window-all-closed', () => {
  updater.stop();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
