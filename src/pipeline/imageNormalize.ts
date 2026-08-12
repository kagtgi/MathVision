/**
 * Chuẩn hoá ảnh model sinh ra thành PNG thật, và ĐO nó bằng pixel trước khi tốn một lượt chấm.
 *
 * Tách hai nửa có chủ ý: nửa THUẦN (đo, quyết định) chạy được dưới Node nên harness kiểm được
 * bằng buffer tổng hợp; nửa DOM (giải mã, vẽ lại) chỉ chạy trong app.
 *
 * VÌ SAO LUÔN GIẢI MÃ RỒI MÃ HOÁ LẠI, không tin bytes model trả về: `pngSize()` (`mmdToDocx.ts`)
 * đọc THẲNG offset 16/20 mà KHÔNG kiểm signature, còn `ImageRun({ type: 'png' })` đóng đuôi
 * `.png` lên bất cứ thứ gì. Một câu trả lời JPEG sẽ cho w/h rác, một `transformation` vô nghĩa,
 * và một file JPEG mang tên .png trong `word/media/` — Word hiện ô ảnh lỗi. Mã hoá lại xoá cả
 * lớp lỗi này.
 */

import { pngSize, type FigureData } from './mmdToDocx.ts';
import { MIN_INK_RATIO } from '../utils/tikzCapabilities.ts';

// ─── Thuần: chạy được dưới Node ──────────────────────────────────────────────

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function isPngBytes(b: Uint8Array): boolean {
  if (b.length < 8) return false;
  return PNG_MAGIC.every((v, i) => b[i] === v);
}

/** Vừa trong `maxPx` theo cạnh dài. KHÔNG BAO GIỜ phóng to. */
export function fitWithin(w: number, h: number, maxPx: number): { w: number; h: number } {
  if (!(w > 0) || !(h > 0)) return { w: 0, h: 0 };
  const scale = Math.min(1, maxPx / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

export interface RasterStats {
  w: number;
  h: number;
  /** Tỉ lệ pixel không-trắng trên TOÀN ảnh (RATIO). */
  ink: number;
  /** Khung bao nét. `null` = ảnh trắng hoàn toàn. */
  inkBox: { x: number; y: number; w: number; h: number } | null;
  /** Tỉ lệ pixel không-trắng TRONG khung bao — đo mật độ nét, bỏ ảnh hưởng của lề. */
  boxDensity: number;
  /** Tỉ lệ pixel có màu (max-min kênh > 40). Nguồn đen trắng thì phải ~0. */
  satFrac: number;
  /** Tỉ lệ pixel trung gian trên tổng pixel có mực — cao là có tô bóng / gradient. */
  midFrac: number;
  /** Tỉ lệ pixel gần-trắng trên vành 2px ngoài cùng. */
  borderWhite: number;
  /** Tỉ lệ pixel có mực nằm trong vành 1,5% ngoài cùng — cao là hình bị cắt cụt. */
  edgeInk: number;
}

/**
 * Một lượt quét ra mọi số đo. Ngưỡng "không trắng" là kênh `< 250`, ĐÚNG ngưỡng `inkRatio` của
 * `latexToImage.ts`, để mọi số mực trong dự án so sánh được với nhau.
 */
export function scanRaster(
  data: Uint8Array | Uint8ClampedArray,
  w: number,
  h: number,
): RasterStats {
  const empty: RasterStats = {
    w,
    h,
    ink: 0,
    inkBox: null,
    boxDensity: 0,
    satFrac: 0,
    midFrac: 0,
    borderWhite: 1,
    edgeInk: 0,
  };
  if (!(w > 0) || !(h > 0) || data.length < w * h * 4) return empty;

  const edge = Math.max(1, Math.round(Math.min(w, h) * 0.015));
  let dark = 0;
  let sat = 0;
  let mid = 0;
  let borderTotal = 0;
  let borderNearWhite = 0;
  let edgeDark = 0;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const isDark = r < 250 || g < 250 || b < 250;

      if (x < 2 || y < 2 || x >= w - 2 || y >= h - 2) {
        borderTotal++;
        if (r >= 245 && g >= 245 && b >= 245) borderNearWhite++;
      }

      if (!isDark) continue;
      dark++;
      if (Math.max(r, g, b) - Math.min(r, g, b) > 40) sat++;
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      if (luma >= 60 && luma <= 200) mid++;
      if (x < edge || y < edge || x >= w - edge || y >= h - edge) edgeDark++;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }

  const total = w * h;
  const inkBox = x1 >= x0 && y1 >= y0 ? { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } : null;
  return {
    w,
    h,
    ink: dark / total,
    inkBox,
    boxDensity: inkBox ? dark / (inkBox.w * inkBox.h) : 0,
    satFrac: dark ? sat / dark : 0,
    midFrac: dark ? mid / dark : 0,
    borderWhite: borderTotal ? borderNearWhite / borderTotal : 1,
    edgeInk: dark ? edgeDark / dark : 0,
  };
}

const aspect = (box: { w: number; h: number }) => box.w / box.h;

/**
 * Mười cửa tất định, chạy TRƯỚC khi tốn một lượt gọi trọng tài. Mỗi cửa chỉ có thể LOẠI, không
 * bao giờ nhận — nên thêm một cửa thì chỉ chặt thêm, không nới ra.
 *
 * Trả `null` = đạt, chuỗi = lý do loại (chuỗi đó đi thẳng vào cảnh báo người dùng thấy).
 *
 * SO TỈ LỆ CỦA HỘP BAO NÉT, KHÔNG SO TỈ LỆ KHUNG ẢNH: model sinh ảnh xuất khung cố định (1:1
 * hoặc 4:3) nên một cửa ở mức khung sẽ loại sạch mọi hình.
 *
 * G9/G10 để lỏng có chủ ý: ảnh cắt mang 2% padding mỗi phía (`figures.ts`) cộng có thể một sợi
 * chữ bên cạnh, nên hộp nét của nó vốn rộng và dày hơn hình thật. Đây là máy dò biến dạng,
 * không phải thước đo.
 */
export function preGateGen(crop: RasterStats, gen: RasterStats): string | null {
  if (!gen.inkBox) return 'ảnh sinh ra trắng hoàn toàn';
  if (Math.min(gen.w, gen.h) < 128) return `ảnh sinh ra quá nhỏ (${gen.w}x${gen.h})`;
  if (Math.max(gen.w, gen.h) > 4096) return `ảnh sinh ra quá lớn (${gen.w}x${gen.h})`;
  if (gen.ink < 0.004) {
    return `gần như trắng (${(gen.ink * 100).toFixed(2)}% mực, ngưỡng app ${MIN_INK_RATIO})`;
  }
  if (gen.ink > 0.35) return `bị tô kín (${(gen.ink * 100).toFixed(0)}% mực) — không phải hình nét`;
  if (gen.borderWhite < 0.95) return 'viền ảnh không trắng — có nền, khung, hoặc bóng đổ';
  if (gen.satFrac > Math.max(0.02, crop.satFrac * 1.5)) {
    return `tự thêm màu (${(gen.satFrac * 100).toFixed(1)}% pixel có màu)`;
  }
  if (gen.midFrac > 0.45) return 'có tô bóng / gradient / hiệu ứng 3D';
  if (gen.edgeInk > 0.005) return 'nét chạm rìa ảnh — hình hoặc nhãn bị cắt cụt';

  const fillW = gen.inkBox.w / gen.w;
  const fillH = gen.inkBox.h / gen.h;
  if (fillW < 0.2 || fillH < 0.2) return 'hình bé tí lọt giữa lề trắng';
  if (fillW > 0.96 || fillH > 0.96) return 'hình không còn lề trắng';

  if (crop.inkBox) {
    const drift = Math.abs(Math.log(aspect(gen.inkBox) / aspect(crop.inkBox)));
    if (drift > 0.3) return 'tỉ lệ khung hình lệch quá xa ảnh cắt — bị méo hoặc bị dựng lại';
    if (crop.boxDensity > 0) {
      const ratio = gen.boxDensity / crop.boxDensity;
      if (ratio < 0.4) return 'nét thưa hơn ảnh cắt nhiều — có thể rụng nội dung';
      if (ratio > 3) return 'nét dày hơn ảnh cắt nhiều — có thể vẽ chồng hoặc kẻ gạch';
    }
  }

  return null;
}

// ─── Cần DOM ─────────────────────────────────────────────────────────────────

export interface NormalizeOptions {
  /** Cạnh dài tối đa. 1000 px là quá đủ cho khung 9 cm của Word. */
  maxPx?: number;
  /** Lề trắng chừa lại sau khi cắt sát nét, theo % cạnh dài. */
  padPercent?: number;
}

export interface NormalizedImage extends FigureData {
  stats: RasterStats;
}

const decode = async (base64: string, mimeType: string): Promise<ImageBitmap> => {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return createImageBitmap(new Blob([bytes], { type: mimeType }));
};

/** Đo một PNG đã có (dùng cho ảnh cắt, để `preGateGen` có mốc so). */
export async function measurePng(bytes: Uint8Array): Promise<RasterStats | null> {
  try {
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0);
    return scanRaster(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
  } catch {
    return null;
  }
}

/**
 * base64 + mimeType (bất kỳ) → PNG THẬT, đã cắt lề trắng và kẹp cỡ.
 *
 * CẮT LỀ LÀ BẮT BUỘC, không phải tối ưu: `makeImageParagraph` co theo CHIỀU RỘNG và chặn ở 9 cm,
 * nên một ảnh 1024² còn 40% lề trắng sẽ vẽ hình bé hơn hẳn ảnh cắt ở cùng khung đó.
 *
 * Trả `null` = giữ ảnh cắt. Mọi lỗi nuốt tại đây.
 */
export async function normalizeToPng(
  base64: string,
  mimeType: string,
  opts: NormalizeOptions = {},
): Promise<NormalizedImage | null> {
  const maxPx = opts.maxPx ?? 1000;
  const padPercent = opts.padPercent ?? 3;
  try {
    const bmp = await decode(base64, mimeType);
    if (!bmp.width || !bmp.height) return null;

    const src = document.createElement('canvas');
    src.width = bmp.width;
    src.height = bmp.height;
    const sctx = src.getContext('2d');
    if (!sctx) return null;
    // Tô trắng TRƯỚC: PNG trong suốt hiện đen trên vài trình xem Word, và chỉ khi có nền trắng
    // thì `scanRaster` mới có nghĩa.
    sctx.fillStyle = '#ffffff';
    sctx.fillRect(0, 0, src.width, src.height);
    sctx.drawImage(bmp, 0, 0);

    const stats = scanRaster(
      sctx.getImageData(0, 0, src.width, src.height).data,
      src.width,
      src.height,
    );
    if (!stats.inkBox || stats.ink < 0.004) return null;

    const pad = Math.round((Math.max(src.width, src.height) * padPercent) / 100);
    const bx = Math.max(0, stats.inkBox.x - pad);
    const by = Math.max(0, stats.inkBox.y - pad);
    const bw = Math.min(src.width - bx, stats.inkBox.w + pad * 2);
    const bh = Math.min(src.height - by, stats.inkBox.h + pad * 2);

    const size = fitWithin(bw, bh, maxPx);
    const out = document.createElement('canvas');
    out.width = size.w;
    out.height = size.h;
    const octx = out.getContext('2d');
    if (!octx) return null;
    octx.fillStyle = '#ffffff';
    octx.fillRect(0, 0, out.width, out.height);
    octx.drawImage(src, bx, by, bw, bh, 0, 0, out.width, out.height);

    const blob = await new Promise<Blob | null>((res) => out.toBlob(res, 'image/png'));
    if (!blob) return null;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    // Cửa chặn đứng TRƯỚC phép đọc IHDR không kiểm signature của `pngSize`.
    if (!isPngBytes(bytes)) return null;

    const finalStats = scanRaster(
      octx.getImageData(0, 0, out.width, out.height).data,
      out.width,
      out.height,
    );
    return { bytes, ...pngSize(bytes), stats: finalStats };
  } catch {
    return null;
  }
}
