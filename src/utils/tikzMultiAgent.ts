/**
 * Multi-Agent TikZ Generation Pipeline — Optimized
 *
 * 2-phase, 2-round-trip architecture:
 *   Phase 1 (parallel):  Initial classify+extract (Draft A) runs alongside
 *                         an independent Draft B — both see the original image.
 *   Phase 2 (sequential): Verifier compares both drafts, merges the best parts,
 *                          fixes errors, outputs final compilable code.
 *
 * When Draft A is provided by the caller (from the initial classify call),
 * only Draft B + Verify are needed — saving one full API round-trip.
 */

import { figureRulesFor, type FigureCategory } from './figurePrompts.ts';
import {
  callGemini,
  TEMP_CREATIVE,
  TEMP_PRECISE,
  TEMP_STANDARD,
  type GeminiPart,
} from '../pipeline/geminiClient';

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Hạn cho MỘT LƯỢT GỌI, truyền thẳng cho `callGemini`.
 *
 * Bản trước bọc `withTimeout(120s)` (một `Promise.race`) quanh `callGemini` mà hạn mỗi lượt của
 * chính nó cũng là 120s, với 3 lượt thử × 5 model. Hai hệ quả đo được:
 *   - Vòng dự phòng của `callGemini` CHẾT HẲN cho mọi lượt gọi TikZ: chỉ cần một lần backoff 429
 *     hay một lần bước model là cái race bên ngoài nổ trước, không bao giờ tới được model kế.
 *   - `Promise.race` không huỷ fetch — đúng cái anti-pattern mà `geminiClient` được viết ra để
 *     loại bỏ (xem chú thích đầu file đó). Lượt gọi bị bỏ rơi vẫn chạy tiếp và vẫn tốn hạn mức.
 *
 * Đo trên đề THPT 2025: hình `p4_f1` mất ĐÚNG 120 000 ms rồi báo "TikZ generation failed" — nó
 * không sinh mã hỏng, nó hết giờ. 45s mỗi lượt cho hỏng nhanh gấp 2,7 lần và để dành thời gian
 * cho chuỗi model làm việc thật.
 */
const CALL_TIMEOUT_MS = 45_000;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TikzGenerationResult {
  tikzCode: string;
  candidates: string[];
  reasoning: string;
  log: string[];
}

export interface TikzProgressCallback {
  (stage: string, detail: string): void;
}

// ─── Prompts ─────────────────────────────────────────────────────────────────

/**
 * Prompt vẽ lại một hình đã có, theo LOẠI hình.
 *
 * Bản trước dùng đúng một prompt nói "a geometric figure" kèm template tam giác cho MỌI hình
 * — kể cả bảng biến thiên và đồ thị hàm số. Giờ luật riêng theo loại nằm ở `figurePrompts.ts`.
 *
 * Template dưới đây bỏ hai dòng `% Required: \usepackage{tikz}` của bản cũ: chúng là comment
 * nên vô tác dụng, mà lại dạy model viết `\usepackage` — thứ làm chết hình nếu nó bỏ dấu `%`.
 */
/**
 * Khối ĐỀ BÀI gửi kèm khi vẽ lại.
 *
 * Bản trước KHÔNG gửi: người viết mã TikZ chỉ nhìn ảnh cắt 144 DPI, mờ và hay dính chữ câu bên
 * cạnh. Trong khi `upgradeFigure` đã cầm sẵn đề bài và vẫn gửi cho trọng tài lẫn đường sinh ảnh —
 * chỉ riêng chỗ VIẾT MÃ là không có. Đo trên đề THPT 2025, hai trong ba ca thua là lỗi mà đề bài
 * nói rõ: "thiếu đoạn nối P và A" và "đồ thị cắt Oy sai dấu tung độ".
 *
 * Hai thẩm quyền phải tách như bên `figureGenPrompts`: ẢNH quyết định HÌNH, ĐỀ quyết định NGHĨA.
 */
const contextBlock = (context: string) =>
  context
    ? `
ĐỀ BÀI của câu chứa hình — dùng để ĐỌC RÕ ảnh, KHÔNG dùng để thay ảnh:
<<<
${context}
>>>
CÁCH DÙNG: đề cho biết điểm nào tên gì, đâu là trung điểm / chân đường vuông góc / hình chiếu,
đoạn nào bài đang hỏi. Dùng nó khi nhãn trong ảnh bị mờ hoặc khi không rõ một nét là cạnh hay
đoạn phụ.
GIỚI HẠN: ẢNH vẫn là bản CHUẨN về hình. Đề nói có mà ảnh KHÔNG VẼ thì KHÔNG vẽ. Đề lệch ảnh thì
theo ảnh (đề ghi "đáy là hình vuông" mà ảnh vẽ hình bình hành nghiêng thì vẽ bình hành nghiêng —
đó là phép chiếu song song). KHÔNG thêm số đo mà ảnh không in.
`
    : '';

const draftPrompt = (kind: FigureCategory, context = '') => `Bạn là chuyên gia TikZ. Nhìn kỹ ảnh hình vẽ này.

Viết mã TikZ ĐẦY ĐỦ, DỰNG ĐƯỢC, tái hiện đúng hình trong ảnh.
${contextBlock(context)}

KHUÔN mã:
\\begin{tikzpicture}[line cap=round, line join=round, >=Stealth]
  \\coordinate (A) at (0,0);
  \\draw[thick] (A) -- (B) -- (C) -- cycle;
  \\draw[dashed] (B) -- (H);
  \\pic[draw, angle radius=8pt] {right angle = A--H--B};
  \\fill (A) circle (1.5pt); \\node[below left] at (A) {$A$};
\\end{tikzpicture}

LUẬT MÃ:
1. Khai \\coordinate cho MỌI điểm có tên TRƯỚC khi dùng nó.
2. Mỗi điểm có nhãn thì \\fill một chấm và \\node một nhãn. Mọi ký hiệu toán trong $...$.
3. Đưa vào ĐỦ mọi thành phần thấy trong ảnh. KHÔNG thêm gì không có trong ảnh.
4. Chỉ khai \\usetikzlibrary những thư viện thật sự dùng.

${figureRulesFor(kind)}

CHỈ xuất mã TikZ. Không giải thích, không bọc trong dấu \`\`\`.`;

const verifyPrompt = (kind: FigureCategory, context = '') => `Bạn là người soát chất lượng mã TikZ. Bạn nhận:
${contextBlock(context)}
1. ảnh hình gốc,
2. một hoặc hai bản mã TikZ ứng viên.

PHẦN 1 — SOÁT, từng bước:
a) So từng thành phần của mỗi bản với ảnh gốc: thiếu gì, thêm gì?
b) Tìm lỗi làm mã không dựng được:
   - \\coordinate nào dùng trước khi khai?
   - macro hay thư viện nào không tồn tại?
   - ngoặc lệch, thiếu dấu chấm phẩy?
c) So tỉ lệ: bản nào giống bố cục ảnh hơn?

PHẦN 2 — XUẤT:
Trả về mã TikZ CUỐI. Được phép: lấy nguyên bản tốt hơn, ghép phần hay của cả hai, hoặc sửa
lỗi tìm thấy. Chỉ có một bản ứng viên thì soát và sửa chính bản đó.

Định dạng trả lời PHẢI đúng như sau:

REASONING:
(phân tích từng bước, nói rõ ở dòng nào)

FINAL_CODE:
\\begin{tikzpicture}[line cap=round, line join=round, >=Stealth]
...
\\end{tikzpicture}

Luật:
- Mọi thành phần thấy trong ảnh phải có mặt.
- KHÔNG thêm thành phần không có trong ảnh. KHÔNG bịa nhãn, điểm, dấu trang trí.
- Cả hai bản đều thiếu một thứ thấy trong ảnh thì thêm vào.
- Cả hai bản đều có thứ KHÔNG có trong ảnh thì bỏ ra.

${figureRulesFor(kind)}

TỰ KIỂM trước khi xuất FINAL_CODE:
- Mọi \\coordinate dùng tới đều đã khai TRƯỚC đó (thứ tự quan trọng).
- Mọi \\usetikzlibrary khai ra đều nằm trong danh sách cho phép và đều thật sự được dùng.
- Mọi nhãn có ký hiệu toán đều nằm trong $...$, ngoặc cân.
- \\pic angle chỉ tham chiếu tên điểm đã khai.
- KHÔNG có ký tự có dấu tiếng Việt ở bất cứ đâu, kể cả trong dòng chú thích %.`;

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function extractTikzCode(text: string): string {
  // From FINAL_CODE: or TIKZ_CODE: marker
  const markerMatch = text.match(/(?:FINAL_CODE|TIKZ_CODE):\s*\n([\s\S]*)/);
  if (markerMatch) {
    const afterMarker = markerMatch[1].trim();
    const envMatch = afterMarker.match(/((?:% Required[\s\S]*?)?\\begin\{tikzpicture\}[\s\S]*?\\end\{tikzpicture\})/);
    if (envMatch) return envMatch[1].trim();
    return afterMarker;
  }

  // From code block
  const codeBlockMatch = text.match(/```(?:latex|tex)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (codeBlockMatch) return codeBlockMatch[1].trim();

  // With header comment
  const tikzMatch = text.match(/(% Required[\s\S]*?\\end\{tikzpicture\})/);
  if (tikzMatch) return tikzMatch[1].trim();

  // Just the environment
  const envMatch = text.match(/(\\begin\{tikzpicture\}[\s\S]*?\\end\{tikzpicture\})/);
  if (envMatch) return envMatch[1].trim();

  return text.trim();
}

function extractReasoning(text: string): string {
  const match = text.match(/REASONING:\s*\n([\s\S]*?)(?=\nFINAL_CODE:)/);
  if (match) return match[1].trim();
  const beforeCode = text.match(/([\s\S]*?)(?=% Required|\\begin\{tikzpicture\})/);
  if (beforeCode && beforeCode[1].trim().length > 20) return beforeCode[1].trim();
  return '';
}

/**
 * Đi qua wrapper chung: có chuỗi model dự phòng, backoff theo retryDelay của Google,
 * và huỷ thật khi người dùng bấm dừng.
 *
 * `models` và `signal` BẮT BUỘC phải chuyền tiếp. Bản trước bỏ cả hai, nên 2-3 lượt gọi mỗi
 * hình luôn bắt đầu ở model bậc 1 dù `checkApiKey` đã lọc ra là tài khoản không có nó, và vẫn
 * đốt hạn mức sau khi người dùng bấm Dừng.
 */
function callModel(
  apiKey: string,
  parts: GeminiPart[],
  temperature: number,
  o?: { models?: string[]; signal?: AbortSignal },
) {
  return callGemini(apiKey, {
    parts,
    temperature,
    label: 'tikz',
    models: o?.models,
    signal: o?.signal,
    // Hạn THẬT (abort), không phải Promise.race — xem chú thích ở CALL_TIMEOUT_MS.
    timeoutMs: CALL_TIMEOUT_MS,
  });
}

// ─── Pipeline ────────────────────────────────────────────────────────────────

/**
 * Optimized pipeline: accepts an existing Draft A (from the initial classify call)
 * so only Draft B + Verify need to run — 2 API calls instead of 3.
 *
 * If draftA is not provided, falls back to generating both drafts (3 calls total).
 */
export async function generateTikzMultiAgent(
  apiKey: string,
  imageBase64: string,
  mimeType: string,
  options?: {
    onProgress?: TikzProgressCallback;
    draftA?: string;
    kind?: FigureCategory;
    /** Chuỗi model đã lọc theo tài khoản. Thiếu là mọi lượt gọi bắt đầu ở model có thể không có. */
    models?: string[];
    /** Thiếu là bấm Dừng rồi vẫn đốt hạn mức. */
    signal?: AbortSignal;
    /**
     * Đề bài của câu chứa hình. Bản trước KHÔNG có: người viết mã chỉ nhìn ảnh cắt mờ, trong khi
     * trọng tài và đường sinh ảnh đều đã được đọc đề. Xem `contextBlock`.
     */
    context?: string;
  },
): Promise<TikzGenerationResult> {
  const { onProgress, draftA } = options ?? {};
  const net = { models: options?.models, signal: options?.signal };
  const ctx = options?.context ?? '';
  // `ve` = hình vẽ chưa rõ loại; luật chung, đúng như hành vi trước 1.2.0.
  const kind: FigureCategory = options?.kind ?? 've';
  const img = { inlineData: { data: imageBase64, mimeType } };
  const log: string[] = [];
  const candidates: string[] = [];

  // ── Phase 1: Get Draft B (+ Draft A if not provided) ──────────────────────

  if (draftA && draftA.includes('\\begin{tikzpicture}')) {
    // Draft A already available from the initial classify call — skip redundant generation
    candidates.push(draftA);
    log.push('Using initial TikZ output as Draft A (saved one API call).');

    onProgress?.('describe', 'Generating independent Draft B for comparison...');
    log.push('Step 1: Generating independent Draft B...');

    try {
      const respB = await callModel(
        apiKey,
        [{ text: draftPrompt(kind, ctx) }, img],
        TEMP_CREATIVE,
        net,
      );
      const codeB = extractTikzCode(respB.text || '');
      if (codeB.includes('\\begin{tikzpicture}')) {
        candidates.push(codeB);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      console.warn('DraftB failed:', msg);
      log.push(`Draft B failed: ${msg}`);
    }
  } else {
    // No Draft A provided — fire both in parallel (3 API calls total)
    onProgress?.('describe', 'Generating two TikZ drafts in parallel...');
    log.push('Step 1: Running two independent drafts in parallel...');

    const callA = callModel(apiKey, [{ text: draftPrompt(kind, ctx) }, img], TEMP_STANDARD, net);
    // Bản B TRƯỚC ĐÂY quên truyền `net`, nên riêng nó không có chuỗi model đã lọc và không dừng
    // được khi người dùng bấm Dừng — một nửa số lượt gọi nháp bị bỏ sót.
    const callB = callModel(apiKey, [{ text: draftPrompt(kind, ctx) }, img], TEMP_CREATIVE, net);

    const [respA, respB] = await Promise.allSettled([callA, callB]);

    if (respA.status === 'fulfilled') {
      const codeA = extractTikzCode(respA.value.text || '');
      if (codeA.includes('\\begin{tikzpicture}')) candidates.push(codeA);
    } else {
      log.push(`Draft A failed: ${respA.reason?.message || 'unknown error'}`);
    }

    if (respB.status === 'fulfilled') {
      const codeB = extractTikzCode(respB.value.text || '');
      if (codeB.includes('\\begin{tikzpicture}')) candidates.push(codeB);
    } else {
      log.push(`Draft B failed: ${respB.reason?.message || 'unknown error'}`);
    }
  }

  if (candidates.length === 0) {
    throw new Error('TikZ generation failed. Please try again.');
  }

  log.push(`Got ${candidates.length} valid draft${candidates.length > 1 ? 's' : ''}.`);

  // ── Phase 2: Verify + Fix ─────────────────────────────────────────────────

  // Bản trước bỏ HẲN bước soát khi chỉ có một bản nháp. Nhưng bước soát không chỉ để chọn
  // giữa hai bản — nó còn là chỗ duy nhất bắt lỗi cú pháp và lỗi thiếu/thừa thành phần so
  // với ảnh. Một bản nháp thì càng cần soát, vì không có bản thứ hai để đối chiếu.
  onProgress?.('verify', 'Verifying drafts against image — picking best result...');
  log.push('Step 2: Verifying both drafts against the image...');

  const draftText = candidates
    .map((code, i) => `=== DRAFT ${String.fromCharCode(65 + i)} ===\n${code}`)
    .join('\n\n');

  const verifyResponse = await callModel(
    apiKey,
    [
      { text: verifyPrompt(kind, ctx) },
      img,
      { text: `${draftText}\n\nVerify and produce the final code.` },
    ],
    TEMP_PRECISE,
    net,
  );

  const verifyText = verifyResponse.text || '';
  const reasoning = extractReasoning(verifyText);
  const finalCode = extractTikzCode(verifyText);

  if (reasoning) {
    const lines = reasoning.split('\n').filter((l) => l.trim().length > 0);
    const summary = lines.slice(0, 5).map((l) => l.trim());
    log.push('Verification findings:');
    for (const s of summary) {
      log.push(`  ${s}`);
    }
    if (lines.length > 5) {
      log.push(`  ... and ${lines.length - 5} more checks.`);
    }
  }

  if (!finalCode.includes('\\begin{tikzpicture}')) {
    log.push('Verifier did not produce valid code. Using best draft directly.');
    return {
      tikzCode: candidates[0],
      candidates,
      reasoning: reasoning || 'Verification produced no code; using draft A.',
      log,
    };
  }

  log.push('Final TikZ code produced successfully.');
  onProgress?.('complete', 'TikZ generation complete.');

  return {
    tikzCode: finalCode,
    candidates,
    reasoning,
    log,
  };
}
