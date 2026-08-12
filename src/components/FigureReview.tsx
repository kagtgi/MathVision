/**
 * Khung soát hình: thumbnail + nguồn của từng hình.
 *
 * VÌ SAO CẦN: trước 1.3 app KHÔNG có chỗ nào xem được từng hình. Muốn biết một hình ra sao thì
 * phải mở tab Xem trước rồi tự dò trong tài liệu. Từ 1.3 có thêm hình do AI SINH — thứ phải được
 * người duyệt trước khi in cho học sinh — nên không có mặt bàn soát là không dùng được.
 *
 * Cố tình KHÔNG có nút vẽ lại: làm được nút đó cần giữ bbox + pixel trang sau khi `process()` kết
 * thúc (hiện canvas trang bị xoá) và cần AbortController riêng cho từng hình. Để 1.4.
 */

import { figureDataUrl, type FigureMap, type FigureOutcome, type FigureSource } from '../pipeline/figures';

interface Props {
  /** Hình thật đang nằm trong tài liệu. */
  figures: FigureMap;
  /** Kết quả nâng chất, để tra số câu và lý do. Rỗng khi mở lại từ lịch sử. */
  outcomes: FigureOutcome[];
}

const LABEL: Record<FigureSource, { text: string; cls: string }> = {
  crop: { text: 'ảnh cắt', cls: 'badge-neutral' },
  tikz: { text: 'TikZ', cls: 'badge-ok' },
  // `warn` chứ không phải `ok`: ảnh AI là thứ cần người đối chiếu, nhãn phải nói lên điều đó.
  genai: { text: 'AI sinh', cls: 'badge-warn' },
};

export default function FigureReview({ figures, outcomes }: Props) {
  if (!figures.size) return null;
  const byId = new Map(outcomes.map((o) => [o.id, o]));

  return (
    <div>
      <span className="t-label block mb-2">Hình trong tài liệu ({figures.size})</span>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {[...figures.entries()].map(([id, fig]) => {
          const o = byId.get(id);
          const label = LABEL[fig.source] ?? LABEL.crop;
          return (
            <div key={id} className="card p-2">
              <img
                src={figureDataUrl(fig)}
                alt={id}
                className="w-full object-contain bg-white rounded"
                style={{ maxHeight: 120, border: '1px solid var(--line)' }}
              />
              <div className="mt-1.5 flex items-center justify-between gap-1.5">
                <code className="text-[11px] truncate" style={{ color: 'var(--ink-3)' }}>
                  {o?.num !== null && o?.num !== undefined ? `Câu ${o.num}` : id}
                </code>
                <span className={`badge ${label.cls}`}>{label.text}</span>
              </div>
              {fig.source === 'genai' && (
                <p className="text-[11px] leading-snug mt-1" style={{ color: 'var(--warn)' }}>
                  Ảnh do AI dựng — đối chiếu với đề gốc trước khi in.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
