/**
 * Bộ đo năng lực TikZJax. Chạy `npm run dev` rồi mở `/probe-tikz.html`.
 *
 * CỐ TÌNH KHÔNG gọi `tikzToImage()` của app: bộ đo cần soi được SVG TRƯỚC lúc rasterise
 * (chữ ra `<text>` hay `<path>`, font nào được dùng) và đo mức mực — những thứ đường sản
 * phẩm không lộ ra. Nên ở đây dựng lại đúng cơ chế iframe của `latexToImage.ts` nhưng trả
 * về nhiều số đo hơn.
 *
 * Chỉ dùng lúc phát triển. `vite build` chỉ lấy `index.html` làm entry nên trang này không
 * vào bản đóng gói.
 */

import { preprocessTikzForTikzJax } from '../../utils/latexToImage';
import { MIN_INK_RATIO } from '../../utils/tikzCapabilities';
import { CASES, type ProbeCase } from './cases';

const TIMEOUT_MS = 12_000;
const TIKZJAX_URL = './vendor/tikzjax/tikzjax.js';
const TIKZJAX_FONTS_URL = './vendor/tikzjax/fonts.css';

interface ProbeResult {
  id: string;
  why: string;
  expect: 'ok' | 'hang';
  raw: boolean;
  ok: boolean;
  /** Đúng kỳ vọng hay không — đây mới là cột cần đọc. */
  asExpected: boolean;
  ms: number;
  w: number;
  h: number;
  /**
   * RATIO pixel không phải trắng (KHÔNG phải phần trăm). Hình rỗng vẫn ra SVG nên đây là phép
   * đo thật sự.
   *
   * Bản trước lưu phần trăm rồi lại chốt đạt bằng `ink > 0.02`, tức ngưỡng thật 0,0002 —
   * LỎNG GẤP 10 LẦN `MIN_INK_RATIO` của app. Hệ quả: ca probe báo "dựng được" ở 0,05% mực là
   * ca mà `tikzToImage` thật sự BỎ HÌNH. Giờ dùng chung một ngưỡng, một đơn vị.
   */
  ink: number;
  textNodes: number;
  pathNodes: number;
  fonts: string[];
  /** Ký tự đầu của SVG để soi khi cần. */
  svgHead: string;
  png?: string;
}

const absUrl = (rel: string) => new URL(rel, document.baseURI).href;

function iframeHtml(code: string): string {
  const close = '</' + 'script>';
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<link rel="stylesheet" href="' + absUrl(TIKZJAX_FONTS_URL) + '">' +
    '<style>body{margin:0;background:#fff}</style></head><body>' +
    '<script type="text/tikz">' + code + close +
    '<script src="' + absUrl(TIKZJAX_URL) + '">' + close +
    '</body></html>'
  );
}

function waitForSvg(doc: Document, timeoutMs: number): Promise<SVGSVGElement | null> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tick = () => {
      const svg = doc.querySelector('svg');
      if (svg) return resolve(svg as unknown as SVGSVGElement);
      if (Date.now() - t0 > timeoutMs) return resolve(null);
      setTimeout(tick, 150);
    };
    tick();
  });
}

/** Vẽ SVG lên canvas rồi đếm pixel không-trắng. Ngưỡng 250 để bỏ qua viền mờ. */
function inkRatio(canvas: HTMLCanvasElement): number {
  const ctx = canvas.getContext('2d');
  if (!ctx) return 0;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let dark = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] < 250 || data[i + 1] < 250 || data[i + 2] < 250) dark++;
  }
  return dark / (canvas.width * canvas.height);
}

async function runCase(c: ProbeCase): Promise<ProbeResult> {
  const expect = c.expect ?? 'ok';
  const raw = Boolean(c.raw);
  const code = raw ? c.code : preprocessTikzForTikzJax(c.code);

  const base: ProbeResult = {
    id: c.id, why: c.why, expect, raw,
    ok: false, asExpected: false, ms: 0, w: 0, h: 0, ink: 0,
    textNodes: 0, pathNodes: 0, fonts: [], svgHead: '',
  };

  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;left:-10000px;top:0;width:1400px;height:1400px;border:0';
  document.body.appendChild(iframe);
  const cleanup = () => iframe.parentNode && document.body.removeChild(iframe);

  const t0 = performance.now();
  try {
    const doc = iframe.contentDocument;
    if (!doc) throw new Error('no iframe document');
    doc.open();
    doc.write(iframeHtml(code));
    doc.close();

    const svg = await waitForSvg(doc, TIMEOUT_MS);
    base.ms = Math.round(performance.now() - t0);
    if (!svg) {
      base.asExpected = expect === 'hang';
      cleanup();
      return base;
    }

    const xml = new XMLSerializer().serializeToString(svg);
    base.textNodes = (xml.match(/<text\b/g) ?? []).length;
    base.pathNodes = (xml.match(/<path\b/g) ?? []).length;
    base.fonts = [...new Set([...xml.matchAll(/font-family\s*[:=]\s*["']?([^"';]+)/g)].map((m) => m[1].trim()))];
    base.svgHead = xml.slice(0, 200);

    const rect = svg.getBoundingClientRect();
    const w = Math.max(Math.ceil(rect.width * 2), 100);
    const h = Math.max(Math.ceil(rect.height * 2), 100);
    base.w = w;
    base.h = h;

    const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
    await new Promise<void>((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        base.ink = inkRatio(canvas);
        base.png = canvas.toDataURL('image/png');
        URL.revokeObjectURL(url);
        resolve();
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(); };
      img.src = url;
    });

    // Ra được SVG nhưng không có mực nào thì coi là KHÔNG dựng được — đúng cái bẫy
    // MIN_TIKZ_DIMENSION đang che: hình rỗng thành PNG trắng 200x200 hợp lệ.
    // Dùng ĐÚNG ngưỡng của app: probe không được rộng rãi hơn thứ nó đang dự báo.
    base.ok = base.ink >= MIN_INK_RATIO;
    base.asExpected = expect === 'ok' ? base.ok : !base.ok;
    cleanup();
    return base;
  } catch (err) {
    base.ms = Math.round(performance.now() - t0);
    base.svgHead = String(err);
    base.asExpected = expect === 'hang';
    cleanup();
    return base;
  }
}

// ─── Giao diện ───────────────────────────────────────────────────────────────

const root = document.getElementById('app')!;
const results: ProbeResult[] = [];
(window as unknown as { __probe: ProbeResult[] }).__probe = results;

function render(done: number) {
  const rows = results
    .map((r) => {
      const mark = r.asExpected ? '✅' : '❌';
      const note = r.expect === 'hang' ? ' <em>(kỳ vọng fail)</em>' : '';
      return `<tr class="${r.asExpected ? '' : 'bad'}">
        <td>${mark}</td><td><code>${r.id}</code>${r.raw ? ' <em>raw</em>' : ''}${note}</td>
        <td>${r.ok ? 'dựng được' : '<b>không dựng được</b>'}</td>
        <td>${r.ms}</td><td>${r.w}×${r.h}</td><td>${(r.ink * 100).toFixed(3)}%</td>
        <td>${r.textNodes}</td><td>${r.pathNodes}</td>
        <td>${r.fonts.join(', ') || '—'}</td>
        <td>${r.png ? `<img src="${r.png}" />` : ''}</td>
      </tr>
      <tr class="why"><td></td><td colspan="9">${r.why}</td></tr>`;
    })
    .join('');

  const bad = results.filter((r) => !r.asExpected);
  root.innerHTML = `
    <h1>Probe năng lực TikZJax</h1>
    <p class="sum">${done}/${QUEUE.length} ca · <b>${results.length - bad.length} đúng kỳ vọng</b>${
      bad.length ? ` · <span class="bad-txt">${bad.length} LỆCH: ${bad.map((r) => r.id).join(', ')}</span>` : ''
    }</p>
    <table>
      <thead><tr><th></th><th>ca</th><th>kết quả</th><th>ms</th><th>px</th><th>mực</th>
      <th>&lt;text&gt;</th><th>&lt;path&gt;</th><th>font</th><th>ảnh</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/** `?only=<group>` để chạy lại một nhóm mà không tốn 2 phút cho cả bộ. */
const only = new URLSearchParams(location.search).get('only');
const QUEUE = only ? CASES.filter((c) => c.group === only) : CASES;

async function main() {
  render(0);
  for (let i = 0; i < QUEUE.length; i++) {
    results.push(await runCase(QUEUE[i]));
    render(i + 1);
    // Mỗi ca nạp lại 156 MB memory image; nghỉ một nhịp cho GC kịp thu.
    await new Promise((r) => setTimeout(r, 120));
  }
  (window as unknown as { __probeDone: boolean }).__probeDone = true;
}

void main();
