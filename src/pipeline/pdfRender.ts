/**
 * Dựng ảnh trang PDF bằng pdf.js — tách riêng khỏi component để test được độc lập.
 */

import * as pdfjsLib from 'pdfjs-dist';
// Lấy worker từ node_modules cho CẢ dev và bản đóng gói. Trước đây bản dev trỏ ra
// jsdelivr, nên mạng chậm/chặn là pdf.js treo im lặng ngay ở bước dựng trang.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

export const PDF_RENDER_SCALE = 2;
/** Chất lượng thấp hơn cho ảnh gửi API: nhẹ hơn nhiều mà độ chính xác OCR không đổi. */
export const JPEG_QUALITY_API = 0.7;

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export type PdfDoc = pdfjsLib.PDFDocumentProxy;

export async function loadPdf(data: ArrayBuffer): Promise<PdfDoc> {
  return pdfjsLib.getDocument({ data }).promise;
}

export async function renderPdfPage(
  pdf: PdfDoc,
  pageNum: number,
  scale = PDF_RENDER_SCALE,
): Promise<HTMLCanvasElement> {
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d')!;
  await page.render({ canvasContext: ctx, canvas, viewport } as Parameters<typeof page.render>[0])
    .promise;
  return canvas;
}

export function canvasToJpegBase64(canvas: HTMLCanvasElement, quality = JPEG_QUALITY_API): string {
  return canvas.toDataURL('image/jpeg', quality).split(',')[1];
}

/**
 * Lấy lớp văn bản nhúng sẵn của trang, làm đối chứng cho bản OCR.
 *
 * PDF quét thì trả chuỗi rỗng — chỗ gọi tự bỏ qua. Không bao giờ dùng lớp này để THAY
 * cho OCR: công thức trong đó đã mất cấu trúc (gạch phân số, dấu căn không phải glyph).
 *
 * Tên font đi kèm để loại chữ toán ra khỏi phép so; `styles` của pdf.js chỉ trả tên rác
 * kiểu `g_d0_f1` nên tra tên thật qua `commonObjs`, có thì dùng, không thì thôi.
 */
export async function extractPageText(pdf: PdfDoc, pageNum: number): Promise<string> {
  const page = await pdf.getPage(pageNum);
  const content = await page.getTextContent();
  const realName = (loaded: string): string => {
    try {
      const obj = page.commonObjs.get(loaded) as { name?: string } | undefined;
      return obj?.name ?? loaded;
    } catch {
      return loaded;
    }
  };

  const { joinPieces } = await import('./textLayerCheck.ts');
  const pieces = content.items
    .filter((it): it is Extract<typeof it, { str: string }> => 'str' in it)
    .map((it) => ({
      str: it.str,
      fontName: realName(it.fontName),
      hasEOL: it.hasEOL,
    }));
  return joinPieces(pieces).prose;
}
