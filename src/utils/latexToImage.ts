// ─── Constants ────────────────────────────────────────────────────────────────

const RETINA_SCALE = 2;
const TIKZ_RENDER_TIMEOUT_MS = 30000;
const MIN_TIKZ_DIMENSION = 100;

// ─── TikZ preprocessing for TikZJax compatibility ───────────────────────────
// TikZJax doesn't support PGF math functions (sqrt, sin, cos, etc.) in
// coordinate expressions.  We evaluate {…} blocks that contain these functions
// into plain numbers so the browser renderer won't hang.

const DEG = Math.PI / 180;

/** Minimal math evaluator for PGF-style expressions. */
function evalPgfExpr(expr: string): number | null {
  // Normalise whitespace
  let s = expr.trim();
  if (s.length === 0) return null;

  // Replace PGF math functions with JS equivalents (TikZ uses degrees)
  s = s.replace(/\bsqrt\s*\(/g, 'Math.sqrt(');
  s = s.replace(/\babs\s*\(/g, 'Math.abs(');
  s = s.replace(/\bsin\s*\(/g, 'Math.sin(DEG*(');
  s = s.replace(/\bcos\s*\(/g, 'Math.cos(DEG*(');
  s = s.replace(/\btan\s*\(/g, 'Math.tan(DEG*(');
  s = s.replace(/\bln\s*\(/g, 'Math.log(');
  s = s.replace(/\bexp\s*\(/g, 'Math.exp(');
  s = s.replace(/\bfloor\s*\(/g, 'Math.floor(');
  s = s.replace(/\bceil\s*\(/g, 'Math.ceil(');
  s = s.replace(/\bround\s*\(/g, 'Math.round(');
  s = s.replace(/\bmin\s*\(/g, 'Math.min(');
  s = s.replace(/\bmax\s*\(/g, 'Math.max(');
  s = s.replace(/\bpow\s*\(/g, 'Math.pow(');
  s = s.replace(/\bmod\s*\(/g, '((a,b)=>a%b)(');  // PGF mod(a,b) → JS modulo
  s = s.replace(/\bpi\b/g, 'Math.PI');
  s = s.replace(/\be\b/g, 'Math.E');  // Euler's number

  // Close extra parens introduced by trig wrappers:  sin(30) → Math.sin(DEG*(30))
  // Count how many DEG*( we inserted vs how many closing parens exist
  const trigCount = (s.match(/DEG\*\(/g) || []).length;
  for (let i = 0; i < trigCount; i++) {
    // Find the matching ')' for the original function call and double it
    const idx = s.indexOf('DEG*(');
    if (idx === -1) break;
    let depth = 0;
    for (let j = idx + 5; j < s.length; j++) {
      if (s[j] === '(') depth++;
      if (s[j] === ')') {
        if (depth === 0) {
          s = s.slice(0, j + 1) + ')' + s.slice(j + 1);
          break;
        }
        depth--;
      }
    }
  }

  // Allow only safe characters: digits, operators, parens, dots, Math.*, DEG
  const safe = s.replace(/Math\.\w+/g, '').replace(/DEG/g, '');
  if (/[^0-9+\-*/().,%^ \t]/.test(safe)) return null;

  // Replace ^ with ** for exponentiation
  s = s.replace(/\^/g, '**');

  try {
    // eslint-disable-next-line no-new-func
    const val = new Function('Math', 'DEG', `"use strict"; return (${s});`)(Math, DEG);
    if (typeof val !== 'number' || !isFinite(val)) return null;
    return val;
  } catch {
    return null;
  }
}

/**
 * Preprocess TikZ code for TikZJax compatibility.
 *
 * 1. Evaluates PGF math expressions inside {…} (e.g. {sqrt(3)}) to plain numbers.
 * 2. Strips unsupported library options that can cause silent hangs (e.g. `e` constant
 *    inside calc expressions).
 * 3. Normalises the `e` constant → 2.71828 when used alone as a PGF value.
 */
export function preprocessTikzForTikzJax(code: string): string {
  // Pass 1: Evaluate {expr} blocks containing PGF math functions or constants.
  // Also catches standalone {e} and {pi} used as coordinate values.
  let result = code.replace(
    /\{([^{}]*(?:sqrt|sin|cos|tan|abs|ln|exp|floor|ceil|round|min|max|pow|mod|\bpi\b|\be\b)[^{}]*)\}/g,
    (_match, inner: string) => {
      const val = evalPgfExpr(inner);
      if (val === null) return _match; // couldn't evaluate — leave unchanged
      const rounded = Math.round(val * 100000) / 100000;
      return String(rounded);
    },
  );

  // Pass 2: Evaluate bare {expr} calc-style interpolation factors that contain math.
  // e.g. $(A)!{sqrt(2)/2}!(B)$ → $(A)!0.70711!(B)$
  result = result.replace(
    /!\{([^{}]*(?:sqrt|sin|cos|tan|abs|ln|exp|floor|ceil|round|min|max|pow|mod|\bpi\b|\be\b)[^{}]*)\}!/g,
    (_match, inner: string) => {
      const val = evalPgfExpr(inner);
      if (val === null) return _match;
      const rounded = Math.round(val * 100000) / 100000;
      return `!${rounded}!`;
    },
  );

  return result;
}

// ─── Dựng TikZ trong iframe riêng ────────────────────────────────────────────
//
// TikZJax chỉ quét `document.getElementsByTagName('script')` MỘT LẦN lúc chính nó
// được nạp, và không có MutationObserver, cũng không lộ hàm nào ra ngoài. Vì vậy cách
// chèn thẻ <script type="text/tikz"> vào trang đang chạy KHÔNG BAO GIỜ được xử lý —
// mọi lần dựng hình đều lặng lẽ chờ hết timeout rồi trả null.
//
// Cách chạy được: mỗi hình dựng trong một iframe riêng, nội dung iframe có sẵn thẻ
// text/tikz TRƯỚC khi tikzjax.js được nạp. Cách này còn tự cô lập từng lần dựng nên
// không còn phải lo TikZJax không an toàn khi chạy song song.

const TIKZJAX_URL = './vendor/tikzjax/tikzjax.js';
const TIKZJAX_FONTS_URL = './vendor/tikzjax/fonts.css';

function absoluteUrl(relative: string): string {
  try {
    return new URL(relative, document.baseURI).href;
  } catch {
    return relative;
  }
}

function tikzIframeHtml(code: string): string {
  // Chẻ chuỗi đóng thẻ để không kết thúc sớm thẻ script của chính tài liệu này.
  const close = '</' + 'script>';
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<link rel="stylesheet" href="' + absoluteUrl(TIKZJAX_FONTS_URL) + '">' +
    '<style>body{margin:0;background:#fff}</style></head><body>' +
    '<script type="text/tikz">' + code + close +
    '<script src="' + absoluteUrl(TIKZJAX_URL) + '">' + close +
    '</body></html>'
  );
}

function waitForSvgIn(doc: Document, timeoutMs: number): Promise<SVGSVGElement | null> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tick = () => {
      const svg = doc.querySelector('svg');
      if (svg) {
        resolve(svg as unknown as SVGSVGElement);
        return;
      }
      if (Date.now() - t0 > timeoutMs) {
        resolve(null);
        return;
      }
      setTimeout(tick, 200);
    };
    tick();
  });
}

/**
 * Dựng mã TikZ thành PNG. Trả null nếu compile hỏng hoặc quá thời gian — bên gọi phải
 * coi đó là "không có hình" và đi tiếp, không được để chỗ trống trong tài liệu.
 */
export async function tikzToImage(
  tikzCode: string,
): Promise<{ bytes: Uint8Array; width: number; height: number } | null> {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.left = '-10000px';
  iframe.style.top = '0';
  iframe.style.width = '1400px';
  iframe.style.height = '1400px';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const cleanup = () => {
    if (iframe.parentNode) document.body.removeChild(iframe);
  };

  try {
    const doc = iframe.contentDocument;
    if (!doc) {
      cleanup();
      return null;
    }
    doc.open();
    doc.write(tikzIframeHtml(preprocessTikzForTikzJax(tikzCode)));
    doc.close();

    const svg = await waitForSvgIn(doc, TIKZ_RENDER_TIMEOUT_MS);
    if (!svg) {
      cleanup();
      return null;
    }

    const rect = svg.getBoundingClientRect();
    const width = Math.max(Math.ceil(rect.width * RETINA_SCALE), MIN_TIKZ_DIMENSION);
    const height = Math.max(Math.ceil(rect.height * RETINA_SCALE), MIN_TIKZ_DIMENSION);

    // Nhúng font vào SVG là không cần: TikZJax xuất chữ dưới dạng <path>.
    const svgData = new XMLSerializer().serializeToString(svg);
    const svgUrl = URL.createObjectURL(new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' }));

    const result = await new Promise<{ bytes: Uint8Array; width: number; height: number } | null>(
      (resolve) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            URL.revokeObjectURL(svgUrl);
            resolve(null);
            return;
          }
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
          URL.revokeObjectURL(svgUrl);
          canvas.toBlob((blob) => {
            if (!blob) {
              resolve(null);
              return;
            }
            blob.arrayBuffer().then((ab) => resolve({ bytes: new Uint8Array(ab), width, height }));
          }, 'image/png');
        };
        img.onerror = () => {
          URL.revokeObjectURL(svgUrl);
          resolve(null);
        };
        img.src = svgUrl;
      },
    );

    cleanup();
    return result;
  } catch {
    cleanup();
    return null;
  }
}
