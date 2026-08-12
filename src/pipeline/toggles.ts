/**
 * Các công tắc điều khiển pipeline: KIỂU + MẶC ĐỊNH + phép vá mục lịch sử cũ.
 *
 * VÌ SAO KHÔNG NẰM TRONG `components/OptionToggles.tsx`: `history/serialize.ts` cần
 * `DEFAULT_TOGGLES` như một GIÁ TRỊ, mà file đó tự khai "không dùng DOM để harness Node import
 * được". Import một file `.tsx` vào đó là kéo React/JSX vào Node và phá đúng ranh giới ấy.
 * Kiểu thì import kiểu được (nó bị xoá lúc biên dịch), giá trị thì không.
 *
 * `OptionToggles.tsx` re-export lại cả ba để mọi chỗ đang import từ đó vẫn chạy.
 */

export interface PipelineToggles {
  /** Chuẩn hoá bố cục đề thi (bỏ phiếu tô, tiêu đề PHẦN, mục ĐÁP ÁN CHI TIẾT). */
  examMode: boolean;
  /** Tự giải đề khi tài liệu chưa có lời giải. */
  autoSolve: boolean;
  /** Giải hai lượt rồi đối chiếu, lệch thì có lượt thứ ba phân xử. */
  doubleCheck: boolean;
  /** Cho phép tự vẽ hình minh hoạ cho bài hình học. */
  drawFigures: boolean;
  /** Ưu tiên dựng lại hình vẽ bằng TikZ; hỏng thì rơi về ảnh cắt từ đề. */
  redrawTikz: boolean;
  /** TikZ thua thì nhờ model sinh ảnh dựng lại (chỉ hình mô hình vật thật). */
  genFigureImage: boolean;
}

/**
 * Mặc định dùng chung. Trước đây mỗi converter tự viết literal riêng, nên thêm một công tắc là
 * phải sửa hai chỗ và rất dễ quên một chỗ. Chế độ ảnh đơn ghi đè đúng hai khoá, ngay tại chỗ
 * gọi, để khác biệt còn nhìn thấy được.
 */
export const DEFAULT_TOGGLES: PipelineToggles = {
  examMode: true,
  autoSolve: true,
  doubleCheck: true,
  drawFigures: true,
  redrawTikz: true,
  genFigureImage: true,
};

/** Chế độ ảnh đơn chưa từng có bước vẽ lại hình trong đề, nên cả hai công tắc đó đều ẩn. */
export const HIDDEN_IN_IMAGE_MODE: Array<keyof PipelineToggles> = [
  'redrawTikz',
  'genFigureImage',
];

/**
 * Vá công tắc của mục lịch sử cũ về đủ khoá.
 *
 * VÌ SAO: `history/store.ts` khôi phục `toggles: entry.toggles` mà KHÔNG có default (các dòng
 * láng giềng đều `?? []`). Mục lưu trước khi một công tắc ra đời sẽ cho `undefined`, rồi
 * `OptionToggles` truyền `checked={undefined && !parentOff}` vào input — React đổi input từ
 * uncontrolled sang controlled, **ô tích chết cứng mà không hiện disabled**, và chỉ log một
 * cảnh báo trong console. Thêm công tắc thứ sáu là tạo ra đúng dân số đó trên đĩa của mọi người.
 *
 * Là hàm THUẦN và ở đây (không viết thẳng trong `load()`) để harness kiểm được: `load()` cần
 * cầu nối Electron nên không kiểm tự động được.
 */
export function normalizeToggles(raw: unknown): PipelineToggles {
  const t = (raw ?? {}) as Partial<PipelineToggles>;
  const out: PipelineToggles = { ...DEFAULT_TOGGLES };
  for (const k of Object.keys(out) as Array<keyof PipelineToggles>) {
    if (typeof t[k] === 'boolean') out[k] = t[k] as boolean;
  }
  return out;
}
