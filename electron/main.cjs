'use strict';

const { app, BrowserWindow, shell, session } = require('electron');
const path = require('path');

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

  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
