/**
 * Kiểm BỘ HÌNH corpus như kiểm dữ liệu — thuần, không mạng, không browser, dưới một giây.
 *
 * Việc dựng thật 47 hình là `scripts/verify-tikz-render.mjs` (chạy tay, ~5 phút, cần Electron).
 * Harness này là cửa rẻ đứng trước nó, và bắt được đúng lớp lỗi mà bản 1.0/1.1 đã mắc: prompt
 * KHUYÊN hoặc CẤM một cấu trúc bằng niềm tin. Nhóm 6 dưới đây chốt hai chiều — luật nào khuyên
 * một cấu trúc thì bộ hình phải có ca chứng minh cấu trúc đó, và ngược lại nếu luật đổi câu chữ
 * thì harness báo để soát lại ca.
 *
 * Bốn nhóm đầu kiểm chính bộ hình phải là mã SẠCH MẪU MỰC: ca nào bị sanitizer sửa là ca viết
 * sai, không phải sanitizer sai — vì bộ này là thứ ta đem đi đo renderer, nó phải là hằng số.
 *
 * Usage: node scripts/verify-tikz-corpus.mjs
 */

import { sanitizeTikz } from '../src/utils/tikzSanitize.ts';
import { TIKZ_LIB_ALLOWLIST } from '../src/utils/tikzCapabilities.ts';
import { figureRulesFor } from '../src/utils/figurePrompts.ts';
import { CORPUS, CORPUS_GROUPS } from '../src/devtools/tikzCorpus/cases.ts';

const GREEN = (s) => `\x1b[32m${s}\x1b[0m`;
const RED = (s) => `\x1b[31m${s}\x1b[0m`;
const DIM = (s) => `\x1b[2m${s}\x1b[0m`;

/** Mỗi họ phải phủ đủ dày mới nói được điều gì về họ đó. */
const MIN_PER_GROUP = 8;

const ALLOWED = new Set(TIKZ_LIB_ALLOWLIST);

// ─── Trợ giúp ────────────────────────────────────────────────────────────────

/**
 * Tên điểm đã được KHAI. Chỉ nhận `\coordinate (X)`, `\node (X)`, `\path (X)` và `by=X`
 * của name intersections — đúng bốn cách bộ hình đang dùng.
 */
function declaredNames(code) {
  const out = new Set();
  for (const re of [
    /\\coordinate\s*(?:\[[^\]]*\])?\s*\(([A-Za-z][\w']*)\)/g,
    /\\node\s*(?:\[[^\]]*\])?\s*\(([A-Za-z][\w']*)\)/g,
    /\\path\s*(?:\[[^\]]*\])?\s*\(([A-Za-z][\w']*)\)/g,
  ]) {
    for (const m of code.matchAll(re)) out.add(m[1]);
  }
  for (const m of code.matchAll(/by\s*=\s*\{?([^}\],]+)/g)) {
    for (const n of m[1].split(',')) {
      const t = n.trim();
      if (/^[A-Za-z][\w']*$/.test(t)) out.add(t);
    }
  }
  return out;
}

/**
 * Tên điểm được DÙNG mà chưa khai, theo đúng thứ tự xuất hiện.
 *
 * Chỉ soi token viết hoa chữ đầu (`A`, `Bp`, `S`, `Ha`) nên bỏ qua sạch toạ độ số `(0,0)`,
 * toạ độ cực `(30:2)`, `(\x,0)`, `cycle`, và `(1.8 and 0.6)`. Hẹp có chủ ý: đủ bắt lỗi cú
 * pháp số một mà `verifyPrompt` nhắc (dùng \coordinate trước khi khai) và không báo oan.
 */
function usedBeforeDeclared(code) {
  const bad = [];
  const declared = new Set();
  for (const line of code.split('\n')) {
    for (const m of line.matchAll(/\(([A-Z][\w']*)\)/g)) {
      if (!declared.has(m[1]) && !declaredNames(line).has(m[1])) bad.push(m[1]);
    }
    for (const n of declaredNames(line)) declared.add(n);
  }
  return [...new Set(bad)];
}

const libsIn = (code) =>
  [...code.matchAll(/\\usetikzlibrary\{([^}]*)\}/g)]
    .flatMap((m) => m[1].split(','))
    .map((s) => s.trim())
    .filter(Boolean);

const idsWhere = (pred) => CORPUS.filter(pred).map((c) => c.id);

// ─── Chống lệch giữa luật vẽ và bộ hình ─────────────────────────────────────
//
// `inRules` tim trong `figureRulesFor(group)`, `inCode` tim trong ma cua HO do.
// Lech mot trong hai chieu la mot phat hien that:
//   - `inRules` khong khop  -> luat da doi cau chu, phai doc lai xem con khuyen thu do khong
//   - `inCode` khong khop   -> luat khuyen mot thu ma bo hinh chua chung minh dung duoc

const DRIFT = [
  {
    group: 'dothi',
    what: 'plot[domain,samples,smooth] cho đường cong',
    inRules: /domain=a:b,samples=100,smooth/,
    inCode: /domain=-?[\d.]+:-?[\d.]+,samples=\d+,smooth/,
  },
  {
    group: 'dothi',
    what: 'hàm lượng giác đơn vị radian {cos(\\x r)}',
    inRules: /\{cos\(\\x r\)\}/,
    inCode: /\{(?:sin|cos|tan)\(\\x r\)\}/,
  },
  {
    group: 'dothi',
    what: 'plot coordinates khi biểu thức phức tạp',
    inRules: /plot coordinates/,
    inCode: /plot coordinates/,
  },
  {
    group: 'dothi',
    what: '\\foreach cho mốc trục',
    inRules: /\\foreach cho các mốc trục/,
    inCode: /\\foreach \\x\/\\t in/,
  },
  {
    group: 'dothi',
    what: 'đặt tỉ lệ hai trục bằng x=...cm, y=...cm',
    inRules: /x=\.\.\.cm, y=\.\.\.cm/,
    inCode: /x=[\d.]+cm,y=[\d.]+cm/,
  },
  {
    group: 'dothi',
    what: 'tiệm cận nét đứt',
    inRules: /Tiệm cận vẽ nét đứt/,
    inCode: /dashed/,
  },
  {
    group: 'bbt',
    what: 'kẻ khung bằng \\draw ... rectangle',
    inRules: /rectangle/,
    inCode: /rectangle/,
  },
  {
    group: 'bbt',
    what: 'mũi tên biến thiên \\draw[->] đi chéo',
    inRules: /\\draw\[->\] đi CHÉO/,
    inCode: /\\draw\[->\]/,
  },
  {
    group: 'bbt',
    what: 'gạch dọc $\\|$ tại tiệm cận đứng',
    inRules: /\\\|/,
    inCode: /\\\|/,
  },
  {
    group: 'bbt',
    what: "ba hàng x / f'(x) / f(x)",
    inRules: /hàng 2: \$f'\(x\)\$/,
    inCode: /f'\(x\)|\$y'\$/,
  },
  {
    group: 'phang',
    what: 'calc để chia đoạn ($(A)!0.5!(B)$)',
    inRules: /\$\(A\)!0\.5!\(B\)\$/,
    inCode: /!0\.5!/,
  },
  {
    group: 'phang',
    what: 'intersections để lấy giao điểm',
    inRules: /intersections để lấy giao điểm/,
    inCode: /name intersections/,
  },
  {
    group: 'phang',
    what: 'through để dựng đường tròn qua điểm',
    inRules: /through\s*\n?để dựng đường tròn qua điểm|through để dựng đường tròn qua điểm/,
    inCode: /circle through=/,
  },
  {
    group: 'phang',
    what: 'dấu góc vuông',
    inRules: /Chỉ đánh dấu góc vuông/,
    inCode: /right angle=/,
  },
  {
    group: 'khonggian',
    what: 'cạnh bị che vẽ nét đứt',
    inRules: /cạnh BỊ CHE vẽ nét đứt \(dashed\)/,
    inCode: /dashed/,
  },
  {
    group: 'khonggian',
    what: 'đánh dấu góc vuông ở chân đường cao',
    inRules: /Đánh dấu góc vuông ở chân đường cao/,
    inCode: /right angle=/,
  },
  // Luật chống đè nhãn phải nói KỸ THUẬT, không nói suông. Bản trước chỉ có câu "không đè lên
  // nét" và bộ hình vẫn có 13/47 hình bị đè — đo được bằng `countLabelOverlaps`.
  {
    group: 'phang',
    what: 'nhãn ghi kèm khoảng cách (above=2pt) chứ không viết trống',
    inRules: /Luôn ghi kèm khoảng cách/,
    inCode: /node\[[^\]]*=\d+pt\]/,
  },
  {
    group: 'bbt',
    what: 'mũi tên dừng trước nhãn, chừa khoảng hở',
    inRules: /Mũi tên .* phải DỪNG TRƯỚC nhãn/,
    inCode: /\\draw\[->\]/,
  },
];

/** Thứ luật CẤM thì tuyệt đối không được có trong bộ hình. */
const FORBIDDEN = [
  { what: 'pgfplots', re: /pgfplots|\\begin\{axis\}|\\addplot/ },
  { what: 'thư viện perspective', re: /perspective/ },
  { what: 'decoration brace/snake/coil', re: /brace|snake|coil|zigzag/ },
  { what: '\\usepackage', re: /\\usepackage/ },
  { what: '\\documentclass hoặc \\begin{document}', re: /\\documentclass|\\begin\{document\}/ },
];

// ─── Bộ ca kiểm ──────────────────────────────────────────────────────────────

const cases = [
  // ── Bộ hình phải là mã sạch mẫu mực ──────────────────────────────────────
  {
    name: 'sanitizeTikz không phải sửa một byte nào, và mọi ca đều usable',
    run: () =>
      idsWhere((c) => {
        const r = sanitizeTikz(c.code);
        return r.code !== c.code || !r.usable || r.notes.length > 0;
      }),
    expect: [],
  },
  {
    name: 'toàn bộ mã là ASCII (một byte ngoài ASCII là mất hình)',
    run: () => idsWhere((c) => /[^\x00-\x7F]/.test(c.code)),
    expect: [],
  },
  {
    name: '\\usetikzlibrary chỉ dùng tên trong allowlist đã đo',
    run: () => idsWhere((c) => libsIn(c.code).some((l) => !ALLOWED.has(l))),
    expect: [],
  },
  {
    name: 'không dùng thứ tikzCapabilities đã đo là CHẾT HẲN',
    run: () =>
      FORBIDDEN.flatMap((f) =>
        idsWhere((c) => f.re.test(c.code)).map((id) => `${id}: ${f.what}`),
      ),
    expect: [],
  },
  {
    name: '\\begin{tikzpicture} khớp \\end{tikzpicture}',
    run: () =>
      idsWhere((c) => {
        const open = (c.code.match(/\\begin\{tikzpicture\}/g) ?? []).length;
        const close = (c.code.match(/\\end\{tikzpicture\}/g) ?? []).length;
        return open !== 1 || close !== 1;
      }),
    expect: [],
  },
  {
    name: 'mọi tên điểm đều \\coordinate khai TRƯỚC khi dùng',
    run: () =>
      CORPUS.flatMap((c) => {
        const bad = usedBeforeDeclared(c.code);
        return bad.length ? [`${c.id}: ${bad.join(',')}`] : [];
      }),
    expect: [],
  },
  {
    name: 'mở đầu đúng khuôn SGK_STYLE_RULES (line cap/join, >=Stealth)',
    run: () =>
      idsWhere(
        (c) => !/\\begin\{tikzpicture\}\[line cap=round,line join=round,>=Stealth/.test(c.code),
      ),
    expect: [],
  },

  // ── Siêu dữ liệu của bộ hình ─────────────────────────────────────────────
  {
    name: `mỗi họ có ít nhất ${MIN_PER_GROUP} ca`,
    run: () =>
      CORPUS_GROUPS.filter((g) => CORPUS.filter((c) => c.group === g).length < MIN_PER_GROUP),
    expect: [],
  },
  {
    name: 'id không trùng nhau',
    run: () => {
      const seen = new Set();
      return CORPUS.filter((c) => (seen.has(c.id) ? true : (seen.add(c.id), false))).map(
        (c) => c.id,
      );
    },
    expect: [],
  },
  {
    name: 'group hợp lệ và sgk không rỗng',
    run: () => idsWhere((c) => !CORPUS_GROUPS.includes(c.group) || !c.sgk.trim()),
    expect: [],
  },
  {
    name: 'expectInk là dải RATIO hợp lệ và sàn không thấp hơn MIN_INK_RATIO',
    run: () =>
      idsWhere((c) => {
        const [lo, hi] = c.expectInk;
        return !(lo >= 0.002 && lo < hi && hi <= 1);
      }),
    expect: [],
  },
  {
    name: 'minText >= 3 (hình đề thi nào cũng có nhãn)',
    run: () => idsWhere((c) => !Number.isInteger(c.minText) || c.minText < 3),
    expect: [],
  },

  // ── Chống lệch giữa luật vẽ và bộ hình ───────────────────────────────────
  {
    name: 'mọi cấu trúc mà luật vẽ KHUYÊN đều có ca chứng minh',
    run: () =>
      DRIFT.flatMap((d) => {
        const out = [];
        if (!d.inRules.test(figureRulesFor(d.group))) {
          out.push(`${d.group}/${d.what}: luật đã đổi câu chữ, soát lại ca`);
        }
        const codes = CORPUS.filter((c) => c.group === d.group).map((c) => c.code);
        if (!codes.some((code) => d.inCode.test(code))) {
          out.push(`${d.group}/${d.what}: chưa có ca nào dùng`);
        }
        return out;
      }),
    expect: [],
  },
];

// ─── Chạy ────────────────────────────────────────────────────────────────────

console.log('=== Bộ hình TikZ theo chương trình THPT ===');
console.log(
  DIM(
    `  ${CORPUS.length} ca: ` +
      CORPUS_GROUPS.map((g) => `${g} ${CORPUS.filter((c) => c.group === g).length}`).join(' · '),
  ),
);

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
