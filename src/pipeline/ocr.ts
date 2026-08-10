/**
 * OCR một trang/ảnh -> MMD sạch + danh sách hình cần cắt.
 *
 * Điểm quan trọng: đọc `finishReason` từ candidate chứ KHÔNG tin `response.text`.
 * Text vẫn có nội dung khi model bị cắt giữa chừng vì hết hạn mức output — không
 * kiểm thì mất nguyên nửa trang mà chẳng có dấu hiệu gì.
 */

import { callGemini, TEMP_PRECISE, type GeminiPart } from './geminiClient.ts';
import { conformMmd } from './conform.ts';
import {
  continuationPrompt,
  extractFigures,
  MMD_IMAGE_PROMPT,
  MMD_PAGE_PROMPT,
  pageContextPart,
  type FigureRef,
} from './prompts.ts';

const MAX_CONTINUATIONS = 3;
const MAX_OUTPUT_TOKENS = 32_768;

export interface OcrPageInput {
  imageBase64: string;
  mimeType: string;
  pageNumber: number;
  totalPages: number;
  prevTail: string;
  /** Ảnh đơn (mode Ảnh → Word) dùng prompt riêng, không có ngữ cảnh trang trước. */
  singleImage?: boolean;
}

export interface OcrPageResult {
  mmd: string;
  figures: FigureRef[];
  warnings: string[];
  truncated: boolean;
  model: string;
}

/** Ghép phần tiếp theo, cắt đoạn model lỡ chép lại. */
function joinContinuation(soFar: string, next: string): string {
  const limit = Math.min(400, soFar.length, next.length);
  for (let k = limit; k >= 20; k--) {
    if (soFar.endsWith(next.slice(0, k))) return soFar + next.slice(k);
  }
  return soFar.replace(/\s+$/, '') + '\n' + next.replace(/^\s+/, '');
}

export async function ocrPage(
  apiKey: string,
  input: OcrPageInput,
  opts: { signal?: AbortSignal; onLog?: (s: string) => void; models?: string[] } = {},
): Promise<OcrPageResult> {
  const image: GeminiPart = {
    inlineData: { data: input.imageBase64, mimeType: input.mimeType },
  };
  const basePrompt = input.singleImage ? MMD_IMAGE_PROMPT : MMD_PAGE_PROMPT;
  const contextText = input.singleImage
    ? null
    : pageContextPart(input.pageNumber, input.totalPages, input.prevTail);

  const parts: GeminiPart[] = [{ text: basePrompt }, image];
  if (contextText) parts.push({ text: contextText });

  const label = input.singleImage ? 'ocr:ảnh' : `ocr:trang ${input.pageNumber}`;
  let res = await callGemini(apiKey, {
    parts,
    temperature: TEMP_PRECISE,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    signal: opts.signal,
    models: opts.models,
    label,
    onLog: opts.onLog,
  });

  let raw = res.text;
  let rounds = 0;
  while (res.finishReason === 'MAX_TOKENS' && rounds < MAX_CONTINUATIONS) {
    rounds++;
    opts.onLog?.(`[${label}] bị cắt vì hết hạn mức output — chép tiếp (lượt ${rounds}).`);
    res = await callGemini(apiKey, {
      parts: [{ text: basePrompt }, image, { text: continuationPrompt(raw) }],
      temperature: TEMP_PRECISE,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      signal: opts.signal,
      models: opts.models,
      label: `${label} (tiếp ${rounds})`,
      onLog: opts.onLog,
    });
    raw = joinContinuation(raw, res.text);
  }

  const truncated = res.finishReason === 'MAX_TOKENS';
  const warnings: string[] = [];
  if (truncated) {
    warnings.push(
      `Trang ${input.pageNumber} có thể bị chép thiếu (đã nối ${rounds} lượt vẫn chưa hết).`,
    );
  }

  // Bóc bbox TRƯỚC khi conform để cặp ngoặc {bbox=...} không đi qua rule nào.
  const fig = extractFigures(raw);
  warnings.push(...fig.warnings);

  const { mmd } = conformMmd(fig.mmd);
  return { mmd, figures: fig.figures, warnings, truncated, model: res.model };
}
