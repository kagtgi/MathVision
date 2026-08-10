'use strict';

const { app, BrowserWindow, shell, session } = require('electron');
const fs = require('fs');
const path = require('path');

/**
 * Mỗi lần tải là hiện hộp thoại cho người dùng tự chọn thư mục, và nhớ thư mục vừa chọn
 * làm mặc định cho lần sau — giáo viên thường lưu cả loạt đề vào cùng một chỗ.
 *
 * Xong thì mở Explorer chỉ đúng file vừa lưu, để không phải đi tìm.
 */
function setupDownloads() {
  let lastDir = null;

  session.defaultSession.on('will-download', (_event, item) => {
    const name = item.getFilename();
    const ext = path.extname(name).toLowerCase();
    const dir = lastDir && fs.existsSync(lastDir) ? lastDir : app.getPath('downloads');

    const filters =
      ext === '.txt'
        ? [{ name: 'Văn bản', extensions: ['txt'] }]
        : [{ name: 'Tài liệu Word', extensions: ['docx'] }];

    // Không gọi setSavePath -> Electron tự bung hộp thoại lưu với các tuỳ chọn này.
    item.setSaveDialogOptions({
      title: 'Lưu file',
      defaultPath: path.join(dir, name),
      filters: [...filters, { name: 'Tất cả', extensions: ['*'] }],
      buttonLabel: 'Lưu',
    });

    item.once('done', (_e, state) => {
      if (state !== 'completed') return;
      const saved = item.getSavePath();
      if (!saved) return;
      lastDir = path.dirname(saved);
      shell.showItemInFolder(saved);
    });
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false, // allow fetch() to external APIs from file:// origin
    },
    title: 'MathVision',
    show: false,
  });

  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  win.once('ready-to-show', () => win.show());

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

app.whenReady().then(() => {
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

  setupDownloads();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
