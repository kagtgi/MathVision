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
  // `gemini-3.1-pro` là tên GA, CHƯA có trên `models.list()` (đo 2026-08-12) — để sẵn ở bậc 1 để
  // ngày Google phát hành thì tự dùng, còn hôm nay `checkApiKey` lọc nó ra nên không tốn gì.
  'gemini-3.1-pro',
  'gemini-3.1-pro-preview',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-flash-latest',
];

/**
 * Chuỗi model SINH ẢNH — TÁCH HẲN khỏi `MODEL_CHAIN`.
 *
 * VÌ SAO PHẢI TÁCH: `checkApiKey` lọc `MODEL_CHAIN` rồi GHI KẾT QUẢ vào `secrets.json`, và chuỗi
 * đã lọc đó được truyền xuống làm `opts.models` cho mọi call site. Nếu đường sinh ảnh dùng chung
 * biến ấy, nó sẽ gọi model đọc-hiểu và nhận về TEXT — không bao giờ có ảnh.
 */
export const IMAGE_MODEL_CHAIN = [
  // Thứ tự do người dùng chốt: pro trước, flash sau. Cả ba tên đều đã đối chiếu `models.list()`
  // ngày 2026-08-12 và đều CÓ THẬT — không đoán tên.
  'gemini-3-pro-image',
  'gemini-3.1-flash-image',
  'gemini-2.5-flash-image',
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

// ─── Gọi model SINH ẢNH ──────────────────────────────────────────────────────

export type ImageAspect =
  | '1:1'
  | '2:3'
  | '3:2'
  | '3:4'
  | '4:3'
  | '4:5'
  | '5:4'
  | '9:16'
  | '16:9'
  | '21:9'
  | '1:4'
  | '4:1'
  | '1:8'
  | '8:1';

/**
 * Bộ giá trị `aspectRatio` LẤY TỪ TÀI LIỆU, không lấy từ doc comment của SDK.
 *
 * Hai nguồn, và chúng khác nhau:
 *   - Hướng dẫn sinh ảnh liệt kê: 1:1, 3:2, 2:3, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9.
 *   - Trang riêng của `gemini-3.1-flash-image` nói bản này THÊM: 1:4, 4:1, 1:8, 8:1.
 * Doc comment trong `@google/genai` 1.46 chỉ ghi 8 giá trị (thiếu 4:5, 5:4 và cả bốn giá trị
 * mới), nhưng trường được khai là `string` nên giá trị mới vẫn gửi được. Tin tài liệu API.
 *
 * BỐN GIÁ TRỊ CỰC ĐOAN LÀ 3.1-ONLY: model dự phòng `gemini-2.5-flash-image` có thể trả 400.
 * Đó chính là việc của bậc 2 trong thang hạ cấu hình ở `callGeminiImage` — nó bỏ `imageConfig`
 * rồi thử lại, mất quyền chọn khung nhưng vẫn có ảnh. Nên ở đây dùng hết bộ của model chính.
 */
const ASPECTS: ReadonlyArray<readonly [ImageAspect, number]> = [
  ['8:1', 8],
  ['4:1', 4],
  ['21:9', 21 / 9],
  ['16:9', 16 / 9],
  ['3:2', 3 / 2],
  ['4:3', 4 / 3],
  ['5:4', 5 / 4],
  ['1:1', 1],
  ['4:5', 4 / 5],
  ['3:4', 3 / 4],
  ['2:3', 2 / 3],
  ['9:16', 9 / 16],
  ['1:4', 1 / 4],
  ['1:8', 1 / 8],
];

/**
 * Khung gần nhất với ảnh cắt.
 *
 * So trong không gian LOG để "rộng gấp đôi" và "cao gấp đôi" lệch bằng nhau — so hiệu tuyến tính
 * sẽ dồn gần hết hình dọc về `1:1`, và khi đó model tự chọn bố cục lại chứ không vẽ lại hình.
 */
export function pickAspectRatio(w: number, h: number): ImageAspect {
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return '1:1';
  const target = Math.log(w / h);
  let best: ImageAspect = '1:1';
  let bestD = Infinity;
  for (const [name, r] of ASPECTS) {
    const d = Math.abs(Math.log(r) - target);
    if (d < bestD) {
      bestD = d;
      best = name;
    }
  }
  return best;
}

export interface GeminiImageOptions {
  parts: GeminiPart[];
  aspectRatio?: ImageAspect;
  /**
   * Tài liệu: `0.5K` (chỉ Flash, còn viết là `512px`), `1K` (mặc định), `2K`, `4K` — chữ K PHẢI
   * viết hoa. Hình vẽ đi vào khung 9 cm của Word nên `1K` là đủ; xem `normalizeToPng`, nó còn
   * kẹp về 1000 px cạnh dài. Để cả bộ ở đây cho khỏi nói sai hợp đồng API.
   */
  imageSize?: '0.5K' | '1K' | '2K' | '4K';
  signal?: AbortSignal;
  timeoutMs?: number;
  models?: string[];
  label?: string;
  onLog?: (line: string) => void;
}

export interface GeminiImageResult {
  /** base64 ảnh model trả về — CHƯA chuẩn hoá, có thể là jpeg/webp. */
  data: string;
  mimeType: string;
  /** Text đi kèm; model sinh ảnh hay giải thích thêm. Chỉ để ghi nhật ký. */
  text: string;
  model: string;
}

/** Sinh ảnh chậm hơn đọc-hiểu, nhưng không nên chờ tới 120 s như đường text. */
const IMAGE_TIMEOUT_MS = 90_000;

/**
 * Nhớ trong PHIÊN: cả chuỗi model ảnh đều 404 thì đừng thử lại cho những hình sau. Đề 15 hình
 * trên tài khoản không có model ảnh sẽ đốt 30 lượt gọi vô ích nếu thiếu cờ này.
 */
let imageChainDead = false;

/**
 * Gọi model sinh ảnh. **KHÔNG BAO GIỜ NÉM** — thất bại trả `null`, vì bên gọi luôn còn ảnh cắt.
 *
 * VÌ SAO LÀ HÀM RIÊNG, KHÔNG PHẢI MỘT CỜ TRÊN `callGemini` — ba lý do, đã đối chiếu tài liệu:
 *   1. `resp.text` của SDK 1.46 là getter BỎ QUA part không phải text ⇒ ảnh rơi âm thầm. Đây là
 *      lý do NẶNG NHẤT: `callGemini` chỉ đọc `resp.text` nên dù request đúng, ảnh vẫn mất. Phải
 *      tự đi qua `resp.candidates[0].content.parts[]`.
 *   2. `responseSchema` kéo theo `responseMimeType: 'application/json'`, xung đột với đầu ra ảnh;
 *      và `callGemini` không có chỗ đặt `responseModalities` / `imageConfig`.
 *   3. Hợp đồng KHÔNG NÉM: mọi call site của đường này còn ảnh cắt làm đường lùi, nên ném ra
 *      ngoài chỉ làm bên gọi phải bọc try/catch. `callGemini` thì buộc phải ném vì bên gọi
 *      không có bản dự phòng nào.
 *
 * ĐÃ SỬA MỘT NHẦM LẪN: bản đầu của hàm này ghi lý do số một là `thinkingConfig` (mà
 * `if (/flash/i.test(model))` ở `callGemini` sẽ đặt vì tên model có chữ "flash") gây 400. Tài
 * liệu của `gemini-3.1-flash-image` nói **Tư duy ĐƯỢC HỖ TRỢ**, nên điều đó không đúng — và
 * `maxOutputTokens: 32_768` cũng đúng bằng trần output của model, không phải giá trị sai. Hàm
 * riêng vẫn là lựa chọn đúng, nhưng vì ba lý do trên chứ không vì hai lý do đó.
 *
 * Khác `callGemini` ở ba điểm: ba lần thử là ba BẬC HẠ CẤU HÌNH (bậc 2 bỏ `imageConfig` — đúng
 * đường lùi khi model dự phòng không nhận khung 3.1-only, xem `ASPECTS`); lỗi `fatal` BƯỚC MODEL
 * thay vì ném; và có cờ `imageChainDead` ở trên.
 *
 * SDK 1.46 cũng có `ai.interactions.create` kèm `response_format: { type: 'image', ... }` — đường
 * mới mà tài liệu đang dùng làm ví dụ. Cố tình KHÔNG dùng: `generateContent` là đường mà cả file
 * này đã có sẵn phân loại lỗi, backoff theo `retryDelay`, và huỷ thật qua `abortSignal`.
 */
export async function callGeminiImage(
  apiKey: string,
  o: GeminiImageOptions,
): Promise<GeminiImageResult | null> {
  if (imageChainDead) return null;

  const ai = clientFor(apiKey);
  const models = o.models?.length ? o.models : IMAGE_MODEL_CHAIN;
  const log = (line: string) => o.onLog?.(`[${o.label ?? 'gemini-image'}] ${line}`);
  let allMissing = true;

  for (const model of models) {
    // Ba bậc: đủ cấu hình -> bỏ imageConfig -> bỏ luôn responseModalities.
    for (let rung = 0; rung < 3; rung++) {
      if (o.signal?.aborted) return null;
      try {
        const config: Record<string, unknown> = {
          abortSignal: combineSignals(o.signal, o.timeoutMs ?? IMAGE_TIMEOUT_MS),
        };
        if (rung < 2) config.responseModalities = ['IMAGE', 'TEXT'];
        if (rung < 1) {
          config.imageConfig = {
            aspectRatio: o.aspectRatio ?? '1:1',
            imageSize: o.imageSize ?? '1K',
          };
        }

        const resp = await ai.models.generateContent({
          model,
          contents: [{ role: 'user', parts: o.parts as never }],
          config: config as never,
        });

        const cand = resp.candidates?.[0];
        const parts = (cand?.content?.parts ?? []) as Array<{
          text?: string;
          inlineData?: { data?: string; mimeType?: string };
        }>;
        let img: { data: string; mimeType: string } | null = null;
        const chatter: string[] = [];
        for (const p of parts) {
          const d = p.inlineData;
          if (!img && d?.data && /^image\//.test(d.mimeType ?? '')) {
            img = { data: d.data, mimeType: d.mimeType as string };
          } else if (typeof p.text === 'string' && p.text.trim()) {
            chatter.push(p.text.trim());
          }
        }

        if (!img) {
          // KÈM LUÔN phần text model trả về. Bản đầu chỉ báo "không trả part ảnh nào" rồi vứt
          // chatter đi — mà chính chatter đó là thứ nói ngay ra nguyên nhân: lần chạy thật đầu
          // tiên, model trả về một khối ```tikz vì prompt lỡ mang theo luật viết mã TikZ. Không
          // có dòng này thì triệu chứng ("STOP, không ảnh") trông y hệt một lỗi cấu hình.
          const said = chatter.join(' ').replace(/\s+/g, ' ').slice(0, 200);
          log(
            `${model} không trả part ảnh nào (${cand?.finishReason ?? '?'})` +
              (said ? ` — model trả text: "${said}"` : '') +
              ' — bước model kế',
          );
          allMissing = false;
          break;
        }
        allMissing = false;
        if (rung > 0) log(`${model} OK ở bậc cấu hình ${rung + 1}`);
        return { ...img, text: chatter.join('\n'), model };
      } catch (err) {
        if (o.signal?.aborted) return null;
        const c = classify(err);
        if (c.kind === 'model-missing') {
          log(`${model} không có (${c.status}) — bước model kế`);
          break;
        }
        allMissing = false;
        if (c.kind === 'rate-limit') {
          log(`${model} chạm hạn mức — giữ ảnh cắt, không chờ`);
          return null;
        }
        if (rung === 2) {
          log(`${model} thất bại sau 3 bậc cấu hình (${c.kind}) — bước model kế`);
          break;
        }
        log(`${model} lỗi ở bậc ${rung + 1} (${c.kind}) — hạ cấu hình rồi thử lại`);
      }
    }
  }

  if (allMissing) {
    imageChainDead = true;
    log('tài khoản không có model sinh ảnh nào — bỏ hẳn bước này cho các hình sau');
  }
  return null;
}

// ─── Dò model có thật ────────────────────────────────────────────────────────

export interface KeyCheckResult {
  ok: boolean;
  chain: string[];
  /**
   * Chuỗi model SINH ẢNH có thật trên tài khoản này.
   *
   * KHÔNG gộp vào `chain`: `chain` bị ghi vào `secrets.json` rồi thành `opts.models` cho OCR và
   * solver, nhét model ảnh vào đó là gửi yêu cầu đọc-hiểu tới model sinh ảnh. Và cố tình KHÔNG
   * persist riêng: giữ ở state của `App.tsx` là đủ, vì `imageChainDead` đã lo ca "tài khoản
   * không có model ảnh" mà không cần nhớ qua các lần chạy.
   */
  imageChain: string[];
  available: string[];
  /** Chỉ có khi key thật sự KHÔNG dùng được. */
  error?: string;
  /** Key chưa bị phủ định, chỉ là lần này chưa xác nhận được (hết hạn mức, mạng chớp). */
  warning?: string;
}

/**
 * Gọi models.list() để (a) xác nhận key dùng được, (b) loại khỏi chuỗi những model
 * mà tài khoản này không có. Tên model Google trả về dạng `models/gemini-...`.
 *
 * PHÂN BIỆT "key sai" với "lần này chưa hỏi được": bản trước gom MỌI lỗi thành `ok:false`,
 * mà giao diện lại không cho vào app khi `!ok` — nên chỉ cần hết hạn mức hoặc mạng chớp một
 * nhịp là người dùng bị báo "key không dùng được" và KHÔNG VÀO ĐƯỢC APP. Dùng lại đúng bộ
 * phân loại lỗi sẵn có: chỉ 400/401/403 mới là key sai; 429 và lỗi mạng/5xx nghĩa là endpoint
 * vẫn sống và key chưa bị chối, nên cho vào và chỉ cảnh báo.
 */
export async function checkApiKey(apiKey: string): Promise<KeyCheckResult> {
  // Đổi key thì cờ "tài khoản này không có model ảnh" của key CŨ hết giá trị. Không xoá thì người
  // dùng đổi sang key CÓ model ảnh mà tính năng vẫn tắt cho tới khi khởi động lại app.
  imageChainDead = false;
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
    // Fail-open y như chuỗi text: API có thể không liệt kê hết model.
    const imageChain = IMAGE_MODEL_CHAIN.filter((m) => available.includes(m));
    return {
      ok: true,
      chain: chain.length ? chain : MODEL_CHAIN,
      imageChain: imageChain.length ? imageChain : IMAGE_MODEL_CHAIN,
      available,
    };
  } catch (err) {
    const c = classify(err);
    if (c.kind === 'rate-limit') {
      return {
        ok: true,
        chain: MODEL_CHAIN,
        imageChain: IMAGE_MODEL_CHAIN,
        available: [],
        warning: 'Tài khoản đang hết hạn mức nên chưa dò được danh sách model — vẫn dùng key này.',
      };
    }
    if (c.kind === 'transient' || c.kind === 'model-missing') {
      return {
        ok: true,
        chain: MODEL_CHAIN,
        imageChain: IMAGE_MODEL_CHAIN,
        available: [],
        warning: 'Chưa hỏi được Google lần này (mạng hoặc phía Google) — vẫn dùng key này.',
      };
    }
    return {
      ok: false,
      chain: MODEL_CHAIN,
      imageChain: IMAGE_MODEL_CHAIN,
      available: [],
      error: humanError(err),
    };
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
