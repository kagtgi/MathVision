'use strict';

const { app, BrowserWindow, shell, session } = require('electron');
const fs = require('fs');
const path = require('path');

/**
 * File tải về luôn vào thư mục Downloads, rồi tự mở Explorer chỉ đúng file đó.
 *
 * Mặc định của Electron là bung hộp thoại "Save As" mỗi lần tải — với người dùng là giáo
 * viên thì vừa thêm một bước, vừa hay bị bấm nhầm rồi không biết file nằm đâu. Cách này
 * bỏ hẳn hộp thoại và trả lời luôn câu "file vừa tải nằm ở đâu".
 */
function setupDownloads() {
  session.defaultSession.on('will-download', (_event, item) => {
    const dir = app.getPath('downloads');
    const name = item.getFilename();
    const ext = path.extname(name);
    const base = path.basename(name, ext);

    // Trùng tên thì thêm (1), (2)... giống Chrome, không ghi đè file cũ.
    let target = path.join(dir, name);
    for (let i = 1; fs.existsSync(target); i++) {
      target = path.join(dir, `${base} (${i})${ext}`);
    }
    item.setSavePath(target);

    item.once('done', (_e, state) => {
      if (state === 'completed') shell.showItemInFolder(target);
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
