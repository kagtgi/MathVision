/**
 * Lớp sửa tất định các kiểu lệch chuẩn MMD mà mô hình OCR hay mắc.
 *
 * Chạy NGAY sau OCR, TRƯỚC normalize.ts. Chỉ sửa những gì chắc chắn đúng; những thứ
 * mơ hồ (tiếng Việt trong math, thập phân dấu chấm, số câu trùng) để QC cảnh báo cho
 * người dùng tự quyết — không "sửa" ngầm.
 *
 * Mọi rule phải IDEMPOTENT: chạy lại trên output của chính nó không được đổi gì
 * (harness golden kiểm điều này trên 25 đề đã ở trạng thái cuối).
 */

import { segmentLine } from './mmdSegment.ts';

export interface ConformNote {
  rule: string;
  count: number;
}

/** Bóc code fence bọc ngoài cùng cả reply (```markdown ... ```). */
export function stripOuterFence(text: string): string {
  const t = text.trim();
  const m = t.match(/^```[a-zA-Z]*\s*\n([\s\S]*?)\n?```$/);
  return m ? m[1] : text;
}

/** `\(...\)` và `\[...\]` -> `$...$`. mmd_normalize KHÔNG hiểu 2 dạng này nên phải sửa trước. */
function latexDelimsToDollar(line: string): string {
  let s = line;
  s = s.replace(/\\\(\s*([\s\S]*?)\s*\\\)/g, (_m, inner: string) => `$${inner}$`);
  s = s.replace(/\\\[\s*([\s\S]*?)\s*\\\]/g, (_m, inner: string) => `$${inner}$`);
  return s;
}

/**
 * `$$x$$` nằm GIỮA dòng (có chữ trước/sau) -> `$x$`.
 * Khối `$$` đứng riêng để handleDisplayBlocks của normalize lo — nó còn biết tách
 * bảng dữ liệu ra khỏi math.
 */
function inlineDisplayToInline(line: string): string {
  if (!line.includes('$$')) return line;
  const standalone = /^\s*\$\$[\s\S]*\$\$\s*$/.test(line) || /^\s*\$\$\s*$/.test(line.trim());
  if (standalone) return line;
  return line.replace(/\$\$([^$\n]+)\$\$/g, (_m, inner: string) => `$${inner}$`);
}

/**
 * Môi trường xếp dòng -> `\begin{array}`, dạng duy nhất MathType nuốt được.
 *
 * Căn cứ: trong 25 đề đã kiểm tay chỉ có `\begin{array}` (38 chỗ, luôn nằm trong
 * `$...$` và luôn kèm `\left\{` hoặc `\left[`); `cases`, `aligned`, `align` không xuất
 * hiện lần nào. Model rất hay viết `\begin{cases}` cho hệ phương trình, nên đây là
 * phép sửa tất định thay vì bắt người dùng tự chữa.
 *
 *   `\begin{cases}a \\ b\end{cases}`   -> `\left\{\begin{array}{l}a \\ b\end{array}\right.`
 *   `\begin{aligned}x &= 1\end{aligned}` -> `\begin{array}{l}x = 1\end{array}`
 *
 * `tabular` KHÔNG đụng tới: mmd2docx dựng nó thành bảng Word thật. `itemize`/`enumerate`
 * cũng để nguyên cho QC báo, vì hạ chúng thành array là sai nghĩa.
 */
function envToArray(text: string): { text: string; hits: number } {
  let hits = 0;
  // Bỏ mốc căn `&`, gom khoảng trắng, giữ nguyên `\\` ngăn dòng.
  const rows = (inner: string) => inner.replace(/&/g, ' ').replace(/\s+/g, ' ').trim();

  let s = text.replace(/\\begin\{cases\}([\s\S]*?)\\end\{cases\}/g, (_m, inner: string) => {
    hits++;
    return `\\left\\{\\begin{array}{l}${rows(inner)}\\end{array}\\right.`;
  });

  s = s.replace(
    /\\begin\{(aligned|align\*?|gathered)\}([\s\S]*?)\\end\{\1\}/g,
    (_m, _env: string, inner: string) => {
      hits++;
      return `\\begin{array}{l}${rows(inner)}\\end{array}`;
    },
  );

  return { text: s, hits };
}

/** Heading markdown trước tiêu đề PHẦN / trước "Câu N." -> dòng thường. */
function unheadPartAndQuestion(line: string): string {
  const m = line.match(/^\s*#{1,6}\s+(.*)$/);
  if (!m) return line;
  const rest = m[1].trim();
  if (/^\**(?:PHẦN|Phần)\b/.test(rest) || /^\**Câu\s+\d+\s*[.:]/.test(rest)) return rest;
  return line;
}

/**
 * Mọi biến thể tiêu đề section -> đúng `## ĐÁP ÁN` / `## HƯỚNG DẪN GIẢI`
 * (dạng mà restructureAnswers tìm). Phải khớp TRỌN dòng và đúng chữ hoa: câu văn
 * trong lời giải hay mở đầu bằng "Đáp án 0,98. Giá trị còn lại là..." — biến nó
 * thành heading sẽ nuốt mất cả câu.
 */
const SECTION_HEAD = /^(ĐÁP ÁN|HƯỚNG DẪN GIẢI)((?:\s*[-–—]\s*ĐỀ\s*\d+)?)\s*:?$/;
function canonicalSectionHeads(line: string): string {
  const t = line.trim().replace(/^#{1,6}\s*/, '').replace(/^\*\*|\*\*$/g, '').trim();
  return SECTION_HEAD.test(t) ? '## ' + t.replace(/\s*:$/, '') : line;
}

/** Bỏ bullet markdown đứng trước phương án. KHÔNG đụng `**A.**` / `__A.__`. */
function stripOptionBullet(line: string): string {
  return line.replace(/^(\s*)[-+*]\s+(?=(?:\*\*|__)?[A-D](?:\*\*|__)?\s*[.)]\s)/, '$1');
}

/**
 * `Câu 1)` -> `Câu 1.` — dấu `)` không nằm trong CAU_RE/QUES_LINE nên cả dòng sẽ bị
 * coi là văn bản thường. `Câu 1:` là hợp lệ (đề gốc dùng thật) nên giữ nguyên, và số
 * câu in sao giữ vậy (BUGS.md B8).
 */
function normalizeQuestionMarker(line: string): string {
  return line.replace(/^(\s*)(\*{0,2})(Câu\s+\d+)\s*\)/, '$1$2$3.');
}

/**
 * Bốn phương án dồn một dòng -> tách bốn dòng.
 * Chỉ cắt ở đoạn NGOÀI math (dùng segmentLine) và chỉ khi chữ cái lên đúng thứ tự
 * A→B→C→D với ít nhất 3 mốc — đủ chặt để không cắt nhầm câu văn.
 */
function splitMergedOptions(line: string): string[] | null {
  if (!/^\s*(?:\*\*|__)?[A-D](?:\*\*|__)?\s*[.)]\s/.test(line)) return null;

  const marks: Array<{ pos: number; letter: string }> = [];
  let offset = 0;
  for (const seg of segmentLine(line)) {
    if (!seg.math) {
      const re = /(^|\s)((?:\*\*|__)?)([A-D])((?:\*\*|__)?)\s*[.)]\s/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(seg.text)) !== null) {
        marks.push({ pos: offset + m.index + m[1].length, letter: m[3] });
      }
    }
    offset += seg.text.length;
  }

  const wanted = ['A', 'B', 'C', 'D'];
  const ordered: Array<{ pos: number; letter: string }> = [];
  let want = 0;
  for (const mk of marks) {
    if (want < wanted.length && mk.letter === wanted[want]) {
      ordered.push(mk);
      want++;
    }
  }
  if (ordered.length < 3 || ordered[0].pos !== line.length - line.trimStart().length) return null;

  const out: string[] = [];
  for (let k = 0; k < ordered.length; k++) {
    const from = ordered[k].pos;
    const to = k + 1 < ordered.length ? ordered[k + 1].pos : line.length;
    const piece = line.slice(from, to).trim();
    if (piece) out.push(piece);
  }
  return out.length >= 3 ? out : null;
}

const isPipe = (l: string): boolean => /^\s*\|.*\|\s*$/.test(l);
const isSepRow = (l: string): boolean => /^\s*\|?[\s:\-|]+\|?\s*$/.test(l) && l.includes('-');
const pipeWidth = (l: string): number => (l.match(/(?<!\\)\|/g) || []).length;

/**
 * Bảng thiếu dòng phân cách -> chèn `| :--- |`.
 * mmd2docx chỉ coi là bảng khi dòng thứ hai là separator; thiếu nó thì cả bảng rơi
 * xuống thành văn bản thường.
 */
function insertMissingTableSeparators(lines: string[], notes: Map<string, number>): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!isPipe(lines[i])) {
      out.push(lines[i]);
      i++;
      continue;
    }
    // Gom trọn một khối pipe liên tiếp, chỉ xét dòng thứ hai của KHỐI.
    let j = i;
    while (j < lines.length && isPipe(lines[j])) j++;
    const block = lines.slice(i, j);
    if (block.length >= 2 && !isSepRow(block[0]) && !isSepRow(block[1])) {
      const cols = Math.max(1, pipeWidth(block[0]) - 1);
      block.splice(1, 0, '| ' + Array(cols).fill(':---').join(' | ') + ' |');
      notes.set('table-separator', (notes.get('table-separator') ?? 0) + 1);
    }
    out.push(...block);
    i = j;
  }
  return out;
}

/**
 * Đưa MMD thô của mô hình về đúng chuẩn mà pipeline đã kiểm chứng mong đợi.
 */
export interface ConformOptions {
  /**
   * Chèn dòng `| :--- |` cho bảng thiếu phân cách. Bật cho văn bản OCR, TẮT cho khối
   * lời giải do solver sinh: bảng `## ĐÁP ÁN` ở đó buộc phải có hàng "Câu" và hàng
   * "Đáp án" NẰM SÁT NHAU, vì parseTLNTables đọc theo cặp hàng liền kề. Chèn phân cách
   * vào giữa là mất sạch dòng "Đáp số:" của mọi câu trả lời ngắn.
   */
  insertTableSeparators?: boolean;
}

export function conformMmd(
  raw: string,
  options: ConformOptions = {},
): { mmd: string; notes: ConformNote[] } {
  const { insertTableSeparators = true } = options;
  const counts = new Map<string, number>();
  const bump = (k: string) => counts.set(k, (counts.get(k) ?? 0) + 1);

  let text = stripOuterFence(raw).replace(/\r\n/g, '\n');

  // Chạy trên cả khối văn bản vì môi trường có thể trải nhiều dòng.
  const env = envToArray(text);
  if (env.hits) counts.set('env-to-array', env.hits);
  text = env.text;

  const outLines: string[] = [];
  for (const original of text.split('\n')) {
    let line = original;

    const afterDelims = latexDelimsToDollar(line);
    if (afterDelims !== line) bump('latex-delims');
    line = afterDelims;

    const afterDisplay = inlineDisplayToInline(line);
    if (afterDisplay !== line) bump('inline-display-math');
    line = afterDisplay;

    const afterHead = unheadPartAndQuestion(line);
    if (afterHead !== line) bump('unhead');
    line = afterHead;

    const afterSection = canonicalSectionHeads(line);
    if (afterSection !== line) bump('section-head');
    line = afterSection;

    const afterBullet = stripOptionBullet(line);
    if (afterBullet !== line) bump('option-bullet');
    line = afterBullet;

    const afterMarker = normalizeQuestionMarker(line);
    if (afterMarker !== line) bump('question-marker');
    line = afterMarker;

    const split = splitMergedOptions(line);
    if (split) {
      bump('merged-options');
      outLines.push(...split);
      continue;
    }

    outLines.push(line);
  }

  const withTables = insertTableSeparators
    ? insertMissingTableSeparators(outLines, counts)
    : outLines;

  const mmd = withTables.join('\n').replace(/\n{3,}/g, '\n\n');
  const notes: ConformNote[] = [...counts.entries()].map(([rule, count]) => ({ rule, count }));
  return { mmd, notes };
}
