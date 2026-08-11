'use strict';

/**
 * Cập nhật trong app.
 *
 * HAI BẢN, HAI CƠ CHẾ KHÁC HẲN NHAU:
 *
 * - **Bản cài (NSIS)** — electron-updater tải bản mới ngầm rồi hiện nút "Khởi động lại để
 *   cập nhật", bấm là `quitAndInstall()` thay file và mở lại. Đây là đường chính.
 *
 * - **Bản portable** — CHỈ báo có bản mới kèm link tải, KHÔNG tự thay file. Lý do: exe
 *   portable tự giải nén ra %TEMP% mỗi lần chạy và đang bị Windows khoá, muốn thay phải
 *   dựng một tiến trình trung gian đợi app thoát rồi mới đổi tên — nhiều đường vỡ (khoá
 *   file, SmartScreen, diệt virus) mà không harness nào che được. Bấm nút là mở trình duyệt
 *   tới trang Release, tải tay.
 *
 * Nhận biết portable bằng `PORTABLE_EXECUTABLE_FILE` — biến môi trường do chính stub NSIS
 * của bản portable đặt.
 *
 * Bản chạy từ `npm run electron:preview` (chưa đóng gói) không kiểm gì cả: electron-updater
 * cần `app-update.yml` nằm trong `resources/`, chỉ có ở bản đã đóng gói.
 */

const { app, shell } = require('electron');

const REPO = 'kagtgi/MathVision';
/** Đợi cửa sổ hiện xong rồi mới đụng tới mạng — khởi động không được chờ mạng. */
const FIRST_CHECK_DELAY = 20_000;
const RECHECK_EVERY = 6 * 60 * 60 * 1000;

const isPortable = () => Boolean(process.env.PORTABLE_EXECUTABLE_FILE);

/** So hai chuỗi phiên bản kiểu `1.10.2`; trả true nếu `a` mới hơn `b`. */
function isNewer(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(Number);
  const pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

function createUpdater({ send, log }) {
  /**
   * Chỉ giữ phần thay đổi; `currentVersion`/`portable` gắn vào lúc đọc ra. Trước đây gắn
   * trong `setState` nên trạng thái KHỞI TẠO thiếu hai field đó — giao diện đọc ngay lúc mở
   * (trước lần kiểm đầu ở giây thứ 20) sẽ không biết mình là bản portable.
   */
  let raw = { status: 'idle' };
  let timer = null;

  const decorate = (s) => ({ ...s, currentVersion: app.getVersion(), portable: isPortable() });
  const setState = (next) => {
    raw = next;
    send('mv:update-state', decorate(raw));
  };

  // ── Bản portable: hỏi GitHub xem có bản mới không, không tải gì ──────────────
  async function checkPortable() {
    try {
      setState({ status: 'checking' });
      const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (!res.ok) throw new Error(`GitHub trả về ${res.status}`);
      const body = await res.json();
      const latest = String(body.tag_name || '').replace(/^v/, '');
      if (latest && isNewer(latest, app.getVersion())) {
        setState({ status: 'available-portable', version: latest, url: body.html_url });
      } else {
        setState({ status: 'idle' });
      }
    } catch (err) {
      log(`kiểm cập nhật (portable) hỏng: ${err.message}`);
      setState({ status: 'idle' });
    }
  }

  // ── Bản cài: electron-updater lo hết ─────────────────────────────────────────
  let autoUpdater = null;
  function installed() {
    if (autoUpdater) return autoUpdater;
    // require muộn: bản portable không bao giờ nạp tới module này.
    ({ autoUpdater } = require('electron-updater'));
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = { info: log, warn: log, error: log, debug: () => {} };

    autoUpdater.on('checking-for-update', () => setState({ status: 'checking' }));
    autoUpdater.on('update-not-available', () => setState({ status: 'idle' }));
    autoUpdater.on('update-available', (info) =>
      setState({ status: 'downloading', version: info.version, percent: 0 }),
    );
    autoUpdater.on('download-progress', (p) =>
      setState({ status: 'downloading', version: raw.version, percent: Math.round(p.percent) }),
    );
    autoUpdater.on('update-downloaded', (info) =>
      setState({ status: 'ready', version: info.version }),
    );
    autoUpdater.on('error', (err) => {
      log(`cập nhật hỏng: ${err && err.message ? err.message : err}`);
      setState({ status: 'idle' });
    });
    return autoUpdater;
  }

  async function check() {
    if (!app.isPackaged) return;
    if (isPortable()) return checkPortable();
    try {
      await installed().checkForUpdates();
    } catch (err) {
      log(`kiểm cập nhật hỏng: ${err.message}`);
    }
  }

  return {
    getState: () => decorate(raw),
    check,
    start() {
      if (!app.isPackaged) {
        log('bản chưa đóng gói — bỏ qua kiểm cập nhật');
        return;
      }
      timer = setTimeout(() => {
        void check();
        timer = setInterval(() => void check(), RECHECK_EVERY);
      }, FIRST_CHECK_DELAY);
    },
    stop() {
      // Cùng một handle, lúc là timeout lúc là interval — Node nhận cả hai hàm xoá.
      if (timer) {
        clearTimeout(timer);
        clearInterval(timer);
        timer = null;
      }
    },
    /** Bản cài: thoát và cài. Bản portable: mở trang Release trong trình duyệt. */
    async apply() {
      if (isPortable()) {
        await shell.openExternal(raw.url || `https://github.com/${REPO}/releases/latest`);
        return { ok: true, opened: true };
      }
      if (raw.status !== 'ready') return { ok: false, error: 'chưa tải xong bản mới' };
      // setImmediate để IPC kịp trả lời trước khi app thoát.
      setImmediate(() => installed().quitAndInstall());
      return { ok: true };
    },
  };
}

module.exports = { createUpdater, isPortable, isNewer };
