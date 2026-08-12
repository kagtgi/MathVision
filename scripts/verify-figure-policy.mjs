/**
 * Chính sách "câu nào thì LỜI GIẢI phải có hình" — `src/pipeline/figurePolicy.ts`.
 *
 * Vì sao cần harness riêng: chính sách này ĐỔI HÀNH VI thật (ép gọi thêm API để xin hình) và
 * chạy bằng khớp từ khoá tiếng Việt, tức rất dễ khớp quá rộng. Nên mỗi hàng luật ở đây có
 * ĐỦ HAI CA: một ca phải kích hoạt, và một ca ÂM phải KHÔNG kích hoạt.
 *
 * Ca âm quan trọng hơn ca dương: một câu xác suất nhắc "hình chóp" ("chọn ngẫu nhiên một đỉnh
 * của hình chóp") mà bị coi là bài hình học thì mỗi đề tốn thêm chục lượt gọi vô ích.
 *
 * Usage: node scripts/verify-figure-policy.mjs
 */

import { splitForSolving } from '../src/pipeline/solveExam.ts';
import { figureBriefFor, figureNeedFor } from '../src/pipeline/figurePolicy.ts';

const GREEN = (s) => `\x1b[32m${s}\x1b[0m`;
const RED = (s) => `\x1b[31m${s}\x1b[0m`;

/**
 * Dựng `QuestionRef` qua ĐÚNG `splitForSolving` chứ không tự bịa object: `type` và `figureIds`
 * là hai thứ chính sách đọc, và chúng do hàm đó suy ra. Tự bịa là kiểm một thế giới khác.
 */
function refOf(body, { withFigure = false } = {}) {
  const mmd = `Câu 1. ${body}${withFigure ? '\n\n![](#p1_f1)' : ''}\n`;
  const refs = splitForSolving(mmd);
  if (refs.length !== 1) throw new Error(`splitForSolving ra ${refs.length} câu, mong 1`);
  return refs[0];
}

/** Câu tự luận: không có phương án A-D nên `questionTypeOf` hạ về TL. */
const verdict = (body, o) => figureNeedFor(refOf(body, o));

const OPTIONS = '\nA. 1.\nB. 2.\nC. 3.\nD. 4.';

const cases = [
  // ── Hình học không gian: bắt buộc ────────────────────────────────────────
  {
    name: 'hình chóp -> bắt buộc, khonggian',
    run: () => {
      const v = verdict(`Cho hình chóp $S.ABCD$ có đáy là hình vuông.${OPTIONS}`);
      return { need: v.need, kind: v.kind };
    },
    expect: { need: 'bat-buoc', kind: 'khonggian' },
  },
  {
    name: 'lăng trụ -> bắt buộc, khonggian',
    run: () => verdict(`Cho lăng trụ đứng $ABC.A'B'C'$.${OPTIONS}`).kind,
    expect: 'khonggian',
  },
  {
    name: 'góc giữa / khoảng cách -> bắt buộc, khonggian',
    run: () => verdict(`Tính khoảng cách từ $A$ đến mặt phẳng $(SBC)$.${OPTIONS}`).kind,
    expect: 'khonggian',
  },
  {
    name: 'hình trụ / nón / cầu -> bắt buộc, khonggian',
    run: () => verdict(`Một hình nón có bán kính đáy $r=3$.${OPTIONS}`).kind,
    expect: 'khonggian',
  },

  // ── Bảng biến thiên ──────────────────────────────────────────────────────
  {
    name: 'đơn điệu -> bắt buộc, bbt',
    run: () => verdict(`Hàm số $y=x^{3}-3x$ đồng biến trên khoảng nào?${OPTIONS}`).kind,
    expect: 'bbt',
  },
  {
    name: 'cực trị -> bắt buộc, bbt',
    run: () => verdict(`Số điểm cực trị của hàm số $y=x^{4}-2x^{2}$ là${OPTIONS}`).kind,
    expect: 'bbt',
  },
  {
    name: 'GTLN-GTNN -> bắt buộc, bbt',
    run: () => verdict(`Tìm giá trị lớn nhất của hàm số trên đoạn $[0;3]$.${OPTIONS}`).kind,
    expect: 'bbt',
  },

  // ── Đồ thị ───────────────────────────────────────────────────────────────
  {
    name: 'số nghiệm / biện luận -> bắt buộc, dothi',
    run: () => verdict(`Tìm $m$ để phương trình có ba nghiệm phân biệt, biện luận theo $m$.${OPTIONS}`).kind,
    expect: 'dothi',
  },
  {
    name: 'tiệm cận -> bắt buộc, dothi',
    run: () => verdict(`Đường tiệm cận ngang của đồ thị hàm số là${OPTIONS}`).kind,
    expect: 'dothi',
  },
  {
    name: 'diện tích hình phẳng -> bắt buộc, dothi',
    run: () => verdict(`Tính diện tích hình phẳng giới hạn bởi hai đồ thị.${OPTIONS}`).kind,
    expect: 'dothi',
  },

  // ── Tự luận chứng minh ───────────────────────────────────────────────────
  {
    name: 'tự luận chứng minh (không nhắc khối) -> bắt buộc',
    run: () => verdict('Chứng minh rằng hai đường thẳng đã cho vuông góc với nhau.').need,
    expect: 'bat-buoc',
  },
  {
    name: 'CÙNG nội dung đó nhưng là trắc nghiệm -> KHÔNG bắt buộc',
    run: () => verdict(`Chứng minh nào sau đây đúng?${OPTIONS}`).need,
    expect: 'khong',
  },

  // ── Hình phẳng: chỉ NÊN ──────────────────────────────────────────────────
  {
    name: 'tam giác + đường tròn -> nên, phang',
    run: () => {
      const v = verdict(`Cho tam giác $ABC$ nội tiếp đường tròn tâm $O$.${OPTIONS}`);
      return { need: v.need, kind: v.kind };
    },
    expect: { need: 'nen', kind: 'phang' },
  },

  // ── CA ÂM: chặn khớp quá rộng ────────────────────────────────────────────
  {
    name: 'ÂM: xác suất nhắc "hình chóp" -> khong',
    run: () =>
      verdict(`Chọn ngẫu nhiên một đỉnh của hình chóp. Tính xác suất đỉnh đó thuộc đáy.${OPTIONS}`)
        .need,
    expect: 'khong',
  },
  {
    name: 'ÂM: cấp số cộng -> khong',
    run: () => verdict(`Số hạng $u_{5}$ của cấp số cộng $1;3;5;\\ldots$ bằng${OPTIONS}`).need,
    expect: 'khong',
  },
  {
    name: 'ÂM: thống kê ghép nhóm -> khong (gõ thành bảng, không vẽ)',
    run: () => verdict(`Cho mẫu số liệu ghép nhóm. Tính phương sai.${OPTIONS}`).need,
    expect: 'khong',
  },
  {
    name: 'ÂM: tổ hợp nhắc "tam giác" -> khong',
    run: () => verdict(`Có bao nhiêu tam giác tạo thành? Dùng tổ hợp để đếm.${OPTIONS}`).need,
    expect: 'khong',
  },
  {
    name: 'ÂM: biến đổi lượng giác thuần -> khong',
    run: () => verdict(`Rút gọn biểu thức $\\sin 2x + \\cos 2x$.${OPTIONS}`).need,
    expect: 'khong',
  },

  // ── annotate: chỗ sửa cốt lõi của 1.3 ────────────────────────────────────
  {
    name: 'đề CÓ hình -> annotate = true, và need KHÔNG bị hạ về khong',
    run: () => {
      const v = verdict(`Cho hình chóp $S.ABCD$ có $SA \\perp (ABCD)$.${OPTIONS}`, {
        withFigure: true,
      });
      return { need: v.need, annotate: v.annotate };
    },
    expect: { need: 'bat-buoc', annotate: true },
  },
  {
    name: 'đề KHÔNG có hình -> annotate = false',
    run: () => verdict(`Cho hình chóp $S.ABCD$.${OPTIONS}`).annotate,
    expect: false,
  },
  {
    name: 'annotate bật thì chỉ dẫn phải BẢO vẽ thêm đường phụ, không sao chép',
    run: () => {
      const brief = figureBriefFor(
        verdict(`Cho hình chóp $S.ABCD$.${OPTIONS}`, { withFigure: true }),
      );
      return {
        noiVeThem: /vẽ THÊM/.test(brief),
        camSaoChep: /KHÔNG vẽ lại y nguyên/.test(brief),
        giuTenDiem: /Giữ nguyên tên điểm/.test(brief),
      };
    },
    expect: { noiVeThem: true, camSaoChep: true, giuTenDiem: true },
  },
  {
    name: 'need = khong thì KHÔNG gửi chỉ dẫn nào (đỡ tốn token mỗi câu)',
    run: () => figureBriefFor(verdict(`Tính $2+2$.${OPTIONS}`)),
    expect: null,
  },
  {
    name: 'need = bat-buoc thì chỉ dẫn nói rõ BẮT BUỘC và kèm loại hình',
    run: () => {
      const brief = figureBriefFor(verdict(`Cho hình chóp $S.ABCD$.${OPTIONS}`));
      return /BẮT BUỘC/.test(brief) && /khonggian/.test(brief);
    },
    expect: true,
  },
];

console.log('=== Chính sách hình cho lời giải ===');
let ok = 0;
for (const c of cases) {
  let got;
  try {
    got = c.run();
  } catch (err) {
    got = `LỖI: ${err.message}`;
  }
  const pass = JSON.stringify(got) === JSON.stringify(c.expect);
  if (pass) ok++;
  else {
    console.log(`  ${RED('FAIL')} ${c.name}`);
    console.log(`      mong ${JSON.stringify(c.expect)}`);
    console.log(`      nhận ${JSON.stringify(got)}`);
  }
}
console.log(`${ok === cases.length ? GREEN('PASS') : RED('FAIL')}  ${ok}/${cases.length} tiêu chí`);
process.exit(ok === cases.length ? 0 : 2);
