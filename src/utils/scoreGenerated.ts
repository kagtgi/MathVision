/**
 * Chấm ảnh do AI SINH so với ảnh cắt gốc, trước khi cho nó vào tài liệu.
 *
 * VÌ SAO LÀ FILE RIÊNG, KHÔNG PHẢI THÊM THAM SỐ CHO `scoreRedraw`: bộ lỗi khác hẳn. TikZ chỉ hỏng
 * theo những cách TikZ diễn đạt được; model sinh ảnh thêm cả một họ lỗi mới — bịa số trục, chữ
 * nhoè, đường mượt-mà-sai, và "hình mẫu hoá" (vẽ một hình mẫu cùng loại thay vì đúng hình này).
 * Và giữ `scoreRedraw` không đụng tới nghĩa là đường TikZ đang chạy tốt không có nguy cơ regress.
 *
 * BA THIẾT KẾ CHÍNH:
 *  1. **Liệt kê TRƯỚC, kết luận SAU.** Đếm và liệt kê là việc model làm đáng tin; "chọn ảnh nào
 *     đẹp hơn" thì không. Bắt nó ghi nhãn của cả hai ảnh trước khi chốt biến phép so nhãn thành
 *     phép so tập hợp TẤT ĐỊNH trong code.
 *  2. **Quyết định nằm ở CODE, không ở model** (xem cuối file).
 *  3. **Im lặng = từ chối.** Đòi mảng `loi` rỗng một cách CHỦ ĐỘNG, nên model không trả lời được
 *     phần soi lỗi là giữ ảnh cắt.
 */

import { callGemini, TEMP_PRECISE } from '../pipeline/geminiClient.ts';
import { figureRulesFor, type FigureCategory } from './figurePrompts.ts';

export interface GenVerdict {
  keep: 'genai' | 'crop';
  why: string;
  /** Mã lỗi trọng tài tìm thấy, để ghi nhật ký. */
  loi: string[];
  doTinCay: number;
}

const LOI_CODES = [
  'trangTri',
  'soBia',
  'chuBia',
  'chuNhoe',
  'chuVietSai',
  'thieuNhan',
  'duongSai',
  'netKhuat',
  'hinhMau',
  'anhThat',
  'watermark',
  'khungAnh',
] as const;

const SCHEMA = {
  type: 'object',
  properties: {
    nhanAnh1: {
      type: 'array',
      items: { type: 'string' },
      description: 'Mọi nhãn chữ đọc được trong ảnh cắt gốc, đúng từng ký tự',
    },
    nhanAnh2: {
      type: 'array',
      items: { type: 'string' },
      description: 'Mọi nhãn chữ trong ảnh AI sinh; nhãn nhoè không đọc được thì ghi "???"',
    },
    loi: {
      type: 'array',
      items: { type: 'string', enum: LOI_CODES as unknown as string[] },
      description: 'Mã các lỗi tìm thấy ở ảnh 2; không có lỗi nào thì mảng rỗng',
    },
    thieu: { type: 'array', items: { type: 'string' }, description: 'Thứ ảnh 1 có mà ảnh 2 thiếu' },
    them: { type: 'array', items: { type: 'string' }, description: 'Thứ ảnh 2 có mà ảnh 1 không có' },
    giu: { type: 'string', enum: ['gen', 'crop'], description: 'Bản nào nên đưa vào tài liệu' },
    doTinCay: { type: 'integer', description: '0-100: mức tin ảnh 2 in vào đề thi mà không gây hiểu sai' },
    lyDo: { type: 'string', description: 'Một câu ngắn vì sao' },
  },
  required: ['nhanAnh1', 'nhanAnh2', 'loi', 'giu', 'doTinCay', 'lyDo'],
} as const;

function prompt(kind: FigureCategory, context: string): string {
  return [
    'Bạn là người soát hình cho đề thi in ra giấy. Bạn nhận HAI ảnh của cùng một hình.',
    '  ẢNH 1 — ảnh cắt trực tiếp từ đề gốc. Đây là bản CHUẨN về nội dung, dù nét có thể mờ,',
    '          có hạt, hoặc dính một sợi chữ bên cạnh.',
    '  ẢNH 2 — ảnh do AI SINH RA từ ảnh 1. Nét sạch hơn, nhưng AI sinh ảnh có thể BỊA: thêm',
    '          chi tiết, thêm số, viết chữ nhoè, hoặc vẽ một hình MẪU cùng loại thay vì vẽ',
    '          đúng hình trong ảnh 1.',
    '',
    'ĐỀ BÀI (chỉ dùng để đọc những nhãn bị mờ trong ẢNH 1):',
    '<<<',
    context || '(không có)',
    '>>>',
    'Thứ mà ĐỀ nhắc nhưng ẢNH 1 KHÔNG CÓ thì ẢNH 2 cũng KHÔNG ĐƯỢC CÓ. Đề không bao giờ là',
    'lý do để chấp nhận một thành phần mà ảnh 1 không có.',
    context
      ? ''
      : 'Không có đề bài kèm theo, nên CHỈ được chọn "gen" khi ảnh 2 khớp ảnh 1 ở MỌI nhãn còn đọc được.',
    '',
    'BƯỚC 1 — LIỆT KÊ TRƯỚC, ĐỪNG KẾT LUẬN TRƯỚC.',
    'Đọc hết nhãn chữ trong ẢNH 1, ghi vào nhanAnh1 (mỗi nhãn một phần tử, đúng từng ký tự,',
    'kể cả dấu phẩy trên và chỉ số). Rồi đọc hết nhãn chữ trong ẢNH 2, ghi vào nhanAnh2.',
    'Nhãn nào trong ảnh 2 nhoè / méo / không đọc được thì ghi đúng chuỗi "???".',
    '',
    'BƯỚC 2 — SOI 12 LỖI SAU. Thấy lỗi nào thì thêm mã đó vào mảng loi:',
    '  trangTri   — ảnh 2 có nét/dấu/mũi tên/lưới ô/đường gióng/hoa văn mà ảnh 1 không có',
    '  soBia      — ảnh 2 có số (mốc trục, độ dài, số đo góc, toạ độ, đơn vị) mà ảnh 1 không in',
    '  chuBia     — ảnh 2 có chữ mà ảnh 1 không có: tiêu đề, chú thích, "Hình 1", tên trục lạ',
    '  chuNhoe    — ảnh 2 có ký tự nhoè, méo, ký tự giả, chữ lặp, chữ không đọc ra được',
    '  chuVietSai — chữ tiếng Việt trong ảnh 2 sai chữ, sai dấu, hoặc ảnh 1 không có mà ảnh 2 thêm',
    '  thieuNhan  — ảnh 2 thiếu nhãn có trong ảnh 1, hoặc nhãn bị đổi tên / hoán vị',
    '  duongSai   — đường/cạnh của ảnh 2 sai hình dạng so với ảnh 1: điểm không còn nằm trên cạnh',
    '               của nó, quan hệ song song / vuông góc / cắt nhau đổi khác',
    '  netKhuat   — cạnh ảnh 1 để nét ĐỨT mà ảnh 2 vẽ nét LIỀN, hoặc ngược lại',
    '  hinhMau    — ảnh 2 vẽ một hình MẪU cùng loại chứ không phải đúng hình của ảnh 1 (đã',
    '               "chuẩn hoá" dáng hình, đổi hướng nghiêng, đổi bố cục)',
    '  anhThat    — ảnh 2 có tô bóng, gradient, hiệu ứng 3D, chất liệu, nền không trắng, như ảnh chụp',
    '  watermark  — ảnh 2 có watermark, logo, chữ ký, khung viền, chú thích dưới hình',
    '  khungAnh   — ảnh 2 bị méo tỉ lệ, bị xoay, hoặc bị cắt cụt một phần hình / một phần nhãn',
    '',
    'BƯỚC 3 — KẾT LUẬN.',
    'Chọn "gen" CHỈ KHI mảng loi RỖNG và nhanAnh2 khớp nhanAnh1 từng phần tử.',
    'Chọn "crop" trong mọi trường hợp còn lại.',
    'Nét mờ, hạt, dính một sợi chữ bên cạnh KHÔNG phải lỗi của ảnh 1 và không phải lý do bỏ',
    'ảnh 1 — ảnh cắt vốn mờ. Ngược lại, NÉT SẠCH KHÔNG BÙ ĐƯỢC cho nội dung sai.',
    'doTinCay: 0-100, mức bạn tin ảnh 2 in vào đề thi cho học sinh mà không gây hiểu sai.',
    'Phân vân thì chọn "crop": in ảnh mờ mà đúng còn hơn in hình sạch mà sai.',
    '',
    figureRulesFor(kind),
  ]
    .filter((l) => l !== '')
    .join('\n');
}

/** Chuẩn hoá nhãn để so tập hợp: bỏ `$`, khoảng trắng, và hạ chữ thường. */
const normLabel = (s: string) => s.replace(/[$\s{}]/g, '').toLowerCase();

export interface ScoreGeneratedInput {
  apiKey: string;
  cropBase64: string;
  genBase64: string;
  kind: FigureCategory;
  /** Đề bài quanh hình; rỗng = không tìm được. */
  context?: string;
  models?: string[];
  signal?: AbortSignal;
}

export async function scoreGenerated(i: ScoreGeneratedInput): Promise<GenVerdict> {
  try {
    const res = await callGemini(i.apiKey, {
      parts: [
        { text: prompt(i.kind, i.context ?? '') },
        { text: 'ẢNH 1 — ảnh cắt từ đề gốc:' },
        { inlineData: { data: i.cropBase64, mimeType: 'image/png' } },
        { text: 'ẢNH 2 — ảnh do AI sinh:' },
        { inlineData: { data: i.genBase64, mimeType: 'image/png' } },
      ],
      temperature: TEMP_PRECISE,
      responseSchema: SCHEMA,
      label: 'gen-score',
      models: i.models,
      signal: i.signal,
    });

    const p = JSON.parse(res.text) as {
      nhanAnh1?: string[];
      nhanAnh2?: string[];
      loi?: string[];
      giu?: string;
      doTinCay?: number;
      lyDo?: string;
    };

    // Lọc rỗng ở CẢ HAI mảng. Lọc một bên thôi thì model trả kèm một chuỗi rỗng là lệch số lượng
    // -> `labelsMatch` false -> loại oan một ảnh có thể đúng.
    const a1 = (p.nhanAnh1 ?? []).map((s) => s.trim()).filter(Boolean);
    const a2 = (p.nhanAnh2 ?? []).map((s) => s.trim()).filter(Boolean);
    const loi = p.loi ?? [];
    const doTinCay = typeof p.doTinCay === 'number' ? p.doTinCay : 0;

    // Phép so nhãn TẤT ĐỊNH: cùng số lượng, không có nhãn nhoè, và cùng tập hợp.
    // Chuẩn hoá CẢ HAI bên (bỏ `$`, khoảng trắng, hạ chữ thường) — chuẩn một bên thì `$A$` và
    // `A` thành hai nhãn khác nhau và không ảnh nào khớp được.
    const set1 = new Set(a1.map(normLabel).filter(Boolean));
    const set2 = new Set(a2.map(normLabel).filter(Boolean));
    const labelsMatch =
      a1.length === a2.length &&
      !a2.some((l) => l === '???') &&
      set1.size === set2.size &&
      [...set1].every((l) => set2.has(l));

    // QUYẾT ĐỊNH Ở CODE: model chỉ cung cấp số liệu, không được tự chốt.
    const keep = p.giu === 'gen' && loi.length === 0 && doTinCay >= 80 && labelsMatch;

    const why = keep
      ? (p.lyDo ?? 'đạt')
      : loi.length
        ? `lỗi: ${loi.join(', ')}`
        : !labelsMatch
          ? 'nhãn không khớp ảnh cắt'
          : doTinCay < 80
            ? `độ tin cậy chỉ ${doTinCay}%`
            : (p.lyDo ?? 'không đạt');

    return { keep: keep ? 'genai' : 'crop', why, loi, doTinCay };
  } catch (err) {
    // Chấm hỏng thì KHÔNG được mặc định thay — đúng luật của `scoreRedraw`.
    return {
      keep: 'crop',
      why: `không chấm được (${err instanceof Error ? err.message : 'lỗi không rõ'})`,
      loi: [],
      doTinCay: 0,
    };
  }
}
