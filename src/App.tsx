/**
 * MathVision — Ảnh → Word và PDF → Word cho đề thi toán THPT.
 *
 * API key chỉ nhập một lần: lưu trong localStorage của ứng dụng (Electron có hồ sơ
 * riêng cho từng app nên không lẫn với trình duyệt). Nút "Đổi key" xoá đi khi cần.
 */

import { useEffect, useState } from 'react';
import { ArrowRight, FileText, Image as ImageIcon, Loader2 } from 'lucide-react';

import ImageToWordConverter from './ImageToWordConverter';
import PdfToDocxConverter from './PdfToDocxConverter';
import { checkApiKey, MODEL_CHAIN } from './pipeline/geminiClient';

type AppMode = 'image-to-word' | 'pdf-to-word';

const KEY_STORAGE = 'mathvision.apiKey';

export default function App() {
  const [apiKey, setApiKey] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [checking, setChecking] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>(MODEL_CHAIN);
  const [mode, setMode] = useState<AppMode>('pdf-to-word');

  // Key đã lưu thì vào thẳng; không gọi mạng lúc khởi động cho nhanh.
  useEffect(() => {
    const saved = localStorage.getItem(KEY_STORAGE);
    if (saved) {
      setApiKey(saved);
      setUnlocked(true);
    }
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
    localStorage.setItem(KEY_STORAGE, key);
    setUnlocked(true);
  };

  const forgetKey = () => {
    localStorage.removeItem(KEY_STORAGE);
    setApiKey('');
    setUnlocked(false);
    setKeyError(null);
  };

  if (!unlocked) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <div className="w-full max-w-[420px]">
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
          <span className="t-title" style={{ letterSpacing: '-0.2px' }}>
            MathVision
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

        <button onClick={forgetKey} className="btn btn-text">
          Đổi key
        </button>
      </header>

      {mode === 'pdf-to-word' ? (
        <PdfToDocxConverter apiKey={apiKey} models={models} />
      ) : (
        <ImageToWordConverter apiKey={apiKey} models={models} />
      )}
    </div>
  );
}
