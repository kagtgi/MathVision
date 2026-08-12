/**
 * Kiểm định MMD trước khi sinh docx.
 *
 * Port tools/qc_mmd.js (8 nhóm kiểm tra) + tools/scan_escapes.js (escape ngoài math —
 * lỗi dễ bỏ sót nhất: mọi script chỉ soi dấu `$` đều lọt). Dùng ĐÚNG segmentLine của
 * mmd2docx nên kết quả khớp với thứ thật sự hiện ra trong Word.
 */

import { segmentLine } from './mmdSegment.ts';

export type QcSeverity = 'error' | 'warn' | 'info';

export interface QcIssue {
  severity: QcSeverity;
  message: string;
  /** 1-indexed; không có khi lỗi ở phạm vi cả file. */
  line?: number;
}

export interface QcOptions {
  /** Id hình có thật trong figureMap (không có `#`). Bỏ trống = không kiểm tra ảnh. */
  figureIds?: Set<string>;
  /** Số câu solver đánh dấu là "2 lượt lệch nhau". */
  disagreements?: string[];
  /**
   * Câu mà `figurePolicy` nói BẮT BUỘC có hình nhưng cuối cùng không có (đã kèm số câu và lý do).
   *
   * Vì sao là một quy tắc riêng: mọi quy tắc ảnh khác ở đây kiểm ảnh **treo id** (có dòng
   * `![](#x)` mà không có dữ liệu). Không có quy tắc nào kiểm ảnh **THIẾU** — mà lời giải hình
   * học không có hình thì trông y như lời giải không cần hình.
   */
  figureMisses?: string[];
}

const VN_DIACRITICS =
  /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;

const ESC_OUTSIDE_MATH = /\\([%&#_{}$~^])/g;

export function qcMmd(raw: string, opts: QcOptions = {}): QcIssue[] {
  const issues: QcIssue[] = [];
  const add = (severity: QcSeverity, message: string, line?: number) =>
    issues.push({ severity, message, line });

  const lines = raw.split('\n');

  // 1. Dấu $ phải cân bằng trên toàn file VÀ trên từng dòng
  const total = (raw.match(/(?<!\\)\$/g) || []).length;
  if (total % 2 !== 0) add('error', `Tổng dấu $ lẻ (${total}) — có công thức chưa đóng`);
  lines.forEach((ln, i) => {
    const n = (ln.match(/(?<!\\)\$/g) || []).length;
    if (n % 2 !== 0) add('error', 'Dấu $ lẻ — công thức bắc cầu qua dòng', i + 1);
  });

  // 2. Cấu trúc MathType không nuốt được
  lines.forEach((ln, i) => {
    if (/\$\$/.test(ln)) add('error', 'Còn khối $$ — MathType không nhận', i + 1);
    if (/\\\[|\\\]/.test(ln)) add('error', 'Còn \\[ \\] — phải đưa về $...$', i + 1);
    if (/\\begin\{(aligned|align|cases|tabular|itemize|enumerate)\}/.test(ln)) {
      add('error', 'Còn môi trường khối \\begin{...}', i + 1);
    }
    if (/\\(color|newcommand|def)\b/.test(ln)) {
      add('error', 'Macro MathType không hỗ trợ (\\color/\\newcommand/\\def)', i + 1);
    }
    if (/!\[[^\]]*\]\(https?:/i.test(ln)) add('error', 'Còn ảnh remote (cdn)', i + 1);
    if (/<(img|br|div)\b/i.test(ln)) add('error', 'Còn thẻ HTML', i + 1);
  });

  // \begin{array} inline trong $...$ thì Toggle TeX nuốt tốt; chỉ báo khi nằm ngoài math.
  for (const m of raw.matchAll(/\\begin\{array\}/g)) {
    const before = raw.slice(0, m.index);
    const openDollars = (before.match(/(?<!\\)\$/g) || []).length;
    if (openDollars % 2 === 0) {
      add('error', '\\begin{array} nằm ngoài $...$', before.split('\n').length);
      break;
    }
  }

  // Ảnh cục bộ phải có trong figureMap
  if (opts.figureIds) {
    lines.forEach((ln, i) => {
      for (const m of ln.matchAll(/!\[[^\]]*\]\((?!https?:)([^)]+)\)/g)) {
        const id = m[1].replace(/^#/, '');
        if (!opts.figureIds!.has(id)) add('error', `Hình không có dữ liệu: ${m[1]}`, i + 1);
      }
    });
  }

  // 3. Công thức rỗng
  let empties = 0;
  for (const m of raw.matchAll(/\$([^$\n]*)\$/g)) {
    if (m[1].trim() === '') empties++;
  }
  if (empties) add('warn', `${empties} công thức rỗng $ $`);

  // 4. Chữ tiếng Việt lọt vào công thức
  lines.forEach((ln, i) => {
    for (const m of ln.matchAll(/\$([^$\n]+)\$/g)) {
      if (VN_DIACRITICS.test(m[1])) {
        add('warn', `Chữ tiếng Việt trong công thức: ${m[0].slice(0, 40)}`, i + 1);
        break;
      }
    }
  });

  // 5. Bảng markdown: mọi hàng phải cùng số cột
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*\|.*\|\s*$/.test(lines[i])) continue;
    if (
      !(
        i + 1 < lines.length &&
        /^\s*\|?[\s:\-|]+\|?\s*$/.test(lines[i + 1]) &&
        lines[i + 1].includes('-')
      )
    ) {
      continue;
    }
    const width = (l: string) => (l.match(/(?<!\\)\|/g) || []).length;
    const w0 = width(lines[i]);
    let j = i + 2;
    while (j < lines.length && /^\s*\|.*\|\s*$/.test(lines[j])) {
      if (width(lines[j]) !== w0) {
        add('error', `Bảng lệch số cột (${width(lines[j])} vs ${w0})`, j + 1);
        break;
      }
      j++;
    }
    i = j;
  }

  // 6/7. Phần đáp án chi tiết
  const hasAns = /#\s*ĐÁP ÁN CHI TIẾT/.test(raw);
  if (!hasAns) add('warn', 'Chưa có phần ĐÁP ÁN CHI TIẾT');

  const body = hasAns ? raw.split(/#\s*ĐÁP ÁN CHI TIẾT/)[0] : raw;
  const ansPart = hasAns ? raw.slice(body.length) : '';
  const qNums = new Set([...body.matchAll(/(?:^|\n)\**Câu\s+(\d+)/g)].map((m) => m[1]));
  const aNums = new Set([...ansPart.matchAll(/(?:^|\n)(?:__)?\**Câu\s+(\d+)/g)].map((m) => m[1]));
  const missing = [...qNums].filter((q) => !aNums.has(q));
  if (hasAns && missing.length) {
    add('error', `Câu chưa có trong đáp án chi tiết: ${missing.join(', ')}`);
  }
  const loigiai = (ansPart.match(/(?:^|\n)\s*\*{0,2}Lời giải\*{0,2}\s*(?:\n|$)/g) || []).length;
  const qInDetail = (ansPart.match(/(?:^|\n)\**Câu\s+\d+/g) || []).length;
  if (hasAns && loigiai < qInDetail) {
    add('error', `Thiếu dòng "Lời giải": ${loigiai}/${qInDetail}`);
  }

  // 8. Câu không giải được — cố ý, chỉ nhắc (BUGS.md E1-E5: đề trường in sai có thật)
  const unknown = (ansPart.match(/Chọn\s+\*{0,2}\?/g) || []).length;
  if (unknown) add('warn', `${unknown} câu chưa chốt đáp án (Chọn ?) — cần đối chiếu đề`);

  // 9. Escape LaTeX ngoài math (scan_escapes.js)
  lines.forEach((ln, i) => {
    for (const seg of segmentLine(ln)) {
      if (seg.math) continue;
      for (const m of seg.text.matchAll(ESC_OUTSIDE_MATH)) {
        add('error', `Escape LaTeX ngoài công thức: ${m[0]} — Word sẽ hiện nguyên dấu \\`, i + 1);
      }
    }
  });

  // 10. Số câu trùng trong cùng một phần — hợp lệ (đề in trùng thật), chỉ cảnh báo
  const seen = new Map<string, number>();
  let curPart = 'PHẦN ?';
  lines.forEach((ln, i) => {
    const t = ln.trim();
    if (/^PHẦN\b/i.test(t) || /^#\s*ĐÁP ÁN CHI TIẾT/.test(t)) {
      curPart = t.slice(0, 40);
      seen.clear();
      return;
    }
    const m = t.match(/^\**Câu\s+(\d+)\s*[.:]/);
    if (!m) return;
    const key = `${curPart}|${m[1]}`;
    const prev = seen.get(key);
    if (prev !== undefined) {
      add('warn', `Câu ${m[1]} xuất hiện lần thứ hai trong "${curPart}" (dòng ${prev})`, i + 1);
    } else {
      seen.set(key, i + 1);
    }
  });

  // 11. Câu solver không chắc
  for (const q of opts.disagreements ?? []) {
    add('warn', `${q}: hai lượt giải cho kết quả khác nhau — cần kiểm tra`);
  }

  // 12. Lời giải thiếu hình minh hoạ mà chính sách nói bắt buộc phải có
  for (const m of opts.figureMisses ?? []) add('warn', m);

  return issues;
}

export function countBySeverity(issues: QcIssue[]): Record<QcSeverity, number> {
  const out: Record<QcSeverity, number> = { error: 0, warn: 0, info: 0 };
  for (const i of issues) out[i.severity]++;
  return out;
}
