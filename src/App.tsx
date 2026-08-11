/**
 * MathVision — Ảnh → Word và PDF → Word cho đề thi toán THPT.
 *
 * API key chỉ nhập một lần: lưu trong localStorage của ứng dụng (Electron có hồ sơ
 * riêng cho từng app nên không lẫn với trình duyệt). Nút "Đổi key" xoá đi khi cần.
 */

import { useEffect, useState } from 'react';
import {
  ArrowRight,
  FileText,
  Image as ImageIcon,
  History as HistoryIcon,
  Loader2,
  Settings as SettingsIcon,
} from 'lucide-react';

import ImageToWordConverter from './ImageToWordConverter';
import PdfToDocxConverter from './PdfToDocxConverter';
import UpdateToast, { useAppVersion } from './components/UpdateToast';
import SettingsPanel from './components/SettingsPanel';
import HistoryPanel from './components/HistoryPanel';
import { historyAvailable, load as loadHistory, type RestoredConversion } from './history/store';
import { clearKey, loadKey, saveKey } from './key/keyStore';
import { checkApiKey, MODEL_CHAIN } from './pipeline/geminiClient';

type AppMode = 'image-to-word' | 'pdf-to-word';

// Key không còn đọc/ghi trực tiếp ở đây nữa — xem `src/key/keyStore.ts`.

export default function App() {
  const [apiKey, setApiKey] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [checking, setChecking] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>(MODEL_CHAIN);
  const [mode, setMode] = useState<AppMode>('pdf-to-word');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  /**
   * Bàn giao mục vừa mở lại cho converter. `restoreSeq` để converter chạy lại effect kể cả
   * khi mở lại đúng mục vừa mở.
   */
  const [restore, setRestore] = useState<RestoredConversion | null>(null);
  const [restoreSeq, setRestoreSeq] = useState(0);
  const [storage, setStorage] = useState<{
    enc: KeyEnc;
    encryptionAvailable: boolean;
    path?: string;
  }>({ enc: 'none', encryptionAvailable: false });
  const [migrateWarn, setMigrateWarn] = useState(false);
  const version = useAppVersion();

  /**
   * Key đã lưu thì vào thẳng; không gọi mạng lúc khởi động cho nhanh.
   *
   * `loadKey()` lo luôn việc chuyển key cũ từ `localStorage` sang kho mã hoá, theo luật
   * ghi-trước-xoá-sau. Chuyển hỏng thì vẫn cho vào app và chỉ cảnh báo — không bao giờ để
   * người dùng mất key.
   *
   * Khôi phục cả `models`: bản trước không lưu nên mỗi lần mở app chuỗi model lại về mặc
   * định, và tài khoản nào không có model đầu chuỗi thì MỖI TRANG OCR và mỗi lượt giải đều
   * tốn một vòng 404 trước khi hạ model.
   */
  useEffect(() => {
    let cancelled = false;
    void loadKey().then((res) => {
      if (cancelled) return;
      setStorage({
        enc: res.enc,
        encryptionAvailable: res.encryptionAvailable,
        path: res.path,
      });
      if (res.migrationFailed) setMigrateWarn(true);
      if (res.models?.length) setModels(res.models);
      if (res.key) {
        setApiKey(res.key);
        setUnlocked(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const submitKey = async () => {
    const key = apiKey.trim();
    if (!key) return;
    setChecking(true);
    setKeyError(null);
    const result = await checkApiKey(key);
    setChecking(false);
    if (!result.ok) {
      setKeyError(result.error ?? 'Không kiểm tra được key.');
      return;
    }
    setModels(result.chain);
    // Lưu kèm chuỗi model đã lọc, chỉ khi thật sự dò được danh sách.
    const saved = await saveKey(key, result.available.length ? result.chain : undefined);
    setStorage((s) => ({ ...s, enc: saved.enc }));
    setUnlocked(true);
  };

  const forgetKey = () => {
    void clearKey();
    setApiKey('');
    setModels(MODEL_CHAIN); // đừng để chuỗi đã lọc của key cũ sống sang key mới
    setUnlocked(false);
    setKeyError(null);
    setStorage((s) => ({ ...s, enc: 'none' }));
  };

  const onKeyChange = (key: string, nextModels?: string[]) => {
    setApiKey(key);
    if (nextModels?.length) setModels(nextModels);
    setMigrateWarn(false);
    void loadKey().then((res) =>
      setStorage({ enc: res.enc, encryptionAvailable: res.encryptionAvailable, path: res.path }),
    );
  };

  if (!unlocked) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        {/* Cũng hiện ở màn hình nhập key — bản mới không phải chờ mở khoá mới báo. */}
        <UpdateToast />
        <div className="w-full max-w-[420px]">
          <img
            src="./logo-mark.png"
            alt=""
            width={72}
            height={72}
            className="mb-5 rounded-2xl"
            style={{ display: 'block' }}
          />
          <h1 className="t-display">MathVision</h1>
          <p className="t-body mt-3">
            Đề thi toán dạng PDF hoặc ảnh, chuyển thành file Word đúng chuẩn kèm đáp án chi
            tiết do máy tự giải.
          </p>

          <div className="mt-9">
            <label htmlFor="api-key" className="t-label block mb-2">
              Gemini API key
            </label>
            <input
              id="api-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submitKey();
              }}
              placeholder="AIza…"
              className="input"
              autoComplete="off"
            />

            {keyError && (
              <p className="t-small mt-2" style={{ color: 'var(--err)' }}>
                {keyError}
              </p>
            )}

            <p className="t-small mt-3">
              Lấy key miễn phí tại{' '}
              <a
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--accent)' }}
              >
                aistudio.google.com
              </a>
              . Key chỉ lưu trên máy này, nhập một lần là xong.
            </p>

            <button
              onClick={() => void submitKey()}
              disabled={!apiKey.trim() || checking}
              className="btn btn-primary mt-6 w-full"
            >
              {checking ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Đang kiểm tra key
                </>
              ) : (
                <>
                  Bắt đầu
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <header className="shrink-0 h-14 hairline-b flex items-center justify-between px-5">
        <div className="flex items-center gap-6">
          <span className="flex items-center gap-2">
            <img src="./logo-mark.png" alt="" width={22} height={22} className="rounded-md" />
            <span className="t-title" style={{ letterSpacing: '-0.2px' }}>
              MathVision
            </span>
          </span>

          <div className="seg">
            <button
              className="seg-item"
              data-on={mode === 'pdf-to-word'}
              onClick={() => setMode('pdf-to-word')}
            >
              <FileText className="w-3.5 h-3.5" />
              PDF → Word
            </button>
            <button
              className="seg-item"
              data-on={mode === 'image-to-word'}
              onClick={() => setMode('image-to-word')}
            >
              <ImageIcon className="w-3.5 h-3.5" />
              Ảnh → Word
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {version && (
            <span className="badge badge-neutral" title="Phiên bản đang chạy">
              v{version}
            </span>
          )}
          {historyAvailable() && (
            <button
              onClick={() => setHistoryOpen(true)}
              className="btn btn-text"
              title="Mở lại đề đã chuyển, xuất Word không tốn lượt gọi API"
            >
              <HistoryIcon className="w-3.5 h-3.5" />
              Lịch sử
            </button>
          )}
          <button
            onClick={() => setSettingsOpen(true)}
            className="btn btn-text"
            title="Key và cách lưu key"
          >
            <SettingsIcon className="w-3.5 h-3.5" />
            Cài đặt
          </button>
        </div>
      </header>

      {migrateWarn && (
        <div
          className="shrink-0 px-5 py-2 flex items-center gap-2"
          style={{ background: '#fef7e0' }}
        >
          <p className="text-[12.5px] flex-1" style={{ color: 'var(--warn)' }}>
            Chưa chuyển được key sang kho mã hoá — key vẫn đang lưu dạng văn bản thường.
          </p>
          <button onClick={() => setSettingsOpen(true)} className="btn btn-text btn-sm">
            Mở Cài đặt
          </button>
        </div>
      )}

      <HistoryPanel
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onOpen={async (id) => {
          const entry = await loadHistory(id);
          if (!entry) return;
          // Đổi chế độ TRƯỚC khi bàn giao: converter đích phải được mount để nhận.
          setMode(entry.mode);
          setRestore(entry);
          setRestoreSeq((n) => n + 1);
        }}
      />

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        apiKey={apiKey}
        storage={storage}
        onKeyChange={onKeyChange}
        onForget={forgetKey}
        version={version}
      />

      <UpdateToast />

      {mode === 'pdf-to-word' ? (
        <PdfToDocxConverter
          apiKey={apiKey}
          models={models}
          restore={restore}
          restoreSeq={restoreSeq}
        />
      ) : (
        <ImageToWordConverter
          apiKey={apiKey}
          models={models}
          restore={restore}
          restoreSeq={restoreSeq}
        />
      )}
    </div>
  );
}
