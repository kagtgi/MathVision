/**
 * Hình trong tài liệu: luôn có ảnh crop từ trang PDF gốc, TikZ chỉ là bản nâng cấp.
 *
 * Nguyên tắc bất di bất dịch: KHÔNG BAO GIỜ để chỗ trống. Bản cũ chỉ chèn hình khi
 * TikZ dựng thành công, thất bại thì để lại dòng "[Figure: ...]" — mất hẳn dữ liệu
 * mà người dùng không biết.
 */

import type { FigureData } from './mmdToDocx.ts';
import { pngSize } from './mmdToDocx.ts';

/**
 * `genai` = model sinh ảnh dựng lại, đã qua tiền kiểm pixel + trọng tài.
 *
 * KHÔNG bump `HISTORY_SCHEMA_VERSION` khi mở rộng union này: không nơi nào đọc số phiên bản đó
 * làm cửa (`electron/history.cjs` chỉ `payload.schema ?? 1`), và app bản cũ mở mục mới vẫn xuất
 * .docx y hệt vì `makeImageParagraph` chỉ đọc `bytes`/`w`/`h`.
 */
export type FigureSource = 'crop' | 'tikz' | 'genai';

export interface FigureEntry extends FigureData {
  source: FigureSource;
}

export type FigureMap = Map<string, FigureEntry>;

/** bbox theo phần trăm: [x, y, w, h]. */
export type Bbox = [number, number, number, number];

/** Mô hình thường khoanh sát 2-5%; nới ra rồi kẹp vào trong khung ảnh. */
const PAD_PERCENT = 2;
const MIN_PX = 24;

export function padClampBbox(
  bbox: Bbox,
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number } | null {
  const [bx, by, bw, bh] = bbox;
  if (![bx, by, bw, bh].every((v) => Number.isFinite(v))) return null;
  if (bw <= 0 || bh <= 0) return null;

  const x0 = ((bx - PAD_PERCENT) / 100) * width;
  const y0 = ((by - PAD_PERCENT) / 100) * height;
  const x1 = ((bx + bw + PAD_PERCENT) / 100) * width;
  const y1 = ((by + bh + PAD_PERCENT) / 100) * height;

  const x = Math.max(0, Math.round(x0));
  const y = Math.max(0, Math.round(y0));
  const w = Math.min(width, Math.round(x1)) - x;
  const h = Math.min(height, Math.round(y1)) - y;
  if (w < MIN_PX || h < MIN_PX) return null;
  return { x, y, w, h };
}

/** Cắt vùng bbox khỏi canvas trang đã render, trả PNG. */
export async function cropFigure(
  canvas: HTMLCanvasElement,
  bbox: Bbox,
): Promise<FigureEntry | null> {
  const rect = padClampBbox(bbox, canvas.width, canvas.height);
  if (!rect) return null;

  const out = document.createElement('canvas');
  out.width = rect.w;
  out.height = rect.h;
  const ctx = out.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(canvas, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);

  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/png'));
  if (!blob) return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { bytes, ...pngSize(bytes), source: 'crop' };
}

/** Data URL để hiện trong tab Xem trước. */
export function figureDataUrl(fig: FigureData): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < fig.bytes.length; i += chunk) {
    binary += String.fromCharCode(...fig.bytes.subarray(i, i + chunk));
  }
  return `data:image/png;base64,${btoa(binary)}`;
}

/**
 * Kết quả xử lý MỘT hình — đủ để dựng cảnh báo và nhật ký mà không phải đoán lại.
 *
 * Thay cho `boolean` mà `redrawOne` từng trả: `false` không phân biệt được "TikZ sai" với "chưa
 * bật sinh ảnh" với "loại hình này không cho sinh", nên cảnh báo nào cũng phải nói chung chung.
 */
export interface FigureOutcome {
  id: string;
  /** Bản THẬT SỰ nằm trong figureMap khi xong. */
  used: FigureSource;
  /** Từng bước đã thử, theo thứ tự. */
  tried: Array<{ step: 'tikz' | 'genai'; ok: boolean; why: string }>;
  /** Có ngữ cảnh đề khi sinh ảnh hay không — đổi câu chữ của cảnh báo. */
  hadContext: boolean;
  /** Số câu chứa hình, nếu tra được. */
  num: number | null;
}

/**
 * Cảnh báo cho tab Kiểm tra. Thuần để harness chốt được từng câu chữ.
 *
 * Hình `tikz` KHÔNG sinh cảnh báo (y như 1.2). Hình `genai` thì LUÔN sinh: ảnh AI là rủi ro về
 * NỘI DUNG theo cách mà một hình TikZ không phải — TikZ ít nhất còn là mã người đọc soát được.
 */
export function warnFor(o: FigureOutcome): string[] {
  const cau = o.num !== null ? ` (câu ${o.num})` : '';
  const last = o.tried.filter((t) => !t.ok).slice(-1)[0]?.why ?? '';

  if (o.used === 'tikz') return [];
  if (o.used === 'genai') {
    return o.hadContext
      ? [
          `Hình ${o.id}${cau} là ảnh do AI SINH, không phải hình trong đề gốc — PHẢI xem lại trước khi in.`,
        ]
      : [
          `Hình ${o.id}${cau}: AI dựng lại CHỈ TỪ ảnh cắt (không tìm được đề bài quanh hình) — cần xem lại kỹ.`,
        ];
  }

  const gen = o.tried.find((t) => t.step === 'genai');
  if (!gen) {
    // Chuỗi này phải GIỮ NGUYÊN từng byte so với 1.2: harness chốt nó để bản mới không âm thầm
    // đổi câu chữ mà người dùng đã quen.
    return [`Hình ${o.id}: dựng TikZ không đạt — dùng ảnh cắt từ đề.`];
  }
  if (gen.why === KIND_NOT_ALLOWED) {
    return [`Hình ${o.id}: dựng TikZ không đạt — loại hình này chỉ dùng TikZ, giữ ảnh cắt từ đề.`];
  }
  return [`Hình ${o.id}: cả TikZ lẫn ảnh AI đều không đạt — dùng ảnh cắt từ đề (${last}).`];
}

/** Lý do cố định, để `warnFor` nhận ra ca "loại hình không cho sinh ảnh". */
export const KIND_NOT_ALLOWED = 'loại hình chỉ dùng TikZ';

/** Resolver cho mmdToDocx: chấp nhận cả `#id` lẫn `id`. */
export function makeFigureResolver(map: FigureMap) {
  return (ref: string): FigureData | null => map.get(ref.replace(/^#/, '')) ?? null;
}
