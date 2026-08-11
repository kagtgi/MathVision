/**
 * Chấm điểm bản vẽ lại so với ảnh cắt gốc, rồi mới quyết định có thay hay không.
 *
 * VÌ SAO CẦN: đường vẽ lại của bản trước thay ảnh cắt ngay khi mã TikZ compile được. Bước
 * soát duy nhất trong đó (`verifyPrompt`) chỉ đọc ảnh gốc và hai chuỗi mã — nó KHÔNG BAO GIỜ
 * nhìn thấy ảnh mình vừa dựng. Nên một hình vẽ sai mà vẫn dựng được sẽ âm thầm ghi đè một ảnh
 * cắt hoàn toàn đọc được, và người dùng chỉ phát hiện khi mở file Word ra xem.
 *
 * Ở đây đưa HAI ẢNH cạnh nhau trong cùng một lượt gọi: ảnh cắt từ đề, và ảnh TikZ vừa dựng.
 * Thua thì giữ ảnh cắt — đúng nguyên tắc "ảnh cắt là lưới an toàn" của `figures.ts`.
 */

import { callGemini, TEMP_PRECISE } from '../pipeline/geminiClient';
import { figureRulesFor, type FigureCategory } from './figurePrompts.ts';

export interface RedrawVerdict {
  keep: 'tikz' | 'crop';
  why: string;
  missing: string[];
  extra: string[];
}

const SCHEMA = {
  type: 'object',
  properties: {
    giu: { type: 'string', enum: ['tikz', 'crop'], description: 'Bản nào nên dùng' },
    lyDo: { type: 'string', description: 'Một câu ngắn vì sao' },
    thieu: { type: 'array', items: { type: 'string' }, description: 'Thứ ảnh 1 có mà ảnh 2 thiếu' },
    them: { type: 'array', items: { type: 'string' }, description: 'Thứ ảnh 2 có mà ảnh 1 không có' },
  },
  required: ['giu', 'lyDo'],
} as const;

function prompt(kind: FigureCategory): string {
  return [
    'Bạn nhận HAI ảnh của cùng một hình:',
    '  ẢNH 1 — ảnh cắt trực tiếp từ đề gốc. Đây là bản CHUẨN về nội dung, dù nét có thể mờ,',
    '          lệch, hoặc dính một chút chữ bên cạnh.',
    '  ẢNH 2 — bản vẽ lại bằng TikZ. Nét sạch hơn, nhưng có thể sai nội dung.',
    '',
    'Việc của bạn: quyết định nên đưa bản NÀO vào tài liệu.',
    '',
    'Chọn "tikz" khi ảnh 2 giữ ĐÚNG mọi quan hệ toán học của ảnh 1 và không bịa thêm gì.',
    'Chọn "crop" khi ảnh 2 có BẤT KỲ lỗi nào sau đây:',
    '- thiếu điểm, thiếu nhãn, thiếu đoạn, thiếu đường phụ có trong ảnh 1;',
    '- có điểm/đoạn/nhãn KHÔNG có trong ảnh 1;',
    '- nhãn sai tên, hoặc đặt sai vị trí tới mức gây hiểu nhầm;',
    '- điểm không nằm đúng trên cạnh/mặt của nó; trung điểm không ở giữa;',
    '- quan hệ song song / vuông góc / cắt nhau khác với ảnh 1;',
    '- hai đường chéo nhau bị vẽ thành cắt nhau;',
    '- hình gần như trắng, hoặc bố cục méo tới mức khó đọc.',
    '',
    'Nét mờ hay hơi lệch KHÔNG phải lý do để chọn "crop" — ảnh cắt vốn mờ. Chỉ nội dung sai',
    'mới là lý do. Ngược lại, nét sạch KHÔNG bù được cho nội dung sai.',
    '',
    'Khi phân vân thì chọn "crop": đưa ảnh mờ mà đúng vào tài liệu còn hơn đưa hình sạch mà sai.',
    '',
    figureRulesFor(kind),
  ].join('\n');
}

export async function scoreRedraw(
  apiKey: string,
  cropBase64: string,
  tikzBase64: string,
  kind: FigureCategory,
): Promise<RedrawVerdict> {
  try {
    const res = await callGemini(apiKey, {
      parts: [
        { text: prompt(kind) },
        { text: 'ẢNH 1 — ảnh cắt từ đề gốc:' },
        { inlineData: { data: cropBase64, mimeType: 'image/png' } },
        { text: 'ẢNH 2 — bản vẽ lại bằng TikZ:' },
        { inlineData: { data: tikzBase64, mimeType: 'image/png' } },
      ],
      temperature: TEMP_PRECISE,
      responseSchema: SCHEMA,
      label: 'tikz-score',
    });
    const parsed = JSON.parse(res.text) as {
      giu?: string;
      lyDo?: string;
      thieu?: string[];
      them?: string[];
    };
    return {
      // Không đọc được câu trả lời thì giữ ảnh cắt — mặc định an toàn.
      keep: parsed.giu === 'tikz' ? 'tikz' : 'crop',
      why: parsed.lyDo ?? 'không rõ',
      missing: parsed.thieu ?? [],
      extra: parsed.them ?? [],
    };
  } catch (err) {
    // Chấm hỏng thì KHÔNG được mặc định thay: giữ ảnh cắt.
    return {
      keep: 'crop',
      why: `không chấm được (${err instanceof Error ? err.message : 'lỗi không rõ'})`,
      missing: [],
      extra: [],
    };
  }
}
