/**
 * Câu nào thì LỜI GIẢI phải có hình minh hoạ — quyết định ở CODE, không phó cho model.
 *
 * VÌ SAO CẦN: trước 1.3, `solveExam.ts` chỉ có đúng một dòng gác
 * `if (chosen?.veHinh && opts.drawFigures && chosen.tikz?.includes(...))` — tức model tự quyết
 * hết, code chỉ có một công tắc người dùng và một phép sniff chuỗi. `ref.type` nằm ngay tại đó
 * và CHƯA BAO GIỜ được dùng cho hình, nên câu tự luận chứng minh xử lý y như câu trắc nghiệm
 * đại số.
 *
 * VÀ CHỖ HỎNG NẶNG NHẤT: prompt dạy `Đề ĐÃ CÓ HÌNH -> veHinh = false`, trong khi
 * `examTransforms.ts` in lại nguyên khối đề vào phần đáp án. Cộng lại thành ra: đúng những câu
 * hình học không gian CÓ hình trong đề thì lời giải KHÔNG BAO GIỜ có hình riêng — nó chỉ in lại
 * ảnh cắt chưa có đường cao, chưa có chân đường vuông góc, chưa có góc cần tính. Cờ `annotate`
 * dưới đây là chỗ sửa: đề đã có hình thì hình của lời giải là bản VẼ THÊM ĐƯỜNG PHỤ, không phải
 * bản sao.
 *
 * Thuần, không DOM, không mạng — `scripts/verify-figure-policy.mjs` kiểm từng hàng của bảng
 * luật, kèm ca ÂM để bắt luật khớp quá rộng.
 */

import type { FigureCategory } from '../utils/figurePrompts.ts';
import type { QuestionRef } from './solveExam.ts';

export type FigureNeed = 'bat-buoc' | 'nen' | 'khong';

export interface FigureNeedVerdict {
  need: FigureNeed;
  /** Loại hình phải vẽ — chọn đúng khối luật `figureRulesFor`. `null` khi `need = khong`. */
  kind: FigureCategory | null;
  /** Một câu vì sao. Đi vào prompt VÀ vào cảnh báo khi dựng hỏng. */
  why: string;
  /**
   * Đề ĐÃ CÓ hình: hình của lời giải phải là bản có THÊM đường phụ, không phải bản sao.
   * Đây là chỗ sửa luật `veHinh = false` đang chặn đúng những câu cần hình nhất.
   */
  annotate: boolean;
}

/**
 * Từ khoá viết KHÔNG dấu tiếng Việt ở đây thì vô dụng — đề thi viết có dấu. Nên so trên chuỗi
 * đã hạ chữ thường, giữ nguyên dấu.
 */
const lower = (s: string) => s.toLowerCase();

const has = (t: string, words: readonly string[]) => words.some((w) => t.includes(w));

/** Khối tròn xoay và đa diện — dấu hiệu chắc chắn nhất của hình học không gian. */
const KHOI_KHONG_GIAN = [
  'hình chóp',
  'chóp s.',
  'lăng trụ',
  'tứ diện',
  'hình hộp',
  'lập phương',
  'hình trụ',
  'hình nón',
  'mặt cầu',
  'hình cầu',
  'khối cầu',
  'khối chóp',
  'khối lăng trụ',
] as const;

/** Quan hệ chỉ có nghĩa trong không gian. */
const QUAN_HE_KHONG_GIAN = [
  'mặt phẳng',
  'giao tuyến',
  'thiết diện',
  'khoảng cách giữa',
  'khoảng cách từ',
  'góc giữa',
  'hình chiếu',
  'chéo nhau',
  'đồng phẳng',
  'vuông góc với mặt',
] as const;

/** Bài mà lời giải ĐỌC TỪ bảng biến thiên. */
const BBT_WORDS = [
  'đơn điệu',
  'đồng biến',
  'nghịch biến',
  'cực trị',
  'cực đại',
  'cực tiểu',
  'giá trị lớn nhất',
  'giá trị nhỏ nhất',
  'gtln',
  'gtnn',
  'bảng biến thiên',
] as const;

/** Bài mà lời giải ĐỌC TỪ đồ thị. */
const DOTHI_WORDS = [
  'số nghiệm',
  'tương giao',
  'cắt đồ thị',
  'cắt nhau tại',
  'biện luận',
  'đồ thị hàm số',
  'tiệm cận',
  'diện tích hình phẳng',
  'thể tích khối tròn xoay',
  'quay quanh trục',
] as const;

/** Hình học phẳng — chỉ khi KHÔNG có dấu hiệu không gian nào. */
const PHANG_WORDS = [
  'tam giác',
  'đường tròn',
  'tiếp tuyến',
  'trung tuyến',
  'đường cao',
  'phân giác',
  'nội tiếp',
  'ngoại tiếp',
  'hình thang',
  'hình bình hành',
  'trực tâm',
] as const;

/** Động từ của câu tự luận cần hình để đọc được lời giải. */
const TU_LUAN_CAN_HINH = [
  'chứng minh',
  'chứng tỏ',
  'tính góc',
  'tính khoảng cách',
  'dựng',
  'xác định thiết diện',
  'xác định giao tuyến',
] as const;

/**
 * Bài mà hình KHÔNG thêm thông tin gì. Xét TRƯỚC mọi luật khác để chặn khớp quá rộng: một câu
 * xác suất nhắc "hình chóp" (chọn ngẫu nhiên một đỉnh của hình chóp) không phải bài hình học.
 */
const KHONG_CAN_HINH = [
  'xác suất',
  'chỉnh hợp',
  'tổ hợp',
  'hoán vị',
  'cấp số cộng',
  'cấp số nhân',
  'số hạng',
  'phương sai',
  'độ lệch chuẩn',
  'trung vị',
  'tứ phân vị',
  'mẫu số liệu',
  'ghép nhóm',
] as const;

export function figureNeedFor(ref: QuestionRef): FigureNeedVerdict {
  const t = lower(ref.text);
  const annotate = ref.figureIds.length > 0;

  const no = (why: string): FigureNeedVerdict => ({ need: 'khong', kind: null, why, annotate });

  // Bài đại số / thống kê / xác suất: chặn trước, vì chúng hay nhắc tên khối hình trong đề.
  if (has(t, KHONG_CAN_HINH)) {
    return no('bài đại số / thống kê / xác suất — hình không thêm thông tin gì');
  }

  const khoi = has(t, KHOI_KHONG_GIAN);
  const quanHe = has(t, QUAN_HE_KHONG_GIAN);
  const laKhongGian = khoi || (quanHe && !has(t, PHANG_WORDS));

  if (laKhongGian) {
    return {
      need: 'bat-buoc',
      kind: 'khonggian',
      why: 'hình học không gian — không có hình thì lời giải không đọc được',
      annotate,
    };
  }

  if (has(t, BBT_WORDS)) {
    return {
      need: 'bat-buoc',
      kind: 'bbt',
      why: 'bài đơn điệu / cực trị / GTLN-GTNN — lời giải đọc trực tiếp từ bảng biến thiên',
      annotate,
    };
  }

  if (has(t, DOTHI_WORDS)) {
    return {
      need: 'bat-buoc',
      kind: 'dothi',
      why: 'bài tương giao / tiệm cận / diện tích - thể tích — lời giải đọc từ đồ thị',
      annotate,
    };
  }

  // Tự luận có động từ cần hình mà chưa khớp luật nào ở trên: vẫn bắt buộc, loại suy từ nội dung.
  if (ref.type === 'TL' && has(t, TU_LUAN_CAN_HINH)) {
    return {
      need: 'bat-buoc',
      kind: has(t, PHANG_WORDS) ? 'phang' : 'khonggian',
      why: 'câu tự luận chứng minh / tính góc - khoảng cách — hình là phần của lời giải',
      annotate,
    };
  }

  if (has(t, PHANG_WORDS)) {
    return {
      need: 'nen',
      kind: 'phang',
      why: 'hình học phẳng — có hình thì dễ theo, nhưng không bắt buộc',
      annotate,
    };
  }

  return no('không thấy dấu hiệu cần hình minh hoạ');
}

/**
 * Câu chỉ dẫn gửi kèm TỪNG CÂU cho solver. Ngắn có chủ ý: khối luật vẽ đầy đủ nằm ở bước soi
 * lại, gửi kèm mỗi câu sẽ tốn hàng trăm nghìn token input mỗi lần chạy (bài học 1.2.1).
 */
export function figureBriefFor(v: FigureNeedVerdict): string | null {
  if (v.need === 'khong') return null;
  const head =
    v.need === 'bat-buoc'
      ? `Câu này BẮT BUỘC có hình minh hoạ (loại: ${v.kind}). Lý do: ${v.why}.`
      : `Câu này NÊN có hình minh hoạ (loại: ${v.kind}). Lý do: ${v.why}.`;
  if (!v.annotate) return head;
  return [
    head,
    'Đề ĐÃ CÓ hình, nhưng hình của LỜI GIẢI không phải bản sao của nó: phải vẽ THÊM đúng những',
    'gì lời giải dùng tới — đường cao, chân đường vuông góc, hình chiếu, góc cần tính, đoạn cần',
    'đo, thiết diện. Giữ nguyên tên điểm của đề. KHÔNG vẽ lại y nguyên hình đề.',
  ].join('\n');
}
