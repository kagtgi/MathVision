/**
 * Các phép biến đổi đặc thù đề thi.
 *
 * Port nguyên văn từ:
 *   tools/strip_answer_sheets.js  -> stripAnswerSheets
 *   tools/strip_worksheet.js      -> stripWorksheet
 *   tools/restructure_answers.js  -> restructureAnswers (+ splitParts/splitQuestions dùng lại cho solver)
 *   tools/finalize_headings.js    -> finalizeHeadings
 *   tools/clean_notes.js          -> cleanNotes
 *
 * KHÔNG port tools/standardize_parts.js — file đó thiếu hàm partKey và luôn ném lỗi.
 */

// ─────────────────────────────────────────────────────────────────────────────
// strip_answer_sheets.js
// ─────────────────────────────────────────────────────────────────────────────

/** Xoá phiếu tô trắc nghiệm (○○○○), hàng bảng phiếu, dòng kẻ trống ____. */
export function stripAnswerSheets(raw: string): string {
  const lines = raw.split('\n');
  const keep: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/[○◯]{2,}/.test(l) || /A\s*O\s*B\s*O\s*C\s*O\s*D\s*O/i.test(l)) continue;
    if (/^\s*\|\s*(Name|Lớp\s*\|\s*STT|ABCD)\b/i.test(l)) continue;
    if (/^_{3,}\s*$/.test(l.trim())) continue;
    keep.push(l);
  }
  let out = keep.join('\n').replace(/\n{3,}/g, '\n\n');
  out = out.replace(/\n(?:II\.|2\.)\s*Phần tự luận\s*\n(?=\n*#|\n*$)/g, '\n');
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// strip_worksheet.js
// ─────────────────────────────────────────────────────────────────────────────

const isRow = (l: string): boolean => /^\s*\|.*\|\s*$/.test(l);
const isSep = (l: string): boolean => /^\s*\|?[\s:\-|]+\|?\s*$/.test(l) && l.includes('-');
const cellsOf = (l: string): string[] => l.split('|').slice(1, -1).map((c) => c.trim());

/** Xoá mảnh "giấy làm bài": ---HẾT---, nhãn Bài làm, bảng rỗng để học sinh viết. */
export function stripWorksheet(raw: string): string {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const drop = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();

    if (
      /^-{2,}\s*HẾT\s*-{2,}$/i.test(t) ||
      /^HẾT$/i.test(t) ||
      /^GIẢI TỰ LUẬN\b/i.test(t) ||
      /^Phần ghi lời giải/i.test(t) ||
      /^(TRẢ LỜI TỰ LUẬN|Bài làm)\s*:?$/i.test(t)
    ) {
      drop.add(i);
      continue;
    }

    if (isRow(lines[i])) {
      let j = i;
      const rows: number[] = [];
      while (j < lines.length && isRow(lines[j])) {
        rows.push(j);
        j++;
      }
      const dataRows = rows.filter((r) => !isSep(lines[r]));
      const allEmpty =
        dataRows.length > 0 && dataRows.every((r) => cellsOf(lines[r]).every((c) => c === ''));
      if (allEmpty) rows.forEach((r) => drop.add(r));
      i = j - 1;
    }
  }

  if (!drop.size) return raw;
  return lines
    .filter((_, i) => !drop.has(i))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '');
}

// ─────────────────────────────────────────────────────────────────────────────
// restructure_answers.js
// ─────────────────────────────────────────────────────────────────────────────

/** Nhận diện dòng "PHẦN ..." (đủ biến thể gặp trong 25 file golden). */
export const PART_LINE =
  /^(?:#{1,3}\s*)?(?:\*\*)?\s*(?:(?:[IVX]+|\d+)\s*\.\s*)?(?:PHẦN|Phần)\b[^\n]*?(?:\*\*)?\s*$|^(?:#{1,3}\s*)?(?:\*\*)?\s*(?:[IVX]+|\d+)\s*\.\s*(?:Câu hỏi|Phần)[^\n]*?(?:\*\*)?\s*$/;
export const QUES_LINE = /^\*{0,2}Câu\s+(\d+)\s*[.:]/;

export function stripPartDecor(line: string): string {
  return line.replace(/^#{1,3}\s*/, '').replace(/^\*\*|\*\*$/g, '').trim();
}

/** numeral key của part ("PHẦN I."->1, "II. PHẦN TỰ LUẬN"->2, "PHẦN 3."->3). */
export function partKey(header: string): number | null {
  const m = stripPartDecor(header).match(/^(?:PHẦN|Phần)?\s*([IVX]+|\d+)\s*[.:]?/i);
  if (!m) return null;
  const t = m[1].toUpperCase();
  if (/^\d+$/.test(t)) return parseInt(t, 10);
  const ROMAN: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6 };
  return ROMAN[t] || null;
}

export interface MmdPart {
  header: string | null;
  key: number;
  lines: string[];
}

/** Tách một khối text thành [{header, key, lines}] theo dòng PHẦN. */
export function splitParts(text: string): MmdPart[] {
  const parts: MmdPart[] = [{ header: null, key: 0, lines: [] }];
  for (const line of text.split('\n')) {
    if (PART_LINE.test(line.trim()) && line.trim() !== '') {
      parts.push({ header: line, key: partKey(line) ?? parts.length, lines: [] });
    } else {
      parts[parts.length - 1].lines.push(line);
    }
  }
  return parts.filter((p) => p.header !== null || p.lines.join('').trim() !== '');
}

export interface MmdQuestion {
  num: number;
  lines: string[];
}

/** Tách nội dung part thành preamble + [{num, lines}]. */
export function splitQuestions(lines: string[]): { preamble: string[]; questions: MmdQuestion[] } {
  const preamble: string[] = [];
  const questions: MmdQuestion[] = [];
  let cur: MmdQuestion | null = null;
  for (const line of lines) {
    const m = line.match(QUES_LINE);
    if (m) {
      cur = { num: parseInt(m[1], 10), lines: [line] };
      questions.push(cur);
    } else if (cur) {
      cur.lines.push(line);
    } else {
      preamble.push(line);
    }
  }
  return { preamble, questions };
}

const trimBlock = (lines: string[]): string => lines.join('\n').replace(/^\n+|\n+$/g, '');

/** Parse bảng TLN trong phần ĐÁP ÁN cũ: | Câu | 1 | 2 | / | Đáp án | v1 | v2 |. */
export function parseTLNTables(answerText: string): Record<number, Record<number, string>> {
  const map: Record<number, Record<number, string>> = {};
  for (const part of splitParts(answerText)) {
    const rows = part.lines.filter((l) => /^\s*\|.*\|\s*$/.test(l));
    for (let i = 0; i + 1 < rows.length; i++) {
      const head = rows[i]
        .split('|')
        .map((c) => c.trim())
        .filter((c, idx, a) => !(idx === 0 || idx === a.length - 1) || c !== '');
      const val = rows[i + 1] ? rows[i + 1].split('|').map((c) => c.trim()) : null;
      if (!head.length || head[0] !== 'Câu' || !val) continue;
      const vcells = val.filter((c, idx, a) => !(idx === 0 || idx === a.length - 1) || c !== '');
      if (!vcells.length || !/^Đáp án/.test(vcells[0])) continue;
      const bucket = (map[part.key] = map[part.key] || {});
      for (let k = 1; k < head.length && k < vcells.length; k++) {
        const num = parseInt(head[k], 10);
        if (!isNaN(num) && vcells[k]) bucket[num] = vcells[k];
      }
    }
  }
  return map;
}

/** Gạch chân đáp án đúng trong khối đề lặp lại: "C. abc" -> "__C.__ abc". */
export function underlineOption(blockLines: string[], letter: string): string[] {
  return blockLines.map((l) => {
    const m = l.match(new RegExp(`^(\\s*)\\*{0,2}(${letter})\\s*([.)])\\*{0,2}\\s+(.*)$`));
    if (m) return `${m[1]}__${m[2]}${m[3]}__ ${m[4]}`;
    return l;
  });
}

export interface RestructureReport {
  done: number;
  missing: string[];
  mode: string;
  error?: string;
}

function buildDetail(
  examBody: string,
  answerText: string,
  solutionText: string,
  report: RestructureReport,
): string {
  const deParts = splitParts(examBody);
  const solParts = splitParts(solutionText);
  const tlnMap = parseTLNTables(answerText || '');

  const out: string[] = [];
  const deQParts = deParts.map((p) => ({ ...p, ...splitQuestions(p.lines) }));
  const solQParts = solParts.map((p) => ({ ...p, ...splitQuestions(p.lines) }));
  const usableDe = deQParts.filter((p) => p.questions.length || (p.header && p.lines.join('').trim()));
  const deWithQ = deQParts.filter((p) => p.questions.length);
  const solWithQ = solQParts.filter((p) => p.questions.length);

  for (const dp of usableDe) {
    if (!dp.questions.length && !dp.header) continue; // preamble đề (tên trường...) không lặp lại

    // tìm part giải tương ứng: ưu tiên numeral key, fallback theo thứ tự có câu hỏi
    let sp: (typeof solQParts)[number] | null = null;
    if (dp.key != null) {
      sp =
        solQParts.find((p) => p.key === dp.key && (p.questions.length || p.lines.join('').trim())) ??
        null;
    }
    if (!sp && deWithQ.length === solWithQ.length) {
      const idx = deWithQ.indexOf(dp);
      if (idx >= 0) sp = solWithQ[idx];
    }
    if (!sp && solQParts.length === 1) sp = solQParts[0];

    if (dp.header) out.push(stripPartDecor(dp.header), '');

    if (!dp.questions.length) {
      // part tự luận không đánh số: chỉ đưa Lời giải + toàn bộ giải của part đó
      if (sp) {
        out.push('Lời giải', '');
        out.push(trimBlock([...sp.preamble, ...sp.questions.flatMap((q) => q.lines)]), '');
      }
      continue;
    }

    const solMap: Record<number, MmdQuestion> = {};
    if (sp) sp.questions.forEach((q) => { solMap[q.num] = q; });

    for (const q of dp.questions) {
      const sol = solMap[q.num];
      if (!sol) {
        report.missing.push(`part ${dp.key} câu ${q.num}`);
        continue;
      }

      let solText = trimBlock(sol.lines).replace(/^\*{0,2}Câu\s+\d+\s*[.:]\*{0,2}\s*/, '');
      const chon = solText.match(/^Chọn\s+\*{0,2}([A-D?])\*{0,2}\s*\.?\s*/);
      let chonLetter: string | null = null;
      if (chon) {
        chonLetter = chon[1];
        solText = solText.slice(chon[0].length).trim();
      }

      let qLines = q.lines;
      if (chonLetter && /[A-D]/.test(chonLetter)) qLines = underlineOption(qLines, chonLetter);
      out.push(trimBlock(qLines), '', 'Lời giải', '');
      if (chonLetter) out.push(`Chọn ${chonLetter}.`, '');
      else {
        const tln = tlnMap[dp.key] && tlnMap[dp.key][q.num];
        const isDS = /^[a-d]\)\s/m.test(solText) && /(Đúng|Sai)/.test(solText);
        if (tln && !isDS) out.push(`Đáp số: ${tln}`, '');
      }
      if (solText) out.push(solText, '');
      report.done++;
    }
  }
  return out.join('\n');
}

/**
 * [đề + ## ĐÁP ÁN + ## HƯỚNG DẪN GIẢI] -> [đề only + # ĐÁP ÁN CHI TIẾT].
 * Trả out=null nếu không có `## HƯỚNG DẪN GIẢI`.
 */
export function restructureAnswers(raw: string): { out: string | null; report: RestructureReport } {
  const report: RestructureReport = { done: 0, missing: [], mode: 'single' };
  const text = raw.replace(/\r\n/g, '\n');

  const hdgMatches = [...text.matchAll(/(?:^|\n)##\s*HƯỚNG DẪN GIẢI[^\n]*/g)];
  if (!hdgMatches.length) {
    return { out: null, report: { ...report, error: 'không có ## HƯỚNG DẪN GIẢI' } };
  }

  if (hdgMatches.length === 1) {
    const apIdx = text.search(/(?:^|\n)##\s*ĐÁP ÁN\s*(?:\n|$)/);
    const hdgIdx = hdgMatches[0].index as number;
    const body = text.slice(0, apIdx >= 0 ? apIdx : hdgIdx).replace(/\n+$/, '');
    const answerText = apIdx >= 0 ? text.slice(apIdx, hdgIdx) : '';
    const solutionText = text.slice(hdgIdx).replace(/^\n?##\s*HƯỚNG DẪN GIẢI[^\n]*\n?/, '');
    const detail = buildDetail(body, answerText, solutionText, report);
    return {
      out: body + '\n\n# ĐÁP ÁN CHI TIẾT\n\n' + detail.replace(/\n{3,}/g, '\n\n') + '\n',
      report,
    };
  }

  // multi-exam (nhiều mã đề): ## ĐÁP ÁN - ĐỀ i / ## HƯỚNG DẪN GIẢI - ĐỀ i
  report.mode = `multi(${hdgMatches.length})`;
  const firstAp = text.search(/(?:^|\n)##\s*ĐÁP ÁN[^\n]*/);
  const allBody = text.slice(0, firstAp).replace(/\n+$/, '');
  const examHeads = [...allBody.matchAll(/(?:^|\n)##\s+(?!ĐÁP ÁN|HƯỚNG DẪN)[^\n]*/g)];
  const bodies: string[] = [];
  for (let i = 0; i < examHeads.length; i++) {
    const s = examHeads[i].index as number;
    const e = i + 1 < examHeads.length ? (examHeads[i + 1].index as number) : allBody.length;
    bodies.push(allBody.slice(s, e).replace(/^\n+/, ''));
  }
  const tail = text.slice(firstAp);
  const pieces: string[] = [allBody, ''];
  for (let i = 0; i < hdgMatches.length; i++) {
    const apM = tail.match(new RegExp(`(?:^|\\n)##\\s*ĐÁP ÁN[^\\n]*ĐỀ\\s*${i + 1}[^\\n]*`));
    const hdgM = tail.match(new RegExp(`(?:^|\\n)##\\s*HƯỚNG DẪN GIẢI[^\\n]*ĐỀ\\s*${i + 1}[^\\n]*`));
    const nextApM = tail.match(new RegExp(`(?:^|\\n)##\\s*ĐÁP ÁN[^\\n]*ĐỀ\\s*${i + 2}[^\\n]*`));
    if (!hdgM) {
      report.missing.push(`đề ${i + 1}: thiếu HDG`);
      continue;
    }
    const answerText = apM ? tail.slice(apM.index as number, hdgM.index as number) : '';
    const solEnd = nextApM ? (nextApM.index as number) : tail.length;
    const solutionText = tail
      .slice(hdgM.index as number, solEnd)
      .replace(/^\n?##\s*HƯỚNG DẪN GIẢI[^\n]*\n?/, '');
    const detail = buildDetail(bodies[i] || '', answerText, solutionText, report);
    pieces.push(`# ĐÁP ÁN CHI TIẾT - ĐỀ ${i + 1}`, '', detail);
  }
  return { out: pieces.join('\n').replace(/\n{3,}/g, '\n\n') + '\n', report };
}

// ─────────────────────────────────────────────────────────────────────────────
// finalize_headings.js
// ─────────────────────────────────────────────────────────────────────────────

export type PartType = 'TN' | 'DS' | 'TLN' | 'TL';

export const PART_NAMES: Record<PartType, string> = {
  TN: 'CÂU TRẮC NGHIỆM NHIỀU PHƯƠNG ÁN LỰA CHỌN',
  DS: 'CÂU TRẮC NGHIỆM ĐÚNG SAI',
  TLN: 'CÂU TRẮC NGHIỆM TRẢ LỜI NGẮN',
  TL: 'CÂU HỎI TỰ LUẬN',
};
const ROMAN_LIST = ['I', 'II', 'III', 'IV', 'V', 'VI'];

const QUES = /^\**Câu\s+\d+\s*[.:]/;
const DETAIL_HEAD = /^#\s*ĐÁP ÁN CHI TIẾT/;
const EXAM_HEAD = /^##\s+\S/;

/**
 * Dòng này có phải tiêu đề phần không, và thuộc loại nào (nhận cả biến thể OCR).
 *
 * `type: null` = ĐÚNG là tiêu đề phần nhưng tiêu đề KHÔNG nói loại câu. Đề chính thức THPT 2025
 * viết PHẦN III là "Thí sinh trả lời từ câu 1 đến câu 6." — không có chữ nào cho biết đó là trả
 * lời ngắn. Trả `null` để `typeFromBody` quyết định, thay vì bỏ luôn cả tiêu đề như bản trước
 * (khi đó PHẦN III không thành một phần riêng, không được đặt tên chuẩn, và các câu của nó bị
 * suy loại lẻ tẻ theo từng câu).
 */
export function asHeading(line: string): { type: PartType | null } | null {
  const t = line.trim().replace(/^#{1,6}\s*/, '').replace(/^\*\*|\*\*$/g, '').trim();
  if (!t || QUES.test(t)) return null;
  if (t.length > 110) return null;
  const low = t.toLowerCase();
  // `đúng HOẶC sai` (có chữ đệm) là cách viết của đề chính thức THPT 2025 — đo trên đề 2025 mã
  // 0101: bản trước chỉ khớp `đúng-sai` liền nên KHÔNG nhận ra tiêu đề PHẦN II của đề đó.
  const dungSai = /đ[úu]ng\s*(?:hoặc|hay)?\s*[-–—]?\s*sai/i;
  // "Thí sinh trả lời từ câu X đến câu Y" là câu mở đầu của CẢ BA phần trong đề chính thức
  // THPT 2025 — nhận nó làm dấu hiệu tiêu đề, kể cả khi phần còn lại không nói loại câu.
  const thiSinhTraLoi = /thí sinh trả lời\s*(?:từ\s*)?câu/i;
  const looksPart =
    /^(phần|\(?\d\)?\s*[.)-]?\s*|[①-⑥]\s*|[ivx]+\s*[.)]\s*)/i.test(t) &&
    (dungSai.test(low) ||
      thiSinhTraLoi.test(low) ||
      /(trắc nghiệm|trấc nghiệm|tự luận|tu luan|phương án|trả lời ngắn|trả lời ngấn|câu hỏi)/i.test(
        low,
      ));
  if (!looksPart) return null;
  let type: PartType | null = null;
  if (dungSai.test(low)) type = 'DS';
  else if (/trả lời ngắn|trả lời ngấn|tra loi ngan/i.test(low)) type = 'TLN';
  else if (/tự luận|tu luan/i.test(low)) type = 'TL';
  else if (/trắc nghiệm|trấc nghiệm|phương án|lựa chọn/i.test(low)) type = 'TN';
  // Là tiêu đề phần thì luôn trả về, kể cả khi chưa biết loại — `typeFromBody` lo phần còn lại.
  return { type };
}

/**
 * Suy loại phần từ nội dung khi không có tiêu đề.
 *
 * CHỈ chạy khi `asHeading` không nhận ra tiêu đề — phần có tiêu đề chuẩn thì loại lấy từ đó, nên
 * 25 đề golden không đi qua đây.
 */
export function typeFromBody(lines: string[]): PartType {
  const txt = lines.join('\n');
  if ((txt.match(/(?:^|\n)\s*(?:__|\*\*)?[A-D](?:__|\*\*)?\s*[.)]\s/g) || []).length >= 3) return 'TN';
  if (/(?:^|\n)\s*a\)\s/.test(txt) && /(?:^|\n)\s*b\)\s/.test(txt)) return 'DS';
  if (/(?:^|\n)Đáp số\s*:/.test(txt)) return 'TLN';
  // Đề chính thức THPT 2025 ghi tiêu đề PHẦN III là "Thí sinh trả lời từ câu 1 đến câu 6." —
  // KHÔNG có chữ "trả lời ngắn", nên tiêu đề không nói được loại. Đo trên mã đề 0101: cả 6 câu
  // rơi về `TL`, và hệ quả là KHÔNG câu nào có dòng "Đáp số:" trong đáp án.
  // Dấu hiệu còn lại nằm ở chính câu hỏi: dạng trả lời ngắn luôn hỏi ra MỘT SỐ.
  if (/bằng bao nhiêu|là bao nhiêu|làm tròn đến/i.test(txt)) return 'TLN';
  return 'TL';
}

interface LineEntry {
  i: number;
  l: string;
}

function splitExams(lines: string[]): Array<{ start: number; lines: LineEntry[] }> {
  const exams: Array<{ start: number; lines: LineEntry[] }> = [{ start: 0, lines: [] }];
  lines.forEach((l, i) => {
    const t = l.trim();
    if ((EXAM_HEAD.test(t) && !asHeading(l)) || DETAIL_HEAD.test(t)) {
      exams.push({ start: i, lines: [] });
    }
    exams[exams.length - 1].lines.push({ i, l });
  });
  return exams.filter((e) => e.lines.length);
}

interface HeadPart {
  headIdx: number | null;
  type: PartType | null;
  body: string[];
  qIdx: number[];
}

function splitHeadParts(entries: LineEntry[]): HeadPart[] {
  const parts: HeadPart[] = [];
  let cur: HeadPart | null = null;
  for (const { i, l } of entries) {
    const h = asHeading(l);
    if (h) {
      cur = { headIdx: i, type: h.type, body: [], qIdx: [] };
      parts.push(cur);
      continue;
    }
    if (!cur) {
      cur = { headIdx: null, type: null, body: [], qIdx: [] };
      parts.push(cur);
    }
    cur.body.push(l);
    if (QUES.test(l.trim())) cur.qIdx.push(i);
  }
  return parts;
}

/**
 * 1) bỏ phần đầu đề; 2) chuẩn hoá tiêu đề phần về 4 tên chuẩn, số La Mã theo thứ tự
 * thực tế, reset ở mỗi mã đề và mỗi mục ĐÁP ÁN CHI TIẾT; 3) bổ sung tiêu đề còn thiếu
 * theo VỊ TRÍ THỨ TỰ câu (không tìm "Câu 1" — số câu reset ở mỗi phần).
 */
export function finalizeHeadings(rawInput: string): {
  out: string;
  changed: boolean;
  removedHead: number;
  summary: string[];
} {
  const raw = rawInput.replace(/\r\n/g, '\n');
  let lines = raw.split('\n');

  // --- 1. bỏ phần đầu đề ---
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue;
    if (asHeading(lines[i]) || QUES.test(t)) {
      start = i;
      break;
    }
    if (DETAIL_HEAD.test(t)) break;
  }
  const removedHead = start > 0 ? lines.slice(0, start).filter((x) => x.trim()).length : 0;
  if (start > 0) lines = lines.slice(start);

  // --- 2/3. chuẩn hoá + bổ sung tiêu đề, theo từng "đề" ---
  const exams = splitExams(lines);
  const inserts: Array<{ at: number; text: string }> = [];
  const rewrites = new Map<number, string>();
  const summary: string[] = [];

  for (const ex of exams) {
    const isDetail = DETAIL_HEAD.test(ex.lines[0].l.trim());
    const parts = splitHeadParts(ex.lines).filter((pp) => pp.qIdx.length);
    if (!parts.length) continue;
    const hadHeading = parts.some((pp) => pp.headIdx !== null);
    if (!hadHeading) {
      summary.push('(không tiêu đề)');
      continue;
    }

    parts.forEach((pp, k) => {
      if (!pp.type) pp.type = typeFromBody(pp.body);
      const canon = `PHẦN ${ROMAN_LIST[k] || k + 1}. ${PART_NAMES[pp.type]}`;
      if (pp.headIdx !== null) rewrites.set(pp.headIdx, canon);
      else inserts.push({ at: pp.qIdx[0], text: canon });
      if (!isDetail) summary.push(canon.replace('CÂU TRẮC NGHIỆM ', '').replace('CÂU HỎI ', ''));
    });
  }

  for (const [idx, text] of rewrites) lines[idx] = text;
  inserts.sort((a, b) => b.at - a.at).forEach((ins) => lines.splice(ins.at, 0, ins.text, ''));

  const out = lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '');
  return { out, changed: out !== raw, removedHead, summary };
}

// ─────────────────────────────────────────────────────────────────────────────
// clean_notes.js
// ─────────────────────────────────────────────────────────────────────────────

const NOTE_RULES: Array<[RegExp, string]> = [
  [/\s*[—-]?\s*\*{0,2}Đã đối chiếu bản PDF gốc[^*\n]*\*{0,2}\.?/gi, ''],
  [/[;,.]?\s*(?:và\s+)?cần đối chiếu (?:lại\s+)?(?:bản\s+)?(?:PDF|pdf)?\s*gốc[^.\n]*\.?/gi, ''],
  [/[;,.]?\s*cần đối chiếu bản gốc[^.\n]*\.?/gi, ''],
  [/\s*\((?:đã\s+)?khôi phục theo (?:bản\s+)?PDF gốc\)/gi, ''],
  [/\s*\*\([^)\n]*(?:đề gốc|OCR|PDF gốc|in trùng|in nhầm|đề ghi là)[^)\n]*\)\*/gi, ''],
  [/\s*\((?:Lưu ý|lưu ý)[^)\n]*(?:OCR|PDF|đề gốc|đề thiếu)[^)\n]*\)/gi, ''],
  [/\s*[—–]\s*(?:bản\s+)?OCR[^.\n]*\.?/gi, ''],
  [/\s*[—–]\s*(?:dữ liệu|biểu đồ|hình|bảng|đề)[^.\n]*(?:OCR|PDF|bị mất|không có)[^.\n]*\.?/gi, ''],
  [/[;,]?\s*(?:bản\s+)?OCR (?:không có|bị mất|chỉ có|đúng|chính xác)[^.\n]*\.?/gi, ''],
  [/[;,]?\s*(?:nhiều khả năng\s+)?đề (?:gốc\s+)?(?:in|gõ) nhầm[^.\n]*\.?/gi, ''],
  [/[;,]?\s*lỗi (?:nằm ở\s+)?(?:chính\s+)?đề[^.\n]*\.?/gi, ''],
  [/\s*\(gần phương án [A-D] nhất\)/gi, ''],
  [/[;,]?\s*không khớp phương án nào/gi, ''],
];

function cleanBlock(text: string): string {
  let s = text;
  for (const [re, to] of NOTE_RULES) s = s.replace(re, to);
  s = s.replace(/[ \t]{2,}/g, ' ');
  s = s.replace(/(?:^|\n)[ \t]*[;,.—–][ \t]*(?=\n|$)/g, '');
  s = s.replace(/\s+([.;,])/g, '$1');
  s = s.replace(/([.;,]){2,}/g, '$1');
  s = s.replace(/\n{3,}/g, '\n\n');
  s = s.replace(/(?:^|\n)[ \t]*[.\-—–]+[ \t]*(?=\n|$)/g, '');
  return s;
}

/** Gỡ ghi chú meta trong phần ĐÁP ÁN CHI TIẾT (giữ nguyên phần đề). */
export function cleanNotes(raw: string): string {
  const idx = raw.indexOf('# ĐÁP ÁN CHI TIẾT');
  if (idx === -1) return raw;
  return raw.slice(0, idx) + cleanBlock(raw.slice(idx));
}

// ─────────────────────────────────────────────────────────────────────────────
// Orchestrator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bước chuẩn bị TRƯỚC khi tự giải: dọn phiếu tô/giấy làm bài rồi chuẩn hoá tiêu đề
 * phần. Phải có tiêu đề phần trước thì solver mới biết loại câu (trắc nghiệm / đúng
 * sai / trả lời ngắn / tự luận) để chọn khuôn trả lời.
 *
 * Chỉ dùng khi đề CHƯA có lời giải. Đề đã có lời giải thì đi thẳng
 * applyExamTransforms để giữ nguyên thứ tự đã kiểm chứng.
 */
export function prepareExamForSolving(input: string): { mmd: string; parts: string[] } {
  let mmd = stripAnswerSheets(input);
  mmd = stripWorksheet(mmd);
  const fin = finalizeHeadings(mmd);
  return { mmd: fin.out, parts: fin.summary };
}

export interface ExamTransformReport {
  restructure: RestructureReport | null;
  removedHead: number;
  parts: string[];
  skippedRestructure: boolean;
}

/**
 * Chuỗi biến đổi đề thi. Với đề đã có `# ĐÁP ÁN CHI TIẾT` (hoặc chưa có
 * `## HƯỚNG DẪN GIẢI`) thì bỏ qua bước tái cấu trúc — đúng hành vi bản Node.
 *
 * Thứ tự bắt buộc: strip → restructure → finalizeHeadings → cleanNotes.
 * finalizeHeadings phải chạy SAU restructure vì nó chuẩn hoá cả tiêu đề bên trong
 * mục ĐÁP ÁN CHI TIẾT (mục này chỉ tồn tại sau khi tái cấu trúc).
 */
export function applyExamTransforms(input: string): { mmd: string; report: ExamTransformReport } {
  const report: ExamTransformReport = {
    restructure: null,
    removedHead: 0,
    parts: [],
    skippedRestructure: false,
  };

  let mmd = stripAnswerSheets(input);
  mmd = stripWorksheet(mmd);

  if (mmd.includes('# ĐÁP ÁN CHI TIẾT')) {
    report.skippedRestructure = true;
  } else {
    const { out, report: r } = restructureAnswers(mmd);
    report.restructure = r;
    if (out) mmd = out;
    else report.skippedRestructure = true;
  }

  const fin = finalizeHeadings(mmd);
  mmd = fin.out;
  report.removedHead = fin.removedHead;
  report.parts = fin.summary;

  mmd = cleanNotes(mmd);
  return { mmd, report };
}
