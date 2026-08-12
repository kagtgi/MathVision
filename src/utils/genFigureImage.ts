/**
 * Sinh lại MỘT hình bằng model ảnh: gói prompt + gọi + chuẩn hoá về PNG thật.
 *
 * Tách khỏi `PdfToDocxConverter` để file đó còn là file UI. Trả `null` là "giữ ảnh cắt" — hàm này
 * không bao giờ ném.
 */

import { callGeminiImage, pickAspectRatio } from '../pipeline/geminiClient.ts';
import { normalizeToPng, type NormalizedImage } from '../pipeline/imageNormalize.ts';
import { figureGenPrompt } from './figureGenPrompts.ts';
import type { FigureCategory } from './figurePrompts.ts';

export interface GenFigureInput {
  apiKey: string;
  cropBase64: string;
  cropW: number;
  cropH: number;
  kind: FigureCategory;
  /** Đề bài quanh hình; rỗng = không tìm được. */
  context: string;
  /** Mã TikZ của lượt thua CƠ HỌC (chưa bị trọng tài chấm). */
  failedTikz?: string;
  /** Mã + phán quyết khi lượt TikZ dựng được nhưng bị trọng tài LOẠI. */
  judged?: { code: string; missing: string[]; extra: string[] };
  /** Chuỗi model ẢNH — KHÔNG phải `models` của OCR/solver. */
  models?: string[];
  signal?: AbortSignal;
  onLog?: (s: string) => void;
}

export async function genFigureImage(i: GenFigureInput): Promise<NormalizedImage | null> {
  const res = await callGeminiImage(i.apiKey, {
    parts: figureGenPrompt({
      kind: i.kind,
      cropBase64: i.cropBase64,
      context: i.context,
      failedTikz: i.failedTikz,
      judged: i.judged,
    }),
    // Khung theo ảnh cắt để model không tự dựng lại bố cục.
    aspectRatio: pickAspectRatio(i.cropW, i.cropH),
    imageSize: '1K',
    models: i.models,
    signal: i.signal,
    label: 'sinh hình',
    onLog: i.onLog,
  });
  if (!res) return null;
  if (res.text) i.onLog?.(`model nói thêm: ${res.text.slice(0, 160)}`);
  return normalizeToPng(res.data, res.mimeType);
}
