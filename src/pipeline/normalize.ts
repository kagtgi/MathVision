/**
 * Chuẩn hoá MMD cho MathType Toggle TeX.
 *
 * Port nguyên văn tools/mmd_normalize.js + tools/fix_escapes.js (fixText).
 * Mọi regex, thứ tự rule và tập loại trừ giữ từng ký tự — đây là chỗ đã từng sai
 * (BUGS.md C3: đổi nhầm `\{1,2\}`, `[7,8)`, `4, 4\sqrt{5}, 20`).
 */

import { segmentLine, segmentLineDollarOnly } from './mmdSegment.ts';

const collapseSpaces = (s: string): string => s.replace(/\s+/g, ' ').trim();

// ---- transforms bên trong một run $...$ (không gồm delimiter) -------------
export function fixInsideMath(m: string): string {
  let s = m;
  s = s.replace(/\}\s*\{\s*\}\s*\^/g, '}^'); // u_{1}{ }^{n} -> u_{1}^{n}
  // 3,14 -> 3{,}14 — CHỈ khi run không phải ngữ cảnh tập hợp/khoảng/liệt kê:
  //   \{...\} (tập hợp), \in (thuộc khoảng [7,8)), ", " (liệt kê "4, 4\sqrt{5}, 20")
  if (!/\\\{|\\in\b|,\s/.test(s)) {
    s = s.replace(/(\d),(\d)/g, '$1{,}$2');
  }
  s = s.replace(/\{\s*\}\s*\^\s*\\circ(?![a-zA-Z])/g, '{ }^{\\circ}'); // {}^\circ -> { }^{\circ}
  s = s.replace(/\^\s*\\circ(?![a-zA-Z{])/g, '^{\\circ}'); // ^\circ  -> ^{\circ}
  return s;
}

// ---- transforms cho nguyên một run $...$ (gồm delimiter) ------------------
export function fixWholeMathRun(run: string): string {
  const inner = run.replace(/^\$\$?|\$\$?$/g, '');

  // 1) run chỉ toàn \_ (chỗ trống điền tay) -> text gạch dưới, không tạo equation rác
  if (/^(\s|\\_)+$/.test(inner)) {
    return inner.replace(/\s/g, '').replace(/\\_/g, '_');
  }

  // 2) run là artifact chỉ-số-trên: ${ }^{X}$ hoặc ${ }^{X} \mathrm{~Y}$ (X không chứa lệnh)
  const sup = inner.match(
    /^\s*\{\s*\}\s*\^\s*\{([^{}\\]*)\}\s*(?:\\mathrm\s*\{(~?[^{}\\]*)\})?\s*$/,
  );
  if (sup) {
    const a = collapseSpaces(sup[1])
      .replace(/\s*\/\s*/g, '/')
      .replace(/(?<=[a-zA-Z]) (?=[a-zA-Z])/g, '');
    const b = sup[2] ? collapseSpaces(sup[2].replace(/~/g, ' ')) : '';
    return (a + (b ? (/\d$/.test(a) && /^[A-Za-z]/.test(b) ? b : ' ' + b) : '')).trim();
  }

  const fixed = fixInsideMath(inner);
  return '$' + fixed + '$';
}

// ---- xử lý khối $$...$$ nhiều dòng ---------------------------------------
export function handleDisplayBlocks(text: string): string {
  return text.replace(/\$\$\s*\n?([\s\S]*?)\n?\s*\$\$/g, (_whole, body: string) => {
    const hasCmd = /\\(?!begin|end|hline|\\|_|~|;|,| )[a-zA-Z]+/.test(
      body.replace(/\\begin\{[a-z]*\}(\{[^}]*\})?/g, '').replace(/\\end\{[a-z]*\}/g, ''),
    );

    // aligned/array chứa thuần DATA (số liệu) -> bỏ math
    const env = body.match(/\\begin\{(aligned|array)\}(\{[^}]*\})?([\s\S]*?)\\end\{\1\}/);
    if (env && !hasCmd) {
      const rows = env[3]
        .split(/\\\\/)
        .map((r) => r.trim())
        .filter(Boolean);
      if (env[1] === 'array') {
        // -> bảng markdown
        const cells = rows.map((r) =>
          r.split('&').map((c) => collapseSpaces(c.replace(/[~.]+\s*$/, (m) => m.replace(/~/g, '')))),
        );
        const w = Math.max(...cells.map((r) => r.length));
        const md: string[] = [];
        md.push('| ' + cells[0].join(' | ') + ' |');
        md.push('|' + Array(w).fill(' :---: ').join('|') + '|');
        for (let i = 1; i < cells.length; i++) md.push('| ' + cells[i].join(' | ') + ' |');
        return '\n' + md.join('\n') + '\n';
      }
      // aligned -> các dòng text thuần
      const lines = rows.map((r) => collapseSpaces(r.replace(/^&/, '').replace(/~/g, ' ')));
      return '\n' + lines.join('\n') + '\n';
    }

    // khối công thức thật -> gộp về $...$ một dòng
    const one = collapseSpaces(body);
    return '\n$' + fixInsideMath(one) + '$\n';
  });
}

// ---- vá lỗi chính tả OCR (chỉ ngoài math, danh sách đã kiểm chứng) --------
const TYPO_FIXES: Array<[RegExp, string]> = [
  [/GIỪA/g, 'GIỮA'],
  [/TỤ LUẬN/g, 'TỰ LUẬN'],
  [/Không kê thời gian giao đê/g, 'Không kể thời gian giao đề'],
];

export function fixOutsideMath(t: string, wrapNumbers = true): string {
  let s = t;
  s = s.replace(/!\[[^\]]*\]\(https?:[^)]*\)/g, ''); // chỉ bỏ ảnh remote (ảnh cục bộ giữ lại)
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/?[a-zA-Z][^>]*>/g, '');
  for (const [re, to] of TYPO_FIXES) s = s.replace(re, to);

  if (!wrapNumbers) return s;

  // Theo file mẫu: khoảng [a; b) và số thập phân trần trong văn bản/ô bảng cũng
  // phải là công thức -> bọc $...$ để MathType chuyển.
  const dec = (x: string) => x.replace(/(\d),(\d)/g, '$1{,}$2');
  s = s.replace(
    /([[(])\s*(-?\d+(?:,\d+)?)\s*;\s*(-?\d+(?:,\d+)?)\s*([\])])/g,
    (_all, o: string, a: string, b: string, cl: string) => `$${o}${dec(a)}; ${dec(b)}${cl}$`,
  );
  s = s.replace(/(?<![\w$,.°])(\d+),(\d+)(?!\d)/g, '$$$1{,}$2$$');
  // nhiệt độ 26°C -> $26^{\circ}C$
  s = s.replace(/(?<![\w$])(\d+(?:\{,\}\d+)?)\s*°\s*C\b/g, '$$$1^{\\circ}C$$');
  return s;
}

/** Pipeline chuẩn hoá cho toàn file (mmd_normalize.js:137-154). */
export function normalizeMmd(mmd: string): string {
  let text = mmd.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  text = handleDisplayBlocks(text);

  const outLines: string[] = [];
  for (const rawLine of text.split('\n')) {
    // Dòng "Đáp số: v" do bước tái cấu trúc sinh ra SAU normalize (giá trị lấy nguyên
    // từ bảng đáp án), nên trong file mẫu nó là text thuần. Không bọc số ở đây, nếu
    // không chạy lại pipeline trên file đã hoàn chỉnh sẽ đổi "52,6" thành "$52{,}6$".
    const wrapNumbers = !/^\s*\*{0,2}Đáp số\s*:/.test(rawLine);
    let rebuilt = '';
    for (const seg of segmentLineDollarOnly(rawLine)) {
      rebuilt += seg.math ? fixWholeMathRun(seg.text) : fixOutsideMath(seg.text, wrapNumbers);
    }
    // <br> tạo ra \n giữa dòng
    for (const piece of rebuilt.split('\n')) outLines.push(piece.replace(/[ \t]+$/g, ''));
  }

  let out = outLines.join('\n');
  out = out.replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '');
  return out + '\n';
}

// ---- fix_escapes.js -------------------------------------------------------
/**
 * Sửa escape LaTeX nằm NGOÀI math. Thứ tự rule quan trọng: tập hợp số `\{4\}` phải
 * thành `$\{4\}$` TRƯỚC, vì bỏ backslash rồi bọc `$` sẽ khiến LaTeX coi `{4}` là
 * nhóm và mất luôn dấu ngoặc.
 */
export function fixEscapeText(t: string): string {
  let s = t;
  s = s.replace(/\\\{([\d\s,;]+)\\\}/g, (_all, inner: string) => `$\\{${inner.trim()}\\}$`);
  s = s.replace(/\\\{/g, '{').replace(/\\\}/g, '}');
  s = s.replace(/\\%/g, '%').replace(/\\&/g, '&').replace(/\\#/g, '#');
  return s;
}

export function fixEscapes(mmd: string): string {
  return mmd
    .split('\n')
    .map((line) => {
      let rebuilt = '';
      for (const seg of segmentLine(line)) {
        rebuilt += seg.math ? seg.text : fixEscapeText(seg.text);
      }
      return rebuilt;
    })
    .join('\n');
}
