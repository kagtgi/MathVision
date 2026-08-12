/**
 * Phán quyết đạt/không đạt cho MỘT hình corpus — thuần, không DOM.
 *
 * Tách ra để trang đo (`main.ts`, chạy trong Electron) và driver
 * (`scripts/verify-tikz-render.mjs`, chạy trong Node) dùng CÙNG một hàm. Nhân bản luật chấm ra
 * hai chỗ là cách chắc chắn để hai bên báo hai kết quả khác nhau trên cùng một số đo.
 */

import type { CorpusCase } from './cases.ts';
// Chấm bằng ĐÚNG ngưỡng của đường sản phẩm, không phải một bản sao: dưới ngưỡng này
// `tikzToImage` tự bỏ hình, nên "dựng được mà dưới ngưỡng" nghĩa là không tới được Word.
// (Bộ probe cũ chốt đạt bằng `ink > 0.02` trong khi biến `ink` của nó là PHẦN TRĂM — ngưỡng
// thật 0,0002, lỏng gấp 10 lần. Ở đây mọi số mực đều là RATIO.)
import { MIN_INK_RATIO } from '../../utils/tikzCapabilities.ts';

export { MIN_INK_RATIO };

/** Trần rộng của `makeImageParagraph` (docx px). 340 px = 9,00 cm = đúng 50% cột chữ A4. */
export const DOCX_MAX_W = 340;

/**
 * Trần cao ĐỀ NGHỊ cho `makeImageParagraph` — chưa có trong app (việc của Phần B).
 * Ở đây dùng làm phép đo: ca nào vượt là ca sẽ chiếm gần trọn chiều cao trang khi vào Word.
 * 420 docx px = 11,1 cm; chọn trên mức 342 px là hình golden cao nhất nên áp vào không làm
 * đổi một byte nào của 25 file đối chứng.
 */
export const DOCX_MAX_H = 420;

/** Số đo lấy được từ một lượt dựng thật. */
export interface CorpusMeasure {
  /** `tikzToImage` trả khác null. */
  ok: boolean;
  ms: number;
  w: number;
  h: number;
  /** RATIO, không phải phần trăm. */
  ink: number;
  textNodes: number;
  pathNodes: number;
  /** Số rule `@font-face` nhúng được vào SVG. 0 = nhãn sẽ sai glyph. */
  fontFaces: number;
  /** Tên font mà SVG yêu cầu. */
  fonts: string[];
  /** Ghi chú của sanitizer. Bộ hình sạch thì phải rỗng. */
  notes: string[];
  /** Số nhãn bị nét của hình chạy xuyên qua. Xem `countLabelOverlaps`. */
  labelOverlaps: number;
}

/** Cỡ hình sau phép co của `makeImageParagraph` — trần rộng, HIỆN CHƯA có trần cao. */
export function docxSize(w: number, h: number): { w: number; h: number } {
  const scale = Math.min(1, DOCX_MAX_W / (w * 0.75));
  return { w: Math.round(w * 0.75 * scale), h: Math.round(h * 0.75 * scale) };
}

/**
 * Sáu tiêu chí. Trả danh sách lý do FAIL — rỗng là đạt.
 *
 * Thứ tự có ý: tiêu chí sau chỉ đọc được khi tiêu chí trước đã đạt, nên hỏng ở đâu thì dừng
 * báo ở đó thay vì đổ ra sáu dòng cho cùng một nguyên nhân.
 */
export function judgeCorpusCase(c: CorpusCase, m: CorpusMeasure): string[] {
  if (!m.ok) return ['không dựng được (tikzToImage trả null)'];

  const fails: string[] = [];
  const [lo, hi] = c.expectInk;

  if (m.ink < MIN_INK_RATIO) {
    fails.push(`mực ${m.ink.toFixed(4)} dưới ngưỡng app tự bỏ hình (${MIN_INK_RATIO})`);
  } else if (m.ink < lo || m.ink > hi) {
    fails.push(`mực ${m.ink.toFixed(4)} ngoài dải mong đợi [${lo}; ${hi}]`);
  }

  if (m.textNodes < c.minText) {
    fails.push(`chỉ ${m.textNodes} node <text>, cần >= ${c.minText} — nhãn bị rụng`);
  }
  if (m.fontFaces === 0) {
    fails.push('không nhúng được @font-face nào — nhãn sẽ sai glyph trong Word');
  }
  const strange = m.fonts.filter((f) => !/^cm/i.test(f));
  if (strange.length) {
    fails.push(`font lạ ngoài bakoma: ${strange.join(', ')} — trình duyệt đã fallback`);
  }

  const box = docxSize(m.w, m.h);
  if (box.h > DOCX_MAX_H) {
    fails.push(`vào Word cao ${box.h} px (${(box.h * 0.02646).toFixed(1)} cm) > trần ${DOCX_MAX_H}`);
  }

  if (m.labelOverlaps > 0) {
    fails.push(`${m.labelOverlaps} nhãn bị nét hình chạy xuyên qua — đặt lại vị trí nhãn`);
  }

  if (m.notes.length) {
    fails.push(`sanitizer phải sửa mã: ${m.notes.join(' | ')}`);
  }

  return fails;
}
