/**
 * Lọc mã TikZ do model sinh, TRƯỚC khi đưa cho TikZJax dựng.
 *
 * Vì sao cần: renderer không báo lỗi. Hàm mở file của nó hardcode `erstat: 0` nên file thiếu
 * mở thành công như file RỖNG; một `\usepackage{pgfplots}` hay một chữ "Số" làm TeX tắt hẳn,
 * không có SVG, và bên gọi chỉ thấy `null` sau trọn 30 giây. Không log, không phân biệt được
 * "sai cú pháp" với "thiếu package" với "treo".
 *
 * Bốn thứ đo được là CHẾT HẲN (xem `tikzCapabilities.ts`):
 *   1. byte ngoài ASCII ở bất kỳ đâu — kể cả trong comment `%` và trong `$\text{}$`
 *   2. `\usepackage{…}` bất kỳ
 *   3. `\usetikzlibrary` ngoài allowlist
 *   4. `\documentclass` + `\begin{document}` do model tự thêm
 *
 * Trong đó (1) là nguy hiểm nhất và cũng dễ xảy ra nhất: prompt của app viết bằng tiếng Việt
 * nên model rất hay chú thích tiếng Việt ngay trong mã.
 */

// Đuôi `.ts` bắt buộc: `scripts/verify-tikz-sanitize.mjs` import file này bằng ESM của Node,
// mà Node không tự dò đuôi như Vite.
import { TIKZ_LIB_ALLOWLIST, TIKZ_LIB_KNOWN_MISSING } from './tikzCapabilities.ts';

const ALLOWED = new Set<string>(TIKZ_LIB_ALLOWLIST);
const KNOWN_MISSING = new Set<string>(TIKZ_LIB_KNOWN_MISSING);

/** `đ`/`Đ` không phân rã được bằng NFD nên phải map tay. */
const EXTRA_MAP: Record<string, string> = { đ: 'd', Đ: 'D', '₫': 'd', '°': ' do', '–': '-', '—': '-', '“': '"', '”': '"', '‘': "'", '’': "'", '…': '...', '×': 'x', '≈': '~', '≤': '<=', '≥': '>=' };

/**
 * Bỏ dấu về ASCII. Dùng NFD rồi xoá dấu tổ hợp — phủ hết a/ă/â/e/ê/i/o/ô/ơ/u/ư/y kèm 5
 * thanh. Chuyển dấu sang macro LaTeX (`\'{\^o}`) thì đẹp hơn nhưng KHÔNG đủ: `ơ`, `ư` và
 * dấu hỏi không ghép được trong OT1 (đo ở ca `vn-horn-impossible`), nên bỏ dấu là đường duy
 * nhất chắc chắn giữ được hình.
 */
export function stripDiacritics(s: string): string {
  let out = '';
  for (const ch of s) {
    out += EXTRA_MAP[ch] ?? ch;
  }
  return out.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export interface SanitizeResult {
  code: string;
  /** Đã bỏ/đổi gì — đưa vào nhật ký xử lý để người dùng thấy, đừng im lặng. */
  notes: string[];
  /** `false` = không nên dựng, mã hỏng cấu trúc. */
  usable: boolean;
}

export function sanitizeTikz(input: string): SanitizeResult {
  const notes: string[] = [];
  let code = input;

  // Gỡ khối ```…``` nếu model bọc mã trong markdown.
  code = code.replace(/^\s*```(?:tex|latex|tikz)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');

  // 1. Preamble do model tự thêm — TikZJax chỉ tự bọc \begin{document} khi mã CHƯA có.
  if (/\\documentclass/.test(code)) {
    code = code.replace(/^[\s\S]*?\\begin\{document\}/, '');
    notes.push('bỏ phần \\documentclass/preamble — bộ dựng tự lo phần đó');
  }
  code = code.replace(/\\end\{document\}[\s\S]*$/, '');

  const usepkg = [...code.matchAll(/\\usepackage(?:\[[^\]]*\])?\{([^}]*)\}/g)].map((m) => m[1]);
  if (usepkg.length) {
    code = code.replace(/^[^\S\n]*\\usepackage(?:\[[^\]]*\])?\{[^}]*\}[^\S\n]*\n?/gm, '');
    notes.push(`bỏ \\usepackage{${usepkg.join(', ')}} — bộ dựng nạp sẵn, khai thêm là mất hình`);
  }

  // 2. Thư viện ngoài allowlist.
  code = code.replace(/\\usetikzlibrary\{([^}]*)\}/g, (_m, list: string) => {
    const names = list.split(',').map((n) => n.trim()).filter(Boolean);
    const keep = names.filter((n) => ALLOWED.has(n));
    const drop = names.filter((n) => !ALLOWED.has(n));
    for (const d of drop) {
      notes.push(
        KNOWN_MISSING.has(d)
          ? `bỏ thư viện "${d}" — bộ dựng không có, để lại là treo 30 giây rồi mất hình`
          : `bỏ thư viện "${d}" — không có trong danh sách đã kiểm`,
      );
    }
    return keep.length ? `\\usetikzlibrary{${keep.join(',')}}` : '';
  });

  // 3. Byte ngoài ASCII — thứ giết hình chắc chắn nhất, và ở BẤT KỲ đâu kể cả comment.
  if (/[^\x00-\x7F]/.test(code)) {
    const before = code;
    code = stripDiacritics(code);
    const left = code.match(/[^\x00-\x7F]/g);
    if (left) {
      // Ký tự không quy được về ASCII (ký hiệu toán Unicode, chữ Hán…) — xoá hẳn, thà mất
      // một nhãn còn hơn mất cả hình.
      code = code.replace(/[^\x00-\x7F]/g, '');
      notes.push(`xoá ${left.length} ký tự không quy được về ASCII: ${[...new Set(left)].join(' ')}`);
    }
    if (before !== code) notes.push('bỏ dấu tiếng Việt trong mã hình — bộ dựng không đọc được chữ có dấu');
  }

  // 4. Cấu trúc phải cân.
  const open = (code.match(/\\begin\{tikzpicture\}/g) ?? []).length;
  const close = (code.match(/\\end\{tikzpicture\}/g) ?? []).length;
  let usable = true;
  if (open === 0) {
    notes.push('không tìm thấy \\begin{tikzpicture}');
    usable = false;
  } else if (open !== close) {
    notes.push(`\\begin{tikzpicture} (${open}) không khớp \\end{tikzpicture} (${close})`);
    usable = false;
  }

  return { code: code.trim(), notes, usable };
}
