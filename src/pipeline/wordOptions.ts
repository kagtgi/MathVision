/**
 * Tuỳ chọn file Word: KIỂU + MẶC ĐỊNH + phép vá mục lịch sử cũ.
 *
 * Song sinh với `pipeline/toggles.ts`, và ở đây vì ĐÚNG CÙNG MỘT LÝ DO: `history/store.ts` cần
 * `DEFAULT_WORD_OPTIONS` như một GIÁ TRỊ, mà nó phải import được từ Node (harness lịch sử). Import
 * `components/WordOptions.tsx` vào đó là kéo React/JSX sang Node.
 *
 * BÀI HỌC ĐÃ MẤT HAI LẦN MỚI HỌC: thêm một trường mới vào object được LƯU VÀO LỊCH SỬ thì phải
 * thêm luôn phép vá mặc định. 1.3 thêm `genFigureImage` vào `PipelineToggles` (đã vá) và
 * `pageNumbers` vào đây (suýt quên). Thiếu vá thì mục lưu trước đó trả `undefined`, React đổi
 * input từ uncontrolled sang controlled, và **ô tích chết cứng mà không hiện disabled** — chỉ có
 * một dòng cảnh báo trong console.
 */

import type { DocFormat } from './formats.ts';
import type { FontPresetId } from './fonts.ts';

export interface WordOptionsValue {
  format: DocFormat;
  /** `null` = dùng font mặc định của định dạng. */
  fontId: FontPresetId | null;
  /** Số câu bắt đầu, chỉ dùng cho định dạng VDC. */
  startNumber: number;
  /**
   * In footer "Trang N". Chỉ có nghĩa với định dạng thường — chuẩn VDC vốn KHÔNG có footer,
   * đo từ file mẫu, nên công tắc này không hiện khi chọn VDC.
   */
  pageNumbers: boolean;
}

export const DEFAULT_WORD_OPTIONS: WordOptionsValue = {
  format: 'k11',
  fontId: null,
  startNumber: 1,
  // Mặc định BẬT: đúng file mẫu K11, nên 25 đề golden vẫn trùng từng byte.
  pageNumbers: true,
};

/** Vá tuỳ chọn Word của mục lịch sử cũ về đủ khoá. Xem `normalizeToggles` cho lý do đầy đủ. */
export function normalizeWordOptions(raw: unknown): WordOptionsValue {
  const w = (raw ?? {}) as Partial<WordOptionsValue>;
  return {
    format: w.format ?? DEFAULT_WORD_OPTIONS.format,
    fontId: w.fontId ?? DEFAULT_WORD_OPTIONS.fontId,
    startNumber:
      typeof w.startNumber === 'number' && w.startNumber >= 1
        ? w.startNumber
        : DEFAULT_WORD_OPTIONS.startNumber,
    pageNumbers:
      typeof w.pageNumbers === 'boolean' ? w.pageNumbers : DEFAULT_WORD_OPTIONS.pageNumbers,
  };
}
