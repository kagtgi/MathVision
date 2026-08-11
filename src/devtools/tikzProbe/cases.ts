/**
 * Ca đo năng lực renderer TikZJax.
 *
 * VÌ SAO CẦN: prompt hiện tại cấm `\foreach`, `\draw plot`, `\pgfmathsetmacro`, `\tikzset`
 * bằng NIỀM TIN, không bằng số đo — trong khi dump `core.bin` có sẵn `pgffor`, `pgfmath`,
 * `plothandlers`, và 6 file .tex cũ của người dùng dùng chúng thoải mái. Ngược lại có những
 * thứ THẬT SỰ không có (`pgfplots`, `perspective`, `decorations.pathreplacing`) và cách
 * chúng chết là im lặng hết 30 s rồi rơi hình.
 *
 * Ca nào PASS ở đây thì mới được cho vào prompt. Kết quả chốt vào
 * `src/utils/tikzCapabilities.ts` để prompt sinh từ đó, không bao giờ lệch nữa.
 *
 * Mỗi ca hỏi ĐÚNG MỘT câu — gộp hai tính năng vào một ca thì fail không biết tại cái nào.
 */

export interface ProbeCase {
  id: string;
  /** Cho phép biết được gì nếu ca này pass/fail. */
  why: string;
  code: string;
  /** `hang` = kỳ vọng KHÔNG dựng được; dùng để chứng minh cần sanitizer. */
  expect?: 'ok' | 'hang';
  /** Bỏ qua bước tiền xử lý PGF math — để đo RENDERER, không đo hàm tiền xử lý. */
  raw?: boolean;
  /** Nhóm để chạy riêng: `/probe-tikz.html?only=chu-viet`. */
  group?: string;
}

const pic = (body: string) => `\\begin{tikzpicture}\n${body}\n\\end{tikzpicture}`;

export const CASES: ProbeCase[] = [
  // ── Mốc so sánh: phải pass, nếu fail thì cả bộ probe vô nghĩa ──────────────
  {
    id: 'baseline-line',
    why: 'Mốc so sánh tối thiểu. Fail = probe hỏng, không phải renderer thiếu.',
    code: pic('\\draw (0,0) -- (2,1) -- (2,0) -- cycle;'),
  },
  {
    id: 'baseline-node-math',
    why: 'Nhãn toán trong $...$ — dùng ở mọi hình.',
    code: pic('\\draw (0,0) -- (2,0);\n  \\node[below] at (1,0) {$A_1$};'),
  },

  // ── Vòng lặp: mở đường cho mốc trục và bảng biến thiên ─────────────────────
  {
    id: 'foreach-range',
    why: '\\foreach dạng {1,...,5}. Cần cho mốc trục và kẻ ô bảng biến thiên.',
    code: pic('\\foreach \\x in {1,...,5} { \\draw (\\x,0) -- (\\x,0.2); }'),
  },
  {
    id: 'foreach-pairs',
    why: '\\foreach \\x/\\t — đúng dạng 11CSU_cau11.tex dùng cho nhãn mốc trục.',
    code: pic(
      '\\foreach \\x/\\t in {0/{0}, 1.5708/{\\dfrac{\\pi}{2}}, 3.1416/{\\pi}} {\n' +
        '    \\draw (\\x,-0.05) -- (\\x,0.05);\n' +
        '    \\node[below,font=\\scriptsize] at (\\x,-0.08) {$\\t$};\n  }',
    ),
  },

  // ── Vẽ hàm: quyết định cách làm đồ thị hàm số ──────────────────────────────
  {
    id: 'plot-coordinates',
    why: 'Đường an toàn nhất cho đồ thị: model tự tính sẵn toạ độ. plothandlers có trong dump.',
    code: pic(
      '\\draw[thick] plot coordinates {(-2,4) (-1,1) (0,0) (1,1) (2,4)};',
    ),
  },
  {
    id: 'plot-domain-samples',
    why: 'Đường TỐT NHẤT cho đồ thị nếu chạy: \\draw plot[domain,samples,smooth]. Prompt đang CẤM.',
    raw: true,
    code: pic('\\draw[thick,domain=-2:2,samples=60,smooth] plot (\\x,{\\x*\\x});'),
  },
  {
    id: 'plot-trig-rad',
    why: 'cos(\\x r) — 11CSU_cau11.tex dùng để vẽ y=cos x. Cần cho đồ thị lượng giác.',
    raw: true,
    code: pic('\\draw[thick,domain=-3.2:3.2,smooth,samples=80] plot (\\x,{cos(\\x r)});'),
  },

  // ── PGF math: nếu chạy thì thu hẹp được hàm tiền xử lý ─────────────────────
  {
    id: 'pgfmath-parse',
    why: '\\pgfmathparse. Prompt đang cấm; dump có pgfmath.',
    raw: true,
    code: pic('\\pgfmathparse{sqrt(3)}\n  \\draw (0,0) -- (2,\\pgfmathresult);'),
  },
  {
    id: 'pgfmath-setmacro',
    why: '\\pgfmathsetmacro. Prompt đang cấm.',
    raw: true,
    code: pic('\\pgfmathsetmacro{\\h}{sqrt(3)}\n  \\draw (0,0) -- (2,\\h);'),
  },
  {
    id: 'raw-sqrt-coord',
    why: 'CA THEN CHỐT: {sqrt(3)} trần trong toạ độ. Cả hàm tiền xử lý tồn tại là vì ca này.',
    raw: true,
    code: pic('\\coordinate (C) at (3,{sqrt(3)});\n  \\draw (0,0) -- (C);'),
  },
  {
    id: 'raw-trig-coord',
    why: '{2*cos(60)} trần trong toạ độ — dạng prompt nêu làm ví dụ BAD.',
    raw: true,
    code: pic('\\draw (0,0) -- ({2*cos(60)},{2*sin(60)});'),
  },
  {
    id: 'calc-interp-math',
    why: '($(A)!{sqrt(2)/2}!(B)$) — pass 2 của hàm tiền xử lý nhắm vào ca này.',
    raw: true,
    code: pic(
      '\\coordinate (A) at (0,0);\n  \\coordinate (B) at (4,0);\n' +
        '  \\coordinate (M) at ($(A)!{sqrt(2)/2}!(B)$);\n  \\fill (M) circle (2pt);',
    ),
  },

  // ── Toạ độ cực + arc ──────────────────────────────────────────────────────
  {
    id: 'polar-literal',
    why: 'Toạ độ cực (30:2) — rẻ hơn tự tính sin/cos nếu chạy.',
    raw: true,
    code: pic('\\draw (0,0) -- (30:2);'),
  },
  {
    id: 'polar-macro',
    why: '\\def rồi dùng trong toạ độ cực — 11CSU_cau6.tex dùng cho đường tròn lượng giác.',
    raw: true,
    code: pic('\\def\\a{210}\n  \\draw (0,0) circle (1);\n  \\draw (0,0) -- (\\a:1);'),
  },
  {
    id: 'arc-macro',
    why: 'arc (270:\\a:0.42) — cung đánh dấu góc.',
    raw: true,
    code: pic('\\def\\a{210}\n  \\draw (0.42,0) arc (0:\\a:0.42);'),
  },

  // ── Thư viện: xác nhận từng cái CÓ THẬT chứ không chỉ có cờ loaded ─────────
  {
    id: 'lib-calc',
    why: 'calc — chia đoạn, trung điểm. Xương sống của hình học.',
    code: pic(
      '\\usetikzlibrary{calc}\n  \\coordinate (A) at (0,0);\n  \\coordinate (B) at (4,2);\n' +
        '  \\coordinate (M) at ($(A)!0.5!(B)$);\n  \\draw (A) -- (B);\n  \\fill (M) circle (2pt);',
    ),
  },
  {
    id: 'lib-angles-quotes',
    why: '\\pic{angle} và {right angle} — đánh dấu góc, góc vuông.',
    code: pic(
      '\\usetikzlibrary{angles,quotes}\n' +
        '  \\coordinate (A) at (0,0);\n  \\coordinate (B) at (3,0);\n  \\coordinate (C) at (0,2);\n' +
        '  \\draw (A) -- (B) -- (C) -- cycle;\n' +
        '  \\pic[draw,angle radius=8pt] {right angle = B--A--C};\n' +
        '  \\pic[draw,angle radius=14pt,"$\\alpha$"] {angle = A--B--C};',
    ),
  },
  {
    id: 'lib-intersections',
    why: 'name path + name intersections — giao tuyến, chân đường cao. Rất cần cho hình không gian.',
    code: pic(
      '\\usetikzlibrary{intersections}\n' +
        '  \\path[name path=l1] (0,0) -- (4,3);\n  \\path[name path=l2] (0,3) -- (4,0);\n' +
        '  \\draw (0,0) -- (4,3);\n  \\draw (0,3) -- (4,0);\n' +
        '  \\path[name intersections={of=l1 and l2, by=X}];\n  \\fill (X) circle (2pt);',
    ),
  },
  {
    id: 'lib-through',
    why: 'through — đường tròn qua một điểm (ngoại tiếp, nội tiếp).',
    code: pic(
      '\\usetikzlibrary{through}\n  \\coordinate (O) at (0,0);\n  \\coordinate (P) at (2,0);\n' +
        '  \\node[draw,circle through=(P)] at (O) {};',
    ),
  },
  {
    id: 'lib-3d',
    why: 'canvas is xy plane at z= — vẽ mặt phẳng trong hình không gian.',
    code: pic(
      '\\usetikzlibrary{3d}\n  \\begin{scope}[canvas is xy plane at z=0]\n' +
        '    \\draw (0,0) rectangle (3,2);\n  \\end{scope}',
    ),
  },
  {
    id: 'lib-matrix',
    why: 'matrix — một cách dựng bảng biến thiên (không có array/tabular).',
    code: pic(
      '\\usetikzlibrary{matrix}\n' +
        '  \\matrix[matrix of nodes,draw] { $x$ & $0$ & $2$ \\\\ $f\'(x)$ & $+$ & $-$ \\\\ };',
    ),
  },
  {
    id: 'lib-patterns',
    why: 'patterns — tô mặt phẳng bị cắt.',
    code: pic(
      '\\usetikzlibrary{patterns}\n  \\fill[pattern=north east lines] (0,0) rectangle (2,1);',
    ),
  },
  {
    id: 'lib-decorations-markings',
    why: 'decorations.markings — vạch đánh dấu đoạn bằng nhau.',
    code: pic(
      '\\usetikzlibrary{decorations.markings}\n' +
        '  \\draw[decoration={markings, mark=at position 0.5 with {\\draw (0,-2pt) -- (0,2pt);}},' +
        'postaction={decorate}] (0,0) -- (3,0);',
    ),
  },
  {
    id: 'lib-positioning',
    why: 'positioning — đặt nhãn tương đối, tránh đè nét.',
    code: pic(
      '\\usetikzlibrary{positioning}\n  \\node (a) {A};\n  \\node[right=1cm of a] (b) {B};\n' +
        '  \\draw (a) -- (b);',
    ),
  },

  // ── Bảng biến thiên: thử dựng tay bằng draw + node ─────────────────────────
  {
    id: 'bbt-handmade',
    why: 'Bảng biến thiên dựng tay: kẻ khung + node + mũi tên chéo. Loại này KHÔNG có prior art.',
    code: pic(
      '\\draw (0,0) rectangle (6,-2.4);\n' +
        '  \\draw (0,-0.8) -- (6,-0.8);\n  \\draw (0,-1.6) -- (6,-1.6);\n' +
        '  \\draw (1,0) -- (1,-2.4);\n' +
        '  \\node at (0.5,-0.4) {$x$};\n  \\node at (0.5,-1.2) {$y\'$};\n' +
        '  \\node at (0.5,-2) {$y$};\n' +
        '  \\node at (2,-0.4) {$-\\infty$};\n  \\node at (4,-0.4) {$0$};\n' +
        '  \\node at (5.6,-0.4) {$+\\infty$};\n' +
        '  \\node at (3,-1.2) {$+$};\n  \\node at (5,-1.2) {$-$};\n' +
        '  \\draw[->] (2,-2.2) -- (3.9,-1.8);\n  \\draw[->] (4.1,-1.8) -- (5.6,-2.2);',
    ),
  },

  // ── Chữ tiếng Việt: dump KHÔNG có T5 fontenc ──────────────────────────────
  //
  // Đo được: `Số nhân viên` thô làm CHẾT HẲN hình (không ra SVG, hết timeout), chứ không
  // phải chỉ sai glyph. Nhóm dưới đây tìm cách cứu nhãn thay vì bỏ luôn.
  {
    id: 'vietnamese-label',
    group: 'chu-viet',
    why: 'CA THEN CHỐT: dấu tiếng Việt thô. ĐO ĐƯỢC: chết hẳn, mất cả hình sau 30 s.',
    expect: 'hang',
    code: pic('\\draw[->] (0,0) -- (4,0) node[right] {Số nhân viên};'),
  },
  {
    id: 'vietnamese-mixed',
    group: 'chu-viet',
    why: 'Chữ Việt lẫn math, dấu viết kiểu LaTeX `\\`o`. ĐO ĐƯỢC: chạy.',
    code: pic('\\draw[->] (0,0) -- (4,0) node[right] {$x$ (gi\\`o)};'),
  },
  {
    id: 'vn-ascii-stripped',
    group: 'chu-viet',
    why: 'Đường cứu ĐƠN GIẢN NHẤT: bỏ dấu về ASCII. Nếu chạy thì sanitizer làm được máy móc.',
    code: pic('\\draw[->] (0,0) -- (4,0) node[right] {So nhan vien};'),
  },
  {
    id: 'vn-accent-nested',
    group: 'chu-viet',
    why: 'Dấu lồng cho `ố` = \\`\\^o. Chạy thì chuyển được a-ă-â-e-ê-i-o-ô-y + 5 thanh.',
    code: pic("\\draw (0,0) node[right] {s\\'{\\^o} \\`{\\^e} c\\~{a}};"),
  },
  {
    id: 'vn-accent-dotbelow',
    group: 'chu-viet',
    why: 'Thanh nặng `\\d{u}` — OT1 có \\d nên nghi là chạy.',
    code: pic('\\draw (0,0) node[right] {h\\d{o}c t\\d{a}p};'),
  },
  {
    id: 'vn-horn-impossible',
    group: 'chu-viet',
    why: 'CHỐT GIỚI HẠN: `ơ`/`ư` cần dấu móc, OT1 KHÔNG có. Fail = phải bỏ dấu về ASCII.',
    expect: 'hang',
    code: pic('\\draw (0,0) node[right] {\\ohorn \\uhorn};'),
  },
  {
    id: 'vn-in-comment',
    group: 'chu-viet',
    why: 'Chữ Việt trong COMMENT có giết hình không? Quyết định phạm vi sanitizer.',
    code: pic('% Đường cao hạ từ đỉnh\n  \\draw (0,0) -- (2,2);'),
  },
  {
    id: 'vn-in-math-text',
    group: 'chu-viet',
    why: '$\\text{Số}$ — amsmath có \\text; thử xem math mode có cứu được không.',
    expect: 'hang',
    code: pic('\\draw (0,0) node[right] {$\\text{Số}$};'),
  },

  // ── Chống hồi quy: phải KHÔNG dựng được, chứng minh cần sanitizer ──────────
  {
    id: 'hang-pgfplots',
    why: 'Phải FAIL. Chứng minh \\usepackage{pgfplots} treo im lặng -> bắt buộc có sanitizer.',
    expect: 'hang',
    code: '\\usepackage{pgfplots}\n\\begin{axis}\n\\end{axis}',
  },
  {
    id: 'hang-lib-missing',
    why: 'Phải FAIL. decorations.pathreplacing không có -> decoration={brace} không chạy.',
    expect: 'hang',
    code: pic(
      '\\usetikzlibrary{decorations.pathreplacing}\n' +
        '  \\draw[decorate,decoration={brace}] (0,0) -- (3,0);',
    ),
  },
  {
    id: 'hang-documentclass',
    why: 'Phải FAIL. Model xuất cả preamble sẽ chặn cơ chế tự bọc \\begin{document} của TikZJax.',
    expect: 'hang',
    code:
      '\\documentclass[border=5pt]{standalone}\n\\usepackage{tikz}\n' +
      '\\begin{document}\n' + pic('\\draw (0,0) -- (2,2);') + '\n\\end{document}',
  },
];
