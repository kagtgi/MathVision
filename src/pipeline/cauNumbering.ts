/**
 * Đánh số "Câu N." bằng numbering thật của Word thay cho chữ gõ ra.
 *
 * Vì sao cần: nhãn gõ thành TextRun thì không có counter nào, nên copy định dạng một dòng
 * câu (Ctrl+Shift+C) rồi dán sang dòng khác (Ctrl+Shift+V) chẳng ra "Câu 2". Hai file mẫu
 * của người dùng đều làm bằng numbering — nhãn nằm trong `numbering.xml`, vô hình với mọi
 * phép grep trên `document.xml`:
 *   K11-Đề-tặng-kèm-số-1  abstractNumId 0  lvlText "Câu %1."  ind 992/hanging 992  b + 0000FF
 *   65-68_Mitu (VDC)      abstractNumId 1  lvlText "Câu %1."  start 65  + Palatino sz23
 *
 * Mô hình lấy từ file mẫu K11: MỘT numId cho MỖI dãy câu liên tiếp — đề dùng numId 2/13/14
 * (12/4/6 câu theo ba PHẦN), mục đáp án dùng 19/20/21 (đúng 12/4/6 câu ấy lặp lại). Nên ở
 * đây mỗi "run" là một reference riêng với `start` bằng số đầu dãy; docx@9.6.1 phát
 * `<w:startOverride>` cho mỗi concrete num nên mỗi reference là một counter độc lập.
 *
 * Cách chia run này còn tránh phải suy luận "restart theo PHẦN" hay "đánh liên tục qua
 * PHẦN" — cả hai kiểu đều có trong 25 đề golden (11CH1 restart 1-8/1-2/1-4; 11CĐIA liên
 * tục 1-14/15-16/17-19). Lấy `start` = số đầu dãy thì hai kiểu ra cùng một kết quả đúng.
 *
 * Dãy nào KHÔNG đánh số được thì rơi về in nhãn thành chữ như trước — giữ nguyên bản in
 * của trường, không tự ý sửa số:
 *   - số trùng: 11CA1 PHẦN IV có `Câu 1  Câu 2  Câu 2` (đề gốc in sai)
 *   - số có 0 đứng đầu: `Câu 07.` (numFmt decimal chỉ ra được "7")
 *   - dấu không nhất quán trong cùng dãy (bộ golden có 468 dấu `.` và 202 dấu `:`)
 */

import type { MmdBlock } from './mmdBlocks.ts';

export interface CauRun {
  /** Tên reference đưa cho docx (`cau-0`, `cau-1`, …). */
  reference: string;
  /** Số đầu dãy — vào `w:start` của level và `w:startOverride` của concrete num. */
  start: number;
  /** `Câu %1.` / `Câu %1:` / `Câu %1` — dấu lấy theo đúng dãy. */
  text: string;
  /** Số câu trong dãy, để harness đối chiếu. */
  count: number;
}

export interface CauNumberingPlan {
  runs: CauRun[];
  /** Reference cho block thứ `index` trong mảng `parseMmdBlocks`; `null` = in nhãn thành chữ. */
  refOf(index: number): string | null;
  /** Tổng số câu được đánh số tự động. */
  numberedCount: number;
}

export const EMPTY_CAU_PLAN: CauNumberingPlan = {
  runs: [],
  refOf: () => null,
  numberedCount: 0,
};

interface Group {
  indices: number[];
  nums: number[];
  raws: string[];
  puncts: string[];
}

/** Dãy đánh số được: đủ số, tăng đúng +1, không có 0 đứng đầu, dấu nhất quán. */
function numberable(g: Group): boolean {
  if (!g.indices.length) return false;
  if (g.nums.some((n) => !Number.isFinite(n))) return false;
  if (g.raws.some((r) => /^0\d/.test(r))) return false;
  if (g.nums.some((n, i) => n !== g.nums[0] + i)) return false;
  return new Set(g.puncts).size === 1;
}

export interface PlanOptions {
  /**
   * Số câu bắt đầu do người dùng nhập (định dạng VDC). Áp dụng thành ĐỘ LỆCH so với số
   * đầu tiên của tài liệu, nên mọi dãy sau đó dịch theo cùng một lượng: file 4 câu đánh
   * 1-4 trong MMD, nhập 65 thì ra 65-68, và mục đáp án (số nguồn restart về 1) cũng về 65
   * — đúng như file mẫu Mitu.
   */
  startNumber?: number;
}

export function planCauNumbering(blocks: MmdBlock[], opts: PlanOptions = {}): CauNumberingPlan {
  const groups: Group[] = [];
  let cur: Group | null = null;

  const flush = () => {
    if (cur && cur.indices.length) groups.push(cur);
    cur = null;
  };

  blocks.forEach((b, i) => {
    // `heading` bắt cả `## KIỂM TRA…` của đề nhiều mã và `# ĐÁP ÁN CHI TIẾT - ĐỀ n`.
    if (b.kind === 'heading' || b.kind === 'phan') {
      flush();
      return;
    }
    if (b.kind !== 'cau') return;
    if (!cur) cur = { indices: [], nums: [], raws: [], puncts: [] };
    cur.indices.push(i);
    cur.nums.push(b.num ?? Number.NaN);
    cur.raws.push(b.numRaw);
    cur.puncts.push(b.punct);
  });
  flush();

  const firstNum = groups.find((g) => Number.isFinite(g.nums[0]))?.nums[0];
  const offset =
    opts.startNumber !== undefined && firstNum !== undefined ? opts.startNumber - firstNum : 0;

  const runs: CauRun[] = [];
  const byIndex = new Map<number, string>();

  for (const g of groups) {
    if (!numberable(g)) continue;
    const reference = `cau-${runs.length}`;
    runs.push({
      reference,
      start: g.nums[0] + offset,
      text: `Câu %1${g.puncts[0]}`,
      count: g.indices.length,
    });
    for (const idx of g.indices) byIndex.set(idx, reference);
  }

  return {
    runs,
    refOf: (index) => byIndex.get(index) ?? null,
    numberedCount: byIndex.size,
  };
}

/** Định dạng nhãn của một level — đo từ file mẫu, mỗi định dạng truyền vào bộ riêng. */
export interface CauLevelStyle {
  font: string;
  /** Half-point (23 = 11.5pt, 24 = 12pt). */
  size: number;
  color: string;
  /** `ind left`/`hanging` của level; cả hai file mẫu đều dùng 992/992. */
  indent?: { left: number; hanging: number };
}

/**
 * `runs` -> `numbering.config` của docx. Trả `undefined` khi không có dãy nào đánh số được,
 * để `new Document({ numbering: undefined })` giữ y nguyên hành vi cũ.
 */
export function cauNumberingConfig(runs: CauRun[], style: CauLevelStyle) {
  if (!runs.length) return undefined;
  const indent = style.indent ?? { left: 992, hanging: 992 };
  return {
    config: runs.map((r) => ({
      reference: r.reference,
      levels: [
        {
          level: 0,
          format: 'decimal' as const,
          text: r.text,
          alignment: 'left' as const,
          start: r.start,
          style: {
            run: { bold: true, color: style.color, font: style.font, size: style.size },
            paragraph: { indent },
          },
        },
      ],
    })),
  };
}
