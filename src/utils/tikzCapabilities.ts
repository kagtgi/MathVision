/**
 * Năng lực THẬT của renderer TikZJax — ĐO, không đoán.
 *
 * HAI LƯỢT ĐO, hai câu hỏi khác nhau — đọc cả hai mới đủ:
 *
 * 1. **Năng lực renderer** — `/probe-tikz.html` (`src/devtools/tikzProbe/`), 36 ca, mỗi ca một
 *    câu hỏi về CÚ PHÁP. Chạy lại một nhóm: `/probe-tikz.html?only=chu-viet`.
 * 2. **Hình đề thi có tới được Word không** — `/tikz-corpus.html` (`src/devtools/tikzCorpus/`),
 *    47 hình thật của chương trình THPT chia bốn họ, đi qua đúng `tikzToImage()` của app.
 *    Chấm bằng máy: `node scripts/verify-tikz-render.mjs`. Kết quả lượt đầu: **47/47 dựng
 *    được**, và những gì nó chứng minh nằm ở `TIKZ_CONFIRMED_WORKING` bên dưới.
 *
 * Lượt 2 cần thiết vì lượt 1 trả lời "\foreach có chạy không", không trả lời "một bảng biến
 * thiên có tiệm cận đứng có dựng ra được không". Renderer TẤT ĐỊNH (hai lượt liên tiếp cho số
 * đo trùng khít từng byte) nên dải mực của từng hình siết được tới +-10%.
 *
 * VÌ SAO FILE NÀY TỒN TẠI: bản 1.0 cấm `\foreach`, `\draw plot`, `\pgfmathsetmacro`,
 * `\tikzset` trong prompt bằng NIỀM TIN. Đo lại thì **cả bốn đều chạy tốt**. Ngược lại, thứ
 * thật sự giết hình — một byte ngoài ASCII ở bất kỳ đâu — thì không ai chặn. Prompt phải
 * SINH TỪ file này để không bao giờ lệch khỏi thực tế renderer nữa.
 *
 * Cách renderer chết cũng là lý do phải có allowlist: hàm mở file của TikZJax hardcode
 * `erstat: 0`, nên file thiếu mở thành công như file RỖNG. `\usepackage{pgfplots}` không báo
 * lỗi gì — nó đọc rỗng, `\begin{axis}` chết ở `Undefined control sequence`, TeX tắt, không
 * có SVG, và mất trọn 30 s timeout rồi rơi hình.
 */

export const TIKZ_CAPS_MEASURED_AT = '2026-08-11';

/**
 * Dưới ngưỡng mực này thì `tikzToImage` coi như KHÔNG dựng được và bỏ hình.
 *
 * Vì sao cần: ra được `<svg>` không có nghĩa là ra được hình. Một `tikzpicture` rỗng vẫn sinh
 * SVG hợp lệ, rồi `MIN_TIKZ_DIMENSION` biến nó thành PNG trắng 100×100 — và bản trắng đó đi
 * thẳng vào file Word. Đo mực là phép kiểm duy nhất bắt được.
 *
 * Đối chiếu 47 hình đề thi thật (bộ corpus): mực đo được **0,0135 – 0,176**, tức hình thưa
 * nhất vẫn cách ngưỡng này gần 7 lần. Ngưỡng nằm ở đây thay vì trong `latexToImage.ts` vì nó
 * là một SỐ ĐO, và vì bộ đo chạy dưới Node cũng phải chấm bằng đúng ngưỡng này.
 */
export const MIN_INK_RATIO = 0.002;

/**
 * Thư viện TikZ dùng được. Đây là allowlist của sanitizer: tên ngoài danh sách này bị bỏ
 * khỏi mã chứ không được để chạm tới renderer.
 *
 * Danh sách lấy từ cờ `tikz@library@<X>@loaded` trong `core.bin` đã giải nén, và những cái
 * đánh dấu ✓ dưới đây đã được probe dựng thật thành công.
 */
export const TIKZ_LIB_ALLOWLIST = [
  '3d', // ✓ canvas is xy plane at z=
  'angles', // ✓ \pic{angle}, \pic{right angle}
  'arrows',
  'arrows.meta',
  'babel',
  'backgrounds',
  'calc', // ✓ ($(A)!0.5!(B)$)
  'cd',
  'decorations',
  'decorations.markings', // ✓ vạch đánh dấu đoạn
  'decorations.shapes',
  'decorations.text',
  'fadings',
  'fit',
  'intersections', // ✓ name path + name intersections
  'matrix', // ✓ matrix of nodes
  'patterns', // ✓ pattern=north east lines
  'positioning', // ✓ right=1cm of
  'quotes', // ✓ ["$\alpha$"]
  'shadows',
  'shapes',
  'shapes.arrows',
  'shapes.callouts',
  'shapes.geometric',
  'shapes.misc',
  'shapes.multipart',
  'shapes.symbols',
  'through', // ✓ circle through=(P)
  'topaths',
  'trees',
] as const;

/**
 * KHÔNG có trong renderer. Gặp là hình chết im lặng hết timeout, nên phải bỏ trước khi dựng.
 * Danh sách này chỉ để log cho dễ hiểu — sanitizer chặn theo allowlist ở trên.
 */
export const TIKZ_LIB_KNOWN_MISSING = [
  'pgfplots', // ✓ probe: chết, 12 s không ra SVG
  'decorations.pathreplacing', // ✓ probe: chết -> decoration={brace} KHÔNG dùng được
  'decorations.pathmorphing', // -> snake/coil/zigzag KHÔNG dùng được
  'perspective', // -> phối cảnh 3D phải tự đặt toạ độ oblique
  'plotmarks',
  'chains',
  'graphs',
  'graphdrawing',
  'spy',
  'math',
  'mindmap',
  'folding',
  'automata',
  'petri',
  'calendar',
  'datavisualization',
] as const;

/** Package `\usepackage` được nạp sẵn. Model KHÔNG cần và KHÔNG được tự khai thêm. */
export const TIKZ_PACKAGES_PRELOADED = [
  'tikz',
  'tikz-cd',
  'pgf',
  'amsmath',
  'amssymb',
  'amsfonts',
  'graphicx',
  'xcolor',
  'latexsym',
] as const;

/**
 * Cú pháp đã dựng thử THÀNH CÔNG. Prompt được phép yêu cầu những thứ này.
 * `case` là id ca để tra lại — trong `tikzProbe/cases.ts` (cú pháp) hoặc `tikzCorpus/cases.ts`
 * (hình đề thi thật, id có tiền tố `dothi-`/`bbt-`/`phang-`/`kg-`).
 */
export const TIKZ_CONFIRMED_WORKING = [
  { what: '\\foreach \\x in {1,...,5}', case: 'foreach-range' },
  { what: '\\foreach \\x/\\t in {a/b, c/d}', case: 'foreach-pairs' },
  { what: '\\draw plot coordinates {(x,y) …}', case: 'plot-coordinates' },
  { what: '\\draw[domain=,samples=,smooth] plot (\\x,{f(\\x)})', case: 'plot-domain-samples' },
  { what: 'hàm lượng giác trong plot: {cos(\\x r)}', case: 'plot-trig-rad' },
  { what: '\\pgfmathparse{…} + \\pgfmathresult', case: 'pgfmath-parse' },
  { what: '\\pgfmathsetmacro{\\h}{sqrt(3)}', case: 'pgfmath-setmacro' },
  { what: '{sqrt(3)} trần trong toạ độ', case: 'raw-sqrt-coord' },
  { what: '{2*cos(60)} trần trong toạ độ', case: 'raw-trig-coord' },
  { what: '($(A)!{sqrt(2)/2}!(B)$)', case: 'calc-interp-math' },
  { what: 'toạ độ cực (30:2) và (\\macro:1)', case: 'polar-literal, polar-macro' },
  { what: 'arc (0:\\a:0.42)', case: 'arc-macro' },
  { what: '\\def\\a{210}', case: 'polar-macro' },
  { what: 'bảng biến thiên kẻ tay bằng \\draw + \\node + mũi tên', case: 'bbt-handmade' },
  { what: 'dấu tiếng Việt kiểu LaTeX: \\`o, \\\'{\\^o}, \\~{a}, \\d{o}', case: 'vn-accent-*' },

  // ── Đo lượt 2 (bộ hình đề thi, 47/47 dựng được) ────────────────────────────
  {
    what: 'tô miền bằng \\fill[pattern=north east lines] nối HAI lệnh plot rồi -- cycle',
    case: 'dothi-mien-giua-hai-do-thi, dothi-mien-voi-truc-ox',
    note:
      'Mở đường cho cả dạng bài diện tích hình phẳng và thể tích khối tròn xoay của lớp 12. ' +
      'Đây là ca vào bộ đo với nhãn "rủi ro có chủ ý" vì nối hai plot trong một path.',
  },
  {
    what: 'hai nhánh RỜI của hàm phân thức: hai lệnh plot với domain tách qua tiệm cận đứng',
    case: 'dothi-phan-thuc-hai-nhanh, dothi-tiem-can-xien',
  },
  { what: 'hàm mũ {2^\\x} và logarit {ln(\\x)/ln(2)} trong plot', case: 'dothi-mu-va-loga' },
  {
    what: 'name path= + \\path[name intersections={of=a and b,by=H}] để lấy giao điểm',
    case: 'phang-truc-tam',
  },
  {
    what: 'phép chiếu vuông góc của calc ($(B)!(A)!(C)$) — chân đường cao ĐÚNG',
    case: 'phang-truc-tam, phang-tam-giac-vuong-duong-cao',
  },
  { what: '\\node[draw,circle through=(A)] at (O) {}', case: 'phang-duong-tron-ngoai-tiep' },
  {
    what: '\\pic{angle=B--A--C} kèm nhãn kiểu quotes ["$\\alpha$"], và \\pic{right angle=...}',
    case: 'phang-goc-noi-tiep, kg-goc-duong-thang-va-mat-phang',
  },
  {
    what: 'postaction={decorate,decoration={markings,mark=at position .5 with {...}}}',
    case: 'phang-hinh-thang-dau-bang-nhau',
    note: 'Dấu đoạn bằng nhau. Không cần decorations.pathreplacing (thứ KHÔNG có).',
  },
  {
    what: 'ellipse (a and b) và arc (180:360:a and b) — hình trụ, nón, cầu',
    case: 'kg-hinh-tru, kg-hinh-non, kg-mat-cau',
  },
  {
    what: 'bảng biến thiên đủ dạng: gạch dọc $\\|$ tại tiệm cận, ô f(x) chia đôi ghi hai giới hạn',
    case: 'bbt-tiem-can-dung, bbt-phan-thuc-bac-nhat',
  },
  {
    what: 'MỘT \\node cho ra ĐÚNG MỘT node <text> trong SVG (không phải một <text> mỗi glyph)',
    case: 'toàn bộ 47 hình corpus',
    note:
      'Số đo về nhãn, không phải cú pháp. Nhờ nó mà đếm <text> dùng được làm phép kiểm "nhãn ' +
      'có ra hay không" — thứ duy nhất bắt được lớp lỗi font 404 của 1.2.',
  },
] as const;

/**
 * CHẾT HẲN (không ra SVG, hết timeout, rơi hình). Sanitizer phải chặn hết.
 */
export const TIKZ_CONFIRMED_FATAL = [
  {
    what: 'BẤT KỲ byte ngoài ASCII, ở BẤT KỲ đâu — kể cả trong comment và trong $\\text{}$',
    case: 'vietnamese-label, vn-in-comment, vn-in-math-text',
    note:
      'TeX 3.14 trong bundle không có inputenc. Đây là lỗi NGUY HIỂM NHẤT vì prompt của app ' +
      'viết bằng tiếng Việt nên model rất hay chú thích tiếng Việt trong mã TikZ.',
  },
  {
    what: '\\ohorn, \\uhorn (ơ, ư) và dấu hỏi — OT1 không ghép được',
    case: 'vn-horn-impossible',
    note: 'Nên chuyển dấu sang LaTeX không đủ; phải bỏ dấu về ASCII cho chắc.',
  },
  { what: '\\usepackage{…} bất kỳ', case: 'hang-pgfplots' },
  { what: '\\usetikzlibrary ngoài allowlist', case: 'hang-lib-missing' },
  {
    what: '\\documentclass + \\begin{document} do model tự thêm',
    case: 'hang-documentclass',
    note: 'TikZJax chỉ tự bọc \\begin{document} khi mã CHƯA có; có rồi là chết ở \\documentclass.',
  },
] as const;

/**
 * Ghi chú: `preprocessTikzForTikzJax` (trong `latexToImage.ts`) evaluate `{sqrt(3)}` thành số
 * là **không cần thiết** — probe chứng minh renderer tự làm được. Vẫn giữ vì nó vô hại (quy
 * về số thập phân cho ra hình y như cũ) và còn che được những dạng PGF math chưa đo tới.
 * Nhưng ĐỪNG tin nó là thứ đang giữ cho hình sống: thứ đó là bộ lọc ASCII ở
 * `tikzSanitize.ts`.
 */
export const PGF_MATH_PREPROCESS_IS_BELT_AND_BRACES = true;

/** Khối luật sinh cho prompt. Prompt KHÔNG được viết tay danh sách này nữa. */
export function tikzCapsRules(): string {
  return [
    'GIỚI HẠN CỦA BỘ DỰNG HÌNH (đo thật ngày ' + TIKZ_CAPS_MEASURED_AT + ', vi phạm = MẤT HÌNH):',
    '',
    'TUYỆT ĐỐI KHÔNG:',
    '- KHÔNG viết chữ có dấu tiếng Việt ở bất cứ đâu trong mã, KỂ CẢ trong dòng chú thích %.',
    '  Một chữ "Số" là mất cả hình. Nhãn chỉ dùng tên điểm, số, và công thức trong $...$.',
    '  Cần ghi chữ tiếng Việt thì viết KHÔNG DẤU (vd: "So nhan vien").',
    '- KHÔNG viết \\documentclass, \\usepackage, \\begin{document}. Mã bắt đầu bằng',
    '  \\begin{tikzpicture} và kết thúc bằng \\end{tikzpicture}.',
    '- KHÔNG dùng pgfplots (không có môi trường axis, không có \\addplot).',
    '- KHÔNG dùng decoration={brace}, snake, coil, zigzag (thiếu decorations.pathreplacing',
    '  và decorations.pathmorphing).',
    '- KHÔNG dùng thư viện perspective — phối cảnh 3D phải tự đặt toạ độ.',
    '',
    'CHỈ được \\usetikzlibrary trong danh sách này:',
    '  ' + TIKZ_LIB_ALLOWLIST.join(', '),
    '',
    'ĐƯỢC PHÉP dùng thoải mái (đã dựng thử thành công):',
    ...TIKZ_CONFIRMED_WORKING.map((c) => '- ' + c.what),
  ].join('\n');
}
