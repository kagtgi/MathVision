/**
 * Lịch sử chuyển đổi — ngăn trượt bên phải, PHỦ LÊN chứ không phải route.
 *
 * Vì sao không phải route (và cũng không phải mục thứ ba của thanh chế độ): hai converter giữ
 * `pdfFile`, `figuresRef`, `abortRef` trong state, và cleanup lúc unmount gọi
 * `abortRef.current?.abort()`. Chuyển route để hiện lịch sử sẽ GIẾT job đang chạy hàng phút.
 * Thanh chế độ lại là ternary hai nhánh, thêm giá trị thứ ba sẽ âm thầm render sai converter.
 */

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ImageOff, Loader2, Trash2, X } from 'lucide-react';

import * as history from '../history/store';
import type { HistoryIndexRow } from '../history/schema';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Mở lại một mục: App set `restore` rồi đổi chế độ. */
  onOpen: (id: string) => Promise<void>;
}

const PAGE = 20;

const fmtBytes = (n: number) =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(0)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

function fmtWhen(ts: number): string {
  const d = new Date(ts);
  const two = (x: number) => String(x).padStart(2, '0');
  const today = new Date();
  const sameDay =
    d.getDate() === today.getDate() &&
    d.getMonth() === today.getMonth() &&
    d.getFullYear() === today.getFullYear();
  const time = `${two(d.getHours())}:${two(d.getMinutes())}`;
  return sameDay ? `Hôm nay ${time}` : `${two(d.getDate())}/${two(d.getMonth() + 1)} ${time}`;
}

export default function HistoryPanel({ open, onClose, onOpen }: Props) {
  const [rows, setRows] = useState<HistoryIndexRow[]>([]);
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map());
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState({ count: 0, bytes: 0, maxBytes: 0 });

  const refresh = async () => {
    const list = await history.list();
    setRows(list);
    const s = await history.stats();
    setInfo({ count: s.count, bytes: s.bytes, maxBytes: s.maxBytes });
  };

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setShown(PAGE);
    void refresh();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [open, onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.preview?.searchText?.includes(q));
  }, [rows, query]);

  const visible = filtered.slice(0, shown);

  // Lấy ảnh nhỏ theo lô cho đúng những dòng đang hiện, tránh đọc cả 40 mục.
  useEffect(() => {
    if (!open) return;
    const need = visible.filter((r) => r.preview?.hasThumb && !thumbs.has(r.id)).map((r) => r.id);
    if (!need.length) return;
    let cancelled = false;
    void history.thumbs(need).then((got) => {
      if (cancelled || !got.size) return;
      setThumbs((prev) => new Map([...prev, ...got]));
    });
    return () => {
      cancelled = true;
    };
  }, [open, visible, thumbs]);

  if (!open) return null;

  const openOne = async (id: string) => {
    setBusy(true);
    try {
      await onOpen(id);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const removeOne = async (id: string) => {
    await history.remove(id);
    await refresh();
  };

  const clearAll = async () => {
    if (!window.confirm(`Xoá tất cả ${info.count} mục trong lịch sử?`)) return;
    await history.clear();
    await refresh();
  };

  return (
    <>
      <div
        onClick={onClose}
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(32,33,36,.32)' }}
        aria-hidden="true"
      />
      <aside
        className="fixed right-0 top-0 bottom-0 z-50 w-[420px] flex flex-col"
        style={{ background: 'var(--surface)', borderLeft: '1px solid var(--line)' }}
        role="dialog"
        aria-label="Lịch sử"
      >
        <header className="shrink-0 h-14 px-5 hairline-b flex items-center justify-between">
          <h2 className="text-[14px] font-medium">Lịch sử</h2>
          <button onClick={onClose} style={{ color: 'var(--ink-4)' }} aria-label="Đóng">
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="shrink-0 px-5 py-3">
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShown(PAGE);
            }}
            placeholder="Tìm theo tên file hoặc nội dung đề…"
            className="input w-full"
            aria-label="Tìm trong lịch sử"
          />
        </div>

        <div className="flex-1 overflow-y-auto scroll-thin px-5 pb-4 space-y-2">
          {rows.length === 0 && (
            <p className="t-small">
              Chưa có mục nào. Mỗi lần chuyển xong một đề sẽ được lưu lại ở đây để mở lại và
              xuất Word mà không phải chạy lại.
            </p>
          )}
          {rows.length > 0 && filtered.length === 0 && (
            <p className="t-small">Không có mục nào khớp “{query}”.</p>
          )}

          {visible.map((r) => (
            <div key={r.id} className="card p-2.5 flex gap-2.5">
              <div
                className="shrink-0 w-[64px] h-[84px] rounded overflow-hidden flex items-center justify-center"
                style={{ background: 'var(--surface-3)' }}
              >
                {thumbs.get(r.id) ? (
                  <img src={thumbs.get(r.id)} alt="" className="w-full h-full object-cover" />
                ) : (
                  <ImageOff className="w-4 h-4" style={{ color: 'var(--ink-4)' }} />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <button
                  onClick={() => void openOne(r.id)}
                  disabled={busy}
                  className="text-left w-full"
                >
                  <p className="text-[13px] font-medium truncate">{r.preview?.fileName}</p>
                  <p className="t-small">
                    {fmtWhen(r.updatedAt)} · {r.preview?.pageCount || 1} trang ·{' '}
                    {r.preview?.format === 'vdc' ? 'VDC' : 'thường'}
                  </p>
                  <p className="t-small mt-0.5 line-clamp-2" style={{ color: 'var(--ink-3)' }}>
                    {r.preview?.excerpt}
                  </p>
                </button>

                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                  {r.preview?.figuresOmitted ? (
                    <span className="badge badge-warn" title="Mục này quá lớn nên chỉ lưu văn bản">
                      <AlertTriangle className="w-3 h-3" />
                      chỉ có văn bản
                    </span>
                  ) : r.preview?.figureCount ? (
                    <span className="badge badge-neutral">{r.preview.figureCount} hình</span>
                  ) : null}
                  {r.preview?.errorCount ? (
                    <span className="badge badge-err">{r.preview.errorCount} lỗi</span>
                  ) : null}
                  {r.preview?.warnCount ? (
                    <span className="badge badge-warn">{r.preview.warnCount} cảnh báo</span>
                  ) : null}
                  <span className="t-small ml-auto">{fmtBytes(r.bytes)}</span>
                  <button
                    onClick={() => void removeOne(r.id)}
                    style={{ color: 'var(--ink-4)' }}
                    aria-label={`Xoá ${r.preview?.fileName}`}
                    title="Xoá mục này"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}

          {filtered.length > shown && (
            <button onClick={() => setShown((n) => n + PAGE)} className="btn btn-text btn-sm w-full">
              Xem thêm {Math.min(PAGE, filtered.length - shown)} mục
            </button>
          )}

          {busy && (
            <p className="t-small flex items-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Đang mở lại…
            </p>
          )}
        </div>

        <footer
          className="shrink-0 px-5 py-3 flex items-center justify-between"
          style={{ borderTop: '1px solid var(--line)' }}
        >
          <p className="t-small">
            {info.count} mục · {fmtBytes(info.bytes)}
            {info.maxBytes ? ` / ${fmtBytes(info.maxBytes)}` : ''}
          </p>
          {info.count > 0 && (
            <button onClick={() => void clearAll()} className="btn btn-text btn-sm">
              Xoá tất cả
            </button>
          )}
        </footer>
      </aside>
    </>
  );
}
