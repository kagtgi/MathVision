/**
 * Bộ hình đề thi THPT để dựng THẬT — khác hẳn `tikzProbe/cases.ts`.
 *
 * `tikzProbe` hỏi "TikZJax làm được gì" (36 ca cú pháp: `\foreach` có chạy không, `pgfplots`
 * có chết không). Bộ này hỏi câu khác: **"hình đề thi có tới được file Word không"** — nên mỗi
 * ca là một hình thật của chương trình, đi qua đúng `tikzToImage()` của app (sanitize + nhúng
 * font + đo mực), không phải qua một bản dựng lại.
 *
 * VÌ SAO CẦN: trước bản này, không ai biết một bảng biến thiên có tiệm cận đứng hay một hình
 * chóp có nét đứt đúng chỗ có dựng ra được không — cho tới lúc chạy đề thật của người dùng.
 * `verify-tikz-sanitize.mjs` chỉ kiểm bộ lọc chuỗi, còn probe thì CỐ TÌNH bỏ qua sanitizer.
 *
 * MỖI CA VIẾT BẰNG ĐÚNG NHỮNG GÌ `figureRulesFor(kind)` DẠY MODEL. Đó là điều kiện để bộ này
 * còn dùng được làm phép kiểm chống lệch prompt: luật nào khuyên một cấu trúc thì phải có ít
 * nhất một ca chứng minh cấu trúc đó dựng được (xem `scripts/verify-tikz-corpus.mjs`).
 * Ca FAIL thì sửa MỘT trong hai — luật (prompt khuyên thứ không dựng được) hoặc ca (viết sai) —
 * và ghi quyết định vào `why`.
 *
 * BẮT BUỘC với `code`: **toàn bộ ASCII** (một chữ có dấu là mất hình), không `\usepackage`,
 * không `\documentclass`, `\usetikzlibrary` chỉ dùng tên trong `TIKZ_LIB_ALLOWLIST` và viết
 * LIỀN không có dấu cách sau dấu phẩy (sanitizer chuẩn hoá về dạng đó, khác đi là harness báo
 * lệch). `why`/`sgk` là chữ hiển thị nên viết tiếng Việt bình thường.
 */

export interface CorpusCase {
  id: string;
  /** Họ hình — dùng đúng slug `FigureCategory` để tra sang `figurePrompts.ts`. */
  group: 'dothi' | 'bbt' | 'phang' | 'khonggian';
  /** Mục chương trình, để soát độ phủ bằng mắt trên trang báo cáo. */
  sgk: string;
  /** Ca này chứng minh được điều gì, và biết được gì nếu nó fail. */
  why: string;
  code: string;
  /**
   * Dải mực chấp nhận, tính bằng **RATIO** (không phải %) để so trực tiếp với
   * `MIN_INK_RATIO = 0.002` của `latexToImage.ts`.
   *
   * ĐO THẬT 2026-08-11 rồi lấy **+-10%** quanh số đo. Siết được tới 10% vì renderer TẤT ĐỊNH:
   * hai lượt `verify-tikz-render.mjs` liên tiếp cho `results.json` trùng khít từng byte. Và
   * phải siết tới đó mới bắt lại được lớp lỗi đắt nhất của 1.2 — `fonts.css` 404 làm nhãn sai
   * glyph, đo được chỉ lệch ~11% mực (6,3% -> 7,1%), nên một dải +-25% sẽ cho nó lọt.
   *
   * Sửa hình thì PHẢI đo lại dải: chạy `node scripts/verify-tikz-render.mjs` rồi lấy số trong
   * `demo/tikz-corpus/results.json`. Harness báo lệch chính là để bắt bước đó.
   */
  expectInk: [number, number];
  /**
   * Số node `<text>` tối thiểu. Phép kiểm mà probe không có và là phép kiểm đắt nhất:
   * TikZJax xuất nhãn thành `<text font-family="cmr10">` chứ KHÔNG phải `<path>`, nên đếm
   * `<text>` là cách duy nhất biết nhãn có ra hay không. Lỗi `fonts.css` 404 của 1.2 (cả 140
   * rule đều 404) trượt qua mọi phép kiểm khác.
   *
   * ĐO THẬT: **một `\node` cho ra đúng MỘT `<text>`**, không phải một `<text>` mỗi glyph —
   * nhãn `$(-1;2)$` vẫn chỉ là một node. Nên số dưới đây bằng đúng số nhãn của hình.
   */
  minText: number;
}

interface PicOpts {
  /** Tuỳ chọn thêm cho môi trường, vd `x=1cm,y=0.8cm`. */
  opts?: string;
  /** Thư viện, viết liền không dấu cách: `calc,angles,quotes`. */
  libs?: string;
}

/** Mở đầu đúng như `SGK_STYLE_RULES` yêu cầu — luật nào dạy thì ca phải dùng đúng thứ đó. */
const BASE_OPTS = 'line cap=round,line join=round,>=Stealth';

const pic = (body: string, o: PicOpts = {}) =>
  (o.libs ? `\\usetikzlibrary{${o.libs}}\n` : '') +
  `\\begin{tikzpicture}[${BASE_OPTS}${o.opts ? ',' + o.opts : ''}]\n${body}\n\\end{tikzpicture}`;

// ─── Đồ thị hàm số ───────────────────────────────────────────────────────────

const DOTHI: CorpusCase[] = [
  {
    id: 'dothi-bac3-hai-cuc-tri',
    group: 'dothi',
    sgk: 'L12 - Khao sat va ve do thi ham bac ba',
    why: 'Hình đồ thị phổ biến nhất của lớp 12. Chốt đường vẽ chính mà luật khuyên: plot[domain,samples,smooth].',
    expectInk: [0.0297, 0.0363],
    minText: 10,
    code: pic(
      '  \\draw[->] (-2.6,0) -- (2.6,0) node[below right] {$x$};\n' +
        '  \\draw[->] (0,-3.6) -- (0,3.6) node[left] {$y$};\n' +
        '  \\node[below left] at (0,0) {$O$};\n' +
        '  \\draw[thick,domain=-2.15:2.15,samples=100,smooth] plot (\\x,{\\x*\\x*\\x-3*\\x});\n' +
        '  \\fill (-1,2) circle (1.5pt) node[above right] {$(-1;2)$};\n' +
        '  \\fill (1,-2) circle (1.5pt) node[below left] {$(1;-2)$};',
      { opts: 'x=1.1cm,y=0.6cm' },
    ),
  },
  {
    id: 'dothi-bac3-don-dieu',
    group: 'dothi',
    sgk: 'L12 - Ham bac ba dong bien tren R (khong cuc tri)',
    why: 'Bản đối chứng của ca trên: cùng loại hàm mà KHÔNG có cực trị. Fail riêng ca này là lỗi dải mực, không phải lỗi renderer.',
    expectInk: [0.0145, 0.0178],
    minText: 3,
    code: pic(
      '  \\draw[->] (-2.4,0) -- (2.4,0) node[below right] {$x$};\n' +
        '  \\draw[->] (0,-3.6) -- (0,3.6) node[left] {$y$};\n' +
        '  \\node[above left] at (0,0) {$O$};\n' +
        '  \\draw[thick,domain=-1.5:1.5,samples=80,smooth] plot (\\x,{\\x*\\x*\\x+\\x});',
      { opts: 'x=1.2cm,y=0.7cm' },
    ),
  },
  {
    id: 'dothi-bac4-trung-phuong',
    group: 'dothi',
    sgk: 'L12 - Do thi ham bac bon trung phuong, ba cuc tri',
    why: 'Ba cực trị và tính đối xứng qua Oy. Bắt lỗi model vẽ thiếu một nhánh.',
    expectInk: [0.0213, 0.026],
    minText: 6,
    code: pic(
      '  \\draw[->] (-2,0) -- (2,0) node[below right] {$x$};\n' +
        '  \\draw[->] (0,-2) -- (0,2.6) node[left] {$y$};\n' +
        '  \\node[below right] at (0,0) {$O$};\n' +
        '  \\draw[thick,domain=-1.6:1.6,samples=100,smooth] plot (\\x,{\\x*\\x*\\x*\\x-2*\\x*\\x});\n' +
        '  \\fill (-1,-1) circle (1.5pt);\n' +
        '  \\fill (1,-1) circle (1.5pt);\n' +
        '  \\node[below] at (-1,-1) {$-1$};\n' +
        '  \\node[below] at (1,-1) {$1$};',
      { opts: 'x=1.6cm,y=1cm' },
    ),
  },
  {
    id: 'dothi-phan-thuc-hai-nhanh',
    group: 'dothi',
    sgk: 'L12 - Do thi y=(ax+b)/(cx+d), tiem can dung va tiem can ngang',
    why: 'CA KHÓ NHẤT của họ này: hai nhánh phải RỜI nhau. Nối liền qua tiệm cận đứng là lỗi mà trọng tài hình gọi là duongSai, và là lỗi model mắc nhiều nhất.',
    expectInk: [0.0195, 0.0238],
    minText: 9,
    code: pic(
      '  \\draw[->] (-2.6,0) -- (3.6,0) node[below right] {$x$};\n' +
        '  \\draw[->] (0,-4) -- (0,4.4) node[left] {$y$};\n' +
        '  \\node[above left] at (0,0) {$O$};\n' +
        '  \\draw[dashed] (1,-4) -- (1,4.2) node[above] {$x=1$};\n' +
        '  \\draw[dashed] (-2.6,1) -- (3.5,1) node[right] {$y=1$};\n' +
        '  \\draw[thick,domain=-2.4:0.5,samples=60,smooth] plot (\\x,{1+2/(\\x-1)});\n' +
        '  \\draw[thick,domain=1.7:3.4,samples=60,smooth] plot (\\x,{1+2/(\\x-1)});',
      { opts: 'x=1cm,y=0.55cm' },
    ),
  },
  {
    id: 'dothi-tiem-can-xien',
    group: 'dothi',
    sgk: 'L12 - Do thi y=(ax^2+bx+c)/(dx+e), tiem can xien',
    why: 'Tiệm cận XIÊN, thứ chỉ vẽ đúng khi model đặt đúng đường y=x. Cũng là ca hai nhánh thứ hai.',
    expectInk: [0.0168, 0.0205],
    minText: 6,
    code: pic(
      '  \\draw[->] (-3.4,0) -- (3.4,0) node[below right] {$x$};\n' +
        '  \\draw[->] (0,-4.2) -- (0,4.2) node[left] {$y$};\n' +
        '  \\node[above left] at (0,0) {$O$};\n' +
        '  \\draw[dashed] (-3.2,-3.2) -- (3.2,3.2) node[above right] {$y=x$};\n' +
        '  \\draw[thick,domain=0.32:3,samples=60,smooth] plot (\\x,{\\x+1/\\x});\n' +
        '  \\draw[thick,domain=-3:-0.32,samples=60,smooth] plot (\\x,{\\x+1/\\x});',
      { opts: 'x=1cm,y=0.7cm' },
    ),
  },
  {
    id: 'dothi-mu-va-loga',
    group: 'dothi',
    sgk: 'L11/L12 - Do thi ham so mu va ham so logarit, doi xung qua y=x',
    why: 'Hai đồ thị trên một hệ trục + quan hệ đối xứng. Đo luôn hàm ln trong plot (pgfmath có ln, và tiền xử lý PGF math phải KHÔNG được nuốt biểu thức chứa \\x).',
    expectInk: [0.0229, 0.0279],
    minText: 15,
    code: pic(
      '  \\draw[->] (-2.2,0) -- (4.2,0) node[below right] {$x$};\n' +
        '  \\draw[->] (0,-2.2) -- (0,4.2) node[left] {$y$};\n' +
        '  \\node[below left] at (0,0) {$O$};\n' +
        '  \\draw[dashed] (-1.8,-1.8) -- (3.8,3.8) node[above right] {$y=x$};\n' +
        '  \\draw[thick,domain=-2:2,samples=60,smooth] plot (\\x,{2^\\x});\n' +
        '  \\draw[thick,domain=0.25:4,samples=60,smooth] plot (\\x,{ln(\\x)/ln(2)});\n' +
        '  \\node[above left] at (2,4) {$y=2^{x}$};\n' +
        '  \\node[below right] at (4,2) {$y=\\log_{2}x$};',
      { opts: 'x=0.9cm,y=0.9cm' },
    ),
  },
  {
    id: 'dothi-f-phay',
    group: 'dothi',
    sgk: 'L12 - Cho do thi f\'(x), hoi tinh don dieu cua f(x)',
    why: 'Dạng đề rất phổ biến của lớp 12: hình là đồ thị của ĐẠO HÀM. Nhãn phải là $y=f\'(x)$ chứ không phải $y=f(x)$ — nhầm chỗ này là sai hẳn bài.',
    expectInk: [0.0232, 0.0283],
    minText: 13,
    code: pic(
      '  \\draw[->] (-2.6,0) -- (2.6,0) node[below right] {$x$};\n' +
        '  \\draw[->] (0,-2) -- (0,2.6) node[left] {$y$};\n' +
        '  \\node[below left] at (0,0) {$O$};\n' +
        '  \\draw[thick,domain=-2.2:2.2,samples=80,smooth] plot (\\x,{\\x*\\x-1});\n' +
        '  \\fill (-1,0) circle (1.5pt) node[below left] {$-1$};\n' +
        '  \\fill (1,0) circle (1.5pt) node[below right] {$1$};\n' +
        '  \\node[right] at (2.2,2.2) {$y=f\'(x)$};',
      { opts: 'x=1.1cm,y=0.8cm' },
    ),
  },
  {
    id: 'dothi-mien-giua-hai-do-thi',
    group: 'dothi',
    sgk: 'L12 - Ung dung tich phan: dien tich hinh phang giua hai do thi',
    why: 'CA RỦI RO CÓ CHỦ Ý: tô miền bằng pattern qua hai lệnh plot nối nhau. Nếu fail thì luật đồ thị phải đổi sang cách tô bằng plot coordinates, vì diện tích hình phẳng là dạng bài lớp 12 không thể bỏ.',
    expectInk: [0.0849, 0.1038],
    minText: 3,
    code: pic(
      '  \\draw[->] (-2.2,0) -- (3,0) node[below right] {$x$};\n' +
        '  \\draw[->] (0,-0.6) -- (0,4.6) node[left] {$y$};\n' +
        '  \\node[below left] at (0,0) {$O$};\n' +
        '  \\fill[pattern=north east lines] plot[domain=-1:2,samples=50,smooth] (\\x,{\\x*\\x})' +
        ' -- plot[domain=2:-1,samples=50,smooth] (\\x,{\\x+2}) -- cycle;\n' +
        '  \\draw[thick,domain=-1.4:2.1,samples=60,smooth] plot (\\x,{\\x*\\x});\n' +
        '  \\draw[thick] plot coordinates {(-1.8,0.2) (2.6,4.6)};',
      { opts: 'x=1.2cm,y=0.8cm', libs: 'patterns' },
    ),
  },
  {
    id: 'dothi-mien-voi-truc-ox',
    group: 'dothi',
    sgk: 'L12 - Ung dung tich phan: dien tich giua do thi va truc Ox tren [a;b]',
    why: 'Bản đơn giản hơn của ca tô miền: biên dưới là đoạn thẳng trên trục. Nếu ca này pass mà ca kia fail thì biết ngay vấn đề nằm ở chỗ nối HAI lệnh plot.',
    expectInk: [0.1587, 0.194],
    minText: 6,
    code: pic(
      '  \\draw[->] (-2.6,0) -- (2.6,0) node[below right] {$x$};\n' +
        '  \\draw[->] (0,-0.6) -- (0,4.6) node[left] {$y$};\n' +
        '  \\node[below left] at (0,0) {$O$};\n' +
        '  \\fill[pattern=north east lines] (-2,0) -- plot[domain=-2:2,samples=50,smooth]' +
        ' (\\x,{4-\\x*\\x}) -- (2,0) -- cycle;\n' +
        // Vẽ đúng đoạn [-2;2]: kéo dài quá nghiệm thì đường cong chạy xuống dưới trục và cắt
        // ngang chính hai nhãn mốc.
        '  \\draw[thick,domain=-2:2,samples=60,smooth] plot (\\x,{4-\\x*\\x});\n' +
        '  \\node[below] at (-2,0) {$-2$};\n' +
        '  \\node[below] at (2,0) {$2$};',
      { opts: 'x=1.1cm,y=0.8cm', libs: 'patterns' },
    ),
  },
  {
    id: 'dothi-tuong-giao-duong-thang',
    group: 'dothi',
    sgk: 'L12 - Tuong giao, bien luan so nghiem theo tham so m',
    why: 'Đường thẳng y=m cắt đồ thị: dạng bài biện luận số nghiệm. Đường gióng nét đứt mảnh tới giao điểm là thứ luật đồ thị yêu cầu.',
    expectInk: [0.0272, 0.0333],
    minText: 6,
    code: pic(
      '  \\draw[->] (-2.6,0) -- (2.6,0) node[below right] {$x$};\n' +
        '  \\draw[->] (0,-3.6) -- (0,3.6) node[left] {$y$};\n' +
        '  \\node[below left] at (0,0) {$O$};\n' +
        '  \\draw[thick,domain=-2.15:2.15,samples=100,smooth] plot (\\x,{\\x*\\x*\\x-3*\\x});\n' +
        '  \\draw[dashed] (-2.5,1) -- (2.5,1) node[right] {$y=m$};\n' +
        '  \\fill (-1.88,1) circle (1.4pt);\n' +
        '  \\fill (-0.35,1) circle (1.4pt);\n' +
        '  \\fill (2.23,1) circle (1.4pt);',
      { opts: 'x=1.1cm,y=0.6cm' },
    ),
  },
  {
    id: 'dothi-sin-mot-chu-ky',
    group: 'dothi',
    sgk: 'L11 - Do thi ham so y=sin x tren mot chu ky',
    why: 'Hàm lượng giác cần đơn vị radian {sin(\\x r)}, và mốc trục theo pi dựng bằng \\foreach \\x/\\t — đúng hai thứ luật đồ thị dạy. Cũng là ca chứng minh tiền xử lý PGF math KHÔNG nuốt \\pi trong nhãn.',
    expectInk: [0.0259, 0.0316],
    minText: 12,
    code: pic(
      '  \\draw[->] (-3.6,0) -- (3.6,0) node[below right] {$x$};\n' +
        '  \\draw[->] (0,-1.6) -- (0,1.6) node[left] {$y$};\n' +
        '  \\node[below right] at (0,0) {$O$};\n' +
        '  \\draw[thick,domain=-3.1416:3.1416,samples=100,smooth] plot (\\x,{sin(\\x r)});\n' +
        '  \\foreach \\x/\\t in {-3.1416/{-\\pi}, -1.5708/{-\\dfrac{\\pi}{2}}, 1.5708/{\\dfrac{\\pi}{2}}, 3.1416/{\\pi}} {\n' +
        '    \\draw (\\x,-0.06) -- (\\x,0.06);\n' +
        '    \\node[below,font=\\scriptsize] at (\\x,-0.08) {$\\t$};\n  }\n' +
        '  \\draw (-0.06,1) -- (0.06,1);\n' +
        '  \\node[left,font=\\scriptsize] at (-0.08,1) {$1$};',
      { opts: 'x=0.8cm,y=1.2cm' },
    ),
  },
  {
    id: 'dothi-parabol-truc-doi-xung',
    group: 'dothi',
    sgk: 'L10 - Do thi ham so bac hai, dinh va truc doi xung',
    why: 'Parabol có đỉnh không ở gốc: đỉnh, trục đối xứng nét đứt, hai giao điểm với Ox phải khớp nghiệm.',
    expectInk: [0.0248, 0.0303],
    minText: 12,
    code: pic(
      '  \\draw[->] (-2.4,0) -- (4.4,0) node[below right] {$x$};\n' +
        '  \\draw[->] (0,-4.6) -- (0,2.6) node[left] {$y$};\n' +
        '  \\node[above left] at (0,0) {$O$};\n' +
        '  \\draw[dashed] (1,-4.4) -- (1,2.4) node[above] {$x=1$};\n' +
        '  \\draw[thick,domain=-1.5:3.5,samples=80,smooth] plot (\\x,{\\x*\\x-2*\\x-3});\n' +
        '  \\fill (-1,0) circle (1.5pt) node[above left] {$-1$};\n' +
        '  \\fill (3,0) circle (1.5pt) node[above right] {$3$};\n' +
        '  \\fill (1,-4) circle (1.5pt) node[below right] {$(1;-4)$};',
      { opts: 'x=1cm,y=0.6cm' },
    ),
  },
  {
    id: 'dothi-duong-tron-oxy',
    group: 'dothi',
    sgk: 'L10 - Phuong trinh duong tron trong mat phang toa do',
    why: 'Hình học toạ độ: đường tròn có tâm không ở gốc, bán kính nét đứt. Đây là loại duy nhất luật cho phép kẻ lưới, nhưng ca này cố tình KHÔNG kẻ để đối chứng.',
    expectInk: [0.0247, 0.0302],
    minText: 9,
    code: pic(
      '  \\coordinate (I) at (1,1);\n' +
        '  \\coordinate (M) at (3,1);\n' +
        '  \\draw[->] (-2,0) -- (4.4,0) node[below right] {$x$};\n' +
        '  \\draw[->] (0,-2) -- (0,4.4) node[left] {$y$};\n' +
        '  \\node[below left] at (0,0) {$O$};\n' +
        '  \\draw[thick] (I) circle (2);\n' +
        '  \\fill (I) circle (1.5pt) node[below left] {$I(1;1)$};\n' +
        '  \\draw[dashed] (I) -- (M) node[midway,above] {$R=2$};',
      { opts: 'x=0.9cm,y=0.9cm' },
    ),
  },
  {
    id: 'dothi-bieu-do-tan-so-ghep-nhom',
    group: 'dothi',
    sgk: 'L12 - Thong ke: mau so lieu ghep nhom, bieu do tan so',
    why: 'Thống kê lớp 12 dùng biểu đồ cột, không phải đồ thị hàm. Dựng bằng \\foreach \\x/\\h — nếu fail thì đề thống kê phải giữ ảnh cắt.',
    expectInk: [0.0258, 0.0315],
    minText: 10,
    code: pic(
      '  \\draw[->] (-0.3,0) -- (6.4,0) node[below right] {$x$};\n' +
        '  \\draw[->] (0,-0.3) -- (0,4.4) node[left] {$n$};\n' +
        '  \\node[below left] at (0,0) {$O$};\n' +
        '  \\foreach \\x/\\h in {0/2, 1/5, 2/8, 3/6, 4/3, 5/1} {\n' +
        '    \\draw (\\x,0) rectangle (\\x+1,\\h*0.4);\n  }\n' +
        '  \\foreach \\x/\\t in {0/{20}, 1/{30}, 2/{40}, 3/{50}, 4/{60}, 5/{70}, 6/{80}} {\n' +
        '    \\node[below,font=\\scriptsize] at (\\x,-0.05) {$\\t$};\n  }',
      { opts: 'x=1cm,y=1cm' },
    ),
  },
];

// ─── Bảng biến thiên ─────────────────────────────────────────────────────────
//
// Ho hinh RUI RO NHAT: `tikzProbe/cases.ts` chi co DUNG MOT ca bbt va ghi ro
// "loai nay KHONG co prior art". Ca nao fail o day thi phai sua CATEGORY_RULES.bbt.

const BBT: CorpusCase[] = [
  {
    id: 'bbt-bac3',
    group: 'bbt',
    sgk: 'L12 - Bang bien thien ham bac ba, hai cuc tri',
    why: 'Bảng biến thiên chuẩn nhất. Chốt nhất quán ba tầng: thứ tự mốc x, dấu f\'(x), chiều mũi tên f(x). Dấu + thì mũi tên phải đi LÊN.',
    expectInk: [0.0679, 0.083],
    minText: 27,
    code: pic(
      '  \\draw (0,0) rectangle (7,-2.4);\n' +
        '  \\draw (0,-0.8) -- (7,-0.8);\n' +
        '  \\draw (0,-1.6) -- (7,-1.6);\n' +
        '  \\draw (1,0) -- (1,-2.4);\n' +
        '  \\node at (0.5,-0.4) {$x$};\n' +
        '  \\node at (0.5,-1.2) {$f\'(x)$};\n' +
        '  \\node at (0.5,-2) {$f(x)$};\n' +
        '  \\node at (1.6,-0.4) {$-\\infty$};\n' +
        '  \\node at (3.2,-0.4) {$-1$};\n' +
        '  \\node at (4.8,-0.4) {$1$};\n' +
        '  \\node at (6.5,-0.4) {$+\\infty$};\n' +
        '  \\node at (2.4,-1.2) {$+$};\n' +
        '  \\node at (3.2,-1.2) {$0$};\n' +
        '  \\node at (4,-1.2) {$-$};\n' +
        '  \\node at (4.8,-1.2) {$0$};\n' +
        '  \\node at (5.7,-1.2) {$+$};\n' +
        '  \\node at (1.6,-2.2) {$-\\infty$};\n' +
        '  \\node at (3.2,-1.8) {$2$};\n' +
        '  \\node at (4.8,-2.2) {$-2$};\n' +
        '  \\node at (6.5,-1.8) {$+\\infty$};\n' +
        '  \\draw[->] (1.95,-2.15) -- (2.9,-1.85);\n' +
        '  \\draw[->] (3.5,-1.85) -- (4.5,-2.15);\n' +
        '  \\draw[->] (5.1,-2.15) -- (6.15,-1.85);',
    ),
  },
  {
    id: 'bbt-bac4-trung-phuong',
    group: 'bbt',
    sgk: 'L12 - Bang bien thien ham bac bon trung phuong, ba cuc tri',
    why: 'Bốn mốc, ba lần đổi dấu, bốn mũi tên. Bảng dài hơn nên bắt được lỗi tràn khung và lỗi ô lệch cột.',
    expectInk: [0.0663, 0.081],
    minText: 33,
    code: pic(
      '  \\draw (0,0) rectangle (8.6,-2.4);\n' +
        '  \\draw (0,-0.8) -- (8.6,-0.8);\n' +
        '  \\draw (0,-1.6) -- (8.6,-1.6);\n' +
        '  \\draw (1,0) -- (1,-2.4);\n' +
        '  \\node at (0.5,-0.4) {$x$};\n' +
        '  \\node at (0.5,-1.2) {$f\'(x)$};\n' +
        '  \\node at (0.5,-2) {$f(x)$};\n' +
        '  \\node at (1.6,-0.4) {$-\\infty$};\n' +
        '  \\node at (3.1,-0.4) {$-1$};\n' +
        '  \\node at (4.8,-0.4) {$0$};\n' +
        '  \\node at (6.5,-0.4) {$1$};\n' +
        '  \\node at (8.1,-0.4) {$+\\infty$};\n' +
        '  \\node at (2.35,-1.2) {$-$};\n' +
        '  \\node at (3.1,-1.2) {$0$};\n' +
        '  \\node at (3.95,-1.2) {$+$};\n' +
        '  \\node at (4.8,-1.2) {$0$};\n' +
        '  \\node at (5.65,-1.2) {$-$};\n' +
        '  \\node at (6.5,-1.2) {$0$};\n' +
        '  \\node at (7.3,-1.2) {$+$};\n' +
        '  \\node at (1.6,-1.8) {$+\\infty$};\n' +
        '  \\node at (3.1,-2.2) {$-1$};\n' +
        '  \\node at (4.8,-1.8) {$0$};\n' +
        '  \\node at (6.5,-2.2) {$-1$};\n' +
        '  \\node at (8.1,-1.8) {$+\\infty$};\n' +
        '  \\draw[->] (1.95,-1.85) -- (2.8,-2.15);\n' +
        '  \\draw[->] (3.4,-2.15) -- (4.5,-1.85);\n' +
        '  \\draw[->] (5.1,-1.85) -- (6.2,-2.15);\n' +
        '  \\draw[->] (6.8,-2.15) -- (7.8,-1.85);',
    ),
  },
  {
    id: 'bbt-tiem-can-dung',
    group: 'bbt',
    sgk: 'L12 - Bang bien thien co tiem can dung, o f(x) chia doi',
    why: 'CA THEN CHỐT của họ bbt: gạch dọc $\\|$ ở hàng f\'(x) và ô f(x) chia đôi ghi giới hạn hai bên. Đúng thứ luật bbt yêu cầu và đúng thứ chưa ai đo.',
    expectInk: [0.0643, 0.0786],
    minText: 22,
    code: pic(
      '  \\draw (0,0) rectangle (7,-2.4);\n' +
        '  \\draw (0,-0.8) -- (7,-0.8);\n' +
        '  \\draw (0,-1.6) -- (7,-1.6);\n' +
        '  \\draw (1,0) -- (1,-2.4);\n' +
        '  \\node at (0.5,-0.4) {$x$};\n' +
        '  \\node at (0.5,-1.2) {$f\'(x)$};\n' +
        '  \\node at (0.5,-2) {$f(x)$};\n' +
        '  \\node at (1.7,-0.4) {$-\\infty$};\n' +
        '  \\node at (4,-0.4) {$1$};\n' +
        '  \\node at (6.4,-0.4) {$+\\infty$};\n' +
        '  \\node at (2.8,-1.2) {$-$};\n' +
        '  \\node at (4,-1.2) {$\\|$};\n' +
        '  \\node at (5.2,-1.2) {$-$};\n' +
        '  \\draw (4,-1.6) -- (4,-2.4);\n' +
        '  \\node at (1.7,-1.8) {$1$};\n' +
        '  \\node at (3.7,-2.2) {$-\\infty$};\n' +
        '  \\node at (4.3,-1.8) {$+\\infty$};\n' +
        '  \\node at (6.4,-2.2) {$1$};\n' +
        '  \\draw[->] (2.1,-1.85) -- (3.05,-2.1);\n' +
        '  \\draw[->] (4.6,-1.85) -- (6,-2.15);',
    ),
  },
  {
    id: 'bbt-nghiem-kep-khong-doi-dau',
    group: 'bbt',
    sgk: 'L12 - f\'(x)=0 nhung khong doi dau, ham don dieu',
    why: 'Bẫy quen: có nghiệm của f\' mà KHÔNG có cực trị. Dấu hai bên cùng là +, mũi tên vẫn đi lên suốt. Bắt lỗi model tự thêm cực trị cho "đủ bộ".',
    expectInk: [0.0663, 0.081],
    minText: 20,
    code: pic(
      '  \\draw (0,0) rectangle (6.4,-2.4);\n' +
        '  \\draw (0,-0.8) -- (6.4,-0.8);\n' +
        '  \\draw (0,-1.6) -- (6.4,-1.6);\n' +
        '  \\draw (1,0) -- (1,-2.4);\n' +
        '  \\node at (0.5,-0.4) {$x$};\n' +
        '  \\node at (0.5,-1.2) {$f\'(x)$};\n' +
        '  \\node at (0.5,-2) {$f(x)$};\n' +
        '  \\node at (1.7,-0.4) {$-\\infty$};\n' +
        '  \\node at (3.7,-0.4) {$0$};\n' +
        '  \\node at (5.8,-0.4) {$+\\infty$};\n' +
        '  \\node at (2.7,-1.2) {$+$};\n' +
        '  \\node at (3.7,-1.2) {$0$};\n' +
        '  \\node at (4.8,-1.2) {$+$};\n' +
        '  \\node at (1.7,-2.2) {$-\\infty$};\n' +
        '  \\node at (5.8,-1.8) {$+\\infty$};\n' +
        '  \\draw[->] (2.4,-2.13) -- (5.4,-1.88);',
    ),
  },
  {
    id: 'bbt-phan-thuc-bac-nhat',
    group: 'bbt',
    sgk: 'L12 - Bang bien thien y=(ax+b)/(cx+d), nghich bien tren tung khoang',
    why: 'Bảng đi kèm ca dothi-phan-thuc-hai-nhanh: cùng một hàm, hai cách trình bày. Hai ca này phải kể cùng một câu chuyện, lệch nhau là prompt sai một bên.',
    expectInk: [0.0603, 0.0737],
    minText: 16,
    code: pic(
      '  \\draw (0,0) rectangle (7,-2.4);\n' +
        '  \\draw (0,-0.8) -- (7,-0.8);\n' +
        '  \\draw (0,-1.6) -- (7,-1.6);\n' +
        '  \\draw (1,0) -- (1,-2.4);\n' +
        '  \\node at (0.5,-0.4) {$x$};\n' +
        '  \\node at (0.5,-1.2) {$y\'$};\n' +
        '  \\node at (0.5,-2) {$y$};\n' +
        '  \\node at (1.7,-0.4) {$-\\infty$};\n' +
        '  \\node at (4,-0.4) {$1$};\n' +
        '  \\node at (6.4,-0.4) {$+\\infty$};\n' +
        '  \\node at (2.8,-1.2) {$-$};\n' +
        '  \\node at (4,-1.2) {$\\|$};\n' +
        '  \\node at (5.2,-1.2) {$-$};\n' +
        '  \\draw (4,-1.6) -- (4,-2.4);\n' +
        '  \\node at (1.7,-1.8) {$1$};\n' +
        '  \\node at (3.7,-2.2) {$-\\infty$};\n' +
        '  \\node at (4.3,-1.8) {$+\\infty$};\n' +
        '  \\node at (6.4,-2.2) {$1$};\n' +
        '  \\draw[->] (2.1,-1.85) -- (3.05,-2.1);\n' +
        '  \\draw[->] (4.6,-1.85) -- (6,-2.15);',
    ),
  },
  {
    id: 'bbt-mot-cuc-tri',
    group: 'bbt',
    sgk: 'L10/L12 - Bang bien thien ham bac hai, mot cuc tieu',
    why: 'Bảng ngắn nhất còn đủ ba hàng: một mốc, một lần đổi dấu, hai mũi tên. Là mốc so sánh của họ bbt — fail ca này thì cả họ vô nghĩa, không phải lỗi của bảng phức tạp.',
    expectInk: [0.0617, 0.0754],
    minText: 17,
    code: pic(
      '  \\draw (0,0) rectangle (6.4,-2.4);\n' +
        '  \\draw (0,-0.8) -- (6.4,-0.8);\n' +
        '  \\draw (0,-1.6) -- (6.4,-1.6);\n' +
        '  \\draw (1,0) -- (1,-2.4);\n' +
        '  \\node at (0.5,-0.4) {$x$};\n' +
        '  \\node at (0.5,-1.2) {$y\'$};\n' +
        '  \\node at (0.5,-2) {$y$};\n' +
        '  \\node at (1.7,-0.4) {$-\\infty$};\n' +
        '  \\node at (3.7,-0.4) {$1$};\n' +
        '  \\node at (5.8,-0.4) {$+\\infty$};\n' +
        '  \\node at (2.7,-1.2) {$-$};\n' +
        '  \\node at (3.7,-1.2) {$0$};\n' +
        '  \\node at (4.8,-1.2) {$+$};\n' +
        '  \\node at (1.7,-1.8) {$+\\infty$};\n' +
        '  \\node at (3.7,-2.2) {$-4$};\n' +
        '  \\node at (5.8,-1.8) {$+\\infty$};\n' +
        '  \\draw[->] (2.05,-1.85) -- (3.05,-2.1);\n' +
        '  \\draw[->] (4.35,-2.13) -- (5.4,-1.88);',
    ),
  },
  {
    id: 'bbt-bang-xet-dau',
    group: 'bbt',
    sgk: 'L12 - Bang xet dau f\'(x) (hai hang)',
    why: 'Bảng HAI hàng, không phải ba. Nếu ca này pass mà ca ba hàng fail thì lỗi nằm ở hàng f(x) và mũi tên chéo, khoanh vùng được ngay.',
    expectInk: [0.067, 0.0819],
    minText: 17,
    code: pic(
      '  \\draw (0,0) rectangle (6.4,-1.6);\n' +
        '  \\draw (0,-0.8) -- (6.4,-0.8);\n' +
        '  \\draw (1,0) -- (1,-1.6);\n' +
        '  \\node at (0.5,-0.4) {$x$};\n' +
        '  \\node at (0.5,-1.2) {$f\'(x)$};\n' +
        '  \\node at (1.7,-0.4) {$-\\infty$};\n' +
        '  \\node at (3,-0.4) {$-2$};\n' +
        '  \\node at (4.4,-0.4) {$3$};\n' +
        '  \\node at (5.8,-0.4) {$+\\infty$};\n' +
        '  \\node at (2.35,-1.2) {$+$};\n' +
        '  \\node at (3,-1.2) {$0$};\n' +
        '  \\node at (3.7,-1.2) {$-$};\n' +
        '  \\node at (4.4,-1.2) {$0$};\n' +
        '  \\node at (5.1,-1.2) {$+$};',
    ),
  },
  {
    id: 'bbt-tren-doan',
    group: 'bbt',
    sgk: 'L12 - GTLN-GTNN tren doan [a;b], hai dau HUU HAN',
    why: 'Hai đầu là số hữu hạn, KHÔNG phải $\\pm\\infty$. Luật bbt viết "hai đầu là -infty va +infty" nên đây là ca chứng minh luật đó phải nói "trừ khi đề cho đoạn".',
    expectInk: [0.0596, 0.0729],
    minText: 14,
    code: pic(
      '  \\draw (0,0) rectangle (6.4,-2.4);\n' +
        '  \\draw (0,-0.8) -- (6.4,-0.8);\n' +
        '  \\draw (0,-1.6) -- (6.4,-1.6);\n' +
        '  \\draw (1,0) -- (1,-2.4);\n' +
        '  \\node at (0.5,-0.4) {$x$};\n' +
        '  \\node at (0.5,-1.2) {$y\'$};\n' +
        '  \\node at (0.5,-2) {$y$};\n' +
        '  \\node at (1.7,-0.4) {$0$};\n' +
        '  \\node at (3.7,-0.4) {$2$};\n' +
        '  \\node at (5.8,-0.4) {$3$};\n' +
        '  \\node at (2.7,-1.2) {$-$};\n' +
        '  \\node at (3.7,-1.2) {$0$};\n' +
        '  \\node at (4.8,-1.2) {$+$};\n' +
        '  \\node at (1.7,-1.8) {$3$};\n' +
        '  \\node at (3.7,-2.2) {$-1$};\n' +
        '  \\node at (5.8,-1.8) {$1$};\n' +
        '  \\draw[->] (2.05,-1.85) -- (3.05,-2.1);\n' +
        '  \\draw[->] (4.35,-2.13) -- (5.4,-1.88);',
    ),
  },
];

// ─── Hình học phẳng ─────────────────────────────────────────────────────────

const PHANG: CorpusCase[] = [
  {
    id: 'phang-truc-tam',
    group: 'phang',
    sgk: 'L10 - Tam giac va ba duong cao, truc tam',
    why: 'Đo HAI thứ luật hình phẳng khuyên và chưa ai dựng thử: phép chiếu ($(B)!(A)!(C)$) của calc để có chân đường cao ĐÚNG, và name intersections để lấy trực tâm thay vì đoán toạ độ.',
    expectInk: [0.034, 0.0415],
    minText: 4,
    code: pic(
      '  \\coordinate (A) at (0,0);\n' +
        '  \\coordinate (B) at (5,0);\n' +
        '  \\coordinate (C) at (1.6,3.2);\n' +
        '  \\coordinate (Ha) at ($(B)!(A)!(C)$);\n' +
        '  \\coordinate (Hb) at ($(A)!(B)!(C)$);\n' +
        '  \\coordinate (Hc) at ($(A)!(C)!(B)$);\n' +
        '  \\draw[thick] (A) -- (B) -- (C) -- cycle;\n' +
        '  \\draw[thin,name path=da] (A) -- (Ha);\n' +
        '  \\draw[thin,name path=db] (B) -- (Hb);\n' +
        '  \\draw[thin] (C) -- (Hc);\n' +
        '  \\path[name intersections={of=da and db,by=H}];\n' +
        '  \\fill (A) circle (1.5pt) node[below left] {$A$};\n' +
        '  \\fill (B) circle (1.5pt) node[below right] {$B$};\n' +
        '  \\fill (C) circle (1.5pt) node[above] {$C$};\n' +
        '  \\fill (H) circle (1.5pt) node[above left=1pt] {$H$};',
      { libs: 'calc,intersections' },
    ),
  },
  {
    id: 'phang-tam-giac-vuong-duong-cao',
    group: 'phang',
    sgk: 'L9/L10 - He thuc luong trong tam giac vuong, duong cao tu dinh vuong',
    why: 'Dấu góc vuông bằng \\pic{right angle} của thư viện angles — luật SGK bắt "đánh dấu góc vuông ở chân đường cao". Hai dấu vuông trong một hình.',
    expectInk: [0.0292, 0.0356],
    minText: 4,
    code: pic(
      '  \\coordinate (A) at (0,0);\n' +
        '  \\coordinate (B) at (5,0);\n' +
        '  \\coordinate (C) at (0,3);\n' +
        '  \\coordinate (H) at ($(B)!(A)!(C)$);\n' +
        '  \\draw[thick] (A) -- (B) -- (C) -- cycle;\n' +
        '  \\draw[thin] (A) -- (H);\n' +
        '  \\pic[draw,angle radius=9pt] {right angle=B--A--C};\n' +
        '  \\pic[draw,angle radius=7pt] {right angle=A--H--B};\n' +
        '  \\fill (A) circle (1.5pt) node[below left] {$A$};\n' +
        '  \\fill (B) circle (1.5pt) node[below right] {$B$};\n' +
        '  \\fill (C) circle (1.5pt) node[above left] {$C$};\n' +
        '  \\fill (H) circle (1.5pt) node[above right] {$H$};',
      { libs: 'calc,angles' },
    ),
  },
  {
    id: 'phang-trung-diem-trung-tuyen',
    group: 'phang',
    sgk: 'L10 - Trung diem, trung tuyen, trong tam',
    why: 'Đo ($(A)!0.5!(B)$) cho trung điểm và !0.6667! cho trọng tâm. Luật viết rõ "trung điểm: đúng trung điểm" nên không được đặt tay.',
    expectInk: [0.0327, 0.04],
    minText: 6,
    code: pic(
      '  \\coordinate (A) at (0,0);\n' +
        '  \\coordinate (B) at (5,0);\n' +
        '  \\coordinate (C) at (1.4,3.4);\n' +
        '  \\coordinate (M) at ($(B)!0.5!(C)$);\n' +
        '  \\coordinate (N) at ($(A)!0.5!(C)$);\n' +
        '  \\coordinate (G) at ($(A)!0.6667!(M)$);\n' +
        '  \\draw[thick] (A) -- (B) -- (C) -- cycle;\n' +
        '  \\draw[thin] (A) -- (M);\n' +
        '  \\draw[thin] (B) -- (N);\n' +
        '  \\fill (A) circle (1.5pt) node[below left] {$A$};\n' +
        '  \\fill (B) circle (1.5pt) node[below right] {$B$};\n' +
        '  \\fill (C) circle (1.5pt) node[above] {$C$};\n' +
        '  \\fill (M) circle (1.5pt) node[right] {$M$};\n' +
        '  \\fill (N) circle (1.5pt) node[left] {$N$};\n' +
        '  \\fill (G) circle (1.5pt) node[below=2pt] {$G$};',
      { libs: 'calc' },
    ),
  },
  {
    id: 'phang-duong-tron-ngoai-tiep',
    group: 'phang',
    sgk: 'L10 - Duong tron ngoai tiep tam giac',
    why: 'Đo circle through=(A) của thư viện through — luật hình phẳng khuyên đúng lệnh này để "các đỉnh nằm THẬT trên đường tròn". Ba đỉnh đặt bằng toạ độ cực nên tâm là điểm chính xác.',
    expectInk: [0.0431, 0.0526],
    minText: 4,
    code: pic(
      '  \\coordinate (O) at (0,0);\n' +
        '  \\coordinate (A) at (90:2.2);\n' +
        '  \\coordinate (B) at (210:2.2);\n' +
        '  \\coordinate (C) at (330:2.2);\n' +
        '  \\node[draw,thick,circle through=(A)] at (O) {};\n' +
        '  \\draw[thick] (A) -- (B) -- (C) -- cycle;\n' +
        '  \\fill (O) circle (1.5pt) node[below right] {$O$};\n' +
        '  \\fill (A) circle (1.5pt) node[above] {$A$};\n' +
        '  \\fill (B) circle (1.5pt) node[below left] {$B$};\n' +
        '  \\fill (C) circle (1.5pt) node[below right] {$C$};',
      { libs: 'through' },
    ),
  },
  {
    id: 'phang-duong-tron-noi-tiep',
    group: 'phang',
    sgk: 'L10 - Duong tron noi tiep tam giac deu, tiep diem',
    why: 'Bán kính nội tiếp viết bằng {4/(2*sqrt(3))} — đo luôn đường sqrt trần trong toạ độ mà tikzCapabilities khẳng định chạy được. Tiếp điểm phải là trung điểm cạnh.',
    expectInk: [0.0359, 0.0438],
    minText: 5,
    code: pic(
      '  \\coordinate (A) at (0,0);\n' +
        '  \\coordinate (B) at (4,0);\n' +
        '  \\coordinate (C) at (2,3.4641);\n' +
        '  \\coordinate (I) at (2,1.1547);\n' +
        '  \\coordinate (T) at (2,0);\n' +
        '  \\draw[thick] (A) -- (B) -- (C) -- cycle;\n' +
        '  \\draw[thick] (I) circle ({4/(2*sqrt(3))});\n' +
        '  \\draw[thin,dashed] (I) -- (T);\n' +
        '  \\fill (I) circle (1.5pt) node[right] {$I$};\n' +
        '  \\fill (T) circle (1.5pt) node[below] {$T$};\n' +
        '  \\node[below left] at (A) {$A$};\n' +
        '  \\node[below right] at (B) {$B$};\n' +
        '  \\node[above] at (C) {$C$};',
    ),
  },
  {
    id: 'phang-tiep-tuyen-tu-diem-ngoai',
    group: 'phang',
    sgk: 'L10 - Hai tiep tuyen tu mot diem ngoai duong tron',
    why: 'Tiếp tuyến phải VUÔNG GÓC bán kính tại tiếp điểm — luật nói thẳng. Toạ độ tiếp điểm tính sẵn (1; 1,7321) nên quan hệ vuông góc là thật, không phải trông có vẻ đúng.',
    expectInk: [0.0315, 0.0384],
    minText: 4,
    code: pic(
      '  \\coordinate (O) at (0,0);\n' +
        '  \\coordinate (P) at (4,0);\n' +
        '  \\coordinate (T) at (1,1.7321);\n' +
        '  \\coordinate (U) at (1,-1.7321);\n' +
        '  \\draw[thick] (O) circle (2);\n' +
        '  \\draw[thick] (P) -- (T);\n' +
        '  \\draw[thick] (P) -- (U);\n' +
        '  \\draw[thin] (O) -- (T);\n' +
        '  \\draw[thin] (O) -- (U);\n' +
        '  \\pic[draw,angle radius=7pt] {right angle=P--T--O};\n' +
        '  \\fill (O) circle (1.5pt) node[below left] {$O$};\n' +
        '  \\fill (P) circle (1.5pt) node[right] {$P$};\n' +
        '  \\fill (T) circle (1.5pt) node[above right] {$T$};\n' +
        '  \\fill (U) circle (1.5pt) node[below right] {$U$};',
      { libs: 'angles' },
    ),
  },
  {
    id: 'phang-hai-duong-tron-cat-nhau',
    group: 'phang',
    sgk: 'L10 - Vi tri tuong doi hai duong tron, day chung',
    why: 'Hai giao điểm tính sẵn từ hệ thức nên hai đường tròn cắt nhau THẬT. Bắt lỗi model vẽ hai đường tròn chỉ chạm nhau hoặc rời nhau.',
    expectInk: [0.0339, 0.0414],
    minText: 4,
    code: pic(
      '  \\coordinate (O) at (0,0);\n' +
        '  \\coordinate (I) at (3,0);\n' +
        '  \\coordinate (A) at (1.875,1.6537);\n' +
        '  \\coordinate (B) at (1.875,-1.6537);\n' +
        '  \\draw[thick] (O) circle (2.5);\n' +
        '  \\draw[thick] (I) circle (2);\n' +
        '  \\draw[thin] (A) -- (B);\n' +
        '  \\draw[thin,dashed] (O) -- (I);\n' +
        '  \\fill (O) circle (1.5pt) node[below left] {$O$};\n' +
        '  \\fill (I) circle (1.5pt) node[below right] {$I$};\n' +
        '  \\fill (A) circle (1.5pt) node[above] {$A$};\n' +
        '  \\fill (B) circle (1.5pt) node[below] {$B$};',
    ),
  },
  {
    id: 'phang-goc-noi-tiep',
    group: 'phang',
    sgk: 'L9 - Goc noi tiep va goc o tam cung chan mot cung',
    why: 'Đo \\pic kèm nhãn kiểu quotes ["$\\alpha$"] — luật khuyên quotes để ghi số đo góc. Hai cung góc trong một hình, một ở tâm một trên đường tròn.',
    expectInk: [0.0439, 0.0537],
    minText: 7,
    code: pic(
      '  \\coordinate (O) at (0,0);\n' +
        '  \\coordinate (B) at (200:2.4);\n' +
        '  \\coordinate (C) at (340:2.4);\n' +
        '  \\coordinate (A) at (80:2.4);\n' +
        '  \\draw[thick] (O) circle (2.4);\n' +
        '  \\draw[thick] (A) -- (B) -- (C) -- cycle;\n' +
        '  \\draw[thin] (O) -- (B);\n' +
        '  \\draw[thin] (O) -- (C);\n' +
        '  \\pic[draw,angle radius=14pt,"$\\alpha$",font=\\scriptsize] {angle=B--A--C};\n' +
        '  \\pic[draw,angle radius=11pt,"$2\\alpha$",font=\\scriptsize] {angle=C--O--B};\n' +
        '  \\fill (O) circle (1.5pt) node[below=2pt] {$O$};\n' +
        '  \\fill (A) circle (1.5pt) node[above] {$A$};\n' +
        '  \\fill (B) circle (1.5pt) node[left] {$B$};\n' +
        '  \\fill (C) circle (1.5pt) node[right] {$C$};',
      { libs: 'angles,quotes' },
    ),
  },
  {
    id: 'phang-hinh-thang-dau-bang-nhau',
    group: 'phang',
    sgk: 'L8 - Hinh thang can, dau hai canh bang nhau',
    why: 'Đo vạch đánh dấu đoạn bằng nhau bằng decorations.markings + postaction. Luật SGK cho phép "đánh dấu đoạn bằng nhau"; nếu ca này fail thì luật phải bỏ mục đó.',
    expectInk: [0.0259, 0.0317],
    minText: 4,
    code: pic(
      '  \\coordinate (A) at (0,0);\n' +
        '  \\coordinate (B) at (6,0);\n' +
        '  \\coordinate (C) at (4.6,2.6);\n' +
        '  \\coordinate (D) at (1.4,2.6);\n' +
        '  \\draw[thick] (A) -- (B) -- (C) -- (D) -- cycle;\n' +
        '  \\draw[thick,postaction={decorate,decoration={markings,' +
        'mark=at position 0.5 with {\\draw (-2pt,-3pt) -- (2pt,3pt);}}}] (A) -- (D);\n' +
        '  \\draw[thick,postaction={decorate,decoration={markings,' +
        'mark=at position 0.5 with {\\draw (-2pt,-3pt) -- (2pt,3pt);}}}] (B) -- (C);\n' +
        '  \\node[below left] at (A) {$A$};\n' +
        '  \\node[below right] at (B) {$B$};\n' +
        '  \\node[above right] at (C) {$C$};\n' +
        '  \\node[above left] at (D) {$D$};',
      { libs: 'decorations.markings' },
    ),
  },
  {
    id: 'phang-oxy-vecto-khoang-cach',
    group: 'phang',
    sgk: 'L10 - Toa do trong mat phang: vecto, duong thang, khoang cach tu diem den duong thang',
    why: 'Hình học toạ độ có mũi tên vectơ và đoạn khoảng cách vuông góc. Đây là loại hình duy nhất luật cho kẻ lưới nên ca này kẻ lưới mảnh để đo luôn.',
    expectInk: [0.0424, 0.0518],
    minText: 7,
    code: pic(
      '  \\coordinate (A) at (1,3);\n' +
        '  \\coordinate (B) at (3,1);\n' +
        '  \\coordinate (H) at ($(-1,-1)!(A)!(4,4)$);\n' +
        '  \\draw[very thin,gray] (-1,-1) grid (4,4);\n' +
        '  \\draw[->] (-1.4,0) -- (4.4,0) node[below right] {$x$};\n' +
        '  \\draw[->] (0,-1.4) -- (0,4.4) node[left] {$y$};\n' +
        '  \\node[above left=1pt] at (0,0) {$O$};\n' +
        '  \\draw[thick] (-1,-1) -- (4,4) node[above right] {$d$};\n' +
        '  \\draw[thick,->] (A) -- (B);\n' +
        '  \\draw[thin,dashed] (A) -- (H);\n' +
        '  \\fill (A) circle (1.5pt) node[above left] {$A$};\n' +
        '  \\fill (B) circle (1.5pt) node[right] {$B$};\n' +
        // H nằm trên d (hướng NE-SW) và là chân đoạn AH (hướng NW-SE), nên cả bốn hướng chéo đều
        // có nét. Đặt ngang sang phải là góc trống duy nhất.
        '  \\fill (H) circle (1.5pt) node[right=3pt] {$H$};',
      { opts: 'x=0.9cm,y=0.9cm', libs: 'calc' },
    ),
  },
];

// ─── Hình học không gian ────────────────────────────────────────────────────
//
// Khong co thu vien perspective, nen moi ca dat toa do theo phep chieu song song
// (oblique) bang tay, dung nhu CATEGORY_RULES.khonggian day: phuong thang dung giu
// nguyen, canh lui ve sau ve cheo va rut ngan, day chop la HINH BINH HANH.

const KHONGGIAN: CorpusCase[] = [
  {
    id: 'kg-chop-day-vuong-sa-vuong-goc',
    group: 'khonggian',
    sgk: 'L11 - Hinh chop S.ABCD day hinh vuong, SA vuong goc mat phang day',
    why: 'Hình chóp phổ biến nhất của đề THPT. Chốt ba thứ luật nhấn mạnh: đáy vẽ thành hình bình hành, cạnh khuất AD và DC nét đứt, dấu góc vuông ở chân đường cao.',
    expectInk: [0.0363, 0.0444],
    minText: 5,
    code: pic(
      '  \\coordinate (A) at (0,0);\n' +
        '  \\coordinate (B) at (4,0);\n' +
        '  \\coordinate (C) at (5.2,1.6);\n' +
        '  \\coordinate (D) at (1.2,1.6);\n' +
        '  \\coordinate (S) at (0,4.2);\n' +
        '  \\draw[thick] (A) -- (B) -- (C) -- (S) -- cycle;\n' +
        '  \\draw[thick] (S) -- (B);\n' +
        '  \\draw[thick] (S) -- (D);\n' +
        '  \\draw[thick,dashed] (A) -- (D) -- (C);\n' +
        '  \\pic[draw,angle radius=8pt] {right angle=S--A--B};\n' +
        '  \\fill (A) circle (1.5pt) node[below left] {$A$};\n' +
        '  \\fill (B) circle (1.5pt) node[below right] {$B$};\n' +
        '  \\fill (C) circle (1.5pt) node[right] {$C$};\n' +
        '  \\fill (D) circle (1.5pt) node[above left] {$D$};\n' +
        '  \\fill (S) circle (1.5pt) node[above] {$S$};',
      { libs: 'angles' },
    ),
  },
  {
    id: 'kg-tu-dien-duong-cao',
    group: 'khonggian',
    sgk: 'L11 - Tu dien, duong cao SH vuong goc mat phang (ABC)',
    why: 'Chân đường cao H nằm TRONG tam giác đáy, nối bằng nét đứt vì bị mặt đáy che. Luật viết "vẽ đủ đường cao, chân đường vuông góc mà lời giải có nhắc tới".',
    expectInk: [0.0348, 0.0426],
    minText: 5,
    code: pic(
      '  \\coordinate (A) at (0,0);\n' +
        '  \\coordinate (B) at (4.4,0.6);\n' +
        '  \\coordinate (C) at (1.6,1.8);\n' +
        '  \\coordinate (H) at (2,0.8);\n' +
        '  \\coordinate (S) at (2,4.2);\n' +
        '  \\draw[thick] (A) -- (B) -- (C) -- cycle;\n' +
        '  \\draw[thick] (S) -- (A);\n' +
        '  \\draw[thick] (S) -- (B);\n' +
        '  \\draw[thick] (S) -- (C);\n' +
        '  \\draw[thin,dashed] (S) -- (H);\n' +
        '  \\pic[draw,angle radius=7pt] {right angle=S--H--B};\n' +
        '  \\fill (A) circle (1.5pt) node[below left] {$A$};\n' +
        '  \\fill (B) circle (1.5pt) node[right] {$B$};\n' +
        '  \\fill (C) circle (1.5pt) node[above left] {$C$};\n' +
        '  \\fill (H) circle (1.5pt) node[below right] {$H$};\n' +
        '  \\fill (S) circle (1.5pt) node[above] {$S$};',
      { libs: 'angles' },
    ),
  },
  {
    id: 'kg-chop-deu-tam-o',
    group: 'khonggian',
    sgk: 'L11 - Hinh chop tu giac deu, SO vuong goc day, O la giao hai duong cheo',
    why: 'Tâm O phải là GIAO hai đường chéo thật, đặt bằng ($(A)!0.5!(C)$). Hai đường chéo đáy nét đứt vì bị đáy che.',
    expectInk: [0.0373, 0.0456],
    minText: 6,
    code: pic(
      '  \\coordinate (A) at (0,0);\n' +
        '  \\coordinate (B) at (4,0);\n' +
        '  \\coordinate (C) at (5.2,1.6);\n' +
        '  \\coordinate (D) at (1.2,1.6);\n' +
        '  \\coordinate (O) at ($(A)!0.5!(C)$);\n' +
        '  \\coordinate (S) at ($(O)+(0,3.8)$);\n' +
        '  \\draw[thick] (A) -- (B) -- (C) -- (S) -- cycle;\n' +
        '  \\draw[thick] (S) -- (B);\n' +
        '  \\draw[thick] (S) -- (D);\n' +
        '  \\draw[thick,dashed] (A) -- (D) -- (C);\n' +
        '  \\draw[thin,dashed] (A) -- (C);\n' +
        '  \\draw[thin,dashed] (B) -- (D);\n' +
        '  \\draw[thin,dashed] (S) -- (O);\n' +
        '  \\pic[draw,angle radius=7pt] {right angle=S--O--C};\n' +
        '  \\fill (A) circle (1.5pt) node[below left] {$A$};\n' +
        '  \\fill (B) circle (1.5pt) node[below right] {$B$};\n' +
        '  \\fill (C) circle (1.5pt) node[right] {$C$};\n' +
        '  \\fill (D) circle (1.5pt) node[above left=1pt] {$D$};\n' +
        '  \\fill (O) circle (1.5pt) node[below right] {$O$};\n' +
        '  \\fill (S) circle (1.5pt) node[above] {$S$};',
      { libs: 'calc,angles' },
    ),
  },
  {
    id: 'kg-lang-tru-dung',
    group: 'khonggian',
    sgk: 'L11 - Lang tru dung tam giac ABC.A\'B\'C\'',
    why: 'Nhãn có dấu phẩy trên ($A\'$) — dạng nhãn mà mọi bài lăng trụ và hình hộp đều dùng. Cạnh bên phải thẳng đứng thật.',
    expectInk: [0.0373, 0.0456],
    minText: 9,
    code: pic(
      '  \\coordinate (A) at (0,0);\n' +
        '  \\coordinate (B) at (4,0.5);\n' +
        '  \\coordinate (C) at (1.5,1.6);\n' +
        '  \\coordinate (Ap) at (0,3.6);\n' +
        '  \\coordinate (Bp) at (4,4.1);\n' +
        '  \\coordinate (Cp) at (1.5,5.2);\n' +
        '  \\draw[thick] (A) -- (B) -- (Bp) -- (Ap) -- cycle;\n' +
        '  \\draw[thick] (Ap) -- (Cp) -- (Bp);\n' +
        '  \\draw[thick] (A) -- (C);\n' +
        '  \\draw[thick] (C) -- (Cp);\n' +
        '  \\draw[thick,dashed] (C) -- (B);\n' +
        '  \\fill (A) circle (1.5pt) node[below left] {$A$};\n' +
        '  \\fill (B) circle (1.5pt) node[below right] {$B$};\n' +
        '  \\fill (C) circle (1.5pt) node[left] {$C$};\n' +
        '  \\fill (Ap) circle (1.5pt) node[above left] {$A\'$};\n' +
        '  \\fill (Bp) circle (1.5pt) node[right] {$B\'$};\n' +
        '  \\fill (Cp) circle (1.5pt) node[above] {$C\'$};',
    ),
  },
  {
    id: 'kg-hinh-hop',
    group: 'khonggian',
    sgk: 'L11 - Hinh hop ABCD.A\'B\'C\'D\'',
    why: 'Ba cạnh khuất gặp nhau ở đỉnh sau D. Đây là ca bắt lỗi "vẽ tất cả thành nét liền" mà luật gọi là lỗi hay gặp nhất.',
    expectInk: [0.0392, 0.0479],
    minText: 12,
    code: pic(
      '  \\coordinate (A) at (0,0);\n' +
        '  \\coordinate (B) at (4,0);\n' +
        '  \\coordinate (C) at (5.2,1.5);\n' +
        '  \\coordinate (D) at (1.2,1.5);\n' +
        '  \\coordinate (Ap) at (0,3);\n' +
        '  \\coordinate (Bp) at (4,3);\n' +
        '  \\coordinate (Cp) at (5.2,4.5);\n' +
        '  \\coordinate (Dp) at (1.2,4.5);\n' +
        '  \\draw[thick] (A) -- (B) -- (C) -- (Cp) -- (Dp) -- (Ap) -- cycle;\n' +
        '  \\draw[thick] (Ap) -- (Bp) -- (Cp);\n' +
        '  \\draw[thick] (B) -- (Bp);\n' +
        '  \\draw[thick,dashed] (A) -- (D) -- (C);\n' +
        '  \\draw[thick,dashed] (D) -- (Dp);\n' +
        '  \\fill (A) circle (1.4pt) node[below left] {$A$};\n' +
        '  \\fill (B) circle (1.4pt) node[below right] {$B$};\n' +
        '  \\fill (C) circle (1.4pt) node[right] {$C$};\n' +
        '  \\fill (D) circle (1.4pt) node[left] {$D$};\n' +
        '  \\fill (Ap) circle (1.4pt) node[left] {$A\'$};\n' +
        '  \\fill (Bp) circle (1.4pt) node[right] {$B\'$};\n' +
        '  \\fill (Cp) circle (1.4pt) node[right] {$C\'$};\n' +
        '  \\fill (Dp) circle (1.4pt) node[above left] {$D\'$};',
    ),
  },
  {
    id: 'kg-lap-phuong-duong-cheo',
    group: 'khonggian',
    sgk: 'L11/L12 - Hinh lap phuong va duong cheo AC\'',
    why: 'Đường chéo trong khối: phần đi qua bên trong là nét đứt. Luật viết "đoạn chỉ bị che MỘT PHẦN thì phải CHIA ĐOẠN" — ca này đo đúng chỗ đó.',
    expectInk: [0.0425, 0.0519],
    minText: 9,
    code: pic(
      '  \\coordinate (A) at (0,0);\n' +
        '  \\coordinate (B) at (3.2,0);\n' +
        '  \\coordinate (C) at (4.4,1.2);\n' +
        '  \\coordinate (D) at (1.2,1.2);\n' +
        '  \\coordinate (Ap) at (0,3.2);\n' +
        '  \\coordinate (Bp) at (3.2,3.2);\n' +
        '  \\coordinate (Cp) at (4.4,4.4);\n' +
        '  \\coordinate (Dp) at (1.2,4.4);\n' +
        '  \\draw[thick] (A) -- (B) -- (C) -- (Cp) -- (Dp) -- (Ap) -- cycle;\n' +
        '  \\draw[thick] (Ap) -- (Bp) -- (Cp);\n' +
        '  \\draw[thick] (B) -- (Bp);\n' +
        '  \\draw[thick,dashed] (A) -- (D) -- (C);\n' +
        '  \\draw[thick,dashed] (D) -- (Dp);\n' +
        '  \\draw[thin,dashed] (A) -- (Cp);\n' +
        '  \\fill (A) circle (1.4pt) node[below left] {$A$};\n' +
        '  \\fill (B) circle (1.4pt) node[below right] {$B$};\n' +
        '  \\fill (C) circle (1.4pt) node[right] {$C$};\n' +
        '  \\fill (Cp) circle (1.4pt) node[right] {$C\'$};\n' +
        '  \\fill (Ap) circle (1.4pt) node[left] {$A\'$};\n' +
        '  \\fill (Dp) circle (1.4pt) node[above left] {$D\'$};',
    ),
  },
  {
    id: 'kg-goc-duong-thang-va-mat-phang',
    group: 'khonggian',
    sgk: 'L11 - Goc giua duong thang SC va mat phang (ABCD)',
    why: 'Hình chiếu AC + cung góc tại C. Dạng câu "tính góc giữa SC và mặt đáy" xuất hiện gần như mỗi đề, và lời giải phải ĐỌC được góc từ hình.',
    expectInk: [0.0407, 0.0498],
    minText: 6,
    code: pic(
      '  \\coordinate (A) at (0,0);\n' +
        '  \\coordinate (B) at (4,0);\n' +
        '  \\coordinate (C) at (5.2,1.6);\n' +
        '  \\coordinate (D) at (1.2,1.6);\n' +
        '  \\coordinate (S) at (0,4);\n' +
        '  \\draw[thick] (A) -- (B) -- (C) -- (S) -- cycle;\n' +
        '  \\draw[thick] (S) -- (B);\n' +
        '  \\draw[thick] (S) -- (D);\n' +
        '  \\draw[thick,dashed] (A) -- (D) -- (C);\n' +
        '  \\draw[thin,dashed] (A) -- (C);\n' +
        '  \\pic[draw,angle radius=8pt] {right angle=S--A--C};\n' +
        '  \\pic[draw,angle radius=22pt,angle eccentricity=1.5,"$\\varphi$",font=\\scriptsize]' +
        ' {angle=S--C--A};\n' +
        '  \\fill (A) circle (1.5pt) node[below left] {$A$};\n' +
        '  \\fill (B) circle (1.5pt) node[below right] {$B$};\n' +
        '  \\fill (C) circle (1.5pt) node[right] {$C$};\n' +
        '  \\fill (D) circle (1.5pt) node[above left] {$D$};\n' +
        '  \\fill (S) circle (1.5pt) node[above] {$S$};',
      { libs: 'angles,quotes' },
    ),
  },
  {
    id: 'kg-goc-hai-mat-phang',
    group: 'khonggian',
    sgk: 'L11 - Goc giua hai mat phang, giao tuyen va hai duong vuong goc giao tuyen',
    why: 'Hai mặt phẳng vẽ thành hai miền hình bình hành KHÔNG tô nền (luật cấm tô), giao tuyến là cạnh chung, góc đo ở chân hai đường vuông góc giao tuyến.',
    expectInk: [0.0366, 0.0447],
    minText: 6,
    code: pic(
      '  \\coordinate (M) at (0,0);\n' +
        '  \\coordinate (N) at (5,0);\n' +
        '  \\coordinate (P) at (6.4,1.5);\n' +
        '  \\coordinate (Q) at (1.4,1.5);\n' +
        '  \\coordinate (E) at (1.6,2.9);\n' +
        '  \\coordinate (F) at (6.6,2.9);\n' +
        '  \\coordinate (I) at (2.5,0);\n' +
        '  \\coordinate (J) at (3.9,1.5);\n' +
        '  \\coordinate (K) at (4.1,2.9);\n' +
        '  \\draw[thick] (M) -- (N) -- (P) -- (Q) -- cycle;\n' +
        '  \\draw[thick] (Q) -- (E) -- (F) -- (P);\n' +
        '  \\draw[thin] (J) -- (I);\n' +
        '  \\draw[thin] (J) -- (K);\n' +
        '  \\pic[draw,angle radius=13pt,angle eccentricity=1.6,"$\\varphi$",font=\\scriptsize]' +
        ' {angle=I--J--K};\n' +
        '  \\fill (I) circle (1.4pt) node[below] {$I$};\n' +
        '  \\fill (J) circle (1.4pt) node[below right=1pt] {$J$};\n' +
        '  \\fill (K) circle (1.4pt) node[above] {$K$};\n' +
        '  \\node[below left] at (M) {$M$};\n' +
        '  \\node[below right] at (N) {$N$};',
      { libs: 'angles,quotes' },
    ),
  },
  {
    id: 'kg-khoang-cach-diem-den-mat-phang',
    group: 'khonggian',
    sgk: 'L11 - Khoang cach tu mot diem den mot mat phang',
    why: 'Đoạn vuông góc AK từ A tới mặt phẳng (SBC), có dấu góc vuông ở K. Dạng câu tính khoảng cách của đề THPT, và lời giải không đọc được nếu thiếu K.',
    expectInk: [0.0397, 0.0485],
    minText: 6,
    code: pic(
      '  \\coordinate (A) at (0,0);\n' +
        '  \\coordinate (B) at (4,0);\n' +
        '  \\coordinate (C) at (5.2,1.6);\n' +
        '  \\coordinate (D) at (1.2,1.6);\n' +
        '  \\coordinate (S) at (0,4);\n' +
        '  \\coordinate (K) at (2.32,1.16);\n' +
        '  \\draw[thick] (A) -- (B) -- (C) -- (S) -- cycle;\n' +
        '  \\draw[thick] (S) -- (B);\n' +
        '  \\draw[thick] (S) -- (D);\n' +
        '  \\draw[thick,dashed] (A) -- (D) -- (C);\n' +
        '  \\draw[thin,dashed] (A) -- (K);\n' +
        '  \\pic[draw,angle radius=6pt] {right angle=A--K--S};\n' +
        '  \\fill (A) circle (1.5pt) node[below left] {$A$};\n' +
        '  \\fill (B) circle (1.5pt) node[below right] {$B$};\n' +
        '  \\fill (C) circle (1.5pt) node[right] {$C$};\n' +
        '  \\fill (D) circle (1.5pt) node[above left] {$D$};\n' +
        '  \\fill (S) circle (1.5pt) node[above] {$S$};\n' +
        '  \\fill (K) circle (1.4pt) node[below right] {$K$};',
      { libs: 'angles' },
    ),
  },
  {
    id: 'kg-hai-duong-cheo-nhau',
    group: 'khonggian',
    sgk: 'L11 - Hai duong thang cheo nhau (khong dong phang)',
    why: 'LỖI KINH ĐIỂN mà THINK_FIRST_RULES gọi tên: hai đường chéo nhau bị vẽ thành cắt nhau. Ca này chứng minh cách vẽ đúng — chỗ giao nhau trên giấy thì một đường liền, đường kia đứt.',
    expectInk: [0.0549, 0.0671],
    minText: 7,
    code: pic(
      '  \\coordinate (A) at (0,0);\n' +
        '  \\coordinate (B) at (4,0);\n' +
        '  \\coordinate (C) at (5.2,1.5);\n' +
        '  \\coordinate (D) at (1.2,1.5);\n' +
        '  \\coordinate (Ap) at (0,3);\n' +
        '  \\coordinate (Bp) at (4,3);\n' +
        '  \\coordinate (Cp) at (5.2,4.5);\n' +
        '  \\coordinate (Dp) at (1.2,4.5);\n' +
        '  \\draw[thick] (A) -- (B) -- (C) -- (Cp) -- (Dp) -- (Ap) -- cycle;\n' +
        '  \\draw[thick] (Ap) -- (Bp) -- (Cp);\n' +
        '  \\draw[thick] (B) -- (Bp);\n' +
        '  \\draw[thick,dashed] (A) -- (D) -- (C);\n' +
        '  \\draw[thick,dashed] (D) -- (Dp);\n' +
        '  \\draw[very thick] (A) -- (Bp);\n' +
        '  \\draw[very thick,dashed] (B) -- (Dp);\n' +
        '  \\fill (A) circle (1.4pt) node[below left] {$A$};\n' +
        '  \\fill (B) circle (1.4pt) node[below right] {$B$};\n' +
        '  \\fill (Bp) circle (1.4pt) node[right] {$B\'$};\n' +
        '  \\fill (Dp) circle (1.4pt) node[above left] {$D\'$};\n' +
        '  \\fill (D) circle (1.4pt) node[left] {$D$};',
    ),
  },
  {
    id: 'kg-thiet-dien',
    group: 'khonggian',
    sgk: 'L11 - Thiet dien cua hinh chop cat boi mot mat phang',
    why: 'Đa giác thiết diện vẽ bằng nét dày hơn, các đỉnh là điểm trên cạnh đặt bằng calc nên nằm ĐÚNG trên cạnh. Bắt lỗi đỉnh thiết diện nổi ra ngoài cạnh.',
    expectInk: [0.0492, 0.0601],
    minText: 7,
    code: pic(
      '  \\coordinate (A) at (0,0);\n' +
        '  \\coordinate (B) at (4,0);\n' +
        '  \\coordinate (C) at (5.2,1.6);\n' +
        '  \\coordinate (D) at (1.2,1.6);\n' +
        '  \\coordinate (S) at (2.6,4.4);\n' +
        '  \\coordinate (M) at ($(S)!0.45!(A)$);\n' +
        '  \\coordinate (N) at ($(S)!0.45!(B)$);\n' +
        '  \\coordinate (P) at ($(S)!0.45!(C)$);\n' +
        '  \\coordinate (Q) at ($(S)!0.45!(D)$);\n' +
        '  \\draw[thick] (A) -- (B) -- (C) -- cycle;\n' +
        '  \\draw[thick] (S) -- (A);\n' +
        '  \\draw[thick] (S) -- (B);\n' +
        '  \\draw[thick] (S) -- (C);\n' +
        '  \\draw[thick] (S) -- (D);\n' +
        '  \\draw[thick,dashed] (A) -- (D) -- (C);\n' +
        '  \\draw[very thick] (M) -- (N) -- (P);\n' +
        '  \\draw[very thick,dashed] (P) -- (Q) -- (M);\n' +
        '  \\fill (M) circle (1.4pt) node[left] {$M$};\n' +
        '  \\fill (N) circle (1.4pt) node[right] {$N$};\n' +
        '  \\fill (P) circle (1.4pt) node[right] {$P$};\n' +
        '  \\fill (Q) circle (1.4pt) node[above left] {$Q$};\n' +
        '  \\node[above] at (S) {$S$};\n' +
        '  \\node[below left] at (A) {$A$};\n' +
        '  \\node[below right] at (B) {$B$};',
      { libs: 'calc' },
    ),
  },
  {
    id: 'kg-hinh-tru',
    group: 'khonggian',
    sgk: 'L12 - Hinh tru: hai duong tron day va duong sinh',
    why: 'Khối tròn xoay dựng bằng ellipse + arc: nửa sau của đường tròn đáy là nét đứt. Nếu ca này fail thì mọi bài hình trụ lớp 12 phải giữ ảnh cắt.',
    expectInk: [0.051, 0.0623],
    minText: 4,
    code: pic(
      '  \\coordinate (O) at (0,0);\n' +
        '  \\coordinate (I) at (0,3.6);\n' +
        '  \\draw[thick] (I) ellipse (1.8 and 0.6);\n' +
        '  \\draw[thick] (-1.8,0) arc (180:360:1.8 and 0.6);\n' +
        '  \\draw[thick,dashed] (-1.8,0) arc (180:0:1.8 and 0.6);\n' +
        '  \\draw[thick] (-1.8,0) -- (-1.8,3.6);\n' +
        '  \\draw[thick] (1.8,0) -- (1.8,3.6);\n' +
        '  \\draw[thin,dashed] (O) -- (I);\n' +
        '  \\fill (O) circle (1.4pt) node[below] {$O$};\n' +
        '  \\fill (I) circle (1.4pt) node[above] {$O\'$};\n' +
        '  \\draw[thin,dashed] (O) -- (1.8,0) node[midway,below] {$R$};',
    ),
  },
  {
    id: 'kg-hinh-non',
    group: 'khonggian',
    sgk: 'L12 - Hinh non: duong sinh, duong cao, ban kinh day',
    why: 'Đường cao SO nét đứt vì nằm trong khối, dấu góc vuông tại O, hai đường sinh tiếp xúc mép ellipse. Bộ ba l, h, R mà mọi bài hình nón đều dùng.',
    expectInk: [0.0343, 0.0419],
    minText: 4,
    code: pic(
      '  \\coordinate (O) at (0,0);\n' +
        '  \\coordinate (S) at (0,3.8);\n' +
        '  \\coordinate (M) at (1.8,0);\n' +
        '  \\draw[thick] (-1.8,0) arc (180:360:1.8 and 0.6);\n' +
        '  \\draw[thick,dashed] (-1.8,0) arc (180:0:1.8 and 0.6);\n' +
        '  \\draw[thick] (-1.8,0) -- (S) -- (1.8,0);\n' +
        '  \\draw[thin,dashed] (S) -- (O);\n' +
        '  \\draw[thin,dashed] (O) -- (M);\n' +
        '  \\pic[draw,angle radius=6pt] {right angle=S--O--M};\n' +
        '  \\fill (S) circle (1.4pt) node[above] {$S$};\n' +
        '  \\fill (O) circle (1.4pt) node[below left] {$O$};\n' +
        '  \\fill (M) circle (1.4pt) node[right] {$M$};\n' +
        '  \\node[right=3pt] at (1.15,1.9) {$l$};',
      { libs: 'angles' },
    ),
  },
  {
    id: 'kg-mat-cau',
    group: 'khonggian',
    sgk: 'L12 - Mat cau: duong tron lon va duong xich dao',
    why: 'Mặt cầu là đường tròn cộng một ellipse xích đạo — nửa sau nét đứt. Quy ước này là thứ duy nhất làm hình phẳng đọc ra khối cầu.',
    expectInk: [0.0412, 0.0504],
    minText: 3,
    code: pic(
      '  \\coordinate (O) at (0,0);\n' +
        '  \\coordinate (M) at (2.2,0);\n' +
        '  \\draw[thick] (O) circle (2.2);\n' +
        '  \\draw[thick] (-2.2,0) arc (180:360:2.2 and 0.7);\n' +
        '  \\draw[thick,dashed] (-2.2,0) arc (180:0:2.2 and 0.7);\n' +
        '  \\draw[thin,dashed] (O) -- (M) node[midway,above] {$R$};\n' +
        '  \\fill (O) circle (1.4pt) node[below left] {$O$};\n' +
        '  \\fill (M) circle (1.4pt) node[right] {$M$};',
    ),
  },
  {
    id: 'kg-oxyz',
    group: 'khonggian',
    sgk: 'L12 - He truc toa do Oxyz, diem va hinh chieu',
    why: 'Ba trục theo phép chiếu tay (không có thư viện perspective), điểm M cùng hình chiếu nét đứt xuống mặt Oxy. Dạng hình duy nhất của chương toạ độ không gian.',
    expectInk: [0.0121, 0.0148],
    minText: 6,
    code: pic(
      '  \\coordinate (O) at (0,0);\n' +
        '  \\coordinate (M) at (2.6,2.4);\n' +
        '  \\coordinate (H) at (2.6,0.9);\n' +
        '  \\draw[->] (0,0) -- (-1.8,-1.4) node[below left] {$x$};\n' +
        '  \\draw[->] (0,0) -- (4.2,0) node[right] {$y$};\n' +
        '  \\draw[->] (0,0) -- (0,3.6) node[above] {$z$};\n' +
        '  \\draw[thin,dashed] (M) -- (H);\n' +
        '  \\draw[thin,dashed] (H) -- (2.6,0);\n' +
        '  \\draw[thin,dashed] (O) -- (H);\n' +
        '  \\fill (O) circle (1.4pt) node[above left=1pt] {$O$};\n' +
        '  \\fill (M) circle (1.4pt) node[above right] {$M$};\n' +
        '  \\fill (H) circle (1.4pt) node[right] {$H$};',
    ),
  },
];

export const CORPUS: CorpusCase[] = [...DOTHI, ...BBT, ...PHANG, ...KHONGGIAN];

/** Bốn họ, đúng thứ tự hiển thị trên trang báo cáo. */
export const CORPUS_GROUPS = ['dothi', 'bbt', 'phang', 'khonggian'] as const;
