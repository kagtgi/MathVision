'use strict';

/**
 * Cập nhật trong app.
 *
 * HAI BẢN, HAI CƠ CHẾ KHÁC HẲN NHAU:
 *
 * - **Bản cài (NSIS)** — electron-updater tải bản mới ngầm rồi hiện nút "Khởi động lại để
 *   cập nhật", bấm là `quitAndInstall()` thay file và mở lại. Đây là đường chính.
 *
 * - **Bản portable** — cũng tự cập nhật, chỉ là bằng cách khác. File BỊ KHOÁ là bản giải nén
 *   trong `%TEMP%`, còn file gốc mà người dùng bấm (`PORTABLE_EXECUTABLE_FILE`) thì thay được
 *   NGAY SAU KHI tiến trình thoát. Nên: tải bản mới về cùng thư mục, đối chiếu SHA256, giao cho
 *   PowerShell một lệnh đưa bản mới vào chỗ rồi dọn bản cũ và mở lên — xong mới `app.quit()`.
 *   Người dùng chỉ bấm một nút. Chi tiết ở `swapCommand`.
 *
 *   Bản trước chỉ mở trình duyệt cho tải tay, với lý do "nhiều đường vỡ mà không harness nào
 *   che được". Vẫn đúng là nhiều đường vỡ, nên MỌI đường vỡ đều rơi về mở trình duyệt: thư mục
 *   không ghi được, tải hỏng, SHA256 lệch, GitHub không trả lời. Không bao giờ chạy một file
 *   chưa đối chiếu được hash. Còn phần "che được" thì `verify-update.mjs` nay thay file thật
 *   trên một exe ĐANG CHẠY để chứng minh, chứ không suy luận nữa.
 *
 * Nhận biết portable bằng `PORTABLE_EXECUTABLE_FILE` — biến môi trường do chính stub NSIS
 * của bản portable đặt.
 *
 * Bản chạy từ `npm run electron:preview` (chưa đóng gói) không kiểm gì cả: electron-updater
 * cần `app-update.yml` nằm trong `resources/`, chỉ có ở bản đã đóng gói.
 */

const { app, shell } = require('electron');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REPO = 'kagtgi/MathVision';
/** Tên file portable trên Release: `MathVision-1.3.0.exe`. Bản cài có chữ `Setup`, phải loại. */
const PORTABLE_ASSET = /^MathVision-\d[\d.]*\.exe$/i;
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

/**
 * Đọc hash mong đợi của MỘT file từ nội dung SHA256.txt. Trả '' nếu không tìm được dòng hợp lệ —
 * bên gọi PHẢI coi đó là lý do huỷ, không được chạy file chưa đối chiếu được.
 *
 * Khớp TÊN FILE CHÍNH XÁC ở cuối dòng, KHÔNG dùng so khớp lỏng: một bản phát hành có cả
 * `MathVision-1.3.0.exe` lẫn `MathVision-Setup.exe.blockmap`, khớp lỏng là lấy nhầm hash của
 * file khác rồi kết luận "tải về hỏng" cho một file hoàn toàn lành.
 */
function parseSha256(text, name) {
  for (const raw of String(text).split('\n')) {
    const parts = raw.trim().split(/\s+/).filter(Boolean);
    if (parts.length < 2 || parts[parts.length - 1] !== name) continue;
    const hash = parts[0].toLowerCase();
    if (/^[0-9a-f]{64}$/.test(hash)) return hash;
  }
  return '';
}

/** Chuỗi cho PowerShell, nháy đơn — trong nháy đơn PS chỉ có `'` là ký tự cần thoát. */
const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** `-EncodedCommand` đòi base64 của UTF-16LE. Đây là chỗ dấu tiếng Việt đi qua nguyên vẹn. */
const encodeCommand = (src) => Buffer.from(src, 'utf16le').toString('base64');

const timeout = (ms) => AbortSignal.timeout(ms);

/**
 * Lệnh thay file, chạy SAU khi app đã thoát.
 *
 * **Vì sao PowerShell chứ không phải `.cmd`:** đường dẫn hay có dấu tiếng Việt
 * (`C:\Users\Nguyễn Văn A\Downloads`). File `.cmd` được cmd.exe đọc theo bảng mã OEM của máy,
 * Node thì không ghi được bảng mã đó — mọi cách ghi đều làm hỏng dấu và script trượt file.
 * `-EncodedCommand` nhận base64 của UTF-16LE nên đường dẫn đi nguyên vẹn, lại không cần file tạm
 * và không đụng ExecutionPolicy (chính sách đó chỉ chặn *file* script).
 *
 * **Thứ tự các bước là phần quan trọng nhất.** Bản mới vào chỗ TRƯỚC, dọn bản cũ SAU: nếu bước
 * chép hỏng thì người dùng vẫn còn nguyên bản cũ chạy được. Làm ngược lại — xoá trước rồi chép
 * hỏng — là người dùng mất sạch app.
 *
 * Vòng lặp xoá phải thử lại: stub portable còn giữ file gốc thêm một nhịp sau khi cửa sổ đóng.
 * Xoá không được cũng KHÔNG dừng: thừa một file cũ thì kệ, còn hơn không mở được bản mới.
 */
function swapCommand({ download, dest, old }) {
  const sameName = String(old).toLowerCase() === String(dest).toLowerCase();
  return `$ErrorActionPreference = 'SilentlyContinue'
$dl = ${psQuote(download)}
$dest = ${psQuote(dest)}
$old = ${psQuote(old)}
function Wait-Gone($p) {
  for ($i = 0; $i -lt 90; $i++) {
    if (-not (Test-Path -LiteralPath $p)) { return $true }
    Remove-Item -LiteralPath $p -Force
    if (-not (Test-Path -LiteralPath $p)) { return $true }
    Start-Sleep -Seconds 1
  }
  return $false
}
${
  sameName
    ? `# Bản mới trùng tên bản cũ nên buộc phải xoá trước. Còn khoá thì bỏ cuộc mà KHÔNG đụng gì —
# file cũ nguyên vẹn, người dùng mở lại như thường.
if (-not (Wait-Gone $old)) { exit 1 }`
    : ''
}
Move-Item -LiteralPath $dl -Destination $dest -Force
if (-not (Test-Path -LiteralPath $dest)) { exit 1 }
${sameName ? '' : 'Wait-Gone $old | Out-Null'}
Start-Process -LiteralPath $dest
`;
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

  // ── Bản portable: tải, đối chiếu hash, thay file ────────────────────────────

  const openReleasePage = async (why) => {
    if (why) log(`portable: ${why} — mở trang Release cho tải tay`);
    await shell.openExternal(raw.url || `https://github.com/${REPO}/releases/latest`);
    return { ok: true, opened: true };
  };

  /** Tải có báo tiến độ, vừa tải vừa băm để khỏi đọc lại file lần hai. */
  async function download(url, dest, version) {
    const res = await fetch(url, { headers: { Accept: 'application/octet-stream' } });
    if (!res.ok || !res.body) throw new Error(`tải về lỗi HTTP ${res.status}`);
    const total = Number(res.headers.get('content-length')) || 0;
    const hash = crypto.createHash('sha256');
    const out = fs.createWriteStream(dest);
    // Đầy đĩa thì `write` trả false rồi 'drain' KHÔNG BAO GIỜ tới — không bắt lỗi là nút quay mãi.
    const died = new Promise((_, reject) => out.once('error', reject));
    let got = 0;
    let lastPct = -1;
    for await (const chunk of res.body) {
      hash.update(chunk);
      got += chunk.length;
      if (!out.write(chunk)) await Promise.race([new Promise((r) => out.once('drain', r)), died]);
      const pct = total ? Math.floor((got / total) * 100) : 0;
      if (pct !== lastPct) {
        lastPct = pct;
        setState({ status: 'downloading', version, percent: pct });
      }
    }
    await Promise.race([new Promise((r) => out.end(r)), died]);
    return hash.digest('hex');
  }

  async function applyPortable() {
    const oldExe = process.env.PORTABLE_EXECUTABLE_FILE;
    if (!oldExe) return openReleasePage('không biết file portable nào đang chạy');
    const dir = path.dirname(oldExe);
    // Chốt lại trước khi `download` ghi đè `raw` — nếu không thì lối vỡ mất cả số hiệu lẫn link.
    const version = raw.version;
    const url = raw.url;

    try {
      fs.accessSync(dir, fs.constants.W_OK);
    } catch {
      return openReleasePage(`thư mục ${dir} không ghi được`);
    }

    let dl = '';
    try {
      // Hai lượt hỏi này chỉ vài KB; treo mạng thì thà rơi về mở trình duyệt còn hơn quay mãi.
      const meta = { headers: { Accept: 'application/vnd.github+json' }, signal: timeout(15_000) };
      const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, meta);
      if (!res.ok) throw new Error(`GitHub trả về ${res.status}`);
      const body = await res.json();
      const asset = (body.assets || []).find((a) => PORTABLE_ASSET.test(a.name));
      const sums = (body.assets || []).find((a) => a.name === 'SHA256.txt');
      if (!asset) throw new Error('bản phát hành không có file portable');
      if (!sums) throw new Error('bản phát hành không có SHA256.txt');

      // Hash mong đợi PHẢI lấy trước khi chạy bất cứ thứ gì tải về.
      const sumRes = await fetch(sums.browser_download_url, { signal: timeout(15_000) });
      if (!sumRes.ok) throw new Error(`không tải được SHA256.txt (HTTP ${sumRes.status})`);
      const want = parseSha256(await sumRes.text(), asset.name);
      if (!want) throw new Error(`SHA256.txt không có dòng cho ${asset.name}`);

      dl = path.join(dir, `${asset.name}.download`);
      const got = await download(asset.browser_download_url, dl, version);
      if (got !== want) throw new Error('SHA256 lệch — tải về hỏng hoặc file bị đổi');

      const dest = path.join(dir, asset.name);
      const ps = swapCommand({ download: dl, dest, old: oldExe });
      // `detached` + `unref` để lệnh sống tiếp sau khi app thoát.
      spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodeCommand(ps)],
        { detached: true, stdio: 'ignore', windowsHide: true },
      ).unref();
      log(`portable: đã tải ${asset.name}, hash khớp — thoát để thay file`);
      setImmediate(() => app.quit());
      return { ok: true };
    } catch (err) {
      if (dl) fs.rmSync(dl, { force: true });
      setState({ status: 'available-portable', version, url });
      return openReleasePage(err.message);
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
    /** Bản cài: thoát và cài. Bản portable: tải, đối chiếu hash, thay file rồi mở lại. */
    async apply() {
      if (isPortable()) return applyPortable();
      if (raw.status !== 'ready') return { ok: false, error: 'chưa tải xong bản mới' };
      // setImmediate để IPC kịp trả lời trước khi app thoát.
      setImmediate(() => installed().quitAndInstall());
      return { ok: true };
    },
  };
}

module.exports = {
  createUpdater,
  isPortable,
  isNewer,
  parseSha256,
  swapCommand,
  encodeCommand,
  PORTABLE_ASSET,
};
