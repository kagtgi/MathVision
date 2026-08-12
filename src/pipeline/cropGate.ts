/**
 * Cửa kiểm ảnh cắt: bản cắt này là HÌNH VẼ, hay là CHỮ CỦA ĐỀ bị khoanh nhầm?
 *
 * VÌ SAO CẦN: model khoanh bbox sai được, và nó sai theo một kiểu rất khó thấy — **đúng hình
 * dạng, sai dòng**. Đo trên đề chuyên Lê Hồng Phong 2026: model trả `[38.0, 33.1, 23.0, 15.5]`
 * trong khi hình thật ở `[38, 62.2, 23, 15.5]`. Ba trên bốn số TRÙNG KHÍT tới một chữ số thập
 * phân; chỉ `y` lệch 29 điểm. Kết quả là một tấm ảnh chụp bảng số liệu và mấy dòng phương án
 * A-D đi thẳng vào file Word ở chỗ đáng ra là hình chóp — và không phép kiểm nào của app hé một
 * lời, vì id nào cũng có dữ liệu nên QC thấy đủ cả.
 *
 * VÌ SAO ĐO PIXEL chứ không đối chiếu lớp văn bản PDF: đề này KHÔNG CÓ lớp văn bản (0 mảnh chữ
 * trên trang 1), nên `extractPageText` trả rỗng và phép đối chứng văn bản im lặng bỏ qua. Đề
 * scan hay đề xuất từ ảnh đều vậy. Pixel là thứ luôn có.
 *
 * VÌ SAO KHÔNG DÙNG TỈ LỆ MỰC: đã đo và nó KHÔNG tách được. Hình thật 4,1-11,6%; dải chữ
 * 5,4-15,9% — trùm lên nhau hoàn toàn. Chữ và nét vẽ đều là mực đen trên giấy trắng.
 *
 * Thứ tách được là CẤU TRÚC HÀNG: chữ in thành những dải ngang cao đều nhau, trải gần hết bề
 * rộng, cách nhau bằng khoảng trắng sạch. Hình vẽ thì không.
 */

/** Ngưỡng "có mực" theo thang xám, cùng chuẩn `< 250` họ hàng ở `imageNormalize`. */
const INK_LEVEL = 200;
/** Hàng được coi là có mực khi ít nhất 1% bề rộng là mực — lọc hạt lẻ của ảnh scan. */
const ROW_ON = 0.01;
/** Dải cao trong khoảng này mới giống một DÒNG chữ: hẹp hơn là gạch, rộng hơn là khối hình. */
const LINE_H_MIN = 0.04;
const LINE_H_MAX = 0.22;
/** Và phải trải ngang quá nửa: nhãn điểm trên hình (A, B, S) thì ngắn, dòng chữ thì dài. */
const LINE_SPAN = 0.45;

/**
 * Từ BAO NHIÊU dải kiểu-dòng-chữ thì coi là ảnh chữ.
 *
 * Đo trên 13 hình thật của hai đề (chuyên Lê Hồng Phong 2026 + chính thức THPT 2025), đủ bốn họ
 * `khonggian`/`dothi`/`bbt`/`ve`: **cao nhất là 1**, và không hình nào bị chặn. Đo trên 40 dải
 * chữ lấy tuỳ ý cùng khổ trên chính hai đề đó: 30/40 đạt từ 2 trở lên. Bản cắt đã lỗi của thầy
 * đo được đúng 2. Chạy lại: `node scripts/probe-crop-gate.mjs <file.pdf>`.
 *
 * Thà bỏ sót vài ca còn hơn bắt oan: bắt oan là XOÁ một hình có thật khỏi đề. Vì thế mọi số đo
 * trên đây lấy trên HỘP GỐC model khai, không phải hộp đã nới lề — xem `cropFigure`.
 */
export const TEXT_BAND_LIMIT = 2;

export interface CropStats {
  /** Tỉ lệ mực — giữ lại để ghi nhật ký, KHÔNG dùng để phán quyết (xem đầu file). */
  ink: number;
  /** Số dải ngang có mực. */
  bands: number;
  /** Số dải trông như một dòng chữ. Đây là con số phán quyết. */
  textBands: number;
  /** Dải trải ngang rộng nhất, theo tỉ lệ bề rộng. */
  maxSpan: number;
}

/**
 * Đo cấu trúc hàng của một ảnh xám.
 *
 * `gray` dài `w * h`, mỗi phần tử 0-255. Thuần để harness kiểm được mà không cần canvas.
 */
export function cropStats(gray: Uint8Array | Uint8ClampedArray, w: number, h: number): CropStats {
  if (w <= 0 || h <= 0 || gray.length < w * h) {
    return { ink: 0, bands: 0, textBands: 0, maxSpan: 0 };
  }
  const rowInk = new Float64Array(h);
  let ink = 0;
  for (let y = 0; y < h; y++) {
    let c = 0;
    const base = y * w;
    for (let x = 0; x < w; x++) if (gray[base + x] < INK_LEVEL) c++;
    rowInk[y] = c / w;
    ink += c;
  }

  let textBands = 0;
  let bands = 0;
  let maxSpan = 0;
  let start = -1;
  for (let y = 0; y <= h; y++) {
    const on = y < h && rowInk[y] > ROW_ON;
    if (on && start < 0) start = y;
    if (!on && start >= 0) {
      bands++;
      let span = 0;
      for (let k = start; k < y; k++) if (rowInk[k] > span) span = rowInk[k];
      if (span > maxSpan) maxSpan = span;
      const height = (y - start) / h;
      if (height > LINE_H_MIN && height < LINE_H_MAX && span > LINE_SPAN) textBands++;
      start = -1;
    }
  }
  return { ink: ink / (w * h), bands, textBands, maxSpan };
}

/**
 * Lý do từ chối, hoặc `null` nếu bản cắt trông như hình vẽ.
 *
 * Trả CHUỖI thay vì boolean vì lý do còn đi vào nhật ký và cảnh báo cho thầy — biết "cắt vào
 * 4 dòng chữ" thì hiểu ngay phải làm gì, còn "không đạt" thì không.
 */
export function textBlockReason(s: CropStats): string | null {
  if (s.textBands < TEXT_BAND_LIMIT) return null;
  return `vùng cắt chứa ${s.textBands} dòng chữ xếp đều — đây là chữ của đề, không phải hình`;
}
