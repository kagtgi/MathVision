/**
 * Lớp gọi Gemini dùng chung cho mọi tác vụ (OCR trang, giải đề, vẽ TikZ).
 *
 * Ba việc mà mọi call site đều cần và trước đây không có:
 *   1. Chuỗi model dự phòng — quá tải / hết quota / model biến mất thì tự bước xuống
 *      bậc dưới thay vì hỏng cả job.
 *   2. Backoff đúng theo `retryDelay` mà Google trả về trong lỗi 429.
 *   3. Huỷ THẬT qua `abortSignal` (Promise.race chỉ bỏ mặc fetch chạy tiếp, vẫn tốn quota).
 */

import { GoogleGenAI } from '@google/genai';

export type GeminiPart = { text: string } | { inlineData: { data: string; mimeType: string } };

/**
 * Bậc 1 là model mạnh nhất cho hiểu tài liệu; các bậc sau đổi chất lượng lấy hạn mức.
 * Đây là NƠI DUY NHẤT ghi tên model — Google đổi tên khá thường xuyên.
 */
export const MODEL_CHAIN = [
  'gemini-3.1-pro-preview',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-flash-latest',
];

export const TEMP_PRECISE = 0.1;
export const TEMP_STANDARD = 0.15;
export const TEMP_CREATIVE = 0.4;

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 32_768;
const MAX_RETRY_DELAY_MS = 60_000;

export interface GeminiCallOptions {
  parts: GeminiPart[];
  temperature: number;
  maxOutputTokens?: number;
  /** JSON Schema — bật chế độ trả JSON có ràng buộc. */
  responseSchema?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
  models?: string[];
  label?: string;
  onLog?: (line: string) => void;
}

export interface GeminiResult {
  text: string;
  finishReason: string;
  model: string;
}

const clients = new Map<string, GoogleGenAI>();

function clientFor(apiKey: string): GoogleGenAI {
  let c = clients.get(apiKey);
  if (!c) {
    c = new GoogleGenAI({ apiKey });
    clients.set(apiKey, c);
  }
  return c;
}

// ─── Phân loại lỗi ───────────────────────────────────────────────────────────

type ErrorKind = 'rate-limit' | 'transient' | 'model-missing' | 'fatal';

interface ClassifiedError {
  kind: ErrorKind;
  status: number | null;
  retryAfterMs: number | null;
  message: string;
}

function statusOf(err: unknown): number | null {
  const e = err as { status?: unknown; code?: unknown; message?: unknown };
  if (typeof e?.status === 'number') return e.status;
  if (typeof e?.code === 'number') return e.code;
  const msg = String(e?.message ?? '');
  const m = msg.match(/\b(\d{3})\b/);
  return m ? parseInt(m[1], 10) : null;
}

/** Google trả `retryDelay: "17s"` trong RetryInfo; SDK đôi khi chỉ để trong message. */
function retryDelayOf(err: unknown): number | null {
  const e = err as { message?: unknown; details?: unknown };
  const details = e?.details;
  if (Array.isArray(details)) {
    for (const d of details as Array<Record<string, unknown>>) {
      const delay = d?.retryDelay;
      if (typeof delay === 'string') {
        const m = delay.match(/^([\d.]+)s$/);
        if (m) return Math.round(parseFloat(m[1]) * 1000);
      }
    }
  }
  const msg = String(e?.message ?? '');
  const m = msg.match(/retryDelay["'\s:]+([\d.]+)s/);
  return m ? Math.round(parseFloat(m[1]) * 1000) : null;
}

function classify(err: unknown): ClassifiedError {
  const message = err instanceof Error ? err.message : String(err);
  const status = statusOf(err);
  const retryAfterMs = retryDelayOf(err);

  if (status === 429 || /RESOURCE_EXHAUSTED|quota|rate limit/i.test(message)) {
    return { kind: 'rate-limit', status, retryAfterMs, message };
  }
  if (status === 404 || /NOT_FOUND|is not found|not supported/i.test(message)) {
    return { kind: 'model-missing', status, retryAfterMs, message };
  }
  if (status !== null && status >= 500) return { kind: 'transient', status, retryAfterMs, message };
  if (/Failed to fetch|network|ECONNRESET|socket hang up|timed out|aborted/i.test(message)) {
    return { kind: 'transient', status, retryAfterMs, message };
  }
  // 400/401/403 — key sai hoặc request sai: đổi model không cứu được
  return { kind: 'fatal', status, retryAfterMs, message };
}

/** Thông báo tiếng Việt cho lỗi không thể tự phục hồi. */
export function humanError(err: unknown): string {
  const { status, message } = classify(err);
  if (status === 401 || status === 403 || /API key/i.test(message)) {
    return 'API key không hợp lệ hoặc chưa bật Gemini API. Kiểm tra lại key ở aistudio.google.com/apikey.';
  }
  if (status === 429) return 'Đã chạm hạn mức Gemini. Chờ ít phút rồi thử lại, hoặc tắt bớt tuỳ chọn.';
  if (status === 400) return `Yêu cầu không hợp lệ: ${message}`;
  return message;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new Error('aborted'));
      },
      { once: true },
    );
  });

// ─── Gọi model ───────────────────────────────────────────────────────────────

function combineSignals(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeout;
  // AbortSignal.any có trong Chromium 116+ / Node 20+ — cả Electron lẫn harness đều có.
  return AbortSignal.any([signal, timeout]);
}

/**
 * Gọi Gemini với chuỗi model dự phòng.
 * - 429: chờ đúng retryDelay (tối đa 60s), thử lại 2 lần rồi bước sang model kế
 * - 5xx / mạng: thử lại 1 lần sau 2s rồi bước model
 * - 404 (model không tồn tại / không có quyền): bước model ngay
 * - 400/401/403: ném luôn
 */
export async function callGemini(apiKey: string, o: GeminiCallOptions): Promise<GeminiResult> {
  const ai = clientFor(apiKey);
  const models = o.models ?? MODEL_CHAIN;
  const log = (line: string) => o.onLog?.(`[${o.label ?? 'gemini'}] ${line}`);
  let lastErr: unknown = new Error('không có model nào để gọi');

  for (let mi = 0; mi < models.length; mi++) {
    const model = models[mi];
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (o.signal?.aborted) throw new Error('aborted');
      try {
        const config: Record<string, unknown> = {
          temperature: o.temperature,
          maxOutputTokens: o.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
          abortSignal: combineSignals(o.signal, o.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        };
        if (o.responseSchema) {
          config.responseMimeType = 'application/json';
          config.responseSchema = o.responseSchema;
        }
        // Model flash dùng thinking budget mặc định khá lớn, ăn hết hạn mức output.
        if (/flash/i.test(model)) config.thinkingConfig = { thinkingBudget: 512 };

        const resp = await ai.models.generateContent({
          model,
          contents: [{ role: 'user', parts: o.parts as never }],
          config: config as never,
        });

        const finishReason = String(resp.candidates?.[0]?.finishReason ?? 'STOP');
        const text = resp.text ?? '';

        if (!text.trim() && (finishReason === 'SAFETY' || finishReason === 'RECITATION')) {
          log(`${model} từ chối trả lời (${finishReason}) — thử model khác`);
          break; // sang model kế
        }
        if (mi > 0 || attempt > 1) log(`${model} OK (lần ${attempt})`);
        return { text, finishReason, model };
      } catch (err) {
        lastErr = err;
        if (o.signal?.aborted) throw new Error('aborted');
        const c = classify(err);

        if (c.kind === 'fatal') throw err;
        if (c.kind === 'model-missing') {
          log(`${model} không dùng được (${c.status}) — bước sang model kế`);
          break;
        }
        if (attempt === maxAttempts) {
          log(`${model} thất bại sau ${attempt} lần (${c.kind}) — bước sang model kế`);
          break;
        }
        const waitMs =
          c.kind === 'rate-limit' ? Math.min(c.retryAfterMs ?? 5_000, MAX_RETRY_DELAY_MS) : 2_000;
        log(`${model} ${c.kind} — chờ ${Math.round(waitMs / 1000)}s rồi thử lại`);
        await sleep(waitMs, o.signal);
      }
    }
  }
  throw lastErr;
}

// ─── Dò model có thật ────────────────────────────────────────────────────────

export interface KeyCheckResult {
  ok: boolean;
  chain: string[];
  available: string[];
  error?: string;
}

/**
 * Gọi models.list() để (a) xác nhận key dùng được, (b) loại khỏi chuỗi những model
 * mà tài khoản này không có. Tên model Google trả về dạng `models/gemini-...`.
 */
export async function checkApiKey(apiKey: string): Promise<KeyCheckResult> {
  try {
    const ai = clientFor(apiKey);
    const available: string[] = [];
    const pager = await ai.models.list();
    for await (const m of pager) {
      const name = String((m as { name?: string }).name ?? '').replace(/^models\//, '');
      if (name) available.push(name);
    }
    const chain = MODEL_CHAIN.filter((m) => available.includes(m));
    // Không nhận diện được model nào (API có thể không liệt kê hết) -> vẫn dùng chain gốc.
    return { ok: true, chain: chain.length ? chain : MODEL_CHAIN, available };
  } catch (err) {
    return { ok: false, chain: MODEL_CHAIN, available: [], error: humanError(err) };
  }
}

// ─── Chạy song song có tiết chế ──────────────────────────────────────────────

/**
 * Chạy nhiều tác vụ song song, gặp 429 lần đầu là tụt xuống 1 luồng và giữ tới hết
 * job (hạn mức miễn phí rất thấp; ép song song chỉ khiến mọi thứ chậm hơn).
 */
export async function runAdaptivePool<T, R>(
  items: T[],
  worker: (item: T, index: number) => Promise<R>,
  opts: { concurrency?: number; signal?: AbortSignal; onLog?: (s: string) => void } = {},
): Promise<Array<R | null>> {
  const results: Array<R | null> = new Array(items.length).fill(null);
  let limit = Math.max(1, opts.concurrency ?? 2);
  let next = 0;
  let throttled = false;

  const runOne = async (): Promise<void> => {
    while (next < items.length) {
      if (opts.signal?.aborted) return;
      const i = next++;
      try {
        results[i] = await worker(items[i], i);
      } catch (err) {
        if (!throttled && classify(err).kind === 'rate-limit') {
          throttled = true;
          limit = 1;
          opts.onLog?.('Chạm hạn mức — chuyển sang chạy tuần tự.');
        }
        results[i] = null;
      }
    }
  };

  const runners = Array.from({ length: Math.min(limit, items.length) }, runOne);
  await Promise.all(runners);
  return results;
}
