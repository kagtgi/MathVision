/**
 * Bộ đo hình đề thi THPT — dựng THẬT qua `tikzToImage()` của app.
 *
 * Hai cách dùng:
 *   1. Người soát bằng mắt: `npm run dev` rồi mở `/tikz-corpus.html`. Trang tự chạy hết 47 hình
 *      và hiện bảng kèm thumbnail theo mục chương trình. Đây là thứ duy nhất chứng minh hình
 *      ĐÚNG KIỂU SGK — harness chỉ chứng minh hình DỰNG ĐƯỢC.
 *   2. Máy: `node scripts/verify-tikz-render.mjs` bật Electron nạp trang này kèm `?sink=<cổng>`,
 *      trang POST từng kết quả về đó rồi POST `/done` khi xong.
 *
 * KHÁC probe: probe cố tình dựng lại cơ chế iframe để đo RENDERER (bỏ qua sanitizer, không
 * nhúng font). Trang này gọi đúng đường sản phẩm, vì câu hỏi ở đây là "hình có tới được file
 * Word không".
 *
 * TRANG NÀY PHẢI NẰM Ở GỐC REPO. `tikzjax.js` hardcode `fetch("./vendor/tikzjax/tex.wasm")` và
 * đường đó phân giải theo base URL của tài liệu iframe, mà iframe không có `src` thì thừa hưởng
 * base của trang tạo ra nó. Để trang ở `/devtools/` là 404 → không SVG → cháy hết 30 giây →
 * rơi hình, và KHÔNG log gì.
 */

import { tikzToImage } from '../../utils/latexToImage';
import { CORPUS, CORPUS_GROUPS, type CorpusCase } from './cases';
import { docxSize, judgeCorpusCase, type CorpusMeasure } from './judge';

interface CorpusResult extends CorpusMeasure {
  id: string;
  group: string;
  sgk: string;
  why: string;
  fails: string[];
  /** Nhãn nào bị nét đè — để sửa đúng chỗ thay vì dò tay cả chục nhãn. */
  overlapLabels: string[];
  /** Cỡ khi vào Word (docx px) — để soát trình bày, không chỉ soát dựng được. */
  docxW: number;
  docxH: number;
  png?: string;
}

const params = new URLSearchParams(location.search);
const sink = params.get('sink');
const only = params.get('only');

const QUEUE: CorpusCase[] = only ? CORPUS.filter((c) => c.group === only) : CORPUS;

// ─── Đo một ca ───────────────────────────────────────────────────────────────

async function runCase(c: CorpusCase): Promise<CorpusResult> {
  const notes: string[] = [];
  const overlapLabels: string[] = [];
  let svgXml = '';

  const t0 = performance.now();
  const png = await tikzToImage(
    c.code,
    (n) => notes.push(n),
    (xml) => {
      svgXml = xml;
    },
  );
  const ms = Math.round(performance.now() - t0);

  // Đọc từ SVG đã nhúng font, tức đúng chuỗi được rasterise. `<text>` cho biết nhãn có ra hay
  // không; `@font-face` cho biết font có tới được hay không (lỗi 1.2: cả 140 rule đều 404).
  const fonts = [
    ...new Set(
      [...svgXml.matchAll(/font-family\s*[:=]\s*["']?([A-Za-z0-9]+)/g)].map((m) => m[1]),
    ),
  ];
  const measure: CorpusMeasure = {
    ok: png !== null,
    ms,
    w: png?.width ?? 0,
    h: png?.height ?? 0,
    ink: png?.ink ?? 0,
    textNodes: (svgXml.match(/<text\b/g) ?? []).length,
    pathNodes: (svgXml.match(/<path\b/g) ?? []).length,
    fontFaces: (svgXml.match(/@font-face/g) ?? []).length,
    fonts,
    notes,
    labelOverlaps: await countLabelOverlaps(svgXml, undefined, overlapLabels),
  };

  const box = docxSize(measure.w || 1, measure.h || 1);
  return {
    ...measure,
    id: c.id,
    group: c.group,
    sgk: c.sgk,
    why: c.why,
    fails: judgeCorpusCase(c, measure).map((f) =>
      f.includes('nhãn bị nét') && overlapLabels.length ? `${f}: ${overlapLabels.join(', ')}` : f,
    ),
    overlapLabels,
    docxW: box.w,
    docxH: box.h,
    png: png ? pngDataUrl(png.bytes) : undefined,
  };
}

/**
 * Đếm số NHÃN bị nét của hình chạy xuyên qua.
 *
 * VÌ SAO ĐO CHỨ KHÔNG CHỈ VIẾT LUẬT: `SGK_STYLE_RULES` đã có câu "nhãn đặt NGOÀI hình, không đè
 * lên nét" từ 1.2, mà hình vẫn bị đè — nên thêm một câu nữa cũng không đổi gì. Chỉ có số đo mới
 * nói được luật có hiệu lực hay không, và mới bắt được lúc nó thôi hiệu lực.
 *
 * Cách đo: dựng SVG (đã nhúng font, tức đúng chuỗi được rasterise) vào một khung ẩn, lấy `getBBox`
 * của từng `<text>`, rồi hỏi từng hình học `isPointInStroke` tại lưới điểm BÊN TRONG hộp chữ.
 * Quy về toạ độ màn hình qua `getScreenCTM` để không phụ thuộc transform lồng nhau.
 *
 * Thu hộp chữ lại 25% mỗi chiều trước khi lấy mẫu: hộp glyph luôn rộng hơn nét chữ (side bearing,
 * phần trên/dưới của em-box), nên một đường đi SÁT nhãn mà không chạm chữ sẽ báo oan. Đo cái làm
 * chữ khó đọc — nét XUYÊN QUA GIỮA chữ — chứ không đo cái chạm mép.
 */
interface OverlapDiag {
  texts: number;
  /** Số pixel mực của HÌNH (không tính chữ) nằm trong ô chữ nhiều nhất. */
  worstInk: number;
}

/** Dưới ngưỡng này coi là nét đi sượt qua mép ô chữ, không phải xuyên qua chữ. */
const OVERLAP_MIN_PX = 4;

/**
 * Chỉ nét ĐẬM mới tính là đè. Ngưỡng 120 chứ không phải 250 như phép đo mực chung.
 *
 * Lý do đo được: lưới toạ độ vẽ bằng `gray` (RGB ~127) chạy dưới MỌI nhãn của hình hệ trục —
 * mà lưới mờ sau chữ là quy ước SGK bình thường, đọc vẫn rõ. Lấy ngưỡng 250 thì ca
 * `phang-oxy-vecto-khoang-cach` báo cả 4 nhãn bị đè, toàn báo oan. Nét đen thật có lõi gần 0 nên
 * ngưỡng 120 tách sạch hai thứ.
 */
const OVERLAP_DARK = 120;

/**
 * Xoá mọi `<text>` khỏi SVG. Đầu ra của dvisvgm là máy sinh, thẻ `text` không lồng nhau nên
 * regex ở đây đủ và rẻ hơn hẳn việc dựng lại cả cây DOM.
 */
const stripText = (xml: string) => xml.replace(/<text\b[\s\S]*?<\/text>/g, '');

/** Ngược lại: bỏ mọi hình học, chỉ chừa chữ. */
const stripGeometry = (xml: string) =>
  xml
    .replace(/<(path|line|polyline|polygon|circle|ellipse|rect)\b[^>]*\/>/g, '')
    .replace(/<(path|line|polyline|polygon|circle|ellipse|rect)\b[\s\S]*?<\/\1>/g, '');

function rasterize(xml: string, w: number, h: number): Promise<ImageData | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        return resolve(null);
      }
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(ctx.getImageData(0, 0, w, h));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

/**
 * Đếm số NHÃN bị nét của hình chạy xuyên qua.
 *
 * VÌ SAO ĐO CHỨ KHÔNG CHỈ VIẾT LUẬT: `SGK_STYLE_RULES` đã có câu "nhãn đặt NGOÀI hình, không đè
 * lên nét" từ 1.2, mà hình vẫn bị đè — thêm một câu nữa cũng không đổi gì. Chỉ số đo mới nói được
 * luật có hiệu lực hay không.
 *
 * CÁCH ĐO — dựng HAI lớp rồi lấy GIAO:
 *   1. bản đã xoá hết `<text>` → chỉ còn nét hình;
 *   2. bản đã xoá hết hình học → chỉ còn nét chữ;
 *   3. đếm pixel ĐẬM ở CẢ HAI lớp. Đó đúng là "chữ trùng vô đường".
 *
 * HAI CÁCH ĐO TRƯỚC ĐỀU SAI, ghi lại để không ai làm lại:
 *   - Hỏi `isPointInStroke` tại lưới 9 điểm: luôn trả 0, kể cả với hình cố tình đặt nhãn đè lên
 *     nét. Nét dày 0,4pt trong hệ toạ độ rộng cả trăm đơn vị thì chín điểm rời rạc gần như không
 *     bao giờ rơi trúng.
 *   - Đếm mực hình nằm trong Ô CHỮ (`getBoundingClientRect`): ô chữ gồm cả phần trống của
 *     ascent/descent, nên với glyph thấp như `-` nó cao gấp mấy lần nét chữ — đường đi cách xa
 *     bên trên vẫn bị tính là đè. Đó là lý do lượt đo đầu báo tới 19/47 hình.
 *
 * Lấy giao hai lớp mực thì không cần ô chữ, không cần biết độ dày nét, và chỉ tính đúng chỗ mực
 * chồng lên nhau. Ô chữ chỉ còn dùng để GỌI TÊN nhãn nào bị đè.
 */
async function countLabelOverlaps(
  svgXml: string,
  diag?: OverlapDiag,
  labels: string[] = [],
): Promise<number> {
  if (!svgXml) return 0;
  const holder = document.createElement('div');
  holder.style.cssText =
    'position:fixed;left:-10000px;top:0;width:1600px;height:1600px;overflow:hidden';
  document.body.appendChild(holder);
  try {
    holder.innerHTML = svgXml;
    const svg = holder.querySelector('svg');
    if (!svg) return 0;

    // BẮT BUỘC chờ font. `svgXml` mang theo `@font-face` dạng data URI, mà trình duyệt nạp font
    // BẤT ĐỒNG BỘ: đo ngay sau `innerHTML` là đo bằng font DỰ PHÒNG, đo sau khi nạp xong là đo
    // bằng cmr10/cmmi10 — hai ô chữ khác nhau.
    //
    // Đo được: thiếu dòng này thì hai lượt chạy liên tiếp cho HAI danh sách hình lỗi khác nhau,
    // kể cả với hình không sửa gì — vì font còn trong cache hay chưa là tuỳ ca chạy trước đó.
    // Một phép đo không tất định thì không dùng làm cửa chặn được.
    await document.fonts.ready;

    const svgRect = svg.getBoundingClientRect();
    const texts = [...svg.querySelectorAll<SVGGraphicsElement>('text')];
    if (diag) diag.texts = texts.length;
    if (!texts.length || svgRect.width <= 0 || svgRect.height <= 0) return 0;

    const W = Math.max(2, Math.min(1600, Math.round(svgRect.width * 2)));
    const H = Math.max(2, Math.min(1600, Math.round(svgRect.height * 2)));
    const [lineLayer, textLayer] = await Promise.all([
      rasterize(stripText(svgXml), W, H),
      rasterize(stripGeometry(svgXml), W, H),
    ]);
    if (!lineLayer || !textLayer) return 0;

    const dark = (d: Uint8ClampedArray, i: number) =>
      d[i] < OVERLAP_DARK && d[i + 1] < OVERLAP_DARK && d[i + 2] < OVERLAP_DARK;

    // Ô chữ chỉ để GỌI TÊN nhãn — pixel giao mới là thứ quyết định.
    const boxes = texts
      .map((t) => {
        const r = t.getBoundingClientRect();
        return {
          name: (t.textContent ?? '?').trim(),
          x0: ((r.left - svgRect.left) / svgRect.width) * W,
          y0: ((r.top - svgRect.top) / svgRect.height) * H,
          x1: ((r.right - svgRect.left) / svgRect.width) * W,
          y1: ((r.bottom - svgRect.top) / svgRect.height) * H,
          hits: 0,
        };
      })
      .filter((b) => b.x1 > b.x0 && b.y1 > b.y0);

    let overlapPx = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        if (!dark(lineLayer.data, i) || !dark(textLayer.data, i)) continue;
        overlapPx++;
        const b = boxes.find((q) => x >= q.x0 && x <= q.x1 && y >= q.y0 && y <= q.y1);
        if (b) b.hits++;
      }
    }
    if (diag) diag.worstInk = overlapPx;

    let hits = 0;
    for (const b of boxes) {
      if (b.hits >= OVERLAP_MIN_PX) {
        hits++;
        labels.push(`"${b.name}"`);
      }
    }
    // Có mực chồng nhưng không quy được về nhãn nào (chữ nằm ngoài mọi ô đã đo) thì vẫn tính một.
    if (!hits && overlapPx >= OVERLAP_MIN_PX * 3) hits = 1;
    return hits;
  } catch {
    // Không đo được thì báo 0 chứ đừng làm hỏng cả lượt chạy — `selfTestOverlap` là thứ phân biệt
    // "sạch" với "máy dò hỏng".
    return 0;
  } finally {
    holder.remove();
  }
}

function pngDataUrl(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:image/png;base64,${btoa(bin)}`;
}

// ─── Gửi về bồn của driver ───────────────────────────────────────────────────

/**
 * Cố tình dùng `text/plain`: `application/json` biến POST thành yêu cầu cần preflight CORS,
 * thêm một vòng OPTIONS và một chỗ nữa để hỏng. Bồn tự `JSON.parse`.
 */
async function post(path: string, body: unknown): Promise<void> {
  if (!sink) return;
  try {
    await fetch(`http://127.0.0.1:${sink}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify(body),
    });
  } catch {
    // Bồn chết thì cứ chạy tiếp cho người xem trang, đừng làm hỏng cả lượt đo.
  }
}

// ─── Giao diện ───────────────────────────────────────────────────────────────

const root = document.getElementById('app')!;
/** Kết quả tự kiểm máy dò đè nhãn; `null` = chưa chạy. */
let selfTest: { bad: number; good: number; diag: string } | null = null;
const results: CorpusResult[] = [];
(window as unknown as { __corpus: CorpusResult[] }).__corpus = results;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function render(done: number) {
  const bad = results.filter((r) => r.fails.length);
  const byGroup = CORPUS_GROUPS.map((g) => {
    const rows = results.filter((r) => r.group === g);
    if (!rows.length) return '';
    const okCount = rows.filter((r) => !r.fails.length).length;
    return `
      <h2>${g} <span class="sub">${okCount}/${rows.length} đạt</span></h2>
      <table>
        <thead><tr><th></th><th>ca</th><th>mục chương trình</th><th>ms</th><th>px</th>
        <th>mực</th><th>&lt;text&gt;</th><th>font</th><th>vào Word</th><th>hình</th></tr></thead>
        <tbody>${rows.map(row).join('')}</tbody>
      </table>`;
  }).join('');

  root.innerHTML = `
    <h1>Bộ hình TikZ theo chương trình THPT</h1>
    <p class="sum">${done}/${QUEUE.length} ca · <b>${results.length - bad.length} đạt</b>${
      bad.length ? ` · <span class="bad-txt">${bad.length} KHÔNG ĐẠT: ${bad.map((r) => r.id).join(', ')}</span>` : ''
    }${sink ? ' · <em>đang gửi về driver</em>' : ''}</p>
    ${
      selfTest
        ? `<p class="sum">Tự kiểm máy dò đè nhãn: hình cố tình đè ra <b>${selfTest.bad}</b> (phải &ge; 1) · hình đặt đúng ra <b>${selfTest.good}</b> (phải = 0)${
            selfTest.bad >= 1 && selfTest.good === 0
              ? ''
              : ' · <span class="bad-txt">MÁY DÒ HỎNG — mọi số 0 bên dưới đều vô nghĩa</span>'
          }<br><em>${esc(selfTest.diag)}</em></p>`
        : ''
    }
    ${only && !QUEUE.length ? `<p class="bad-txt">Không có họ nào tên "${esc(only)}". Chọn một trong: ${CORPUS_GROUPS.join(', ')}.</p>` : ''}
    ${byGroup}`;
}

function row(r: CorpusResult): string {
  const mark = r.fails.length ? '❌' : '✅';
  return `<tr class="${r.fails.length ? 'bad' : ''}">
      <td>${mark}</td><td><code>${r.id}</code></td><td class="sgk">${esc(r.sgk)}</td>
      <td>${r.ms}</td><td>${r.w}×${r.h}</td>
      <td>${(r.ink * 100).toFixed(2)}%</td>
      <td>${r.textNodes}${r.labelOverlaps ? ` <span class="bad-txt">${r.labelOverlaps} đè</span>` : ''}</td>
      <td>${r.fonts.length}<span class="sub"> · ${r.fontFaces} face</span></td>
      <td>${r.docxW}×${r.docxH}<span class="sub"> · ${(r.docxH * 0.02646).toFixed(1)} cm</span></td>
      <td>${r.png ? `<img src="${r.png}" />` : ''}</td>
    </tr>
    <tr class="why"><td></td><td colspan="9">${esc(r.why)}${
      r.fails.length ? `<br><span class="bad-txt">${r.fails.map(esc).join('<br>')}</span>` : ''
    }</td></tr>`;
}

// ─── Tự kiểm máy dò đè nhãn ──────────────────────────────────────────────────

/**
 * Chứng minh phép đo đè nhãn THẬT SỰ đo được, trước khi tin con số 0 của nó.
 *
 * Bài học đắt nhất của 1.1 là một assert `!/>Câu \d/` trông như đang canh gác mà thực ra canh
 * chỗ trống. `countLabelOverlaps` có `catch { return 0 }`, nên "0 nhãn bị đè" và "phép đo hỏng"
 * trông giống hệt nhau. Hai ca dưới đây tách hai thứ đó ra: một hình cố tình đặt nhãn ĐÈ LÊN nét
 * (phải ra >= 1) và một hình đặt nhãn lệch ra (phải ra 0).
 */
async function selfTestOverlap(): Promise<{ bad: number; good: number; diag: string }> {
  const measure = async (code: string) => {
    let xml = '';
    await tikzToImage(
      code,
      () => {},
      (s) => {
        xml = s;
      },
    );
    const d: OverlapDiag = { texts: 0, worstInk: 0 };
    const n = await countLabelOverlaps(xml, d);
    return { n, d };
  };
  const line = '\\draw[thick] (0,0) -- (4,0);';
  const bad = await measure(
    `\\begin{tikzpicture}\n  ${line}\n  \\node at (2,0) {$M$};\n\\end{tikzpicture}`,
  );
  const good = await measure(
    `\\begin{tikzpicture}\n  ${line}\n  \\node[above=3pt] at (2,0) {$M$};\n\\end{tikzpicture}`,
  );
  return {
    bad: bad.n,
    good: good.n,
    diag: `ca đè: ${bad.d.texts} nhãn, mực hình trong ô chữ nhiều nhất ${bad.d.worstInk}px (ngưỡng ${OVERLAP_MIN_PX}) · ca đúng: ${good.d.worstInk}px`,
  };
}

// ─── Chạy ────────────────────────────────────────────────────────────────────

async function main() {
  render(0);
  const self = await selfTestOverlap();
  selfTest = self;
  render(0);
  await post('/selftest', self);
  for (let i = 0; i < QUEUE.length; i++) {
    const r = await runCase(QUEUE[i]);
    results.push(r);
    render(i + 1);
    await post('/case', r);
    // Mỗi lượt dựng cấp 163,8 MB WebAssembly.Memory; nghỉ một nhịp cho GC kịp thu, không thì
    // vài chục ca sau sẽ hỏng vì hết bộ nhớ chứ không phải vì mã sai.
    await new Promise((res) => setTimeout(res, 150));
  }
  (window as unknown as { __corpusDone: boolean }).__corpusDone = true;
  await post('/done', { total: QUEUE.length });
}

void main();
