/**
 * Tiến trình main Electron tối giản, CHỈ để bộ đo hình dùng.
 *
 * Vì sao không dùng `electron/main.cjs` của app: hàm đó `loadFile('dist/index.html')`, tức bắt
 * phải `npm run build` trước, mà bản build KHÔNG chứa `tikz-corpus.html` (`vite.config.ts` chỉ
 * lấy `index.html` làm entry). Nạp thẳng trang từ Vite dev server là đường ngắn nhất và cũng là
 * đường giống môi trường thật nhất (http, không phải file://).
 *
 * Vì sao KHÔNG cần CDP: trang tự POST kết quả về bồn http của driver. Bỏ được cả cổng debug,
 * cả `WebSocket`, và cả giới hạn payload của `Runtime.evaluate returnByValue` — 47 ảnh base64
 * thì thừa sức làm vỡ chỗ đó.
 *
 * Usage (driver tự gọi): electron scripts/lib/corpusMain.cjs <url>
 */

const { app, BrowserWindow } = require('electron');

const url = process.argv[2];

// GPU trên máy ảo CI hay dựng ra lỗi lạ, mà trang này chỉ cần canvas 2D.
app.disableHardwareAcceleration();

app.whenReady().then(() => {
  const win = new BrowserWindow({
    show: false,
    width: 1400,
    height: 1000,
    webPreferences: {
      // BẮT BUỘC: cửa sổ ẩn bị Chromium hãm timer, mà `waitForSvgIn` dò SVG bằng setTimeout
      // 200 ms. Thiếu cờ này thì mọi hình đều "quá thời gian" chứ không phải mã sai.
      backgroundThrottling: false,
      // Bằng với app thật (`electron/main.cjs`): cho fetch tới tex.wasm và bồn http.
      webSecurity: false,
      offscreen: false,
    },
  });

  win.webContents.on('console-message', (_e, _level, message) => {
    if (/error|fail|404/i.test(message)) console.log(`[renderer] ${message}`);
  });

  win.loadURL(url);
});

// Driver là bên quyết định lúc nào xong; ở đây chỉ cần đừng tự thoát khi cửa sổ đóng.
app.on('window-all-closed', () => app.quit());
