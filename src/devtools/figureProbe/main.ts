/**
 * Đo đường NÂNG CHẤT HÌNH trên hình đề THẬT: ảnh cắt → TikZ → (AI sinh ảnh) → chốt.
 *
 * VÌ SAO CẦN: `run-real-exam.mjs` chạy trong Node nên `tikzToImage` không chạy được, và file Word
 * nó sinh ra toàn ảnh cắt. Nhìn vào đó KHÔNG phân biệt được ba khả năng rất khác nhau: TikZ dựng
 * hỏng · TikZ dựng được nhưng trọng tài loại · đường TikZ không hề chạy. Trang này gọi ĐÚNG
 * `upgradeFigure` mà app dùng, trên đúng những ảnh cắt của đề thật, và đếm từng khả năng.
 *
 * Khác `tikz-corpus.html`: bộ corpus đo hình do NGƯỜI viết TikZ; trang này đo hình do MODEL viết
 * TikZ từ ảnh cắt mờ — hai câu hỏi khác nhau, và câu thứ hai mới là thứ người dùng gặp.
 *
 * Driver: `scripts/probe-figure-pipeline.mjs` (truyền khoá + danh sách ảnh qua query, nhận kết
 * quả qua bồn http).
 */

import { upgradeFigure } from '../../pipeline/upgradeFigure';
import { pngSize } from '../../pipeline/mmdToDocx';
import type { FigureOutcome } from '../../pipeline/figures';
import type { FigureKind } from '../../pipeline/prompts';

interface Job {
  id: string;
  /** Đường dẫn ảnh cắt, Vite phục vụ từ `public/`. */
  url: string;
  kind: FigureKind;
  /** Đề bài quanh hình. */
  context: string;
  num: number | null;
}

interface Row extends FigureOutcome {
  ms: number;
  cropPng: string;
  outPng: string | null;
}

const params = new URLSearchParams(location.search);
const sink = params.get('sink');
const apiKey = params.get('key') ?? '';
const allowGen = params.get('gen') !== '0';

const root = document.getElementById('app')!;
const rows: Row[] = [];
const logs: string[] = [];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

async function post(path: string, body: unknown) {
  if (!sink) return;
  try {
    await fetch(`http://127.0.0.1:${sink}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify(body),
    });
  } catch {
    // Bồn chết thì vẫn chạy tiếp cho người xem trang.
  }
}

const toDataUrl = (b: Uint8Array) => {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < b.length; i += chunk) s += String.fromCharCode(...b.subarray(i, i + chunk));
  return `data:image/png;base64,${btoa(s)}`;
};

const LABEL: Record<string, string> = {
  crop: 'giữ ảnh cắt',
  tikz: 'TikZ THẮNG',
  genai: 'AI sinh ảnh',
};

function render(done: number, total: number) {
  const n = (k: string) => rows.filter((r) => r.used === k).length;
  root.innerHTML = `
    <h1>Đo đường nâng chất hình — hình đề thật</h1>
    <p class="sum">${done}/${total} hình · TikZ thắng <b>${n('tikz')}</b> ·
      AI sinh <b>${n('genai')}</b> · giữ ảnh cắt <b>${n('crop')}</b></p>
    <table>
      <thead><tr><th>hình</th><th>kết quả</th><th>các bước đã thử</th>
      <th>ảnh cắt</th><th>bản mới</th></tr></thead>
      <tbody>${rows
        .map(
          (r) => `<tr>
        <td><code>${r.id}</code><br><span class="dim">${r.num !== null ? `câu ${r.num}` : ''}${
          r.hadContext ? ' · có đề' : ' · KHÔNG có đề'
        }</span></td>
        <td>${r.used === 'crop' ? `<span class="bad-txt">${LABEL.crop}</span>` : LABEL[r.used]}
          <br><span class="dim">${r.ms}ms</span></td>
        <td class="dim">${r.tried
          .map((t) => `${t.step}: ${t.ok ? 'ĐẠT' : 'thua'} — ${esc(t.why)}`)
          .join('<br>')}</td>
        <td><img src="${r.cropPng}"></td>
        <td>${r.outPng ? `<img src="${r.outPng}">` : '<span class="dim">—</span>'}</td>
      </tr>`,
        )
        .join('')}</tbody>
    </table>`;
}

async function main() {
  const jobs: Job[] = JSON.parse(decodeURIComponent(params.get('jobs') ?? '[]'));
  render(0, jobs.length);
  const tAll = performance.now();

  // Chạy song song ĐÚNG mức app dùng, để wall-clock đo được ở đây là con số người dùng chờ.
  const concurrency = Math.max(1, Number(params.get('conc') ?? 2));
  let next = 0;

  const runOne = async (job: Job) => {
    const bytes = new Uint8Array(await (await fetch(job.url)).arrayBuffer());
    const crop = { bytes, ...pngSize(bytes), source: 'crop' as const };
    let out: { bytes: Uint8Array } | null = null;

    const t0 = performance.now();
    const outcome = await upgradeFigure({
      id: job.id,
      crop,
      kind: job.kind,
      context: job.context ? { text: job.context, scope: 'cau', num: job.num } : undefined,
      apiKey,
      allowGen,
      log: (l) => logs.push(l),
      onCommit: (fig) => {
        out = fig;
      },
    });
    const ms = Math.round(performance.now() - t0);

    const row: Row = {
      ...outcome,
      ms,
      cropPng: toDataUrl(bytes),
      outPng: out ? toDataUrl((out as { bytes: Uint8Array }).bytes) : null,
    };
    rows.push(row);
    render(rows.length, jobs.length);
    await post('/case', row);
  };

  const worker = async () => {
    while (next < jobs.length) await runOne(jobs[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));

  const wallMs = Math.round(performance.now() - tAll);
  (window as unknown as { __figureProbeDone: boolean }).__figureProbeDone = true;
  await post('/done', { total: jobs.length, logs, wallMs, concurrency });
}

void main();
