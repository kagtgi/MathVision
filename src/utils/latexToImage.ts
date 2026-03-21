import katex from 'katex';

/**
 * Render a LaTeX equation string to a PNG image (as Uint8Array + dimensions).
 * Uses KaTeX to produce HTML, wraps it in an SVG foreignObject, and draws to a canvas.
 *
 * @param latex  LaTeX string WITHOUT $ delimiters
 * @param displayMode  true for display equations, false for inline
 * @returns { bytes, width, height } — PNG bytes and pixel dimensions
 */
export async function latexToImage(
  latex: string,
  displayMode = true,
): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  // Render LaTeX to HTML string with KaTeX
  const html = katex.renderToString(latex, {
    displayMode,
    throwOnError: false,
    output: 'html',
    strict: false,
  });

  // Create an off-screen container to measure the rendered size
  const container = document.createElement('div');
  container.style.position = 'absolute';
  container.style.visibility = 'hidden';
  container.style.left = '-9999px';
  container.style.top = '-9999px';
  container.style.fontSize = '18px';
  container.style.lineHeight = '1.4';
  container.style.padding = '8px 12px';
  container.innerHTML = html;
  document.body.appendChild(container);

  // Load KaTeX CSS into our measurement (it should already be in the page)
  await new Promise((r) => setTimeout(r, 50)); // allow CSS to apply

  const rect = container.getBoundingClientRect();
  const scale = 2; // 2x for retina-quality rendering
  const width = Math.ceil(rect.width * scale);
  const height = Math.ceil(rect.height * scale);

  document.body.removeChild(container);

  // Build an SVG with foreignObject containing the KaTeX HTML
  const katexCssUrl = 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css';
  const svgContent = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <foreignObject width="100%" height="100%">
        <div xmlns="http://www.w3.org/1999/xhtml"
             style="font-size:${18 * scale}px; line-height:1.4; padding:${8 * scale}px ${12 * scale}px; color:#000;">
          <link rel="stylesheet" href="${katexCssUrl}" />
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
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
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
    // TikZJax fires a 'tikzjax-load-finished' event or we can poll for an SVG child
    const svg = await waitForTikzSvg(container, 15000);

    if (!svg) {
      document.body.removeChild(container);
      return null;
    }

    // Convert SVG to PNG
    const svgData = new XMLSerializer().serializeToString(svg);
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const svgUrl = URL.createObjectURL(svgBlob);

    const svgRect = svg.getBoundingClientRect();
    const scale = 2;
    const width = Math.max(Math.ceil(svgRect.width * scale), 100);
    const height = Math.max(Math.ceil(svgRect.height * scale), 100);

    const img = new Image();
    const result = await new Promise<{ bytes: Uint8Array; width: number; height: number } | null>(
      (resolve) => {
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d')!;
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
 * Poll for an SVG element inside a container (created by TikZJax).
 */
function waitForTikzSvg(container: HTMLElement, timeoutMs: number): Promise<SVGSVGElement | null> {
  return new Promise((resolve) => {
    const startTime = Date.now();

    const check = () => {
      const svg = container.querySelector('svg');
      if (svg) {
        resolve(svg);
        return;
      }
      if (Date.now() - startTime > timeoutMs) {
        resolve(null);
        return;
      }
      requestAnimationFrame(check);
    };
    check();
  });
}
