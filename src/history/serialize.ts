/**
 * Đổi `FigureMap` <-> bản ghi lịch sử. **Không dùng DOM** để harness Node import được — đó
 * chính là thứ chứng minh "mở lại xuất ra y như cũ".
 */

import type { FigureEntry, FigureMap } from '../pipeline/figures.ts';
import type { HistoryFigureBlob, HistoryFigureRecord, HistoryPreview } from './schema.ts';

/**
 * Tên file theo CHỈ MỤC, không theo id.
 *
 * Id hình do model sinh. Đường chính (`FIG_LINE`) giới hạn `[\w-]+`, nhưng nhánh JSON dự
 * phòng từng nhận mọi chuỗi kể cả `../evil` — dùng id làm tên file là mở đường ghi ra ngoài
 * thư mục lịch sử. Map id->file nằm trong manifest nên vẫn khôi phục đúng khoá.
 */
export function figureMapToRecords(map: FigureMap): {
  records: HistoryFigureRecord[];
  blobs: HistoryFigureBlob[];
} {
  const records: HistoryFigureRecord[] = [];
  const blobs: HistoryFigureBlob[] = [];
  let i = 0;
  for (const [id, fig] of map) {
    const file = `fig-${i}.png`;
    records.push({ id, file, w: fig.w, h: fig.h, source: fig.source, bytes: fig.bytes.length });
    blobs.push({ file, bytes: fig.bytes });
    i++;
  }
  return { records, blobs };
}

export function recordsToFigureMap(
  records: HistoryFigureRecord[],
  blobs: HistoryFigureBlob[],
): FigureMap {
  const byFile = new Map(blobs.map((b) => [b.file, b.bytes]));
  const map: FigureMap = new Map();
  for (const r of records) {
    const raw = byFile.get(r.file);
    if (!raw) continue;
    // Copy sang Uint8Array RIÊNG đúng cỡ. `pngSize` đọc qua
    // `new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)` và `ImageRun` hash
    // `options.data`; cả hai đúng trên view, nhưng `fs.readFileSync` trả `Buffer` dùng chung
    // pool với các file nhỏ khác — một dòng copy làm chỗ dựa vào `.buffer` không còn mơ hồ.
    const bytes = new Uint8Array(raw.length);
    bytes.set(raw);
    const entry: FigureEntry = { bytes, w: r.w, h: r.h, source: r.source };
    map.set(r.id, entry);
  }
  return map;
}

/** Bỏ math, markdown, và dòng hình để lấy đoạn trích đọc được. */
export function plainExcerpt(mmd: string, max = 160): string {
  const text = mmd
    .replace(/!\[[^\]]*\]\([^)]*\)(\{[^}]*\})?/g, ' ')
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/\$[^$\n]*\$/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*|__/g, '')
    .replace(/^\s*\|.*$/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length <= max ? text : text.slice(0, max - 1).trimEnd() + '…';
}

export function buildPreview(input: {
  fileName: string;
  mode: HistoryPreview['mode'];
  pageCount: number;
  mmd: string;
  format: string;
  figureCount: number;
  errorCount: number;
  warnCount: number;
  hasThumb: boolean;
  figuresOmitted: boolean;
}): HistoryPreview {
  return {
    fileName: input.fileName,
    mode: input.mode,
    pageCount: input.pageCount,
    excerpt: plainExcerpt(input.mmd),
    searchText: (input.fileName + ' ' + plainExcerpt(input.mmd, 4000)).toLowerCase(),
    format: input.format,
    figureCount: input.figureCount,
    errorCount: input.errorCount,
    warnCount: input.warnCount,
    hasThumb: input.hasThumb,
    figuresOmitted: input.figuresOmitted,
  };
}

/** Tổng dung lượng hình, để so với `MAX_ENTRY_BYTES` trước khi quyết định lưu kèm hình. */
export const totalFigureBytes = (map: FigureMap): number => {
  let n = 0;
  for (const f of map.values()) n += f.bytes.length;
  return n;
};
