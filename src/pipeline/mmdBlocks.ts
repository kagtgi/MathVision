/**
 * Quét MMD thành các khối có ý nghĩa, để mỗi định dạng Word tự lo phần trình bày.
 *
 * Trước đây việc quét nằm chung với việc dựng docx chuẩn K11. Khi thêm định dạng VDC,
 * hai format khác nhau ở cách TRÌNH BÀY (font, màu, thụt lề, cách đánh dấu đáp án đúng)
 * nhưng giống hệt nhau ở cách ĐỌC MMD, nên phần đọc được tách ra đây.
 *
 * Thứ tự nhận dạng giữ nguyên như tools/mmd2docx.js — đổi thứ tự là sai kết quả, ví dụ
 * dòng phương án phải xét trước dòng thường, và bảng phải xét trước ảnh.
 */

import { isPipeRow, isSeparatorRow, splitRow } from './mmdSegment.ts';

export interface OptionItem {
  letter: string;
  body: string;
  /** Đáp án đúng, đánh dấu `__C.__` trong MMD. */
  correct: boolean;
}

export type MmdBlock =
  /** Dòng nằm trong khối `$$` — nhả nguyên văn, không diễn giải. */
  | { kind: 'raw'; line: string }
  | { kind: 'table'; rows: string[][]; headerBold: boolean }
  /** `line` để dựng lại thành text khi không tìm được ảnh — bản gốc rơi về dòng thường. */
  | { kind: 'image'; ref: string; line: string }
  | { kind: 'heading'; level: number; text: string; isPhan: boolean; isDapAn: boolean }
  | { kind: 'phan'; text: string; afterSolution: boolean }
  | { kind: 'loiGiai' }
  | { kind: 'chon'; text: string }
  | { kind: 'dapSo'; text: string; value: string }
  | { kind: 'options'; opts: OptionItem[] }
  /**
   * `num`/`numRaw`/`punct` để dựng numbering thật của Word (xem `cauNumbering.ts`).
   * `prefix` giữ nguyên vì những dãy câu không đánh số được (số trùng, số có 0 đứng đầu)
   * vẫn rơi về in nhãn thành chữ như trước.
   */
  | {
      kind: 'cau';
      prefix: string;
      num: number | null;
      numRaw: string;
      punct: '.' | ':' | '';
      rest: string;
      afterSolution: boolean;
    }
  /**
   * Ý đúng/sai trong phần lời giải: `a) **Đúng**. giải thích`.
   * `line`/`inSolution` để K11 dựng y như dòng thường (định dạng VDC mới tách riêng
   * dòng phán quyết ra khỏi phần giải thích).
   */
  | { kind: 'verdict'; label: string; dung: boolean; explain: string; line: string; inSolution: boolean }
  | { kind: 'text'; line: string; inSolution: boolean };

/** Nhóm: 1 = nhãn đầy đủ, 2 = chữ số thô (giữ cả `0` đứng đầu), 3 = dấu, 4 = phần còn lại. */
export const CAU_RE = /^\s*\*{0,2}(Câu\s+(\d+)\s*([.:]?))\*{0,2}\s*(.*)$/;
export const OPT_RE = /^\s*(?:\*\*|__)?([A-D])\s*[.)](?:\*\*|__)?\s+(.*)$/;
export const OPT_UNDER_RE = /^\s*__([A-D])\s*[.)]__\s/;
export const PHAN_RE =
  /^\s*\*{0,2}((?:[IVX\d]+\s*\.\s*)?(?:PHẦN|Phần)\b[^*\n]*?|[IVX]+\s*\.\s*Câu hỏi[^*\n]*?)\*{0,2}\s*$/;
const VERDICT_RE = /^\s*([a-d])\)\s*\*\*(Đúng|Sai)\*\*\.?\s*(.*)$/;

export function parseMmdBlocks(mmd: string): MmdBlock[] {
  const lines = mmd.replace(/^﻿/, '').replace(/\r\n/g, '\n').split('\n');
  const out: MmdBlock[] = [];
  let i = 0;
  let inDisplayMath = false;
  let inSolution = false;

  while (i < lines.length) {
    const line = lines[i];

    if (inDisplayMath) {
      out.push({ kind: 'raw', line });
      if (line.includes('$$')) inDisplayMath = false;
      i++;
      continue;
    }
    if ((line.match(/\$\$/g) || []).length % 2 === 1) {
      out.push({ kind: 'raw', line });
      inDisplayMath = true;
      i++;
      continue;
    }

    // \begin{tabular} ... \end{tabular}
    if (/\\begin\{tabular\}/.test(line)) {
      let block = '';
      while (i < lines.length) {
        block += lines[i] + '\n';
        if (/\\end\{tabular\}/.test(lines[i])) {
          i++;
          break;
        }
        i++;
      }
      const body = block
        .replace(/\\begin\{tabular\}\s*(\{[^}]*\})?/, '')
        .replace(/\\end\{tabular\}/, '')
        .replace(/\\hline/g, '')
        .trim();
      const rows = body
        .split(/\\\\/)
        .map((r) => r.trim())
        .filter(Boolean)
        .map((r) => r.split('&').map((c) => c.trim()));
      if (rows.length) out.push({ kind: 'table', rows, headerBold: false });
      continue;
    }

    // Bảng pipe: phải có dòng phân cách ngay dưới dòng đầu.
    if (isPipeRow(line) && i + 1 < lines.length && isPipeRow(lines[i + 1]) && isSeparatorRow(lines[i + 1])) {
      const rows = [splitRow(line)];
      i += 2;
      while (i < lines.length && isPipeRow(lines[i])) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      out.push({ kind: 'table', rows, headerBold: true });
      continue;
    }

    const img = line.match(/^\s*!\[[^\]]*\]\(([^)]+)\)\s*$/);
    if (img && !/^https?:/i.test(img[1])) {
      out.push({ kind: 'image', ref: img[1], line });
      i++;
      continue;
    }

    // Dòng trống markdown không sinh đoạn Word rỗng — spacing đã lo khoảng cách.
    if (line.trim() === '') {
      i++;
      continue;
    }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const text = h[2].trim();
      const isDapAn = /^ĐÁP ÁN CHI TIẾT/.test(text);
      out.push({
        kind: 'heading',
        level: h[1].length,
        text,
        isPhan: /^(PHẦN|Phần)/.test(text) || isDapAn,
        isDapAn,
      });
      i++;
      continue;
    }

    const phan = line.match(PHAN_RE);
    if (phan) {
      out.push({ kind: 'phan', text: phan[1].trim(), afterSolution: inSolution });
      inSolution = false;
      i++;
      continue;
    }

    if (/^\s*\*{0,2}Lời giải\*{0,2}\s*$/.test(line)) {
      out.push({ kind: 'loiGiai' });
      inSolution = true;
      i++;
      continue;
    }

    const chon = line.match(/^\s*(Chọn\s+[A-D?]\.?)\s*$/);
    if (chon) {
      out.push({ kind: 'chon', text: chon[1] });
      i++;
      continue;
    }
    const dapSo = line.match(/^\s*(Đáp số\s*:\s*(.*?))\s*$/);
    if (dapSo) {
      out.push({ kind: 'dapSo', text: dapSo[1], value: dapSo[2].trim() });
      i++;
      continue;
    }

    const verdict = line.match(VERDICT_RE);
    if (verdict) {
      out.push({
        kind: 'verdict',
        label: verdict[1],
        dung: verdict[2] === 'Đúng',
        explain: verdict[3].trim(),
        line,
        inSolution,
      });
      i++;
      continue;
    }

    // Gộp các dòng phương án liên tiếp, tối đa 4.
    if (OPT_RE.test(line)) {
      const opts: OptionItem[] = [];
      while (i < lines.length && OPT_RE.test(lines[i]) && opts.length < 4) {
        const m = lines[i].match(OPT_RE)!;
        opts.push({ letter: m[1], body: m[2].trim(), correct: OPT_UNDER_RE.test(lines[i]) });
        i++;
      }
      out.push({ kind: 'options', opts });
      continue;
    }

    const cau = line.match(CAU_RE);
    if (cau) {
      out.push({
        kind: 'cau',
        prefix: cau[1].replace(/\s+/g, ' '),
        num: Number.parseInt(cau[2], 10),
        numRaw: cau[2],
        punct: (cau[3] as '.' | ':' | '') ?? '',
        rest: cau[4],
        afterSolution: inSolution,
      });
      inSolution = false;
      i++;
      continue;
    }

    out.push({ kind: 'text', line, inSolution });
    i++;
  }

  return out;
}

/**
 * Số phương án trên một dòng, theo độ dài phương án dài nhất.
 * Ngưỡng 52/22 đo từ file mẫu K11 — giữ nguyên cho cả hai định dạng.
 */
export function optionsPerLine(opts: OptionItem[]): number {
  const est = (o: OptionItem) => o.body.replace(/\\[a-zA-Z]+/g, 'xx').replace(/[${}^_]/g, '').length;
  const maxLen = Math.max(...opts.map(est));
  if (maxLen > 52) return 1;
  if (maxLen > 22) return 2;
  return 4;
}
