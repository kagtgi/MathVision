/**
 * Nửa THUẦN của đường AI sinh ảnh: khung tỉ lệ, đo pixel, mười cửa tiền kiểm, ngữ cảnh đề, và
 * câu chữ cảnh báo.
 *
 * Không mạng, không DOM. Nửa cần mạng có `scripts/probe-gen-figure.mjs` (chạy tay).
 *
 * Ca đắt nhất ở đây là ca `pngSize` nhận bytes JPEG: nó CHỨNG MINH `pngSize` trả rác khi không
 * phải PNG, tức chứng minh vì sao `isPngBytes` phải đứng TRƯỚC nó trong `normalizeToPng`.
 *
 * Usage: node scripts/verify-figure-gen.mjs
 */

import { pngSize } from '../src/pipeline/mmdToDocx.ts';
import {
  fitWithin,
  isPngBytes,
  preGateGen,
  scanRaster,
} from '../src/pipeline/imageNormalize.ts';
import { pickAspectRatio } from '../src/pipeline/geminiClient.ts';
import { buildFigureContexts } from '../src/pipeline/figureContext.ts';
import { warnFor, KIND_NOT_ALLOWED } from '../src/pipeline/figures.ts';
import { figureGenPrompt } from '../src/utils/figureGenPrompts.ts';
import { scopeFigureIds } from '../src/pipeline/prompts.ts';
import { makePng } from './lib/png.mjs';

const GREEN = (s) => `\x1b[32m${s}\x1b[0m`;
const RED = (s) => `\x1b[31m${s}\x1b[0m`;

/**
 * Bộ giá trị `aspectRatio` LẤY TỪ TÀI LIỆU API. Sai một ký tự là 400 cho MỌI lượt gọi ảnh, và
 * không phép kiểm nào khác bắt được — nên danh sách này chép tay từ tài liệu, KHÔNG import từ
 * `geminiClient` (import thì nó chỉ kiểm chính nó).
 *
 * Mười giá trị của hướng dẫn sinh ảnh, cộng bốn giá trị mà trang `gemini-3.1-flash-image` khai
 * là mới của bản 3.1.
 */
const SDK_ASPECTS = [
  '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9',
  '1:4', '4:1', '1:8', '8:1',
];

// ─── Buffer RGBA tổng hợp ────────────────────────────────────────────────────

/** Nền trắng, rồi vẽ một hình chữ nhật màu `v` (0-255) tại (x,y,w,h). */
function buf(w, h, rects = []) {
  const d = new Uint8Array(w * h * 4).fill(255);
  for (const [x, y, rw, rh, v, sat] of rects) {
    for (let yy = y; yy < y + rh; yy++) {
      for (let xx = x; xx < x + rw; xx++) {
        const i = (yy * w + xx) * 4;
        d[i] = v;
        d[i + 1] = sat ? Math.min(255, v + 90) : v;
        d[i + 2] = v;
      }
    }
  }
  return d;
}

const statsOf = (w, h, rects) => scanRaster(buf(w, h, rects), w, h);

/**
 * Khung viền rỗng — mô phỏng HÌNH NÉT, không phải khối tô. Quan trọng: một khối 240×180 tô đặc
 * trong ảnh 400×300 là 36% mực, tức chính nó bị cửa "tô kín" loại. Hình thật của bộ corpus đo
 * được 1,3%–17,6% mực, nên fixture phải là nét mảnh mới đại diện đúng.
 */
const frame = (x, y, w, h, v = 0, sat = false, t = 3) => [
  [x, y, w, t, v, sat],
  [x, y + h - t, w, t, v, sat],
  [x, y, t, h, v, sat],
  [x + w - t, y, t, h, v, sat],
];

/** Ảnh cắt mẫu: nét đen chiếm giữa, có lề. */
const CROP = statsOf(400, 300, frame(80, 60, 240, 180));

// ─── Fixture MMD hai trang ───────────────────────────────────────────────────

const PAGE1 = `PHẦN I. CÂU TRẮC NGHIỆM NHIỀU PHƯƠNG ÁN LỰA CHỌN

Câu 3. Cho hình chóp $S.ABCD$ có đáy là hình vuông cạnh $a$.

![](#p1_f1)

A. $30^{\\circ}$.
B. $45^{\\circ}$.
C. $60^{\\circ}$.
D. $90^{\\circ}$.

Câu 4. Tính $2+2$.

Câu 5. Cho hình trụ có bán kính đáy $r$ và chiều cao $h$.`;

/** Ảnh của câu 5 nằm ở TRANG SAU — ca giết phương án cắt theo từng trang. */
const PAGE2 = `![](#p2_f1)

Thể tích khối trụ bằng bao nhiêu?

A. $\\pi r^{2}h$.
B. $2\\pi rh$.`;

const CTX = buildFigureContexts([PAGE1, PAGE2]);

// ─── Bộ ca kiểm ──────────────────────────────────────────────────────────────

const cases = [
  // ── pickAspectRatio ──────────────────────────────────────────────────────
  {
    name: 'pickAspectRatio: ngang / dọc / vuông / rất dẹt',
    run: () => [
      pickAspectRatio(800, 600),
      pickAspectRatio(600, 800),
      pickAspectRatio(1000, 1000),
      pickAspectRatio(1200, 500),
      // 1:3 gần 1:4 (lệch log 0,29) hơn 9:16 (0,52). Trước khi có 1:4 trong danh sách thì ca này
      // ra 9:16 — tức khung lệch xa nội dung và model được mời dựng lại bố cục.
      pickAspectRatio(300, 900),
      pickAspectRatio(1600, 200),
    ],
    expect: ['4:3', '3:4', '1:1', '21:9', '1:4', '8:1'],
  },
  {
    name: 'pickAspectRatio: suy biến -> 1:1 (không ném, không NaN)',
    run: () => [
      pickAspectRatio(0, 100),
      pickAspectRatio(NaN, 10),
      pickAspectRatio(-5, 5),
      pickAspectRatio(10, 0),
    ],
    expect: ['1:1', '1:1', '1:1', '1:1'],
  },
  {
    name: 'pickAspectRatio: MỌI giá trị trả về đều nằm trong bộ SDK cho phép',
    run: () => {
      const bad = [];
      for (let w = 100; w <= 2000; w += 37) {
        for (let h = 100; h <= 2000; h += 53) {
          const a = pickAspectRatio(w, h);
          if (!SDK_ASPECTS.includes(a)) bad.push(`${w}x${h}=${a}`);
        }
      }
      return bad;
    },
    expect: [],
  },
  {
    name: 'pickAspectRatio: mỗi giá trị trong bộ tự khớp lại chính nó',
    run: () =>
      SDK_ASPECTS.filter((a) => {
        const [x, y] = a.split(':').map(Number);
        return pickAspectRatio(x * 120, y * 120) !== a;
      }),
    expect: [],
  },
  {
    name: 'pickAspectRatio: ảnh ngang luôn ra khung ngang, ảnh dọc ra khung dọc',
    run: () => {
      // Bất biến thật, không phụ thuộc danh sách: đảo (w,h) thì khung phải đảo chiều theo.
      const val = (a) => {
        const [x, y] = a.split(':').map(Number);
        return x / y;
      };
      const bad = [];
      for (const [w, h] of [
        [1600, 200],
        [1200, 500],
        [800, 600],
        [900, 880],
        [600, 800],
        [300, 900],
        [200, 1600],
      ]) {
        if (w > h && val(pickAspectRatio(w, h)) < 1) bad.push(`${w}x${h} ngang ra khung dọc`);
        if (w < h && val(pickAspectRatio(w, h)) > 1) bad.push(`${w}x${h} dọc ra khung ngang`);
      }
      return bad;
    },
    expect: [],
  },

  // ── isPngBytes / pngSize: cửa chặn phải đứng TRƯỚC ───────────────────────
  {
    name: 'CA THEN CHỐT: pngSize đọc bytes JPEG ra RÁC, isPngBytes loại đúng bytes đó',
    run: () => {
      // SOI/APP0 của JPEG. `pngSize` đọc thẳng offset 16/20 mà không kiểm signature.
      const jpeg = new Uint8Array(32);
      jpeg.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46], 0);
      const png = makePng(40, 30);
      const junk = pngSize(jpeg);
      return {
        pngSizeTraRac: junk.w !== 40 && junk.h !== 30,
        chanJpeg: isPngBytes(jpeg) === false,
        nhanPng: isPngBytes(png) === true,
        pngSizeDungVoiPng: pngSize(png).w === 40 && pngSize(png).h === 30,
      };
    },
    expect: { pngSizeTraRac: true, chanJpeg: true, nhanPng: true, pngSizeDungVoiPng: true },
  },
  {
    name: 'isPngBytes: buffer quá ngắn không ném',
    run: () => [isPngBytes(new Uint8Array(0)), isPngBytes(new Uint8Array([0x89, 0x50]))],
    expect: [false, false],
  },

  // ── fitWithin ────────────────────────────────────────────────────────────
  {
    name: 'fitWithin: co theo cạnh dài, và KHÔNG BAO GIỜ phóng to',
    run: () => [
      fitWithin(3200, 1600, 1000),
      fitWithin(400, 300, 1000),
      fitWithin(500, 2000, 1000),
    ],
    expect: [
      { w: 1000, h: 500 },
      { w: 400, h: 300 },
      { w: 250, h: 1000 },
    ],
  },
  {
    name: 'fitWithin: cỡ 0 không chia cho 0',
    run: () => [fitWithin(0, 0, 1000), fitWithin(-3, 10, 1000)],
    expect: [
      { w: 0, h: 0 },
      { w: 0, h: 0 },
    ],
  },

  // ── scanRaster ───────────────────────────────────────────────────────────
  {
    name: 'scanRaster: ảnh trắng -> ink 0, inkBox null',
    run: () => {
      const s = statsOf(32, 32, []);
      return { ink: s.ink, box: s.inkBox };
    },
    expect: { ink: 0, box: null },
  },
  {
    name: 'scanRaster: ô 4x4 tối trong 32x32 -> ink và hộp bao đúng từng số',
    run: () => {
      const s = statsOf(32, 32, [[10, 12, 4, 4, 0, false]]);
      return { ink: s.ink, box: s.inkBox };
    },
    expect: { ink: 16 / 1024, box: { x: 10, y: 12, w: 4, h: 4 } },
  },
  {
    name: 'scanRaster: biên chống răng cưa — 249 tính là mực, 251 tính là trắng',
    run: () => [
      statsOf(20, 20, [[5, 5, 2, 2, 249, false]]).ink > 0,
      statsOf(20, 20, [[5, 5, 2, 2, 251, false]]).ink === 0,
    ],
    expect: [true, true],
  },
  {
    name: 'scanRaster: pixel có màu đếm vào satFrac',
    run: () => statsOf(40, 40, [[10, 10, 10, 10, 100, true]]).satFrac > 0.9,
    expect: true,
  },

  // ── preGateGen: một ca đạt + một ca mỗi cửa ──────────────────────────────
  {
    name: 'preGateGen: ảnh sinh tốt -> null (đạt)',
    run: () => preGateGen(CROP, statsOf(400, 300, frame(80, 60, 240, 180))),
    expect: null,
  },
  // Mỗi ca dưới đây khẳng định ĐÚNG CỬA nào loại, không chỉ "có bị loại hay không": một fixture
  // vô tình chạm cửa khác sẽ vẫn "đạt" nếu chỉ so boolean, và khi đó cửa cần kiểm không được kiểm.
  ...[
    ['ảnh trắng hoàn toàn', statsOf(400, 300, []), 'trắng hoàn toàn'],
    ['ảnh quá nhỏ', statsOf(100, 90, frame(20, 20, 50, 40)), 'quá nhỏ'],
    ['bị tô kín', statsOf(400, 300, [[20, 20, 360, 260, 0, false]]), 'tô kín'],
    ['tự thêm màu', statsOf(400, 300, frame(80, 60, 240, 180, 100, true)), 'thêm màu'],
    ['có tô bóng / gradient', statsOf(400, 300, frame(80, 60, 240, 180, 130)), 'tô bóng'],
    // Nét lấn vào vành 1,5% ngoài cùng nhưng KHÔNG chạm vành 2px, để cửa `borderWhite` (đứng
    // trước) không nổ trước và ca này còn kiểm được đúng `edgeInk`.
    ['nét chạm rìa (cắt cụt)', statsOf(400, 300, frame(2, 60, 396, 180)), 'chạm rìa'],
    // Khối nhỏ TÔ ĐẶC: đủ mực để qua sàn 0,4% (một khung viền 20×15 chỉ có 0,1% nên bị sàn mực
    // loại trước), nhưng hộp nét chỉ chiếm 10% chiều rộng.
    ['hình bé tí giữa lề trắng', statsOf(400, 300, [[190, 140, 40, 30, 0, false]]), 'bé tí'],
    // Hộp nét 360×70 qua được cả hai cửa lấp đầy (≥20%, ≤96%) nên mới tới được cửa tỉ lệ.
    ['tỉ lệ khung lệch xa ảnh cắt', statsOf(400, 300, frame(20, 115, 360, 70)), 'tỉ lệ khung'],
  ].map(([what, stats, phrase]) => ({
    name: `preGateGen: loại ${what}`,
    run: () => {
      const why = preGateGen(CROP, stats);
      return { biLoai: typeof why === 'string' && why.trim().length > 0, dungCua: (why ?? '').includes(phrase) };
    },
    expect: { biLoai: true, dungCua: true },
  })),

  // ── buildFigureContexts ──────────────────────────────────────────────────
  {
    name: 'ngữ cảnh: hình trong Câu 3 -> cắt theo câu, đúng số câu',
    run: () => {
      const c = CTX.get('p1_f1');
      return { scope: c.scope, num: c.num, coDe: c.text.includes('hình vuông cạnh') };
    },
    expect: { scope: 'cau', num: 3, coDe: true },
  },
  {
    name: 'ngữ cảnh: KHÔNG lẫn sang câu kế tiếp',
    run: () => CTX.get('p1_f1').text.includes('Câu 4'),
    expect: false,
  },
  {
    name: 'CA GIẾT PHƯƠNG ÁN CẮT TỪNG TRANG: header Câu 5 ở trang 1, ảnh ở trang 2',
    run: () => {
      const c = CTX.get('p2_f1');
      return { scope: c.scope, num: c.num, coDe: c.text.includes('hình trụ') };
    },
    expect: { scope: 'cau', num: 5, coDe: true },
  },
  {
    name: 'ngữ cảnh: BỎ dòng phương án A/B/C/D (phòng tuyến chống bịa số)',
    run: () => {
      const t = CTX.get('p1_f1').text;
      return { coPhuongAn: /^\s*[A-D]\s*[.)]/m.test(t), coSoNhieu: t.includes('30^{\\circ}') };
    },
    expect: { coPhuongAn: false, coSoNhieu: false },
  },
  {
    name: 'ngữ cảnh: bỏ chính dòng ảnh (nó không nói gì cho model)',
    run: () => CTX.get('p1_f1').text.includes('!['),
    expect: false,
  },
  {
    name: 'ngữ cảnh: id lạ -> undefined',
    run: () => CTX.get('khong_ton_tai') ?? null,
    expect: null,
  },
  {
    name: 'ngữ cảnh: hình trước mọi mốc Câu -> cửa sổ dòng, num null',
    run: () => {
      const m = buildFigureContexts(['Đề thi thử\n\n![](#x1)\n\nMôn Toán']);
      const c = m.get('x1');
      return { scope: c.scope, num: c.num, coChu: c.text.length > 0 };
    },
    expect: { scope: 'cuaso', num: null, coChu: true },
  },
  {
    name: 'ngữ cảnh: câu rất dài bị cắt về <= 900 ký tự',
    run: () => {
      const long = 'Câu 1. ' + 'x'.repeat(5000) + '\n\n![](#y1)\n';
      return buildFigureContexts([long]).get('y1').text.length <= 900;
    },
    expect: true,
  },

  // ── Prompt sinh ảnh KHÔNG được mang luật viết mã TikZ ────────────────────
  //
  // ĐO THẬT: bản đầu ghép `figureRulesFor('model')` vào khối luật, kéo theo `tikzCapsRules()` và
  // câu "CHỈ xuất mã TikZ". `gemini-3.1-flash-image` làm đúng thứ được bảo — trả về khối ```tikz
  // bằng TEXT, KHÔNG có part ảnh nào, `finishReason: STOP`. Triệu chứng đó trông y hệt lỗi cấu
  // hình nên rất tốn công tìm. Ba ca dưới đây chốt lại để không ai ghép nhầm lần nữa.
  {
    name: 'khối luật KHÔNG chứa lệnh xuất mã TikZ (bug đã đo, đừng lặp lại)',
    run: () => {
      const rules = figureGenPrompt({ kind: 'model', cropBase64: 'x', context: 'Câu 1. Test.' })[0]
        .text;
      return {
        khongBaoXuatTikz: !/xuất mã TikZ/.test(rules),
        khongCoUsetikzlibrary: !/usetikzlibrary/.test(rules),
        khongCoTikzpicture: !/tikzpicture/.test(rules),
      };
    },
    expect: { khongBaoXuatTikz: true, khongCoUsetikzlibrary: true, khongCoTikzpicture: true },
  },
  {
    name: 'khối luật giữ đủ hai thẩm quyền và hợp đồng một ảnh',
    run: () => {
      const rules = figureGenPrompt({ kind: 'model', cropBase64: 'x', context: 'Câu 1. Test.' })[0]
        .text;
      return {
        anhLaNoiDung: /THẨM QUYỀN VỀ NỘI DUNG/.test(rules),
        deLaYNghia: /THẨM QUYỀN VỀ Ý NGHĨA/.test(rules),
        theoAnhKhiLech: /THEO ẢNH/.test(rules),
        motAnh: /ĐÚNG MỘT ẢNH/.test(rules),
      };
    },
    expect: { anhLaNoiDung: true, deLaYNghia: true, theoAnhKhiLech: true, motAnh: true },
  },
  {
    name: 'mã TikZ của lượt thua CHỈ được vào phần gợi ý, kèm nhãn độ tin cậy thấp',
    run: () => {
      const parts = figureGenPrompt({
        kind: 'model',
        cropBase64: 'x',
        context: 'Câu 1. Test.',
        failedTikz: '\\begin{tikzpicture}\\node {A};\\end{tikzpicture}',
      });
      const hint = parts.find((p) => p.text?.includes('tikzpicture'));
      return {
        coGoiY: Boolean(hint),
        khongPhaiKhoiLuat: parts[0].text.indexOf('tikzpicture') === -1,
        coNhanTinCayThap: /ĐỘ TIN CẬY THẤP/.test(hint?.text ?? ''),
      };
    },
    expect: { coGoiY: true, khongPhaiKhoiLuat: true, coNhanTinCayThap: true },
  },

  // ── Ép id hình về đúng trang ─────────────────────────────────────────────
  //
  // Do that tren de THPT 2025: mot hinh o TRANG 3 nhan id `p1_f1`, trung id cua hinh trang 1.
  // Trung id am tham nuot mot hinh (map.set ghi de) roi hai cau cung tro vao mot anh, ma QC
  // khong thay gi vi id nao cung co du lieu.
  {
    name: 'id đúng trang thì giữ NGUYÊN, không đổi vô cớ',
    run: () => {
      const r = scopeFigureIds(
        [{ id: 'p3_f1', bbox: [0, 0, 1, 1], kind: 've' }],
        'x\n\n![](#p3_f1)\n',
        3,
      );
      return { id: r.figures[0].id, canhBao: r.warnings.length, mmdGiuNguyen: r.mmd.includes('#p3_f1') };
    },
    expect: { id: 'p3_f1', canhBao: 0, mmdGiuNguyen: true },
  },
  {
    name: 'id sai trang -> đổi về trang đúng, VÀ sửa luôn tham chiếu trong MMD',
    run: () => {
      const r = scopeFigureIds(
        [{ id: 'p1_f1', bbox: [0, 0, 1, 1], kind: 've' }],
        'Câu 5.\n\n![](#p1_f1)\n',
        3,
      );
      return {
        id: r.figures[0].id,
        mmdDaDoi: r.mmd.includes('![](#p3_f1)') && !r.mmd.includes('#p1_f1'),
        coCanhBao: r.warnings.length === 1,
      };
    },
    expect: { id: 'p3_f1', mmdDaDoi: true, coCanhBao: true },
  },
  {
    name: 'hai hình trùng id trong cùng trang -> tách thành hai id khác nhau',
    run: () => {
      const r = scopeFigureIds(
        [
          { id: 'p2_f1', bbox: [0, 0, 1, 1], kind: 've' },
          { id: 'p2_f1', bbox: [0, 0, 1, 1], kind: 've' },
        ],
        'a ![](#p2_f1) b',
        2,
      );
      return { ids: r.figures.map((f) => f.id), khacNhau: r.figures[0].id !== r.figures[1].id };
    },
    expect: { ids: ['p2_f1', 'p2_f2'], khacNhau: true },
  },
  {
    name: 'id mới KHÔNG được đụng id đã dùng trong cùng trang',
    run: () => {
      const r = scopeFigureIds(
        [
          { id: 'p4_f1', bbox: [0, 0, 1, 1], kind: 've' },
          { id: 'lac_loai', bbox: [0, 0, 1, 1], kind: 've' },
        ],
        'a ![](#p4_f1) b ![](#lac_loai)',
        4,
      );
      return { ids: r.figures.map((f) => f.id), trung: new Set(r.figures.map((f) => f.id)).size === 2 };
    },
    expect: { ids: ['p4_f1', 'p4_f2'], trung: true },
  },

  // ── warnFor ──────────────────────────────────────────────────────────────
  {
    name: 'warnFor: hình TikZ đạt -> KHÔNG cảnh báo (y như 1.2)',
    run: () => warnFor({ id: 'p1_f1', used: 'tikz', tried: [], hadContext: true, num: 3 }),
    expect: [],
  },
  {
    name: 'CHỐT REGRESSION: ca crop + chưa thử sinh ảnh phải trùng TỪNG BYTE chuỗi của 1.2',
    run: () => warnFor({ id: 'p1_f1', used: 'crop', tried: [], hadContext: false, num: null })[0],
    expect: 'Hình p1_f1: dựng TikZ không đạt — dùng ảnh cắt từ đề.',
  },
  {
    name: 'warnFor: hình AI sinh có đề -> nói rõ PHẢI xem lại, kèm số câu',
    run: () => {
      const w = warnFor({
        id: 'p1_f1',
        used: 'genai',
        tried: [{ step: 'genai', ok: true, why: 'đạt' }],
        hadContext: true,
        num: 3,
      });
      return { mot: w.length === 1, coCau: w[0].includes('câu 3'), canhBao: w[0].includes('AI SINH') };
    },
    expect: { mot: true, coCau: true, canhBao: true },
  },
  {
    name: 'warnFor: hình AI sinh KHÔNG có đề -> câu chữ khác, nhắc xem lại kỹ',
    run: () =>
      warnFor({ id: 'p1_f1', used: 'genai', tried: [], hadContext: false, num: null })[0].includes(
        'CHỈ TỪ ảnh cắt',
      ),
    expect: true,
  },
  {
    name: 'warnFor: loại hình không cho sinh -> nói rõ chỉ dùng TikZ',
    run: () =>
      warnFor({
        id: 'p1_f1',
        used: 'crop',
        tried: [{ step: 'genai', ok: false, why: KIND_NOT_ALLOWED }],
        hadContext: false,
        num: null,
      })[0].includes('chỉ dùng TikZ'),
    expect: true,
  },
  {
    name: 'warnFor: cả hai đường đều thua -> nêu lý do cuối',
    run: () =>
      warnFor({
        id: 'p1_f1',
        used: 'crop',
        tried: [
          { step: 'tikz', ok: false, why: 'mã không dựng được' },
          { step: 'genai', ok: false, why: 'ảnh sinh ra trắng hoàn toàn' },
        ],
        hadContext: true,
        num: 7,
      })[0].includes('ảnh sinh ra trắng hoàn toàn'),
    expect: true,
  },
];

console.log('=== AI sinh ảnh: nửa thuần ===');
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
