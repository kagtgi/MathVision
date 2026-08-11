/**
 * Cài đặt — ngăn trượt bên phải, PHỦ LÊN chứ không phải route.
 *
 * Vì sao không dùng route: hai converter giữ `pdfFile`, `figuresRef`, `abortRef` trong state,
 * và cleanup lúc unmount gọi `abortRef.current?.abort()`. Chuyển route để hiện Cài đặt sẽ
 * giết job đang chạy hàng phút.
 */

import { useEffect, useState } from 'react';
import { Eye, EyeOff, Loader2, ShieldCheck, ShieldAlert, X } from 'lucide-react';

import { checkApiKey } from '../pipeline/geminiClient';
import { clearKey, saveKey } from '../key/keyStore';

interface Props {
  open: boolean;
  onClose: () => void;
  apiKey: string;
  storage: { enc: KeyEnc; encryptionAvailable: boolean; path?: string };
  /** Gọi khi key đổi để App cập nhật state và chuỗi model. */
  onKeyChange: (key: string, models?: string[]) => void;
  onForget: () => void;
  version: string | null;
}

type CheckState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'ok'; count: number }
  | { kind: 'warn'; text: string }
  | { kind: 'err'; text: string };

export default function SettingsPanel({
  open,
  onClose,
  apiKey,
  storage,
  onKeyChange,
  onForget,
  version,
}: Props) {
  const [draft, setDraft] = useState(apiKey);
  const [show, setShow] = useState(false);
  const [check, setCheck] = useState<CheckState>({ kind: 'idle' });

  useEffect(() => {
    if (open) {
      setDraft(apiKey);
      setCheck({ kind: 'idle' });
    }
  }, [open, apiKey]);

  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [open, onClose]);

  if (!open) return null;

  /** Lưu onBlur để không ghi đĩa từng ký tự. */
  const commit = async () => {
    const next = draft.trim();
    if (!next || next === apiKey) return;
    await saveKey(next);
    onKeyChange(next);
  };

  const runCheck = async () => {
    const next = draft.trim();
    if (!next) return;
    setCheck({ kind: 'checking' });
    const res = await checkApiKey(next);
    if (!res.ok) {
      setCheck({ kind: 'err', text: res.error ?? 'Key không dùng được.' });
      return;
    }
    // `warning` = chưa xác nhận được nhưng key chưa bị chối -> VẪN lưu.
    await saveKey(next, res.available.length ? res.chain : undefined);
    onKeyChange(next, res.chain);
    setCheck(
      res.warning
        ? { kind: 'warn', text: res.warning }
        : { kind: 'ok', count: res.chain.length },
    );
  };

  const forget = async () => {
    await clearKey();
    onForget();
    onClose();
  };

  const encrypted = storage.enc === 'safeStorage';

  return (
    <>
      <div
        onClick={onClose}
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(32,33,36,.32)' }}
        aria-hidden="true"
      />
      <aside
        className="fixed right-0 top-0 bottom-0 z-50 w-[380px] flex flex-col"
        style={{ background: 'var(--surface)', borderLeft: '1px solid var(--line)' }}
        role="dialog"
        aria-label="Cài đặt"
      >
        <header className="shrink-0 h-14 px-5 hairline-b flex items-center justify-between">
          <h2 className="text-[14px] font-medium">Cài đặt</h2>
          <button onClick={onClose} style={{ color: 'var(--ink-4)' }} aria-label="Đóng">
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto scroll-thin px-5 py-4 space-y-5">
          <section>
            <label htmlFor="set-key" className="t-label block mb-2">
              Gemini API key
            </label>
            <div className="flex gap-2">
              <input
                id="set-key"
                type={show ? 'text' : 'password'}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                autoComplete="off"
                spellCheck={false}
                className="input flex-1"
                placeholder="AIza…"
              />
              <button
                onClick={() => setShow((s) => !s)}
                className="btn btn-outline btn-sm"
                aria-label={show ? 'Ẩn key' : 'Hiện key'}
              >
                {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>

            <button
              onClick={runCheck}
              disabled={!draft.trim() || check.kind === 'checking'}
              className="btn btn-tonal btn-sm mt-2.5"
            >
              {check.kind === 'checking' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <ShieldCheck className="w-3.5 h-3.5" />
              )}
              Kiểm tra key
            </button>

            {check.kind === 'ok' && (
              <p className="t-small mt-2" style={{ color: 'var(--ok)' }}>
                Dùng được — {check.count} model khả dụng.
              </p>
            )}
            {check.kind === 'warn' && (
              <p className="t-small mt-2" style={{ color: 'var(--warn)' }}>
                {check.text}
              </p>
            )}
            {check.kind === 'err' && (
              <p className="t-small mt-2" style={{ color: 'var(--err)' }}>
                {check.text}
              </p>
            )}
          </section>

          <section>
            <p className="t-label mb-2">Cách lưu key</p>
            {storage.enc === 'none' ? (
              <p className="t-small">Chưa lưu key nào.</p>
            ) : encrypted ? (
              <div className="flex items-start gap-2">
                <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: 'var(--ok)' }} />
                <p className="t-small">
                  Đã mã hoá bằng kho khoá của Windows — chỉ tài khoản Windows này giải mã được.
                </p>
              </div>
            ) : (
              <div className="flex items-start gap-2 rounded-lg p-3" style={{ background: '#fef7e0' }}>
                <ShieldAlert
                  className="w-3.5 h-3.5 mt-0.5 shrink-0"
                  style={{ color: 'var(--warn)' }}
                />
                <p className="text-[12.5px]" style={{ color: 'var(--warn)' }}>
                  Máy này không có kho khoá hệ thống nên key đang lưu dạng văn bản thường
                  {storage.path ? ` tại ${storage.path}` : ''}. Bấm “Xoá key” khi dùng máy chung.
                </p>
              </div>
            )}
          </section>

          <section>
            <button onClick={forget} className="btn btn-outline btn-sm">
              Xoá key
            </button>
            <p className="t-small mt-1.5">
              Xoá khỏi máy này. Lần sau mở app sẽ hỏi lại key.
            </p>
          </section>
        </div>

        <footer className="shrink-0 px-5 py-3" style={{ borderTop: '1px solid var(--line)' }}>
          <p className="t-small">MathVision {version ? `v${version}` : ''}</p>
        </footer>
      </aside>
    </>
  );
}
