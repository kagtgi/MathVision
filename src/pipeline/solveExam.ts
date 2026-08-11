/**
 * Tự giải đề và sinh khối `## HƯỚNG DẪN GIẢI`.
 *
 * Thiết kế cốt lõi: solver KHÔNG đụng vào đường ống đã kiểm chứng. Nó chỉ sinh ra một
 * khối MMD đúng y dạng mà `restructureAnswers` (port từ restructure_answers.js) vốn
 * đọc được từ đề có sẵn lời giải. Nhờ vậy phần tái cấu trúc, gạch chân đáp án, dòng
 * "Lời giải", "Chọn X." highlight và toàn bộ khâu sinh docx giữ nguyên bảo chứng
 * golden 25 đề.
 */

import { callGemini, runAdaptivePool, type GeminiPart } from './geminiClient.ts';
import {
  asHeading,
  splitParts,
  splitQuestions,
  stripPartDecor,
  typeFromBody,
  type PartType,
} from './examTransforms.ts';
import { figureCheckPrompt, solvePrompt, solveSchema, type QType } from './solvePrompts.ts';
import { tikzCapsRules } from '../utils/tikzCapabilities.ts';

export interface QuestionRef {
  /** Vị trí thứ tự trong toàn đề — dùng để map, KHÔNG dùng số câu (đề in trùng số thật). */
  index: number;
  partIndex: number;
  partHeader: string | null;
  partKey: number;
  /** Số câu in trên đề; có thể trùng nhau. */
  num: number | null;
  type: QType;
  text: string;
  figureIds: string[];
}

export interface SolvedQuestion {
  ref: QuestionRef;
  chon: string | null;
  yKien: Array<{ y: string; dung: boolean; giaiThich: string }> | null;
  dapSo: string | null;
  loiGiai: string[];
  /** Hình solver tự dựng (id trong figureMap), null nếu không vẽ hoặc dựng hỏng. */
  figureId: string | null;
  figureReason: string | null;
  disagreement: boolean;
  failed: boolean;
}

export interface SolveOptions {
  apiKey: string;
  /** Ảnh crop của hình trong đề, để solver "nhìn" được câu hình. */
  figureImages?: Map<string, { base64: string; mimeType: string }>;
  /** Dựng TikZ -> PNG (chỉ có trong trình duyệt). Trả null nếu compile hỏng. */
  renderTikz?: (code: string) => Promise<{ bytes: Uint8Array; w: number; h: number } | null>;
  /** Giải 2 lượt và phân xử khi lệch. */
  doubleCheck?: boolean;
  /** Cho phép solver tự vẽ hình. */
  drawFigures?: boolean;
  /** Soi lại hình bằng ảnh render (tốn thêm 1-2 call mỗi hình). */
  verifyFigures?: boolean;
  concurrency?: number;
  models?: string[];
  signal?: AbortSignal;
  onLog?: (s: string) => void;
  onProgress?: (done: number, total: number) => void;
}

// ─── Cắt đề thành từng câu ───────────────────────────────────────────────────

function partTypeOf(header: string | null, lines: string[]): PartType {
  const h = header ? asHeading(header) : null;
  return h ? h.type : typeFromBody(lines);
}

/**
 * Loại của MỘT câu.
 *
 * Tiêu đề phần chuẩn (PHẦN I/II/III/IV) là căn cứ đáng tin nhất nên ưu tiên. Đề không
 * có tiêu đề phần thì phải xét TỪNG CÂU: đề kiểm tra thường xuyên hay trộn câu trắc
 * nghiệm với câu tự luận trong cùng một khối, lấy loại của cả khối gán cho mọi câu sẽ
 * biến câu tự luận thành trắc nghiệm và sinh ra dòng "Chọn ?." vô nghĩa.
 *
 * Chốt cuối: đã gọi là trắc nghiệm thì phải thấy đủ phương án. Không thấy thì hạ về tự
 * luận, vì thà thiếu dòng "Chọn" còn hơn in một đáp án bỏ trống.
 */
function questionTypeOf(headerType: PartType | null, lines: string[]): PartType {
  const t = headerType ?? typeFromBody(lines);
  if (t !== 'TN') return t;
  const options = (lines.join('\n').match(/(?:^|\n)\s*(?:__|\*\*)?[A-D](?:__|\*\*)?\s*[.)]\s/g) || [])
    .length;
  return options >= 2 ? 'TN' : 'TL';
}

const FIG_REF = /!\[[^\]]*\]\(\s*#([\w-]+)\s*\)/g;

function figureIdsIn(text: string): string[] {
  return [...text.matchAll(FIG_REF)].map((m) => m[1]);
}

export function splitForSolving(examMmd: string): QuestionRef[] {
  const out: QuestionRef[] = [];
  let index = 0;
  splitParts(examMmd).forEach((part, partIndex) => {
    const { preamble, questions } = splitQuestions(part.lines);
    const headerType = part.header ? (asHeading(part.header)?.type ?? null) : null;
    const type = partTypeOf(part.header, part.lines);

    if (!questions.length) {
      const text = preamble.join('\n').trim();
      // Phần tự luận không đánh số: giải cả phần như một đơn vị.
      if (text && part.header) {
        out.push({
          index: index++,
          partIndex,
          partHeader: part.header,
          partKey: part.key,
          num: null,
          type,
          text,
          figureIds: figureIdsIn(text),
        });
      }
      return;
    }

    for (const q of questions) {
      const text = q.lines.join('\n').trim();
      out.push({
        index: index++,
        partIndex,
        partHeader: part.header,
        partKey: part.key,
        num: q.num,
        type: questionTypeOf(headerType, q.lines),
        text,
        figureIds: figureIdsIn(text),
      });
    }
  });
  return out;
}

// ─── Giải một câu ────────────────────────────────────────────────────────────

interface RawSolution {
  chon?: string;
  ketQua?: string;
  dapSo?: string;
  yKien?: Array<{ y: string; dung: boolean; giaiThich: string }>;
  loiGiai?: string[];
  veHinh?: boolean;
  lyDoHinh?: string;
  tikz?: string;
}

function parseSolution(text: string): RawSolution | null {
  const cleaned = text.trim().replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```$/, '');
  try {
    return JSON.parse(cleaned) as RawSolution;
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]) as RawSolution;
    } catch {
      return null;
    }
  }
}

/** Chuẩn hoá đáp án để so hai lượt: chỉ so KẾT LUẬN, không so lời giải. */
function answerKey(type: QType, s: RawSolution): string {
  if (type === 'TN') return (s.chon ?? '?').trim().toUpperCase();
  if (type === 'TLN') return (s.dapSo ?? '').replace(/\s/g, '').replace(/\./g, ',');
  if (type === 'DS') {
    return (s.yKien ?? [])
      .map((k) => `${k.y.trim().toLowerCase()}=${k.dung ? 1 : 0}`)
      .sort()
      .join(',');
  }
  return ''; // tự luận không có đáp án rời rạc để so
}

async function solveOnce(
  ref: QuestionRef,
  variant: 0 | 1 | 2,
  opts: SolveOptions,
): Promise<RawSolution | null> {
  const parts: GeminiPart[] = [{ text: solvePrompt(ref.type, variant) }];

  for (const id of ref.figureIds) {
    const img = opts.figureImages?.get(id);
    if (img) parts.push({ inlineData: { data: img.base64, mimeType: img.mimeType } });
  }
  parts.push({ text: `CÂU HỎI:\n${ref.text}` });
  if (!opts.drawFigures) {
    parts.push({ text: 'Lần này KHÔNG vẽ hình: luôn trả veHinh = false, tikz để rỗng.' });
  }

  const res = await callGemini(opts.apiKey, {
    parts,
    temperature: variant === 1 ? 0.3 : 0.1,
    maxOutputTokens: 8192,
    responseSchema: solveSchema(ref.type),
    signal: opts.signal,
    models: opts.models,
    label: `giải câu ${ref.num ?? ref.index + 1}${variant ? ` (lượt ${variant + 1})` : ''}`,
    onLog: opts.onLog,
  });
  return parseSolution(res.text);
}

// ─── Dựng hình ───────────────────────────────────────────────────────────────

function extractTikz(text: string): string | null {
  const m = text.match(/\\begin\{tikzpicture\}[\s\S]*?\\end\{tikzpicture\}/);
  return m ? m[0] : null;
}

/**
 * Mã không dựng được thì nhờ model viết lại đơn giản hơn, kèm danh sách thư viện thật sự có.
 * Trả `null` nếu không cứu được — bên gọi bỏ hình.
 */
async function rewriteBrokenTikz(
  broken: string,
  questionText: string,
  opts: SolveOptions,
): Promise<string | null> {
  try {
    const res = await callGemini(opts.apiKey, {
      parts: [
        {
          text: [
            'Mã TikZ dưới đây KHÔNG dựng được (bộ dựng không báo lỗi cụ thể, chỉ treo rồi bỏ).',
            'Viết lại ĐƠN GIẢN HƠN cho chắc chắn dựng được: bớt trang trí, bớt lệnh lạ, giữ',
            'đúng nội dung toán học của hình.',
            '',
            'CÂU HỎI:',
            questionText,
            '',
            'MÃ HỎNG:',
            broken,
            '',
            tikzCapsRules(),
            '',
            'Chỉ trả mã TikZ, bắt đầu bằng \\begin{tikzpicture}, không kèm lời dẫn.',
          ].join('\n'),
        },
      ],
      temperature: 0.1,
      maxOutputTokens: 4096,
      signal: opts.signal,
      models: opts.models,
      label: 'viết lại hình',
      onLog: opts.onLog,
    });
    const fixed = extractTikz(res.text);
    return fixed && fixed.includes('\\begin{tikzpicture}') ? fixed : null;
  } catch {
    return null;
  }
}

async function buildFigure(
  ref: QuestionRef,
  tikz: string,
  opts: SolveOptions,
): Promise<{ id: string; entry: { bytes: Uint8Array; w: number; h: number } } | null> {
  if (!opts.renderTikz) return null;
  const id = `sol_c${ref.index + 1}_f1`;

  const label = ref.num ?? ref.index + 1;
  let code = tikz;
  /** Chỉ cho đúng MỘT lượt viết lại khi mã không dựng được, để không tốn API vô hạn. */
  let repairsLeft = 1;

  for (let round = 0; round <= (opts.verifyFigures ? 2 : 0); round++) {
    const png = await opts.renderTikz(code);
    if (!png) {
      // Bản trước bỏ hình NGAY tại đây, nên mã sai cú pháp không bao giờ được sửa: vòng lặp
      // soi lại chỉ chạy khi render ĐÃ thành công. Cho một lượt viết lại đơn giản hơn.
      if (repairsLeft > 0 && opts.apiKey) {
        repairsLeft--;
        opts.onLog?.(`[hình câu ${label}] TikZ không dựng được — thử viết lại đơn giản hơn.`);
        const rewritten = await rewriteBrokenTikz(code, ref.text, opts);
        if (rewritten && rewritten !== code) {
          code = rewritten;
          round--; // lượt này chưa tính, vẫn còn nguyên ngân sách soi lại
          continue;
        }
      }
      opts.onLog?.(`[hình câu ${label}] TikZ không dựng được — bỏ hình.`);
      return null;
    }
    if (!opts.verifyFigures || round === 2) return { id, entry: png };

    // Soi lại bằng chính ảnh vừa dựng
    try {
      const check = await callGemini(opts.apiKey, {
        parts: [
          { text: figureCheckPrompt(ref.text) },
          { inlineData: { data: bytesToBase64(png.bytes), mimeType: 'image/png' } },
        ],
        temperature: 0.1,
        maxOutputTokens: 4096,
        signal: opts.signal,
        models: opts.models,
        label: `soi hình câu ${ref.num ?? ref.index + 1}`,
        onLog: opts.onLog,
      });
      if (/^\s*OK\b/i.test(check.text)) return { id, entry: png };
      const fixed = extractTikz(check.text);
      if (!fixed || fixed === code) return { id, entry: png };
      code = fixed;
    } catch {
      return { id, entry: png }; // soi hỏng thì giữ hình đã dựng, không mất dữ liệu
    }
  }
  return null;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// ─── Giải cả đề ──────────────────────────────────────────────────────────────

export interface SolveResult {
  solved: SolvedQuestion[];
  /** Hình solver tự dựng, để nhập vào figureMap chung. */
  newFigures: Map<string, { bytes: Uint8Array; w: number; h: number }>;
  disagreements: string[];
}

export async function solveExam(examMmd: string, opts: SolveOptions): Promise<SolveResult> {
  const refs = splitForSolving(examMmd);
  const newFigures = new Map<string, { bytes: Uint8Array; w: number; h: number }>();
  const disagreements: string[] = [];
  let done = 0;

  const results = await runAdaptivePool(
    refs,
    async (ref) => {
      const first = await solveOnce(ref, 0, opts);
      let chosen = first;
      let disagreement = false;

      // Lượt 2 chỉ có nghĩa với câu có đáp án rời rạc để so.
      if (opts.doubleCheck && first && ref.type !== 'TL') {
        const second = await solveOnce(ref, 1, opts);
        if (second) {
          const k1 = answerKey(ref.type, first);
          const k2 = answerKey(ref.type, second);
          if (k1 !== k2) {
            const third = await solveOnce(ref, 2, opts);
            const k3 = third ? answerKey(ref.type, third) : null;
            if (k3 && k3 === k1) chosen = first;
            else if (k3 && k3 === k2) chosen = second;
            else {
              // Ba kết quả khác nhau -> không chốt đáp án
              chosen = third ?? first;
              if (ref.type === 'TN') chosen = { ...chosen, chon: '?' };
            }
            disagreement = true;
            disagreements.push(`Câu ${ref.num ?? ref.index + 1}`);
          }
        }
      }

      let figureId: string | null = null;
      if (chosen?.veHinh && opts.drawFigures && chosen.tikz?.includes('\\begin{tikzpicture}')) {
        const built = await buildFigure(ref, chosen.tikz, opts);
        if (built) {
          newFigures.set(built.id, built.entry);
          figureId = built.id;
        }
      }

      done++;
      opts.onProgress?.(done, refs.length);

      const solved: SolvedQuestion = {
        ref,
        chon: chosen?.chon ? chosen.chon.trim().toUpperCase() : null,
        yKien: chosen?.yKien ?? null,
        dapSo: chosen?.dapSo?.trim() ?? null,
        loiGiai: (chosen?.loiGiai ?? []).map((l) => l.trim()).filter(Boolean),
        figureId,
        figureReason: chosen?.lyDoHinh ?? null,
        disagreement,
        failed: !chosen,
      };
      return solved;
    },
    { concurrency: opts.concurrency ?? 4, signal: opts.signal, onLog: opts.onLog },
  );

  const solved: SolvedQuestion[] = results.map((r, i) =>
    r
      ? r
      : {
          ref: refs[i],
          chon: null,
          yKien: null,
          dapSo: null,
          loiGiai: ['Chưa giải được câu này — vui lòng bấm "Giải lại câu này".'],
          figureId: null,
          figureReason: null,
          disagreement: false,
          failed: true,
        },
  );

  return { solved, newFigures, disagreements };
}

// ─── Ráp thành MMD cho đường ống cũ ──────────────────────────────────────────

function renderOneSolution(s: SolvedQuestion): string[] {
  const out: string[] = [];
  const head = s.ref.num !== null ? `Câu ${s.ref.num}.` : null;

  // Câu trắc nghiệm luôn có dòng "Chọn". Máy không chốt được thì để "Chọn ?." làm mốc
  // cho người dùng tìm và sửa — QC đếm đúng dấu này. Chỉ những câu THỰC SỰ là trắc
  // nghiệm mới đi vào đây, nên không còn cảnh câu tự luận bị gắn dòng đáp án rỗng.
  if (s.ref.type === 'TN') {
    const letter = s.chon && /^[A-D]$/.test(s.chon) ? s.chon : '?';
    out.push(head ? `${head} Chọn ${letter}.` : `Chọn ${letter}.`);
  } else if (head) {
    out.push(head);
  }

  if (s.figureId) out.push('', `![](#${s.figureId})`);

  if (s.ref.type === 'DS' && s.yKien?.length) {
    for (const k of s.yKien) {
      const label = k.y.trim().toLowerCase();
      out.push('', `${label}) **${k.dung ? 'Đúng' : 'Sai'}**. ${k.giaiThich.trim()}`);
    }
  }

  if (s.loiGiai.length) {
    out.push('', ...s.loiGiai);
  }
  return out;
}

/**
 * Sinh khối `## ĐÁP ÁN` (bảng trả lời ngắn) + `## HƯỚNG DẪN GIẢI` đúng dạng mà
 * restructureAnswers mong đợi. Thứ tự bắt buộc: ĐÁP ÁN trước, HƯỚNG DẪN GIẢI sau.
 */
export function renderSolutionsMmd(solved: SolvedQuestion[]): string {
  const byPart = new Map<number, SolvedQuestion[]>();
  for (const s of solved) {
    const list = byPart.get(s.ref.partIndex) ?? [];
    list.push(s);
    byPart.set(s.ref.partIndex, list);
  }
  const partOrder = [...byPart.keys()].sort((a, b) => a - b);

  // ── Bảng đáp án cho câu trả lời ngắn ──
  const answerBlock: string[] = [];
  for (const pi of partOrder) {
    const list = byPart.get(pi)!;
    const tln = list.filter((s) => s.ref.type === 'TLN' && s.ref.num !== null && s.dapSo);
    if (!tln.length) continue;
    const header = list[0].ref.partHeader;
    if (header) answerBlock.push(stripPartDecor(header), '');
    // parseTLNTables đọc hàng "Câu" và hàng "Đáp án" NẰM SÁT NHAU — chèn dòng phân
    // cách markdown vào giữa là nó không ghép được cặp nữa. Khối này bị tiêu thụ hết
    // trong lúc tái cấu trúc nên không cần đúng cú pháp bảng để hiển thị.
    answerBlock.push(
      '| Câu | ' + tln.map((s) => String(s.ref.num)).join(' | ') + ' |',
      '| Đáp án | ' + tln.map((s) => s.dapSo).join(' | ') + ' |',
      '',
    );
  }

  // ── Lời giải theo từng phần ──
  const solutionBlock: string[] = [];
  for (const pi of partOrder) {
    const list = byPart.get(pi)!;
    const header = list[0].ref.partHeader;
    if (header) solutionBlock.push(stripPartDecor(header), '');
    for (const s of list) {
      solutionBlock.push(...renderOneSolution(s), '');
    }
  }

  const pieces: string[] = [];
  if (answerBlock.length) pieces.push('## ĐÁP ÁN', '', ...answerBlock);
  pieces.push('## HƯỚNG DẪN GIẢI', '', ...solutionBlock);
  return pieces.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
