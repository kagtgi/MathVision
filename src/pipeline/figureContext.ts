/**
 * Ngữ cảnh ĐỀ BÀI cho từng hình — để model sinh ảnh hiểu hình nói về cái gì, không chỉ nhìn
 * ảnh cắt mờ.
 *
 * VÌ SAO KHÔNG DÙNG `splitForSolving` (nó đã có sẵn `figureIds` cho mỗi câu): nó chạy bên trong
 * `runTextPipeline`, mà chặng đó khởi động **song song** với bước nâng chất hình (xem chú thích
 * ở `PdfToDocxConverter`, bước dựng TikZ cố tình chạy cùng lúc với bước giải đề để không cộng
 * thêm vài phút chờ). Nên tới lúc cần thì nó chưa chạy. Nó cũng cần mốc `Câu N.` nằm CÙNG TRANG,
 * nên hình ở trang sau rơi vào `preamble` rồi bị bỏ.
 *
 * Thuần, không DOM — `scripts/verify-figure-gen.mjs` kiểm.
 */

import { QUES_LINE } from './examTransforms.ts';

/** Đủ để hiểu đề, không nhồi cả trang vào prompt. */
const MAX_CONTEXT_CHARS = 900;
/** Không tìm được mốc `Câu N.` thì lấy cửa sổ quanh dòng ảnh. */
const WINDOW_LINES = 8;
/** Chặn trên: một "câu" ăn hết trang thì cắt bớt. */
const MAX_BLOCK_LINES = 60;

const FIG_REF = /!\[[^\]]*\]\(\s*#([\w-]+)\s*\)/g;
/** Dòng chỉ có một tham chiếu hình — không nói gì cho model, bỏ. */
const FIG_ONLY_LINE = /^\s*!\[[^\]]*\]\(\s*#[\w-]+\s*\)\s*$/;
/** Dòng phương án A/B/C/D. */
const OPTION_LINE = /^\s*(?:\*\*|__)?[A-D]\s*[.)]/;
const SOLUTION_HEAD = /^\s*#{1,3}\s*(?:HƯỚNG DẪN GIẢI|ĐÁP ÁN)/;

export interface FigureContext {
  /** Đoạn đề chứa hình, đã cắt tỉa. */
  text: string;
  /** `cau` = cắt theo mốc câu · `cuaso` = cửa sổ dòng dự phòng. */
  scope: 'cau' | 'cuaso';
  /** Số câu in trên đề, nếu cắt được theo câu. */
  num: number | null;
}

/**
 * Bỏ những dòng chỉ làm model bịa thêm.
 *
 * **Bỏ dòng phương án A/B/C/D là phòng tuyến rẻ nhất chống bịa số**: phương án nhiễu mang đúng
 * loại con số mà model sẽ vẽ lên hình (`A. $30^{\circ}$` → nó ghi 30 độ vào góc), trong khi đề
 * bài không hề cho số đo đó. Giữ tiêu đề PHẦN vì đó là tín hiệu thật về loại câu.
 */
function trim(lines: string[]): string {
  const kept: string[] = [];
  for (const l of lines) {
    if (FIG_ONLY_LINE.test(l)) continue;
    if (OPTION_LINE.test(l)) continue;
    kept.push(l);
  }
  // Gộp dòng trống liên tiếp.
  const out: string[] = [];
  for (const l of kept) {
    if (!l.trim() && !out.length) continue;
    if (!l.trim() && !out[out.length - 1]?.trim()) continue;
    out.push(l);
  }
  let text = out.join('\n').trim();
  if (text.length > MAX_CONTEXT_CHARS) {
    // Cắt ở biên dòng để không bỏ lửng một công thức giữa `$...$`.
    text = text.slice(0, MAX_CONTEXT_CHARS);
    const nl = text.lastIndexOf('\n');
    if (nl > MAX_CONTEXT_CHARS * 0.5) text = text.slice(0, nl);
    text = text.trimEnd();
  }
  return text;
}

/**
 * Ngữ cảnh đề cho TỪNG id hình, một lượt quét cho cả đề.
 *
 * NHẬN `pageMmds` RỒI TỰ NỐI, không nhận một trang: câu bị cắt trang là chuyện thường, và cắt
 * theo từng trang thì hình nằm ở trang sau sẽ mất hẳn phần đề của nó.
 *
 * Cố tình KHÔNG gọi `stitchPages`: nó bỏ tiêu đề lặp và nối bảng, ta chỉ cần chữ để hiểu đề nên
 * trả tiền cho nó là vô ích — và quan trọng hơn, nối thẳng thì bước này không phải xếp sau chặng
 * văn bản đang chạy song song.
 */
export function buildFigureContexts(pageMmds: string[]): Map<string, FigureContext> {
  const lines = pageMmds.join('\n\n').split('\n');

  const marks: Array<{ line: number; num: number }> = [];
  let solutionAt = lines.length;
  lines.forEach((l, i) => {
    const m = l.match(QUES_LINE);
    if (m) marks.push({ line: i, num: parseInt(m[1], 10) });
    if (solutionAt === lines.length && SOLUTION_HEAD.test(l)) solutionAt = i;
  });

  const out = new Map<string, FigureContext>();
  lines.forEach((l, i) => {
    for (const m of l.matchAll(FIG_REF)) {
      const id = m[1];
      if (out.has(id)) continue;

      let mark: { line: number; num: number } | null = null;
      for (const k of marks) {
        if (k.line <= i) mark = k;
        else break;
      }

      if (mark) {
        const next = marks.find((k) => k.line > mark!.line)?.line ?? lines.length;
        const end = Math.min(next, mark.line + MAX_BLOCK_LINES, solutionAt);
        out.set(id, {
          text: trim(lines.slice(mark.line, Math.max(end, mark.line + 1))),
          scope: 'cau',
          num: mark.num,
        });
      } else {
        out.set(id, {
          text: trim(lines.slice(Math.max(0, i - WINDOW_LINES), i + WINDOW_LINES + 1)),
          scope: 'cuaso',
          num: null,
        });
      }
    }
  });
  return out;
}
