/**
 * Hai định dạng đầu ra.
 *
 * `k11` — chuẩn file mẫu K11-Đề-tặng-kèm-số-1: Times New Roman 12pt, "Câu N." đậm xanh,
 * đáp án đúng gạch chân, dòng "Chọn X." highlight xanh lá, footer "Trang N".
 *
 * `vdc` — chuẩn nhóm VDC Bhp, đo từ hai file mẫu của người dùng (16-18_Mitu.docx,
 * 65-68_Mitu.docx): Palatino Linotype 11.5pt, KHÔNG in "Câu N.", bốn phương án nằm một
 * dòng, đáp án đúng đậm đỏ + highlight vàng + gạch chân, ý đúng/sai thành dòng riêng
 * "a) SAI" in hoa, câu trả lời ngắn dùng ô đáp án 1×4 nền vàng, có header của nhóm.
 */

export type DocFormat = 'k11' | 'vdc';

export interface FormatInfo {
  id: DocFormat;
  label: string;
  hint: string;
  /** VDC còn xuất kèm .txt theo quy ước LaTeX của nhóm. */
  hasTxt: boolean;
}

export const FORMATS: FormatInfo[] = [
  {
    id: 'k11',
    label: 'Định dạng thường',
    hint: 'Chuẩn đề tặng kèm K11 — Times New Roman, có "Câu N.", footer số trang',
    hasTxt: false,
  },
  {
    id: 'vdc',
    label: 'Định dạng VDC',
    hint: 'Chuẩn nhóm VDC Bhp — Palatino Linotype, bỏ "Câu N.", đáp án đúng bôi vàng',
    hasTxt: true,
  },
];

export function formatInfo(id: DocFormat): FormatInfo {
  return FORMATS.find((f) => f.id === id) ?? FORMATS[0];
}
