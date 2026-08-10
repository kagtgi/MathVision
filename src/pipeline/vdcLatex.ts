/**
 * Quy ước LaTeX riêng của nhóm VDC.
 *
 * Nguồn: skill "vn-exam-extractor" mà người dùng cung cấp. Khác chuẩn K11 ở bốn chỗ, và
 * cả bốn đều là phép biến đổi tất định nên làm bằng code chứ không nhờ model:
 *
 *   5a. Ký tự ngay trước dấu phẩy trên phải bọc `{}`   `A'`      -> `{A}'`
 *   5b. Run chỉ gồm chữ cái, từ 2 chữ trở lên: bọc chữ đầu   `Oxyz`  -> `{O}xyz`
 *   5c. Tích phân dùng `\int\limits`, bọc integrand   `\int_a^b f(x)dx` -> `\int\limits_a^b{{f(x)}dx}`
 *   6.  Mọi ngoặc trong math dùng `\left`/`\right`     `(a+b)`  -> `\left( a+b \right)`
 *
 * Thêm một luật của skill đi ngược chuẩn K11: **số trần đứng một mình KHÔNG bọc `$...$`**
 * ("180 điểm", "xác suất 0,7" để nguyên). K11 thì bắt buộc bọc, nên việc này chỉ chạy ở
 * định dạng VDC.
 *
 * Mọi hàm phải IDEMPOTENT: người dùng sửa tay rồi dựng lại file là chuyện thường, chạy
 * hai lần không được ra `\left\left(`.
 */

import { segmentLine } from './mmdSegment.ts';

/** `A'` -> `{A}'`. Bỏ qua khi đã bọc sẵn. */
function bracePrimes(math: string): string {
  // Ký tự đứng trước ' có thể là chữ, số, hoặc `}` (đã bọc rồi thì thôi).
  return math.replace(/(?<![}])([A-Za-z0-9])'/g, '{$1}’'.replace('’', "'"));
}

/** Run chỉ gồm chữ cái và dài ≥2: bọc chữ đầu. `Oxyz` -> `{O}xyz`, `ABCD` -> `{A}BCD`. */
function braceFirstLetter(math: string): string {
  return /^[A-Za-z]{2,}$/.test(math) ? `{${math[0]}}${math.slice(1)}` : math;
}

/**
 * `\int` -> `\int\limits` và bọc integrand: `{{<integrand>}dx}`.
 *
 * Chỉ xử lý khi tìm được vi phân `dx`/`dt`/... trong cùng run. Không thấy thì để nguyên,
 * vì đoán sai chỗ kết thúc integrand còn tệ hơn không đổi.
 */
function fixIntegrals(math: string): string {
  if (!math.includes('\\int')) return math;
  let s = math.replace(/\\int(?!\\limits)/g, '\\int\\limits');

  // \int\limits<giới hạn> <integrand> d<biến>  ->  \int\limits<giới hạn>{{<integrand>}d<biến>}
  s = s.replace(
    /(\\int\\limits(?:\s*[_^]\s*(?:\{[^{}]*\}|\\?[A-Za-z0-9+\-]))*)\s*([\s\S]*?)\s*\\?\bd([a-zA-Z])\b/g,
    (whole, head: string, integrand: string, variable: string) => {
      const body = integrand.trim();
      // Đã bọc rồi (dạng `{{...}dx}`) thì giữ nguyên.
      if (!body || body.startsWith('{{')) return whole;
      return `${head}{{${body}}d${variable}}`;
    },
  );
  return s;
}

/**
 * Ngoặc trần -> `\left`/`\right`.
 *
 * Chỉ đụng ngoặc TRÒN, VUÔNG và ngoặc nhọn ĐÃ escape (`\{`). Ngoặc nhọn trần trong LaTeX
 * là ký hiệu gom nhóm (`\frac{a}{b}`, `x^{2}`) — biến chúng thành `\left\{` là phá công
 * thức, đây là chỗ dễ sai nhất của luật này.
 */
function leftRightBrackets(math: string): string {
  let s = math;
  s = s.replace(/(?<!\\left)(?<!\\bigl?)(?<!\\Bigl?)\(/g, '\\left(');
  s = s.replace(/(?<!\\right)(?<!\\bigr?)(?<!\\Bigr?)\)/g, '\\right)');
  s = s.replace(/(?<!\\left)(?<!\\bigl?)(?<!\\Bigl?)\[/g, '\\left[');
  s = s.replace(/(?<!\\right)(?<!\\bigr?)(?<!\\Bigr?)\]/g, '\\right]');
  s = s.replace(/(?<!\\left)\\\{/g, '\\left\\{');
  s = s.replace(/(?<!\\right)\\\}/g, '\\right\\}');
  // \left[ ... \right. của hệ/tuyển vẫn hợp lệ, không đụng tới dấu chấm.
  return s;
}

/** Chỉ có số (kèm dấu phẩy thập phân) thì không cần là công thức. */
function isBareNumber(math: string): boolean {
  return /^-?\d+(?:\{,\}\d+|,\d+)?$/.test(math.trim());
}

/** Một run math của VDC. Trả `null` nghĩa là nên hạ xuống text thường. */
export function vdcMathRun(inner: string): string | null {
  const trimmed = inner.trim();
  if (!trimmed) return null;
  if (isBareNumber(trimmed)) return null;

  let s = trimmed;
  s = fixIntegrals(s);
  s = braceFirstLetter(s);
  s = bracePrimes(s);
  s = leftRightBrackets(s);
  return s;
}

/** Áp quy ước VDC cho cả tài liệu MMD. */
export function applyVdcLatex(mmd: string): string {
  return mmd
    .split('\n')
    .map((line) => {
      // Dòng bảng vẫn có math trong ô, segmentLine xử lý đúng nên không cần tách riêng.
      let out = '';
      for (const seg of segmentLine(line)) {
        if (!seg.math) {
          out += seg.text;
          continue;
        }
        const raw = seg.text;
        // Giữ nguyên khối `$$` (normalize đã hạ hết về `$` đơn, đây chỉ là phòng xa).
        if (raw.startsWith('$$')) {
          out += raw;
          continue;
        }
        const inner = raw.slice(1, -1);
        const fixed = vdcMathRun(inner);
        out += fixed === null ? inner.replace(/\{,\}/g, ',') : `$${fixed}$`;
      }
      return out;
    })
    .join('\n');
}
