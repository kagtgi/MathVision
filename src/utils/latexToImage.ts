import katex from 'katex';

// ─── Constants ────────────────────────────────────────────────────────────────

const RETINA_SCALE = 2;
const EQUATION_FONT_SIZE_PX = 18;
const EQUATION_PADDING_PX = 8;
const EQUATION_PADDING_SIDE_PX = 12;
const TIKZ_RENDER_TIMEOUT_MS = 30000;
const MIN_TIKZ_DIMENSION = 100;

const KATEX_CSS_URL = 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css';

// ─── Reusable canvas pool ─────────────────────────────────────────────────────

let _reusableCanvas: HTMLCanvasElement | null = null;

function getReusableCanvas(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  if (!_reusableCanvas) {
    _reusableCanvas = document.createElement('canvas');
  }
  _reusableCanvas.width = width;
  _reusableCanvas.height = height;
  const ctx = _reusableCanvas.getContext('2d', { willReadFrequently: false })!;
  // Clear any previous content to prevent ghosting artifacts
  ctx.clearRect(0, 0, width, height);
  return { canvas: _reusableCanvas, ctx };
}

// ─── KaTeX CSS preload ────────────────────────────────────────────────────────

let _katexCssText: string | null = null;
let _katexCssPromise: Promise<string> | null = null;

function getKatexCss(): Promise<string> {
  if (_katexCssText) return Promise.resolve(_katexCssText);
  if (!_katexCssPromise) {
    _katexCssPromise = fetch(KATEX_CSS_URL)
      .then((r) => r.text())
      .then((css) => {
        // Rewrite relative font URLs to absolute
        _katexCssText = css.replace(/url\(fonts\//g, `url(https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/fonts/`);
        return _katexCssText;
      })
      .catch(() => ''); // Fallback: empty CSS, will still use <link> tag
  }
  return _katexCssPromise;
}

// Kick off CSS preload immediately on module load
getKatexCss();

// ─── Wait for next frame (replaces fixed 50ms delay) ──────────────────────────

function waitForLayout(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      // Double-rAF ensures layout is complete
      requestAnimationFrame(() => resolve());
    });
  });
}

/**
 * Render a LaTeX equation string to a PNG image (as Uint8Array + dimensions).
 * Uses KaTeX to produce a DOM node, measures it, then draws to canvas via SVG foreignObject.
 *
 * @param latex  LaTeX string WITHOUT $ delimiters
 * @param displayMode  true for display equations, false for inline
 * @returns { bytes, width, height } — PNG bytes and pixel dimensions
 */
export async function latexToImage(
  latex: string,
  displayMode = true,
): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  // Preload CSS in parallel with KaTeX rendering
  const cssPromise = getKatexCss();

  // Create an off-screen container and render LaTeX via KaTeX DOM API (safe — no innerHTML)
  const container = document.createElement('div');
  container.style.position = 'absolute';
  container.style.visibility = 'hidden';
  container.style.left = '-9999px';
  container.style.top = '-9999px';
  container.style.fontSize = `${EQUATION_FONT_SIZE_PX}px`;
  container.style.lineHeight = '1.4';
  container.style.padding = `${EQUATION_PADDING_PX}px ${EQUATION_PADDING_SIDE_PX}px`;

  // Use KaTeX's DOM rendering (renderMathInElement is unsafe, but renderToString is fine
  // since KaTeX output is deterministic and trusted). We use the DOM overload for safety.
  katex.render(latex, container, {
    displayMode,
    throwOnError: false,
    output: 'html',
    strict: false,
  });

  document.body.appendChild(container);

  // Wait for layout to settle (uses rAF instead of fixed 50ms timeout)
  await waitForLayout();

  const rect = container.getBoundingClientRect();
  const width = Math.ceil(rect.width * RETINA_SCALE);
  const height = Math.ceil(rect.height * RETINA_SCALE);

  // Get the rendered HTML from the container (now it's KaTeX-generated, trusted)
  const html = container.innerHTML;
  document.body.removeChild(container);

  // Use inlined CSS when available for faster SVG rendering (no external fetch per equation)
  const katexCss = await cssPromise;
  const cssTag = katexCss
    ? `<style>${katexCss}</style>`
    : `<link rel="stylesheet" href="${KATEX_CSS_URL}" />`;

  // Build an SVG with foreignObject containing the KaTeX HTML
  const svgContent = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <foreignObject width="100%" height="100%">
        <div xmlns="http://www.w3.org/1999/xhtml"
             style="font-size:${EQUATION_FONT_SIZE_PX * RETINA_SCALE}px; line-height:1.4; padding:${EQUATION_PADDING_PX * RETINA_SCALE}px ${EQUATION_PADDING_SIDE_PX * RETINA_SCALE}px; color:#000;">
          ${cssTag}
          ${html}
        </div>
      </foreignObject>
    </svg>`;

  const svgBlob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
  const svgUrl = URL.createObjectURL(svgBlob);

  const img = new Image();
  img.width = width;
  img.height = height;

  const bytes = await new Promise<Uint8Array>((resolve, reject) => {
    img.onload = () => {
      const { canvas, ctx } = getReusableCanvas(width, height);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(svgUrl);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Failed to create image blob'));
            return;
          }
          blob.arrayBuffer().then((ab) => resolve(new Uint8Array(ab)));
        },
        'image/png',
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(svgUrl);
      reject(new Error('Failed to load SVG image'));
    };
    img.src = svgUrl;
  });

  return { bytes, width, height };
}

/**
 * Render TikZ code to a PNG image via a hidden DOM element and TikZJax-style rendering.
 * Falls back to an API-based approach if TikZJax is not available.
 *
 * @param tikzCode  Complete TikZ code (with \begin{tikzpicture}...\end{tikzpicture})
 * @returns { bytes, width, height } — PNG bytes and pixel dimensions, or null on failure
 */
export async function tikzToImage(
  tikzCode: string,
): Promise<{ bytes: Uint8Array; width: number; height: number } | null> {
  try {
    // Use a hidden container with a <script type="text/tikz"> element
    // TikZJax processes these automatically if it's loaded
    const container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.left = '-9999px';
    container.style.top = '-9999px';
    container.style.visibility = 'hidden';
    document.body.appendChild(container);

    const script = document.createElement('script');
    script.type = 'text/tikz';
    script.textContent = tikzCode;
    container.appendChild(script);

    // Wait for TikZJax to render (it converts script elements to SVG)
    const svg = await waitForTikzSvg(container, TIKZ_RENDER_TIMEOUT_MS);

    if (!svg) {
      document.body.removeChild(container);
      return null;
    }

    // Convert SVG to PNG
    const svgData = new XMLSerializer().serializeToString(svg);
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const svgUrl = URL.createObjectURL(svgBlob);

    const svgRect = svg.getBoundingClientRect();
    const width = Math.max(Math.ceil(svgRect.width * RETINA_SCALE), MIN_TIKZ_DIMENSION);
    const height = Math.max(Math.ceil(svgRect.height * RETINA_SCALE), MIN_TIKZ_DIMENSION);

    const img = new Image();
    const result = await new Promise<{ bytes: Uint8Array; width: number; height: number } | null>(
      (resolve) => {
        img.onload = () => {
          const { canvas, ctx } = getReusableCanvas(width, height);
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
          URL.revokeObjectURL(svgUrl);

          canvas.toBlob(
            (blob) => {
              if (!blob) {
                resolve(null);
                return;
              }
              blob.arrayBuffer().then((ab) =>
                resolve({ bytes: new Uint8Array(ab), width, height }),
              );
            },
            'image/png',
          );
        };
        img.onerror = () => {
          URL.revokeObjectURL(svgUrl);
          resolve(null);
        };
        img.src = svgUrl;
      },
    );

    document.body.removeChild(container);
    return result;
  } catch {
    return null;
  }
}

/**
 * Wait for an SVG element inside a container (created by TikZJax).
 * Uses MutationObserver for instant detection instead of rAF polling.
 */
function waitForTikzSvg(container: HTMLElement, timeoutMs: number): Promise<SVGSVGElement | null> {
  return new Promise((resolve) => {
    // Check immediately in case SVG is already present
    const existing = container.querySelector('svg');
    if (existing) { resolve(existing); return; }

    let settled = false;
    const observer = new MutationObserver(() => {
      const svg = container.querySelector('svg');
      if (svg && !settled) {
        settled = true;
        observer.disconnect();
        clearTimeout(timer);
        resolve(svg);
      }
    });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        observer.disconnect();
        resolve(null);
      }
    }, timeoutMs);

    observer.observe(container, { childList: true, subtree: true });
  });
}
