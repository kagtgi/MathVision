/**
 * Xem trước MMD bằng chính bộ render của Mathpix (mathpix-markdown-it, MIT).
 *
 * Vì sao không dùng ReactMarkdown + KaTeX: KaTeX không render nổi `\begin{array}`
 * trong `$...$` — thứ có 2-14 chỗ trong mỗi đề mẫu — cũng như `\begin{tabular}`,
 * theorem, footnote. Bộ của Mathpix hiểu trọn phương ngữ MMD.
 *
 * Vì sao nạp bằng thẻ <script> cổ điển thay vì import:
 *   1. Package hard-dep react@^18 trong `dependencies` (không phải peer) — dưới
 *      React 19 npm lồng thêm một bản React nữa và component của họ vỡ.
 *   2. MathJax AsciiMath là sloppy-mode; Vite luôn strict nên import ESM ném
 *      "TypeError: 'caller','callee','arguments' may not be accessed"
 *      (mathpix-markdown-it#278, còn mở).
 * Script cổ điển né cả hai, lại nạp lười nên không phình bundle chính.
 *
 * Chạy offline tuyệt đối: giữ output_format 'svg' (MathJax pre-render), KHÔNG bao giờ
 * gọi getMathpixFontsStyle()/htmlWrapper.includeFonts — chúng @import Google Fonts.
 */

const BUNDLE_URL = './vendor/mathpix/bundle.js';

type MarkdownToHtml = (mmd: string, options?: Record<string, unknown>) => string;

interface MathpixGlobals {
  markdownToHTML?: MarkdownToHtml;
  loadMathJax?: (...args: unknown[]) => boolean;
}

let loadPromise: Promise<boolean> | null = null;

function globals(): MathpixGlobals {
  return window as unknown as MathpixGlobals;
}

/** Nạp bundle một lần. Trả false nếu không nạp được — gọi bên ngoài phải có đường lui. */
export function loadMathpixRenderer(): Promise<boolean> {
  if (loadPromise) return loadPromise;
  loadPromise = new Promise<boolean>((resolve) => {
    if (typeof document === 'undefined') {
      resolve(false);
      return;
    }
    if (globals().markdownToHTML) {
      resolve(true);
      return;
    }
    const script = document.createElement('script');
    script.src = BUNDLE_URL;
    script.async = true;
    script.onload = () => {
      try {
        globals().loadMathJax?.();
      } catch {
        /* loadMathJax chỉ chèn stylesheet; hỏng thì render vẫn chạy */
      }
      resolve(typeof globals().markdownToHTML === 'function');
    };
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
  return loadPromise;
}

export function isRendererReady(): boolean {
  return typeof globals().markdownToHTML === 'function';
}

const BASE_OPTIONS: Record<string, unknown> = {
  width: 900,
  htmlTags: false,
  htmlSanitize: false,
  centerImages: true,
  centerTables: true,
  outMath: { include_latex: true, include_svg: true },
};

/** `![](#id)` -> data URL để hình hiện được trong khung xem trước. */
function inlineFigures(mmd: string, dataUrlFor: (id: string) => string | null): string {
  return mmd.replace(/!\[([^\]]*)\]\(\s*#([\w-]+)\s*\)/g, (whole, alt: string, id: string) => {
    const url = dataUrlFor(id);
    return url ? `![${alt}](${url})` : whole;
  });
}

export function renderMmdHtml(mmd: string, dataUrlFor: (id: string) => string | null): string | null {
  const fn = globals().markdownToHTML;
  if (!fn) return null;
  try {
    return fn(inlineFigures(mmd, dataUrlFor), BASE_OPTIONS);
  } catch {
    return null;
  }
}

export interface RenderLintIssue {
  message: string;
  snippet: string;
}

/**
 * Dùng chính bộ render làm bộ lint: bật parserErrors 'show_input' rồi soi marker lỗi
 * trong HTML. Bắt được LaTeX sai cú pháp mà QC regex của ta không thấy.
 */
export function lintMmd(mmd: string): RenderLintIssue[] {
  const fn = globals().markdownToHTML;
  if (!fn) return [];
  let html = '';
  try {
    html = fn(mmd, {
      ...BASE_OPTIONS,
      parserErrors: 'show_input',
      outMath: { ...(BASE_OPTIONS.outMath as object), include_error: true },
    });
  } catch {
    return [];
  }

  const issues: RenderLintIssue[] = [];
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const el of Array.from(doc.querySelectorAll('merror, .math-error, [data-error]'))) {
    const message = el.getAttribute('data-error') || el.textContent?.trim() || 'Lỗi cú pháp LaTeX';
    issues.push({ message: message.slice(0, 160), snippet: (el.textContent ?? '').slice(0, 80) });
    if (issues.length >= 20) break;
  }
  return issues;
}
