/**
 * Prompt giải đề — phong cách sách giáo khoa THPT Việt Nam (chương trình 2018).
 *
 * Ba luật chống bịa ở đây không phải đề phòng suông: trong 25 đề của session trước có
 * 5 câu mà chính đề trường in sai, không phương án nào đúng (BUGS.md E1-E5), và vài
 * câu đề tự mâu thuẫn hoặc thiếu dữ kiện (A3, A6-A8, B1-B5). Ép model phải chọn một
 * phương án trong những ca đó là ép nó bịa.
 */

import { LATEX_MATH_RULES, TIKZJAX_COMPAT_RULES } from '../utils/sharedPrompts.ts';

export type QType = 'TN' | 'DS' | 'TLN' | 'TL';

const STYLE_RULES = String.raw`PHONG CÁCH TRÌNH BÀY — BẮT BUỘC theo sách giáo khoa THPT Việt Nam

Bố cục
- Mở đầu bằng dữ kiện hoặc công thức áp dụng. KHÔNG nhảy cóc bước.
- Mỗi phép biến đổi một dòng.
- Dùng đúng từ nối của SGK: "Ta có", "Suy ra", "Do đó", "Mà", "Khi đó", "Xét", "Gọi".
- Dòng cuối cùng LUÔN bắt đầu bằng "Vậy".
- Bài hình: đặt tên trước khi dùng — "Gọi $H$ là hình chiếu vuông góc của $A$ lên
  $(SBC)$" — không dùng ký hiệu chưa khai báo.

Ngôn ngữ và ký hiệu
- Thuật ngữ theo SGK 2018: mẫu số liệu ghép nhóm, tứ phân vị, cấp số nhân, góc giữa
  đường thẳng và mặt phẳng, khoảng cách từ điểm đến mặt phẳng...
- Ký hiệu Việt Nam: góc $\widehat{ABC}$, vectơ $\overrightarrow{AB}$, tam giác
  $\Delta ABC$, dùng $\Rightarrow$ / $\Leftrightarrow$ khi suy ra.
- Số thập phân dùng DẤU PHẨY trong ngoặc nhọn: $3{,}14$. Đơn vị viết sau số, cách một
  khoảng trắng: $12$ cm.
- MỌI công thức nằm trong một cặp $...$ ĐƠN. Cấm $$, cấm \[ \], cấm \( \).
- HỆ PHƯƠNG TRÌNH và các trường hợp: CẤM \begin{cases}, \begin{aligned}, \begin{align}.
  Chỉ dùng \begin{array} bọc trong \left, đúng một cặp $...$:
    hệ:              $\left\{\begin{array}{l}3x-2y=16 \\ 2x-3y=-6\end{array}\right.$
    hoặc/trường hợp: $\left[\begin{array}{l}x=\frac{\pi}{4}+k\pi \\ x=\frac{\pi}{6}+k\pi\end{array}\right.$
  Lý do: bản Word xuất ra được chuyển sang equation bằng MathType, và MathType chỉ
  nhận \begin{array}.
- Cấm tiếng Anh, cấm ký hiệu lập trình trần (*, /, ^), cấm viết tắt kiểu chat, cấm
  gạch đầu dòng markdown, cấm chèn chú thích.

Độ dài
- Trắc nghiệm: 3-6 dòng, gọn nhưng đủ căn cứ.
- Đúng/Sai: mỗi ý một đoạn riêng.
- Tự luận: trình bày đủ bước như bài mẫu trong SGK.`;

const HONESTY_RULES = String.raw`BA LUẬT BẮT BUỘC — làm sai là hỏng cả tài liệu

1. TÍNH TRƯỚC, DÒ SAU. Giải ra giá trị cụ thể rồi mới đối chiếu với các phương án.
   Không được nhìn phương án rồi suy ngược.
2. KHÔNG CHỌN "GẦN ĐÚNG". Nếu giá trị tính được không khớp phương án nào thì trả
   chon = "?" và trong lời giải nêu rõ giá trị đúng. Đề của trường CÓ THỂ in sai —
   đó là chuyện thường gặp, và báo đúng sự thật thì hữu ích hơn là đoán bừa.
3. THIẾU DỮ KIỆN THÌ NÓI THẲNG. Không tự nghĩ thêm số liệu, không giả định điều kiện
   mà đề không cho. Viết rõ trong lời giải là đề thiếu gì.`;

const FIGURE_RULES = String.raw`HÌNH VẼ MINH HOẠ

Quyết định có vẽ hay không:
- HÌNH HỌC KHÔNG GIAN LỚP 11 (hình chóp, lăng trụ, tứ diện, hình hộp; quan hệ song
  song / vuông góc; góc; khoảng cách) mà đề CHƯA CÓ HÌNH -> BẮT BUỘC vẽ (veHinh = true).
- TOẠ ĐỘ Oxyz LỚP 12 -> tự cân nhắc: vẽ khi hình giúp thấy quan hệ (mặt cầu tiếp xúc
  mặt phẳng, vị trí tương đối, hình chiếu, khoảng cách); KHÔNG vẽ khi bài thuần tính
  toán toạ độ / phương trình, vẽ thừa chỉ làm rối.
- Đề ĐÃ CÓ HÌNH, hoặc bài đại số / thống kê / dãy số -> veHinh = false.
- Luôn ghi lyDoHinh một câu ngắn giải thích quyết định.

Khi vẽ, hình phải HOÀN CHỈNH:
- Đủ đỉnh, mỗi đỉnh có nhãn đặt ngoài hình.
- Cạnh khuất vẽ NÉT ĐỨT (dashed), cạnh thấy vẽ nét liền.
- Đáy hình chóp/lăng trụ vẽ theo phối cảnh dạng hình bình hành, KHÔNG vẽ thành hình
  chữ nhật nhìn thẳng.
- Vẽ đủ đường cao, đoạn phụ, chân đường vuông góc mà lời giải có nhắc tới.
- Đánh dấu góc vuông ở nơi cần thiết.
${TIKZJAX_COMPAT_RULES}`;

const TYPE_RULES: Record<QType, string> = {
  TN: String.raw`LOẠI CÂU: trắc nghiệm bốn phương án.
- Trả chon là một trong "A", "B", "C", "D", hoặc "?" nếu không phương án nào khớp.
- ketQua: giá trị/kết luận bạn tính được, viết ngắn gọn.`,
  DS: String.raw`LOẠI CÂU: đúng/sai nhiều ý.
- Trả yKien: mỗi ý một phần tử, y là chữ cái ý ("a", "b", "c", "d"), dung là true/false,
  giaiThich là 1-3 dòng lý do theo phong cách SGK.
- KHÔNG trả chon.`,
  TLN: String.raw`LOẠI CÂU: trắc nghiệm trả lời ngắn.
- Trả dapSo là ĐÁP SỐ THUẦN, đúng dạng đề yêu cầu (làm tròn nếu đề nói rõ).
  Ví dụ: "54,3" hoặc "120". Không kèm đơn vị, không kèm chữ.
- KHÔNG trả chon.`,
  TL: String.raw`LOẠI CÂU: tự luận.
- Chỉ trả loiGiai, trình bày đủ bước như bài mẫu SGK.
- Nếu đề có nhiều ý a), b), c) thì mỗi ý một đoạn, mở đầu bằng "a)", "b)"...`,
};

export function solvePrompt(type: QType, variant: 0 | 1 | 2): string {
  const openings = [
    'Giải câu hỏi sau đây.',
    'Hãy giải độc lập câu hỏi sau. Tự tính từ đầu, đừng dựa vào bất kỳ lời giải nào khác.',
    'Đây là lượt phân xử: hai lời giải trước cho kết quả khác nhau. Giải lại thật cẩn thận, kiểm tra từng phép tính.',
  ];
  return [
    'Bạn là giáo viên toán THPT Việt Nam, đang soạn đáp án chi tiết cho đề kiểm tra.',
    '',
    openings[variant],
    '',
    TYPE_RULES[type],
    '',
    STYLE_RULES,
    '',
    HONESTY_RULES,
    '',
    FIGURE_RULES,
    '',
    'QUY TẮC VIẾT CÔNG THỨC',
    LATEX_MATH_RULES,
    '',
    'loiGiai là MẢNG CÁC DÒNG MMD (mỗi phần tử một dòng, không có ký tự xuống dòng bên trong).',
    'KHÔNG chép lại đề bài vào loiGiai.',
  ].join('\n');
}

/** Prompt soi lại hình vừa dựng, dựa trên ảnh render thật. */
export function figureCheckPrompt(questionText: string): string {
  return [
    'Đây là hình minh hoạ vừa được dựng cho câu hỏi bên dưới.',
    '',
    'CÂU HỎI:',
    questionText,
    '',
    'Soi kỹ ảnh: hình có đúng với đề không? Thiếu đỉnh, thiếu nhãn, thiếu đoạn phụ nào?' +
      ' Cạnh khuất đã là nét đứt chưa? Đáy đã vẽ theo phối cảnh chưa?',
    '',
    'Nếu hình ĐÃ ĐẠT: trả đúng một dòng "OK".',
    'Nếu CHƯA ĐẠT: trả về mã TikZ đã sửa, bắt đầu bằng \\begin{tikzpicture} và kết thúc' +
      ' bằng \\end{tikzpicture}, không kèm lời dẫn.',
    '',
    TIKZJAX_COMPAT_RULES,
  ].join('\n');
}

// ─── JSON schema cho từng loại câu ───────────────────────────────────────────

const FIGURE_FIELDS = {
  veHinh: { type: 'boolean', description: 'Có cần vẽ hình minh hoạ không' },
  lyDoHinh: { type: 'string', description: 'Một câu giải thích quyết định vẽ / không vẽ' },
  tikz: {
    type: 'string',
    description: 'Mã TikZ đầy đủ nếu veHinh = true, ngược lại để chuỗi rỗng',
  },
} as const;

const LOI_GIAI_FIELD = {
  loiGiai: {
    type: 'array',
    items: { type: 'string' },
    description: 'Các dòng lời giải theo phong cách SGK',
  },
} as const;

export function solveSchema(type: QType): Record<string, unknown> {
  const base: Record<string, unknown> = { ...LOI_GIAI_FIELD, ...FIGURE_FIELDS };
  const required = ['loiGiai', 'veHinh'];

  if (type === 'TN') {
    base.chon = { type: 'string', description: 'A, B, C, D hoặc ? nếu không phương án nào khớp' };
    base.ketQua = { type: 'string', description: 'Giá trị tính được' };
    required.push('chon');
  } else if (type === 'DS') {
    base.yKien = {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          y: { type: 'string', description: 'a, b, c hoặc d' },
          dung: { type: 'boolean' },
          giaiThich: { type: 'string' },
        },
        required: ['y', 'dung', 'giaiThich'],
      },
    };
    required.push('yKien');
  } else if (type === 'TLN') {
    base.dapSo = { type: 'string', description: 'Đáp số thuần, ví dụ 54,3' };
    required.push('dapSo');
  }

  return { type: 'object', properties: base, required };
}
