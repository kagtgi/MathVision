/**
 * Prompt OCR: ảnh trang -> Mathpix Markdown (MMD).
 *
 * Toàn bộ pipeline phía sau (chuẩn hoá, tái cấu trúc, sinh docx) đã được kiểm chứng
 * trên MMD do Mathpix xuất ra. Nhiệm vụ của prompt này là ép Gemini viết ĐÚNG phương
 * ngữ đó. Ba lớp bảo vệ: prompt (có ví dụ mẫu + self-check) -> conform.ts (sửa tất
 * định) -> qc.ts (cảnh báo phần không tự sửa được).
 *
 * `$TeX$` là cú pháp inline math CHÍNH THỨC của Mathpix Markdown (ngang hàng `\( \)`),
 * nên yêu cầu dùng `$...$` vừa đúng chuẩn vừa khớp pipeline.
 */

import { ANTI_HALLUCINATION, LATEX_MATH_RULES } from '../utils/sharedPrompts.ts';

/** Ví dụ mẫu trích từ đề đã xử lý đạt chuẩn (MMD KTTX/11CA2_KTTX3_HK1.mmd). */
const GOLD_EXAMPLE = String.raw`PHẦN I. CÂU TRẮC NGHIỆM NHIỀU PHƯƠNG ÁN LỰA CHỌN

Câu 1. Trung vị của mẫu số liệu ghép nhóm

A. xác định chính xác trung vị của mẫu số liệu gốc.
B. là giá trị xấp xỉ cho mẫu số liệu gốc.
C. không thể lấy làm giá trị đại diện.
D. chia mẫu số liệu thành bốn phần bằng nhau.

Câu 2. Cho mẫu số liệu ghép nhóm sau:

| Nhóm | Tần số |
| :--- | :--- |
| $[40; 45)$ | 4 |
| $[45; 50)$ | 11 |

Trung vị của mẫu số liệu trên là
A. 50.
B. 45.
C. 55.
D. 40.

Câu 3. Cho hình chóp $S.ABCD$ có đáy $ABCD$ là hình vuông cạnh $a$, $SA \perp (ABCD)$ và $SA = a\sqrt{3}$.

![](#p1_f1){bbox=58.4,22.7,34.0,26.5}

Góc giữa $SC$ và mặt phẳng $(ABCD)$ bằng
A. $30^{\circ}$.
B. $45^{\circ}$.
C. $60^{\circ}$.
D. $90^{\circ}$.

PHẦN II. CÂU TRẮC NGHIỆM ĐÚNG SAI

Câu 1. Cho dãy số $\left(u_{n}\right)$ có công thức truy hồi $\left\{\begin{array}{l}u_{1}=2 \\ u_{n+1}=3 u_{n}\end{array}\right.$

a) $u_{2}=6$.
b) Dãy số $\left(u_{n}\right)$ là cấp số cộng.`;

const STRUCTURE_RULES = String.raw`QUY TẮC CẤU TRÚC

1. Thứ tự đọc: trên xuống dưới, trái sang phải. Trang chia hai cột thì đọc hết cột
   trái rồi mới sang cột phải.
2. MỌI công thức toán nằm trong một cặp $...$ ĐƠN. TUYỆT ĐỐI không dùng $$, không
   dùng \[ \], không dùng \( \). Cấu trúc nhiều dòng vẫn phải nằm gọn trong một cặp
   $...$, ví dụ hệ phương trình:
   $\left\{\begin{array}{l}x + y = 1 \\ x - y = 3\end{array}\right.$
3. Dòng câu hỏi: đúng dạng "Câu N." hoặc "Câu N:" ở đầu dòng. GIỮ NGUYÊN số câu in
   trên đề, kể cả khi đề in trùng số — không đánh lại.
4. Phương án trắc nghiệm: mỗi phương án MỘT DÒNG, dạng "A. nội dung". Không gộp 4
   phương án vào một dòng, không thêm dấu đầu dòng markdown.
5. Ý đúng/sai: mỗi ý một dòng, dạng "a) nội dung".
6. Bảng: dùng bảng pipe GitHub, BẮT BUỘC có dòng phân cách ngay sau hàng đầu:
   | Nhóm | Tần số |
   | :--- | :--- |
   | $[40; 45)$ | 4 |
   Chỉ dùng \begin{tabular} khi bảng có ô gộp mà pipe không diễn tả được.
7. Tiêu đề phần ("PHẦN I. ...", "1. Trắc nghiệm ...") viết thành DÒNG THƯỜNG, không
   thêm dấu #.
8. Nếu trang có bảng đáp án tổng hợp: mở đầu bằng dòng "## ĐÁP ÁN" rồi tới bảng pipe
   "| Câu | 1 | 2 | ..." và "| Đáp án | ... |".
   Nếu trang có phần lời giải: mở đầu bằng dòng "## HƯỚNG DẪN GIẢI", mỗi lời giải bắt
   đầu bằng "Câu N." và với câu trắc nghiệm thì có dòng "Chọn X." trước phần trình bày.
9. Khoảng số và số thập phân kiểu Việt cũng là công thức: $[40; 45)$, $3{,}14$.

BỎ HẲN, KHÔNG CHÉP LẠI
- Tiêu đề/chân trang lặp lại mỗi trang, số trang ("Trang 1/4"), watermark.
- Phiếu tô trắc nghiệm (lưới ○○○○), ô ghi Họ tên / Lớp / SBD của phiếu làm bài.
- Dòng kẻ trống ____ để học sinh viết, khung "Bài làm", dòng ---HẾT---.
- Chú thích của chính bạn. Mathpix Markdown KHÔNG có cú pháp comment — đừng chèn.

HÌNH VẼ
Hình học, đồ thị hàm số, biểu đồ, ảnh thực tế (KHÔNG tính logo trường, hoa văn trang
trí) — xuất ĐÚNG MỘT DÒNG tại đúng vị trí trong mạch đọc:
  ![](#p{PAGE}_f{K}){bbox=x,y,w,h}
với x,y là góc trên trái, w,h là kích thước, tất cả tính theo PHẦN TRĂM của ảnh trang
này (một chữ số thập phân); K đánh số 1,2,3... theo thứ tự đọc trong trang.
Không mô tả hình bằng lời, không bỏ trống dòng này.`;

const SELF_CHECK = String.raw`TỰ KIỂM TRA trước khi xuất (sửa ngay nếu sai):
□ Số dấu $ trên mỗi dòng là số chẵn.
□ Không còn $$, \[ \], \( \) ở bất cứ đâu.
□ Mỗi bảng đều có dòng phân cách | :--- | ngay sau hàng đầu.
□ Mỗi hình đều có đủ bbox bốn số.
□ Không có chữ tiếng Việt nằm bên trong $...$.
□ Không thêm bất cứ thứ gì không có trên trang.`;

const OUTPUT_HEADER = `Bạn là bộ OCR chuẩn Mathpix cho đề thi toán THPT Việt Nam.

ĐẦU RA: chỉ văn bản Mathpix Markdown (MMD). Không code fence, không JSON, không lời
dẫn. Bắt đầu ngay bằng dòng nội dung đầu tiên.`;

export const MMD_PAGE_PROMPT = [
  OUTPUT_HEADER,
  '\nChép lại TOÀN BỘ nội dung của ảnh trang này.',
  STRUCTURE_RULES,
  '\nQUY TẮC VIẾT CÔNG THỨC\n' + LATEX_MATH_RULES,
  ANTI_HALLUCINATION,
  '\nVÍ DỤ MẪU — đầu ra phải trông đúng như thế này:\n\n' + GOLD_EXAMPLE,
  '\n' + SELF_CHECK,
].join('\n');

export const MMD_IMAGE_PROMPT = [
  OUTPUT_HEADER,
  '\nChép lại TOÀN BỘ nội dung của ảnh chụp/quét tài liệu này. Coi cả ảnh là một trang' +
    ' (dùng tiền tố `p1` cho id hình).',
  STRUCTURE_RULES,
  '\nQUY TẮC VIẾT CÔNG THỨC\n' + LATEX_MATH_RULES,
  ANTI_HALLUCINATION,
  '\nVÍ DỤ MẪU — đầu ra phải trông đúng như thế này:\n\n' + GOLD_EXAMPLE,
  '\n' + SELF_CHECK,
].join('\n');

/** Ngữ cảnh đuôi trang trước, để nối liền câu/bảng bị cắt ngang trang. */
export function pageContextPart(pageNumber: number, totalPages: number, prevTail: string): string {
  const tail = prevTail.trim();
  return [
    `TRANG: ${pageNumber}/${totalPages}`,
    '',
    'PHẦN CUỐI CỦA BẢN CHÉP TRANG TRƯỚC:',
    tail ? tail.slice(-800) : '(chưa có — đây là trang đầu)',
    '',
    'Nếu trang này bắt đầu giữa chừng một câu, một bảng hay một lời giải thì chép tiếp' +
      ' cho liền mạch. KHÔNG chép lại phần đã có ở trên. KHÔNG lặp lại tiêu đề đề thi.',
  ].join('\n');
}

export function continuationPrompt(soFar: string): string {
  return [
    'Bản chép trang này bị cắt giữa chừng. Nó đang dừng ở:',
    '<<<',
    soFar.slice(-1000),
    '>>>',
    '',
    'Chép TIẾP từ đúng chỗ đó, giữ nguyên mọi quy tắc đã nêu.',
    'CHỈ xuất phần tiếp theo — không lặp lại bất cứ dòng nào ở trên.',
  ].join('\n');
}

// ─── Bóc hình + bbox ─────────────────────────────────────────────────────────

export interface FigureRef {
  id: string;
  /** [x, y, w, h] theo phần trăm ảnh trang. */
  bbox: [number, number, number, number];
}

/**
 * Regex khoan dung: chấp nhận alt text, dấu `#` tuỳ chọn, ngăn cách bằng `,` hoặc `;`,
 * `bbox=` hoặc `bbox:`, và thuộc tính lạ đứng cạnh trong cùng cặp ngoặc nhọn.
 */
const FIG_LINE =
  /!\[[^\]]*\]\(\s*#?([\w-]+)\s*\)\s*\{[^}]*bbox\s*[:=]\s*([\d.]+)\s*[,;]\s*([\d.]+)\s*[,;]\s*([\d.]+)\s*[,;]\s*([\d.]+)[^}]*\}/g;

const FIG_LINE_NO_BBOX = /^\s*!\[[^\]]*\]\(\s*#[\w-]+\s*\)\s*$/;

/**
 * Tách khai báo hình ra khỏi MMD: giữ lại `![](#id)` sạch (dạng mà mọi transform phía
 * sau hiểu được) và trả danh sách bbox để cắt ảnh.
 *
 * Dự phòng: nếu mô hình lỡ xuất khối ```json {"figures":[...]} ở cuối thì đọc luôn.
 */
export function extractFigures(mmd: string): {
  mmd: string;
  figures: FigureRef[];
  warnings: string[];
} {
  const figures: FigureRef[] = [];
  const warnings: string[] = [];

  let text = mmd.replace(FIG_LINE, (_m, id: string, x: string, y: string, w: string, h: string) => {
    figures.push({
      id,
      bbox: [parseFloat(x), parseFloat(y), parseFloat(w), parseFloat(h)],
    });
    return `![](#${id})`;
  });

  // Dự phòng: khối JSON đuôi liệt kê hình
  const jsonTail = text.match(/```json\s*(\{[\s\S]*?"figures"[\s\S]*?\})\s*```/);
  if (jsonTail) {
    try {
      const parsed = JSON.parse(jsonTail[1]) as { figures?: Array<{ id?: string; bbox?: number[] }> };
      for (const f of parsed.figures ?? []) {
        const id = String(f.id ?? '').replace(/^#/, '');
        const b = f.bbox;
        if (!id || !Array.isArray(b) || b.length !== 4) continue;
        if (figures.some((x) => x.id === id)) continue;
        figures.push({ id, bbox: [b[0], b[1], b[2], b[3]] });
      }
      text = text.replace(jsonTail[0], '').trimEnd();
    } catch {
      warnings.push('Khối JSON hình ở cuối trang không đọc được — đã bỏ qua.');
    }
  }

  // Hình không có bbox và cũng không khớp id nào -> bỏ dòng, báo cho người dùng
  const known = new Set(figures.map((f) => f.id));
  const kept: string[] = [];
  for (const line of text.split('\n')) {
    if (FIG_LINE_NO_BBOX.test(line)) {
      const id = line.match(/#([\w-]+)/)?.[1] ?? '';
      if (!known.has(id)) {
        warnings.push(`Hình "${id}" không có toạ độ bbox — đã bỏ dòng ảnh.`);
        continue;
      }
    }
    kept.push(line);
  }

  return { mmd: kept.join('\n'), figures, warnings };
}
