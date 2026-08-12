/**
 * Thông báo cập nhật, góc dưới bên phải.
 *
 * Trạng thái do tiến trình main đẩy sang (xem `electron/updater.cjs`) — giao diện không tự
 * hỏi mạng, vì `<StrictMode>` gọi effect hai lần lúc phát triển thì sẽ kiểm hai lượt.
 *
 * Chạy trong trình duyệt lúc `npm run dev` thì `window.mathvision` là `undefined` nên
 * component này không hiện gì cả.
 */

import { useEffect, useState } from 'react';
import { Download, Loader2, RefreshCw, X } from 'lucide-react';

export default function UpdateToast() {
  const [state, setState] = useState<UpdateState | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    const bridge = window.mathvision;
    if (!bridge?.onUpdateState) return;
    void bridge.getUpdateState().then(setState);
    return bridge.onUpdateState(setState);
  }, []);

  if (!state) return null;
  // `checking`/`idle` im lặng — không làm phiền khi chẳng có gì mới.
  if (state.status === 'idle' || state.status === 'checking') return null;
  if (state.version && dismissed === state.version) return null;

  const apply = async () => {
    setApplying(true);
    try {
      const res = await window.mathvision?.applyUpdate();
      // Bản portable chỉ mở trình duyệt, app vẫn chạy tiếp -> nhả nút ra.
      if (res?.opened) setApplying(false);
    } catch {
      setApplying(false);
    }
  };

  const downloading = state.status === 'downloading';
  const portable = state.status === 'available-portable';

  return (
    <div
      className="card fixed bottom-4 right-4 z-50 w-[300px] p-3.5"
      style={{ boxShadow: '0 2px 12px rgba(0,0,0,.10)' }}
      role="status"
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium">
            {downloading ? 'Đang tải bản mới' : `Đã có MathVision ${state.version}`}
          </p>
          <p className="t-small mt-0.5">
            {downloading
              ? `${state.percent ?? 0}%`
              : portable
                ? `Bạn đang dùng ${state.currentVersion}. Bấm để tải, thay file và mở lại bản mới.`
                : `Bạn đang dùng ${state.currentVersion}.`}
          </p>
        </div>
        {!downloading && (
          <button
            onClick={() => setDismissed(state.version ?? null)}
            style={{ color: 'var(--ink-4)' }}
            aria-label="Để sau"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {downloading && (
        <div className="progress mt-2.5">
          <span style={{ width: `${state.percent ?? 0}%` }} />
        </div>
      )}

      {state.status === 'ready' && (
        <button onClick={apply} disabled={applying} className="btn btn-primary btn-sm w-full mt-2.5">
          {applying ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <RefreshCw className="w-3.5 h-3.5" />
          )}
          Khởi động lại để cập nhật
        </button>
      )}

      {portable && (
        <button onClick={apply} disabled={applying} className="btn btn-primary btn-sm w-full mt-2.5">
          {applying ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Download className="w-3.5 h-3.5" />
          )}
          Cập nhật và mở lại
        </button>
      )}
    </div>
  );
}

/** Số phiên bản để hiện ở thanh tiêu đề; `null` khi chạy trong trình duyệt. */
export function useAppVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    void window.mathvision?.getVersion().then(setVersion);
  }, []);
  return version;
}
