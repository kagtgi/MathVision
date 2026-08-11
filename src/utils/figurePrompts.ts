/**
 * Luật vẽ hình cho model, theo phong cách SGK Toán Việt Nam.
 *
 * Hai điều làm file này khác bản 1.1:
 *
 * 1. **Khối giới hạn renderer SINH TỪ `tikzCapabilities.ts`**, không viết tay. Bản trước viết
 *    tay và cấm oan `\foreach`, `\draw plot`, `\pgfmathparse`, `\tikzset` — đo lại thì cả bốn
 *    đều chạy tốt, trong khi thứ thật sự giết hình (byte ngoài ASCII) thì không nhắc gì.
 *
 * 2. **Luật riêng theo TỪNG LOẠI HÌNH.** Bản trước có đúng một prompt nói "a geometric figure"
 *    kèm một template tam giác, dùng cho tất cả — kể cả bảng biến thiên và đồ thị hàm số. Bên
 *    đường tự-giải-đề thì còn tệ hơn: luật cũ dập thẳng `bài đại số / thống kê / dãy số ->
 *    veHinh = false`, tức là không bao giờ vẽ bảng biến thiên hay đồ thị.
 */

import { tikzCapsRules } from './tikzCapabilities.ts';

/** Loại hình, quyết định dùng khối luật nào. */
export type FigureCategory =
  /** Bảng biến thiên — vẽ bằng TikZ, kẻ tay. */
  | 'bbt'
  /** Đồ thị hàm số trên hệ trục. */
  | 'dothi'
  /** Hình học không gian: chóp, lăng trụ, tứ diện, hộp. */
  | 'khonggian'
  /** Hình học phẳng: tam giác, đường tròn, đa giác. */
  | 'phang'
  /** Mô hình hoá vật thật: mái nhà, bể nước, cầu, khối ghép. */
  | 'model'
  /** Bảng số liệu thống kê — KHÔNG vẽ, xuất thành bảng Word. */
  | 'bang'
  /** Ảnh chụp vật thật — giữ ảnh gốc, không vẽ lại. */
  | 'anh'
  /**
   * Hình vẽ chưa phân loại. Giá trị mặc định khi model không khai hoặc khai lạ, và cũng là
   * giá trị mà MMD cũ (trước 1.2.0) dùng. Vẫn dựng lại được, chỉ là dùng luật chung.
   */
  | 've';

/** Loại nào thì dựng lại bằng TikZ. */
export const REDRAWABLE: readonly FigureCategory[] = [
  'bbt',
  'dothi',
  'khonggian',
  'phang',
  'model',
  've',
];

export const isRedrawable = (k: FigureCategory): boolean =>
  (REDRAWABLE as readonly string[]).includes(k);

/**
 * Phong cách chung, áp cho mọi loại. Dịch từ yêu cầu của người dùng: nét mảnh đều, đen
 * trắng, phẳng, không hiệu ứng, giống hình in trong SGK chứ không giống infographic.
 */
export const SGK_STYLE_RULES = `PHONG CÁCH SGK TOÁN VIỆT NAM (áp cho mọi hình):

Thứ tự ưu tiên khi phải đánh đổi:
  1. ĐÚNG quan hệ toán học   2. đúng cấu trúc hình   3. dễ đọc khi in đen trắng
  4. bố cục cân đối          5. đẹp mắt
KHÔNG BAO GIỜ làm hình đẹp hơn bằng cách đổi quan hệ hình học.

Nét và màu:
- Chỉ nét đen trên nền trắng. KHÔNG tô bóng, KHÔNG gradient, KHÔNG hiệu ứng 3D,
  KHÔNG hoa văn trang trí, KHÔNG màu trừ khi bài buộc phải phân biệt.
- Nét chính (cạnh, đồ thị): dày 0.7-0.9pt. Nét phụ (đường dựng, gióng): 0.4-0.6pt.
- Mở đầu bằng: \\begin{tikzpicture}[line cap=round, line join=round, >=Stealth]
- Cạnh THẤY vẽ nét liền; cạnh BỊ CHE vẽ nét đứt (dashed).

Nhãn:
- Nhãn đặt NGOÀI hình, không đè lên nét, không đè lên nhau. Dùng above/below/left/right/
  above left... theo vị trí thực tế của điểm.
- Tên điểm và công thức đặt trong $...$: $A$, $B'$, $S.ABCD$.
- KHÔNG ghi độ dài, số đo góc, hay toạ độ nếu đề không cho con số đó.
- Chỉ đánh dấu góc vuông / đoạn bằng nhau / hai đường song song khi đề nói rõ hoặc khi
  suy ra trực tiếp được từ đề.

Bố cục:
- Hình nằm giữa, chừa lề trắng.
- KHÔNG tiêu đề, KHÔNG chú thích ngoài hình, KHÔNG viền, KHÔNG lời giải.
- Hình sẽ bị thu về tối đa 340pt khi đưa vào Word, nên đừng vẽ quá rộng và đừng nhồi
  chữ nhỏ; chữ trong hình dùng \\small hoặc \\scriptsize.`;

/**
 * Bước phân tích trước khi vẽ. Đúng ý người dùng: xác định quan hệ hình học TRƯỚC, rồi mới
 * vẽ, và KHÔNG lộ phần suy luận ra ngoài.
 *
 * Đây là chỗ duy nhất trị được lỗi thường gặp nhất của mô hình sinh hình: hình nhìn đẹp mà
 * sai quan hệ thuộc (điểm không nằm trên cạnh nó phải nằm, hai đường chéo nhau lại vẽ thành
 * cắt nhau).
 */
export const THINK_FIRST_RULES = `TRƯỚC KHI VẼ, tự xác định trong đầu (KHÔNG viết ra):
  1. tất cả các điểm có trong bài;
  2. điểm nào thẳng hàng với điểm nào;
  3. điểm nào nằm TRÊN đoạn / cạnh / mặt nào;
  4. mọi giao điểm, giao tuyến;
  5. cạnh nào thấy, cạnh nào bị che;
  6. đoạn phụ nào bài buộc phải có (đường cao, trung tuyến, hình chiếu).
Rồi mới viết mã. CHỈ xuất mã TikZ, không xuất phần phân tích.

TỰ KIỂM trước khi xuất — sửa ngay nếu sai:
- Mỗi điểm có nằm ĐÚNG trên cạnh/mặt của nó không? Trung điểm có ở giữa thật không?
- Hai đường bài nói cắt nhau thì trên hình có cắt nhau không?
- Hai đường CHÉO NHAU (không đồng phẳng) có bị vẽ thành cắt nhau không?
- Chân đường vuông góc có đúng chỗ không?
- Có tự thêm quan hệ song song / vuông góc mà bài KHÔNG nói không?
- Đoạn chỉ bị che MỘT PHẦN thì phải CHIA ĐOẠN: phần thấy nét liền, phần khuất nét đứt.
  Đừng biến cả đoạn thành nét đứt.

Câu hỏi chốt: học sinh chỉ nhìn hình mà chưa đọc lời giải, có hiểu sai quan hệ nào không?`;

const CATEGORY_RULES: Record<FigureCategory, string> = {
  bbt: `LOẠI HÌNH: BẢNG BIẾN THIÊN.

Bộ dựng KHÔNG có tkz-tab, cũng không có array/tabular. Kẻ tay bằng \\draw và \\node.

Cấu trúc ba hàng, cột đầu là tên hàng:
  hàng 1: $x$        các mốc theo thứ tự TĂNG, hai đầu là $-\\infty$ và $+\\infty$
  hàng 2: $f'(x)$    dấu $+$ / $-$ giữa hai mốc; số 0 hoặc gạch $\\|$ tại mốc
  hàng 3: $f(x)$     giá trị tại mốc, và mũi tên chiều biến thiên

Cách vẽ:
- Kẻ khung ngoài bằng \\draw ... rectangle, kẻ hai đường ngang chia ba hàng, kẻ một
  đường dọc tách cột tên hàng.
- Mũi tên biến thiên là \\draw[->] đi CHÉO giữa hai ô: đi lên cho đồng biến, đi xuống cho
  nghịch biến. Đừng dùng ký tự mũi tên trong chữ.
- Cực đại đặt ở mép TRÊN của hàng $f(x)$, cực tiểu ở mép DƯỚI, đúng cột của mốc.
- Tại tiệm cận đứng hoặc điểm không xác định: kẻ hai gạch dọc $\\|$ ở hàng $f'(x)$, và ô
  $f(x)$ tại đó chia đôi để ghi giới hạn bên trái và bên phải.

BẮT BUỘC nhất quán: thứ tự mốc $x$ → dấu của $f'(x)$ → chiều mũi tên của $f(x)$.
Dấu $+$ thì mũi tên phải đi lên; dấu $-$ thì phải đi xuống. Sai chỗ này là bảng vô nghĩa.`,

  dothi: `LOẠI HÌNH: ĐỒ THỊ HÀM SỐ.

Trước khi vẽ, xác định: tập xác định, nghiệm, giao với $Oy$, cực trị, khoảng đồng biến /
nghịch biến, tiệm cận, giới hạn ở hai đầu, tính đối xứng nếu có.

Hệ trục:
- Hai trục có mũi tên, ghi $x$ ở đầu trục ngang, $y$ ở đầu trục dọc, $O$ ở gốc.
- KHÔNG kẻ lưới ô vuông trừ khi bài là hình học toạ độ.
- Chỉ ghi mốc nào BÀI CẦN. Đừng đánh số dày trục.
- Dùng \\foreach cho các mốc trục, mỗi mốc một vạch ngắn cộng một nhãn.
- Đặt tỉ lệ hai trục bằng x=...cm, y=...cm để hình cân, không cần cùng đơn vị.

Đường cong:
- Vẽ bằng: \\draw[thick,domain=a:b,samples=100,smooth] plot (\\x,{biểu thức});
  Hàm lượng giác nhớ đơn vị radian: {cos(\\x r)}.
- Nếu biểu thức phức tạp, tự tính sẵn các điểm rồi
  \\draw[thick] plot coordinates {(x1,y1) (x2,y2) ...};
- Đồ thị phải ĐÚNG: nghiệm, cực trị, tiệm cận, chiều đơn điệu, chiều tiến tới $\\pm\\infty$.
- Tiệm cận vẽ nét đứt mảnh, có nhãn phương trình.
- Hàm có điểm gián đoạn: vẽ TỪNG NHÁNH riêng, TUYỆT ĐỐI không nối qua điểm gián đoạn.
- Đường gióng từ trục tới điểm đặc biệt: nét đứt mảnh.`,

  khonggian: `LOẠI HÌNH: HÌNH HỌC KHÔNG GIAN.

Bộ dựng KHÔNG có thư viện perspective, nên tự đặt toạ độ theo phép chiếu song song
(oblique) kiểu SGK:
- Phương thẳng đứng giữ nguyên thẳng đứng.
- Cạnh lùi về sau vẽ chéo, khoảng 30-45 độ, và RÚT NGẮN lại (khoảng 0.5-0.7 lần) cho ra
  chiều sâu.
- Cạnh song song trong thực tế thì trên hình vẫn phải song song.
- KHÔNG dùng phối cảnh có điểm tụ, KHÔNG vẽ như ảnh thật.

Bố cục:
- Đáy chóp / lăng trụ vẽ thành HÌNH BÌNH HÀNH (do phép chiếu), KHÔNG vẽ thành hình chữ
  nhật nhìn thẳng — đó là lỗi hay gặp nhất.
- Chọn hướng nhìn sao cho không có hai đỉnh trùng nhau và mọi giao điểm đều thấy rõ.
- Mặt phẳng khi cần thể hiện thì vẽ thành miền hình bình hành, KHÔNG tô nền.
- Vẽ đủ đường cao, hình chiếu, chân đường vuông góc mà lời giải có nhắc tới.
- Đánh dấu góc vuông ở chân đường cao.`,

  phang: `LOẠI HÌNH: HÌNH HỌC PHẲNG.

Dựng theo RÀNG BUỘC trước, chọn toạ độ sau — đừng vẽ hình "trông có vẻ đúng":
- tam giác cân: hai cạnh bằng nhau THẬT; tam giác vuông: góc 90 độ THẬT;
- trung điểm: đúng trung điểm; đường cao: vuông góc thật;
- phân giác: chia đúng góc; tiếp tuyến: vuông góc với bán kính tại tiếp điểm;
- đường tròn ngoại tiếp: các đỉnh nằm THẬT trên đường tròn.

Dùng thư viện calc để chia đoạn ($(A)!0.5!(B)$), intersections để lấy giao điểm, through
để dựng đường tròn qua điểm — chính xác hơn là tự đoán toạ độ.
Nhìn thẳng, không phối cảnh. Chọn tỉ lệ cho hình dễ đọc.`,

  model: `LOẠI HÌNH: MÔ HÌNH HOÁ VẬT THẬT (mái nhà, bể nước, cầu, cột, khối ghép...).

Trừu tượng hoá thành hình học, ĐỪNG vẽ như ảnh thật:
- Chỉ nét, đen trắng, ít chi tiết, giữ đúng những thành phần mà bài toán cần.
- Vật thể khối thì áp luật phép chiếu song song như hình không gian.
- Bỏ hết chi tiết trang trí không phục vụ việc giải toán.
- Kích thước nào đề cho thì ghi, không cho thì đừng bịa.
Khi đề dùng vật thật chỉ để minh hoạ, ưu tiên làm rõ MÔ HÌNH TOÁN chứ không phải vật.`,

  bang: `LOẠI HÌNH: BẢNG SỐ LIỆU — KHÔNG VẼ HÌNH.
Xuất thành bảng markdown để thành bảng Word thật, sửa được. Đừng dựng bằng TikZ.`,

  anh: `LOẠI HÌNH: ẢNH CHỤP VẬT THẬT — KHÔNG VẼ LẠI. Giữ ảnh gốc.`,

  ve: `LOẠI HÌNH: hình vẽ nét, chưa rõ thuộc loại nào.
Nhìn hình rồi tự nhận ra nó là bảng biến thiên, đồ thị, hình không gian, hình phẳng hay mô
hình vật thật, và áp đúng quy ước của loại đó. Nếu là hình không gian thì nhớ: đáy vẽ thành
hình bình hành, cạnh khuất nét đứt.`,
};

/** Khối luật đầy đủ cho một loại hình, ghép sẵn theo đúng thứ tự. */
export function figureRulesFor(kind: FigureCategory): string {
  return [CATEGORY_RULES[kind], '', SGK_STYLE_RULES, '', THINK_FIRST_RULES, '', tikzCapsRules()].join(
    '\n',
  );
}

/** Mô tả ngắn từng loại, dùng trong prompt OCR để model tự gán loại. */
export const CATEGORY_HINTS = `  bbt        — bảng biến thiên (bảng có hàng x, f'(x), f(x) và mũi tên chéo)
  dothi      — đồ thị hàm số trên hệ trục Oxy
  khonggian  — hình không gian: chóp, lăng trụ, tứ diện, hình hộp, mặt cầu
  phang      — hình phẳng: tam giác, đường tròn, đa giác, hình thang
  model      — mô hình vật thật vẽ bằng nét: mái nhà, bể nước, cầu, khối ghép
  bang       — BẢNG SỐ LIỆU thống kê (tần số, mẫu số liệu) — xuất thành bảng, không phải hình
  anh        — ẢNH CHỤP vật thật, ảnh màn hình, bản đồ ảnh`;
