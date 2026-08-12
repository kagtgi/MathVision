/**
 * Nâng chất MỘT hình: ảnh cắt → TikZ → (AI sinh ảnh) → chốt.
 *
 * VÌ SAO LÀ MODULE RIÊNG, không nằm trong `PdfToDocxConverter.tsx` như bản đầu: nằm trong file
 * UI thì KHÔNG ĐO ĐƯỢC. Hệ quả thật, phát hiện khi chạy đề THPT 2025: file Word ra toàn ảnh cắt,
 * và không có cách nào biết TikZ thua vì mã sai, vì trọng tài loại, hay vì đường đó không hề
 * chạy — muốn biết thì phải bấm tay trong app rồi đọc nhật ký. Tách ra thì
 * `scripts/probe-figure-pipeline.mjs` chạy đúng hàm này trên hình đề thật và đếm được.
 *
 * Cần DOM (`tikzToImage`, `measurePng` dùng canvas) nên chỉ chạy trong trình duyệt / Electron.
 *
 * THỨ TỰ CỐ ĐỊNH, và ẢNH CẮT LUÔN LÀ BẢN CUỐI nếu cả hai bước thua:
 *   1. TikZ — vector, nét sạch, người soát được mã, nhẹ. Vẫn là lựa chọn số một.
 *   2. AI sinh ảnh — CHỈ khi TikZ thua, và CHỈ với loại hình mô hình vật thật
 *      (`isGenImageAllowed`). Đọc thêm ĐỀ BÀI, vì ảnh cắt mờ không đủ để biết điểm nào tên gì;
 *      nhưng model sinh ảnh bịa rất tự nhiên nên phải qua HAI cửa: tiền kiểm tất định bằng pixel
 *      (không tốn lượt gọi) rồi mới tới trọng tài nhìn hai ảnh.
 *   3. giữ ảnh cắt.
 *
 * TikZ thua theo HAI KIỂU khác nhau về mức nguy hiểm: (i) mã không dựng được, (ii) dựng được
 * nhưng trọng tài loại. Kiểu (ii) nghĩa là ảnh cắt khó đọc tới mức một model ĐÃ bịa một lần rồi
 * — đúng chỗ model sinh ảnh cũng dễ bịa nhất. Cả hai đều đi tiếp sang bước 2, và chính cửa trọng
 * tài mới là thứ đỡ kiểu (ii); vì thế kiểu (ii) KHÔNG gửi lại mã TikZ mà chỉ gửi những chỗ đã bị
 * chấm sai làm negative prompt.
 *
 * Hỏng một hình không được làm hỏng cả tài liệu, nên mọi lỗi đều nuốt tại đây.
 */

import { tikzToImage } from '../utils/latexToImage.ts';
import { generateTikzMultiAgent } from '../utils/tikzMultiAgent.ts';
import { isGenImageAllowed } from '../utils/figurePrompts.ts';
import { scoreRedraw } from '../utils/scoreRedraw.ts';
import { scoreGenerated } from '../utils/scoreGenerated.ts';
import { genFigureImage } from '../utils/genFigureImage.ts';
import { measurePng, preGateGen } from './imageNormalize.ts';
import { KIND_NOT_ALLOWED, type FigureEntry, type FigureOutcome, type FigureSource } from './figures.ts';
import type { FigureContext } from './figureContext.ts';
import type { FigureKind } from './prompts.ts';

export interface UpgradeFigureInput {
  id: string;
  crop: FigureEntry;
  kind: FigureKind;
  /** Đề bài quanh hình; `undefined` = không tra được. */
  context?: FigureContext;

  apiKey: string;
  /** Chuỗi model đọc-hiểu (OCR/solver/trọng tài). */
  models?: string[];
  /** Chuỗi model SINH ẢNH — tách hẳn, xem `IMAGE_MODEL_CHAIN`. */
  imageModels?: string[];
  /** Công tắc `genFigureImage`. Tắt thì TikZ thua là giữ ảnh cắt luôn. */
  allowGen: boolean;
  signal?: AbortSignal;
  log?: (line: string) => void;
  /** Gọi khi có bản mới thay ảnh cắt. Bên gọi tự ghi vào figureMap của mình. */
  onCommit?: (fig: { bytes: Uint8Array; w: number; h: number; source: FigureSource }) => void;
}

const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
};

export async function upgradeFigure(a: UpgradeFigureInput): Promise<FigureOutcome> {
  const tried: FigureOutcome['tried'] = [];
  const ctxText = a.context?.text ?? '';
  const cropB64 = toBase64(a.crop.bytes);
  const log = a.log ?? (() => {});
  const net = { models: a.models, signal: a.signal, context: ctxText };

  const done = (used: FigureSource): FigureOutcome => ({
    id: a.id,
    used,
    tried,
    hadContext: ctxText.length > 0,
    num: a.context?.num ?? null,
  });
  const commit = (bytes: Uint8Array, w: number, h: number, source: FigureSource) => {
    a.onCommit?.({ bytes, w, h, source });
  };

  // ── 1. TikZ ──
  let judged: { code: string; missing: string[]; extra: string[] } | undefined;
  let failedTikz: string | undefined;
  try {
    const gen = await generateTikzMultiAgent(a.apiKey, cropB64, 'image/png', {
      kind: a.kind,
      models: a.models,
      signal: a.signal,
    });
    if (a.signal?.aborted) return done('crop');
    const png = gen.tikzCode.includes('\\begin{tikzpicture}')
      ? await tikzToImage(gen.tikzCode, (n) => log(`TikZ ${a.id}: ${n}`))
      : null;

    if (!png) {
      failedTikz = gen.tikzCode;
      tried.push({ step: 'tikz', ok: false, why: 'mã không dựng được' });
    } else {
      const verdict = await scoreRedraw(a.apiKey, cropB64, toBase64(png.bytes), a.kind, net);
      if (verdict.keep === 'tikz') {
        commit(png.bytes, png.width, png.height, 'tikz');
        tried.push({ step: 'tikz', ok: true, why: verdict.why });
        return done('tikz');
      }
      log(`TikZ ${a.id}: trọng tài loại — ${verdict.why}`);
      tried.push({ step: 'tikz', ok: false, why: verdict.why });
      judged = { code: gen.tikzCode, missing: verdict.missing, extra: verdict.extra };
    }
  } catch (err) {
    tried.push({ step: 'tikz', ok: false, why: err instanceof Error ? err.message : 'lỗi không rõ' });
  }

  // ── 2. AI sinh ảnh ──
  if (a.signal?.aborted) return done('crop');
  if (!a.allowGen) return done('crop');
  if (!isGenImageAllowed(a.kind)) {
    tried.push({ step: 'genai', ok: false, why: KIND_NOT_ALLOWED });
    return done('crop');
  }

  try {
    log(
      `Sinh ảnh ${a.id}: TikZ thua, gọi model sinh hình` +
        (ctxText ? ` (kèm đề câu ${a.context?.num ?? '?'})` : ' (KHÔNG có đề bài)'),
    );
    const img = await genFigureImage({
      apiKey: a.apiKey,
      cropBase64: cropB64,
      cropW: a.crop.w,
      cropH: a.crop.h,
      kind: a.kind,
      context: ctxText,
      failedTikz,
      judged,
      models: a.imageModels,
      signal: a.signal,
      onLog: (s) => log(`Sinh ảnh ${a.id}: ${s}`),
    });
    if (a.signal?.aborted) return done('crop');
    if (!img) {
      tried.push({ step: 'genai', ok: false, why: 'model không trả ảnh dùng được' });
      return done('crop');
    }

    // Cửa 1: tất định, không tốn lượt gọi.
    const cropStats = await measurePng(a.crop.bytes);
    if (!cropStats) {
      const why = 'không đo được ảnh cắt để so';
      log(`Sinh ảnh ${a.id}: ${why}`);
      tried.push({ step: 'genai', ok: false, why });
      return done('crop');
    }
    const preFail = preGateGen(cropStats, img.stats);
    if (preFail) {
      log(`Sinh ảnh ${a.id}: loại ở tiền kiểm — ${preFail}`);
      tried.push({ step: 'genai', ok: false, why: preFail });
      return done('crop');
    }

    // Cửa 2: trọng tài nhìn hai ảnh, kèm đề bài.
    const verdict = await scoreGenerated({
      apiKey: a.apiKey,
      cropBase64: cropB64,
      genBase64: toBase64(img.bytes),
      kind: a.kind,
      context: ctxText,
      models: a.models,
      signal: a.signal,
    });
    if (verdict.keep !== 'genai') {
      log(`Sinh ảnh ${a.id}: trọng tài giữ ảnh cắt — ${verdict.why}`);
      tried.push({ step: 'genai', ok: false, why: verdict.why });
      return done('crop');
    }

    commit(img.bytes, img.w, img.h, 'genai');
    log(`Sinh ảnh ${a.id}: THAY ảnh cắt (độ tin cậy ${verdict.doTinCay}%) — cần người duyệt.`);
    tried.push({ step: 'genai', ok: true, why: verdict.why });
    return done('genai');
  } catch (err) {
    tried.push({ step: 'genai', ok: false, why: err instanceof Error ? err.message : 'lỗi không rõ' });
    return done('crop');
  }
}
