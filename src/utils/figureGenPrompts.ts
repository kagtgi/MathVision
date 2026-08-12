/**
 * Prompt cho model SINH ẢNH dựng lại hình, khi TikZ đã thua.
 *
 * Chỉ dùng cho `kind === 'model'` (mô hình hoá vật thật: mái nhà, bể nước, cầu, khối ghép) —
 * thầy chốt 2026-08-11: hình toán chính xác phải là TikZ. Xem `GEN_IMAGE_KINDS`.
 *
 * Yêu cầu quan trọng nhất của thầy: **"sinh hình thì không chỉ dựa vào crop hình gốc, mà còn
 * phải hiểu context đề để chính xác hơn"**. Nên prompt này có hai nguồn với HAI THẨM QUYỀN khác
 * nhau, và ba luật xử lý xung đột — chỗ đó là toàn bộ phần khó của file này. Đưa đề bài vào mà
 * không chia thẩm quyền thì model vẽ một hình MẪU đúng loại nhưng sai đề, vì "vẽ hình chóp đáy
 * vuông" là việc nó giỏi còn "sao lại đúng hình này" là việc nó yếu.
 */

import type { GeminiPart } from '../pipeline/geminiClient.ts';
import type { FigureCategory } from './figurePrompts.ts';

// ─── Bảy khối luật ───────────────────────────────────────────────────────────

/** Nêu rõ nhiệm vụ là SAO LẠI, và nêu hậu quả để model không tự "làm đẹp". */
const GEN_ROLE = `Bạn là hoạ viên vẽ hình cho sách giáo khoa Toán THPT Việt Nam.

Việc của bạn: VẼ LẠI CHO SẠCH đúng cái hình có trong ẢNH GỐC. Không phải vẽ một hình mới,
không phải vẽ hình mẫu "chuẩn theo sách", không phải minh hoạ cho bài toán.
Hình này sẽ được in vào đề thi cho học sinh, nên một hình SAI mà nét sạch còn TỆ HƠN một
ảnh mờ mà đúng.`;

/**
 * Chia thẩm quyền. Ba luật xung đột (a)(b)(c) là chỗ chặn đúng ca thất bại đáng lo nhất: đề nói
 * "đáy là hình vuông" rồi model vẽ một hình chóp mẫu thay vì hình trong ảnh.
 */
const GEN_AUTHORITY = `HAI NGUỒN, HAI THẨM QUYỀN KHÁC NHAU — đừng lẫn:

1. ẢNH GỐC (ảnh cắt từ đề; có thể mờ, có hạt, có thể dính một sợi chữ bên cạnh) là
   THẨM QUYỀN VỀ NỘI DUNG HÌNH: có bao nhiêu điểm, điểm nằm ở đâu, nối với điểm nào, nét
   nào liền nét nào đứt, nhãn đặt phía nào, hình nghiêng bên nào, khung ngang hay dọc —
   TẤT CẢ lấy từ ảnh. Bạn vẽ lại đúng cái hình ĐÓ, không phải một hình cùng loại.
2. ĐỀ BÀI là THẨM QUYỀN VỀ Ý NGHĨA: điểm nào tên gì, đâu là trung điểm / chân đường cao /
   hình chiếu, đoạn nào bài đang hỏi, quan hệ nào là quan hệ chính. Dùng đề để ĐỌC RÕ ảnh:
   đoán đúng một nhãn bị mờ, biết một nét mờ là cạnh hay là đoạn phụ.

BA LUẬT XỬ LÝ XUNG ĐỘT:
a) ĐỀ VÀ ẢNH LỆCH NHAU THÌ THEO ẢNH. Đề ghi "đáy là hình vuông" mà ảnh vẽ đáy thành hình
   bình hành nghiêng thì VẼ HÌNH BÌNH HÀNH NGHIÊNG NHƯ ẢNH — đó là phép chiếu song song
   của hình vuông, không phải lỗi của đề.
b) ĐỀ CÓ MÀ ẢNH KHÔNG CÓ THÌ KHÔNG VẼ. Đề nhắc đường cao $SH$ mà ảnh không vẽ $SH$ thì
   hình ra KHÔNG có $SH$. Đề cho $SA = a\\sqrt{3}$ mà ảnh không ghi số thì hình ra KHÔNG
   ghi số.
c) ẢNH CÓ MÀ ĐỀ KHÔNG NHẮC THÌ VẪN VẼ. Ảnh là bản chuẩn, đề chỉ là lời giải thích.

Câu "cho hình chóp $S.ABCD$ có đáy là hình vuông" KHÔNG phải lệnh vẽ một hình chóp mẫu.
Nó chỉ giúp bạn hiểu ảnh trước mắt.`;

/**
 * Bảy điều cấm. Vì sao từng điều: (1) trang trí tự sinh là lỗi phổ biến nhất của model ảnh và
 * học sinh sẽ đọc nó như dữ kiện; (2) mất một nhãn là mất một dữ kiện của đề; (3) nhãn sai tên
 * biến thành một bài khác; (4) số bịa nhìn rất thuyết phục nên nguy hiểm nhất; (5) chữ thêm vào
 * không xoá được khỏi ảnh raster; (6) "làm đẹp" chính là cách hình mất quan hệ toán học; (7) cho
 * model một đường ra hợp lệ khi ảnh mờ, thay vì buộc nó bịa.
 */
const GEN_NO_INVENT = `KHÔNG BỊA — bảy điều cấm:
1. KHÔNG thêm điểm, đoạn, đường, mũi tên, dấu góc vuông, dấu đoạn bằng nhau, đường gióng,
   lưới ô, hay ký hiệu nào mà ảnh gốc không có.
2. KHÔNG bỏ nhãn. Ảnh gốc có bao nhiêu nhãn thì hình ra có ĐÚNG bấy nhiêu nhãn.
3. KHÔNG đổi tên chữ. $A$ là $A$, $S$ là $S$, $B'$ là $B'$ (còn nguyên dấu phẩy trên).
   Không đổi $M$ thành $N$, không đổi $O$ thành số $0$, không hoán vị hai nhãn.
4. KHÔNG bịa số. Không thêm số trên trục, không thêm độ dài, số đo góc, toạ độ, đơn vị,
   nếu ảnh gốc không IN con số đó.
5. KHÔNG thêm chữ của riêng bạn: không tiêu đề, không chú thích, không chú giải, không
   "Hình 1", không watermark, không logo, không khung viền, không chữ ký.
6. KHÔNG "sửa cho đẹp". Ảnh vẽ tam giác hơi lệch thì vẫn là tam giác lệch đó, đừng biến
   thành tam giác cân. Ảnh nghiêng bên nào thì giữ bên đó.
7. Chỗ nào trong ảnh MỜ tới mức không đọc được thì vẽ lại đúng nét mờ thấy được và DỪNG
   ở đó. Không đoán thêm chi tiết, không điền thêm nhãn.`;

/**
 * Đích trực quan. Vì sao: (1) nền không trắng lệch tông với trang Word đen trắng và đo được bằng
 * pixel nên phải nói trước; (2) photorealistic là mặc định của model ảnh, phải cấm thẳng; (3) màu
 * tự thêm thành xám nhoè khi in đen trắng; (4) nét khuất là quy ước bắt buộc của SGK; (5) nhãn
 * đè nét làm hình vô dụng khi thu về 9 cm; (6)(7) cắt cụt và méo tỉ lệ là hai lỗi mà bước đo
 * pixel sẽ loại, nói trước cho đỡ tốn một lượt gọi.
 */
const GEN_LOOK = `HÌNH RA PHẢI TRÔNG NHƯ THẾ NÀY:
1. Nét ĐEN trên nền TRẮNG TINH (#FFFFFF). Không nền kem, không xám, không giấy có vân,
   không bóng đổ, không viền, không vignette.
2. Nét mảnh, đều, sắc, như hình in trong SGK. KHÔNG tô bóng, KHÔNG gradient, KHÔNG hiệu
   ứng 3D, KHÔNG dựng hình như ảnh chụp, KHÔNG nét chì, KHÔNG nét cọ, KHÔNG vẽ tay.
3. KHÔNG MÀU. Chỉ dùng màu khi ẢNH GỐC có màu, và khi đó dùng đúng màu đó, đúng chỗ đó.
4. Nét THẤY vẽ liền, nét BỊ CHE vẽ đứt — đứt đúng những nét mà ảnh gốc để đứt.
5. Nhãn toán là chữ cái LATIN IN NGHIÊNG kiểu toán ($A$, $B$, $S$, $x$, $y$), đặt NGOÀI
   nét, không đè lên nét, không đè lên nhau, đúng PHÍA như ảnh gốc.
6. Hình nằm giữa, chừa lề trắng đều. KHÔNG cắt cụt bất kỳ phần nào của hình hay của nhãn.
7. Giữ đúng hướng và tỉ lệ khung của ảnh gốc (ảnh gốc nằm ngang thì hình ra nằm ngang).
   Không kéo méo, không xoay.`;

/**
 * Chữ trong hình. Vì sao: (2) hình học thuần chữ Latin là ca thường gặp, cấm sạch chữ Việt ở đó
 * vừa an toàn vừa kiểm được bằng máy; (3) `model` là loại THẬT SỰ mang chữ Việt, bỏ chữ đi là mất
 * nghĩa; (4) dấu sai đọc như lỗi chính tả của giáo viên còn dấu nhoè đọc như file lỗi — không dấu
 * là hỏng ít nhất trong ba, và thầy gõ lại được; (5) glyph rác là lỗi đặc trưng của model ảnh.
 */
const GEN_TEXT = `CHỮ TRONG HÌNH — chỗ dễ hỏng nhất, làm đúng từng ý:
1. Chép đúng từng ký tự của mọi nhãn, kể cả dấu phẩy trên, chỉ số dưới, dấu mũ.
2. ẢNH GỐC KHÔNG CÓ chữ tiếng Việt thì hình ra KHÔNG ĐƯỢC có chữ tiếng Việt nào. Không tự
   thêm "Hình", "đáy", "chiều cao", "mặt phẳng", "cm".
3. ẢNH GỐC CÓ chữ tiếng Việt (hình mô hình vật thật hay có: "mái nhà", "bể nước",
   "$x$ (m)") thì chép LẠI ĐÚNG cụm chữ đó, ĐÚNG DẤU, đúng chỗ. Không dịch, không viết
   lại theo ý bạn, không thay bằng cụm khác.
4. Nếu bạn không chắc vẽ đúng dấu tiếng Việt được, thì viết ĐÚNG cụm chữ đó KHÔNG DẤU còn
   hơn viết sai dấu — nhưng TUYỆT ĐỐI không bỏ hẳn cụm chữ và không thay bằng chữ khác.
5. Mỗi ký tự phải là một ký tự THẬT, sắc nét, đọc được. KHÔNG viết chữ giả, chữ nhoè, chữ
   nhìn giống chữ mà không đọc ra, không lặp một chữ hai lần cạnh nhau.`;

/**
 * TUYỆT ĐỐI KHÔNG ghép `figureRulesFor()` vào prompt này — ĐO THẬT 2026-08-11.
 *
 * Nó có vẻ là thứ nên dùng lại (luật vẽ SGK đã tinh chỉnh sẵn), và bản đầu của file này ghi rõ
 * "dùng lại `figureRulesFor('model')` nguyên xi" như một ưu điểm. Sai: `figureRulesFor` tự ghép
 * `tikzCapsRules()` + `THINK_FIRST_RULES` vào, tức prompt mang theo luật viết MÃ TIKZ — kể cả câu
 * "CHỈ xuất mã TikZ, không xuất phần phân tích" và danh sách `\usetikzlibrary` cho phép.
 *
 * Hệ quả đo được: khối đó chiếm 5.217 / 10.559 ký tự của prompt, và `gemini-3.1-flash-image` làm
 * đúng thứ được bảo — trả về một khối ```tikz ... ``` bằng TEXT, KHÔNG có part ảnh nào,
 * `finishReason: STOP`. Bỏ khối đó ra thì cùng prompt, cùng cấu hình, cùng ảnh cắt: có ảnh ngay.
 *
 * Bảy khối dưới đây đã tự phủ đủ phong cách, nhãn, cấm bịa và luật riêng theo loại.
 */

/** Luật riêng cho loại `model`. Các loại khác không đi qua đường này (`GEN_IMAGE_KINDS`). */
const GEN_MODEL = `LOẠI HÌNH: MÔ HÌNH VẬT THẬT (mái nhà, bể nước, cầu, cột, khối ghép...).
- Vẽ thành HÌNH HỌC BẰNG NÉT. Không vẽ thành ảnh thật, không thêm chất liệu, không thêm
  cây cối, người, mây, nền, không thêm chi tiết trang trí.
- Kích thước, đơn vị, chữ chú thích: giữ đúng những gì ảnh gốc CÓ ghi, không thêm cái nào.
- Bỏ vệt bẩn và hạt nhiễu của ảnh cắt, giữ nguyên mọi thành phần của vật.`;

/** Checklist ĐẾM ĐƯỢC là thứ model thật sự làm được, khác hẳn "hãy chính xác". */
const GEN_SELFCHECK = `TỰ SOÁT trước khi xuất — sửa ngay nếu sai:
- Đếm nhãn: ảnh gốc bao nhiêu nhãn, hình ra đúng bấy nhiêu, đúng từng ký tự.
- Đếm điểm, đoạn, mặt: khớp ảnh gốc.
- Không có chữ nào mà ảnh gốc không có (tiêu đề, chú thích, số đo, watermark).
- Nền trắng tinh; không màu, không bóng, không gradient, không khung viền.
- Nét khuất vẫn đứt, nét thấy vẫn liền, đúng những cạnh như ảnh.
- Không phần nào của hình hay của nhãn bị cắt ở rìa; còn lề trắng bốn phía.
- Từng ký tự chữ đều đọc được: không nhoè, không méo, không ký tự lạ.

ĐẦU RA: ĐÚNG MỘT ẢNH, không kèm gì khác. Không lời dẫn, không giải thích, không mô tả,
không hỏi lại, không đề nghị phương án.`;

// ─── Gợi ý từ lượt TikZ đã thua ──────────────────────────────────────────────

/**
 * TikZ chết CƠ HỌC (không ra mã, sanitizer chặn, treo, ảnh trắng): bản đọc đó **chưa từng bị
 * chấm là sai**, và nó là bản đọc tốt nhất của multi-agent kèm đủ luật theo loại. Gửi mã.
 */
function tikzHint(code: string): string {
  const clean = code
    .split('\n')
    .filter((l) => !/^\s*%/.test(l))
    .join('\n');
  const short =
    clean.length > 2500
      ? clean
          .split('\n')
          .filter((l) => /\\node|\\coordinate/.test(l))
          .join('\n')
      : clean;
  return `GỢI Ý TỪ LƯỢT TRƯỚC — ĐỘ TIN CẬY THẤP.
Đây là cách một mô hình khác đã ĐỌC ảnh này. Bản đó chưa dựng được, nên nó có thể đọc SAI.

${short}

CÁCH DÙNG: chỉ để đối chiếu TÊN NHÃN và thứ tự nhãn khi nét trong ảnh bị mờ. Toạ độ, tỉ lệ,
bố cục, nét liền/nét đứt thì LẤY TỪ ẢNH GỐC, không lấy từ đây. Thấy nó lệch ảnh thì bỏ nó.`;
}

/**
 * Trọng tài LOẠI bản TikZ: một model **đã nhìn cả hai ảnh** và nói nội dung sai. Gửi lại cả mã
 * là đúng nguy cơ lan lại cái đọc sai, nên chỉ gửi danh sách nhãn + chỗ đã bị chấm sai làm
 * negative prompt. Hai mảng `thieu`/`them` này trước đây bị vứt đi.
 */
function judgeHint(code: string, missing: string[], extra: string[]): string {
  const labels = [...new Set([...code.matchAll(/\\node[^{]*\{([^}]*)\}/g)].map((m) => m[1].trim()))]
    .filter(Boolean)
    .slice(0, 40);
  return [
    'GỢI Ý TỪ LƯỢT TRƯỚC — ĐỘ TIN CẬY THẤP.',
    labels.length
      ? `Một mô hình khác đọc ảnh này và ghi lại các nhãn sau: ${labels.join(', ')}.`
      : '',
    'Danh sách này CHƯA CHẮC ĐÚNG và CHƯA CHẮC ĐỦ. Chỉ dùng khi một nhãn trong ảnh quá mờ.',
    '',
    'BẢN ĐỌC ĐÓ ĐÃ BỊ CHẤM LÀ SAI ở những chỗ sau — ĐỪNG LẶP LẠI:',
    missing.length ? `- bản đó THIẾU (ảnh gốc có mà nó không có): ${missing.join('; ')}` : '',
    extra.length ? `- bản đó THÊM (ảnh gốc không có mà nó tự vẽ): ${extra.join('; ')}` : '',
    'Soi lại chính những chỗ này trong ảnh gốc trước khi vẽ.',
  ]
    .filter(Boolean)
    .join('\n');
}

// ─── Lắp prompt ──────────────────────────────────────────────────────────────

export interface FigureGenPromptInput {
  kind: FigureCategory;
  cropBase64: string;
  cropMimeType?: string;
  /** Đề bài quanh hình; rỗng = không tìm được. */
  context: string;
  /** Mã TikZ của lượt thua, nếu lượt đó chết CƠ HỌC (chưa bị trọng tài chấm). */
  failedTikz?: string;
  /** Mã + phán quyết khi lượt TikZ dựng được nhưng bị trọng tài LOẠI. */
  judged?: { code: string; missing: string[]; extra: string[] };
}

/**
 * THỨ TỰ PART CHÍNH LÀ CƠ CHẾ giữ ảnh làm thẩm quyền: luật → ảnh → đề (bọc `<<< >>>`) → gợi ý →
 * **một dòng nhắc lại ảnh gốc**. Recency thuộc về ảnh, không thuộc về lời văn; và bọc đề trong
 * dấu ngoặc để giọng mệnh lệnh của đề ("Cho hình chóp…") không bị đọc thành lệnh vẽ.
 */
export function figureGenPrompt(i: FigureGenPromptInput): GeminiPart[] {
  const rules = [
    GEN_ROLE,
    GEN_AUTHORITY,
    GEN_NO_INVENT,
    GEN_LOOK,
    GEN_TEXT,
    i.kind === 'model' ? GEN_MODEL : '',
    GEN_SELFCHECK,
  ]
    .filter(Boolean)
    .join('\n\n');

  const parts: GeminiPart[] = [
    { text: rules },
    { text: 'ẢNH GỐC — bản CHUẨN về hình. Vẽ lại đúng hình này:' },
    { inlineData: { data: i.cropBase64, mimeType: i.cropMimeType ?? 'image/png' } },
    {
      text: i.context
        ? `ĐỀ BÀI — chỉ dùng để HIỂU ảnh trên, KHÔNG dùng để thay hình:\n<<<\n${i.context}\n>>>`
        : '(không tìm được câu hỏi tham chiếu hình này — chỉ dựa vào ảnh)',
    },
  ];

  if (i.judged) {
    parts.push({ text: judgeHint(i.judged.code, i.judged.missing, i.judged.extra) });
  } else if (i.failedTikz?.includes('\\begin{tikzpicture}')) {
    parts.push({ text: tikzHint(i.failedTikz) });
  }

  parts.push({
    text:
      'Vẽ lại ĐÚNG hình trong ẢNH GỐC. Chỉ nét đen trên nền trắng. Không thêm, không bớt, ' +
      'không đổi tên nhãn. Xuất ĐÚNG MỘT ẢNH.',
  });
  return parts;
}
