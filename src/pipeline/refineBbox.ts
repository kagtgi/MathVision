/**
 * Xin lại bbox của MỘT hình, sau khi cửa `cropGate` phát hiện bản cắt là chữ của đề.
 *
 * VÌ SAO KHÔNG đọc lại cả trang: lượt đọc trang đã cho MMD đúng và bộ id đã được `scopeFigureIds`
 * chốt; đọc lại là sinh ra bộ id mới có thể lệch với các dòng `![](#id)` đã nằm trong MMD, tức
 * đổi một lỗi thấy được thành một lỗi trỏ hư không. Ở đây chỉ hỏi bốn con số.
 *
 * VÌ SAO CÓ THỂ SỬA ĐƯỢC: kiểu sai đã đo là "đúng hình dạng, sai dòng" — model nhận ra hình,
 * chỉ đặt sai chỗ theo trục dọc. Nói thẳng cho nó biết hộp cũ rơi vào chữ gì thì nó có đủ thông
 * tin để tìm lại đúng dòng, và lần này chỉ phải làm một việc chứ không phải chép cả trang.
 */

import { callGemini, TEMP_PRECISE } from './geminiClient.ts';
import type { Bbox } from './figures.ts';

export interface RefineInput {
  imageBase64: string;
  mimeType: string;
  /** Hộp đã cắt ra chữ, để bảo model TRÁNH đúng chỗ đó. */
  badBbox: Bbox;
  /** Vì sao bị từ chối, nguyên văn từ `textBlockReason`. */
  why: string;
  /** Đề bài quanh hình, giúp model biết đang phải tìm hình của câu nào. */
  context?: string;
}

const prompt = (input: RefineInput): string => {
  const [x, y, w, h] = input.badBbox;
  return `Trên ảnh trang này có MỘT hình vẽ cần khoanh lại.

Lần trước bạn khoanh vùng x=${x}, y=${y}, w=${w}, h=${h} (phần trăm ảnh, gốc trên trái).
Vùng đó SAI: ${input.why}.

Hình vẽ thật nằm ở CHỖ KHÁC trên trang. Hãy tìm vùng chỉ có NÉT VẼ (hình học, đồ thị, bảng
biến thiên, ảnh minh hoạ) và nhãn ngắn trên hình — không phải dòng chữ của đề, không phải
phương án A-D, không phải bảng số liệu gõ được thành chữ.

Kinh nghiệm: hộp cũ thường đúng bề rộng và đúng kích thước, chỉ sai VỊ TRÍ THEO CHIỀU DỌC.
Hãy soát lại toàn bộ chiều cao trang trước khi trả lời.
${input.context ? `\nĐề bài của câu chứa hình, chỉ để bạn biết phải tìm hình gì:\n<<<\n${input.context}\n>>>\n` : ''}
Trả về ĐÚNG MỘT DÒNG, không giải thích, không xuống dòng thêm:
bbox=x,y,w,h

Nếu cả trang KHÔNG có hình vẽ nào thì trả về đúng chữ: KHONG-CO`;
};

/** Đọc `bbox=x,y,w,h` ở bất cứ đâu trong câu trả lời; trả `null` nếu không có bộ bốn số hợp lệ. */
export function parseBboxReply(text: string): Bbox | null {
  const m = /bbox\s*[:=]\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(text);
  if (!m) return null;
  const v = [1, 2, 3, 4].map((i) => parseFloat(m[i])) as Bbox;
  if (!v.every((n) => Number.isFinite(n) && n >= 0 && n <= 100)) return null;
  if (v[2] <= 0 || v[3] <= 0) return null;
  // Hộp phải nằm trong trang, và không được trùm gần hết trang (thế thì cắt cũng vô nghĩa).
  if (v[0] + v[2] > 100.5 || v[1] + v[3] > 100.5) return null;
  if (v[2] * v[3] > 6000) return null;
  return v;
}

export async function refineFigureBbox(
  apiKey: string,
  input: RefineInput,
  opts: {
    signal?: AbortSignal;
    onLog?: (line: string) => void;
    models?: string[];
    label?: string;
  } = {},
): Promise<Bbox | null> {
  try {
    const res = await callGemini(apiKey, {
      parts: [
        { text: prompt(input) },
        { inlineData: { mimeType: input.mimeType, data: input.imageBase64 } },
      ],
      temperature: TEMP_PRECISE,
      /**
       * Câu trả lời chỉ một dòng, nhưng hạn mức này gồm CẢ token suy nghĩ của model — đặt 256
       * thì phần suy nghĩ ăn hết và câu trả lời bị cắt GIỮA CON SỐ. Đo thật: trả về đúng chuỗi
       * `"bbox=38.5,6"`, tức nó đã tìm ra vùng đúng (y≈62) mà vẫn coi như thất bại.
       */
      maxOutputTokens: 8192,
      signal: opts.signal,
      models: opts.models,
      label: opts.label ?? 'khoanh lại hình',
      onLog: opts.onLog,
    });
    const box = parseBboxReply(res.text);
    // Đọc không ra thì PHẢI ghi lại nguyên văn: đây là chẩn đoán duy nhất phân biệt "model nói
    // trang không có hình" với "model trả đúng số nhưng sai khuôn chữ".
    if (!box) opts.onLog?.(`khoanh lại: không đọc được bbox từ "${res.text.trim().slice(0, 160)}"`);
    return box;
  } catch (err) {
    // Không ném: hỏng lượt này thì bên gọi vẫn còn đường bỏ hình kèm cảnh báo.
    opts.onLog?.(`khoanh lại hình hỏng: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
