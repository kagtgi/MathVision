/**
 * Hình trong tài liệu: luôn có ảnh crop từ trang PDF gốc, TikZ chỉ là bản nâng cấp.
 *
 * Nguyên tắc bất di bất dịch: KHÔNG BAO GIỜ để chỗ trống. Bản cũ chỉ chèn hình khi
 * TikZ dựng thành công, thất bại thì để lại dòng "[Figure: ...]" — mất hẳn dữ liệu
 * mà người dùng không biết.
 */

import type { FigureData } from './mmdToDocx.ts';
import { pngSize } from './mmdToDocx.ts';

export type FigureSource = 'crop' | 'tikz';

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

/** Resolver cho mmdToDocx: chấp nhận cả `#id` lẫn `id`. */
export function makeFigureResolver(map: FigureMap) {
  return (ref: string): FigureData | null => map.get(ref.replace(/^#/, '')) ?? null;
}
