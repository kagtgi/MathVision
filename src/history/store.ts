/**
 * Mặt tiền lịch sử cho renderer.
 *
 * Chọn kho bằng cách hỏi **method có tồn tại không** (`typeof historySave === 'function'`),
 * KHÔNG dò user-agent. Hai lý do: bản đóng gói CŨ có cầu nối nhưng chưa có mấy hàm lịch sử
 * nên không được rơi vào nhánh sai; và bản web thì không có lịch sử, nút phải ẩn hẳn.
 *
 * (Cũng may là chọn theo method — cửa sổ nạp bằng `win.loadFile` nên origin là `file://`, mà
 * Chromium coi `file://` là opaque với IndexedDB và `indexedDB.open` có thể throw
 * `SecurityError`. Nếu sau này đổi sang `loadURL('app://…')` thì câu trả lời khác.)
 */

import type { FigureMap } from '../pipeline/figures.ts';
import type { QcIssue } from '../pipeline/qc.ts';
import { normalizeToggles, type PipelineToggles } from '../pipeline/toggles.ts';
import { normalizeWordOptions, type WordOptionsValue } from '../pipeline/wordOptions.ts';
import {
  HISTORY_SCHEMA_VERSION,
  MAX_ENTRY_BYTES,
  type HistoryIndexRow,
  type HistoryManifest,
  type HistoryMode,
} from './schema.ts';
import {
  buildPreview,
  figureMapToRecords,
  recordsToFigureMap,
  totalFigureBytes,
} from './serialize.ts';

const bridge = () => {
  const b = window.mathvision;
  return b && typeof b.historySave === 'function' ? b : null;
};

export const historyAvailable = (): boolean => bridge() !== null;

/** Id đủ để không trùng trong một phiên, và khớp regex chặn đường dẫn ở main. */
function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface SaveInput {
  mode: HistoryMode;
  fileName: string;
  pageCount: number;
  mmd: string;
  notes: string[];
  issues: QcIssue[];
  disagreements: string[];
  wordOptions: WordOptionsValue;
  toggles: PipelineToggles;
  figures: FigureMap;
  /** JPEG trang đầu, sinh trong `process()` — xem ghi chú ở converter. */
  thumb?: Uint8Array;
  meta?: HistoryManifest['meta'];
}

/** Lưu một lượt chuyển vừa xong. Trả id, hoặc `null` nếu không lưu được. */
export async function save(input: SaveInput): Promise<string | null> {
  const b = bridge();
  if (!b) return null;

  const now = Date.now();
  const id = newId();

  // Vượt trần một mục thì lưu CHỈ VĂN BẢN, và nói rõ ra để UI cảnh báo trước khi xuất —
  // đừng âm thầm sinh file thiếu hình.
  const figuresOmitted = totalFigureBytes(input.figures) > MAX_ENTRY_BYTES;
  const { records, blobs } = figuresOmitted
    ? { records: [], blobs: [] }
    : figureMapToRecords(input.figures);

  const entry: HistoryManifest = {
    schema: HISTORY_SCHEMA_VERSION,
    id,
    createdAt: now,
    updatedAt: now,
    mode: input.mode,
    fileName: input.fileName,
    pageCount: input.pageCount,
    mmd: input.mmd,
    notes: input.notes,
    issues: input.issues,
    disagreements: input.disagreements,
    wordOptions: input.wordOptions,
    toggles: input.toggles,
    figures: records,
    figuresOmitted,
    meta: input.meta,
  };

  const res = await b.historySave({
    id,
    createdAt: now,
    updatedAt: now,
    schema: HISTORY_SCHEMA_VERSION,
    preview: buildPreview({
      fileName: input.fileName,
      mode: input.mode,
      pageCount: input.pageCount,
      mmd: input.mmd,
      format: input.wordOptions.format,
      figureCount: records.length,
      errorCount: input.issues.filter((i) => i.severity === 'error').length,
      warnCount: input.issues.filter((i) => i.severity === 'warn').length,
      hasThumb: Boolean(input.thumb?.length),
      figuresOmitted,
    }),
    entry,
    thumb: input.thumb,
    figures: blobs,
  });
  return res.ok ? id : null;
}

/**
 * Cập nhật khi người dùng sửa MMD hoặc đổi tuỳ chọn Word.
 * KHÔNG gửi lại bytes hình — đó là toàn bộ ý nghĩa của việc tách file.
 */
export async function update(
  id: string,
  patch: {
    mmd: string;
    issues: QcIssue[];
    wordOptions: WordOptionsValue;
  },
): Promise<boolean> {
  const b = bridge();
  if (!b) return false;
  const loaded = await b.historyLoad(id);
  if (!loaded.ok || !loaded.entryJson) return false;

  const entry = JSON.parse(loaded.entryJson) as HistoryManifest;
  const next: HistoryManifest = {
    ...entry,
    updatedAt: Date.now(),
    mmd: patch.mmd,
    issues: patch.issues,
    wordOptions: patch.wordOptions,
  };

  const res = await b.historyUpdate({
    id,
    updatedAt: next.updatedAt,
    preview: buildPreview({
      fileName: next.fileName,
      mode: next.mode,
      pageCount: next.pageCount,
      mmd: next.mmd,
      format: next.wordOptions.format,
      figureCount: next.figures.length,
      errorCount: next.issues.filter((i) => i.severity === 'error').length,
      warnCount: next.issues.filter((i) => i.severity === 'warn').length,
      hasThumb: true,
      figuresOmitted: next.figuresOmitted,
    }),
    entry: next,
  });
  return res.ok;
}

export interface RestoredConversion {
  id: string;
  createdAt: number;
  mode: HistoryMode;
  fileName: string;
  mmd: string;
  notes: string[];
  issues: QcIssue[];
  disagreements: string[];
  wordOptions: WordOptionsValue;
  toggles: PipelineToggles;
  figures: FigureMap;
  figuresOmitted: boolean;
}

export async function load(id: string): Promise<RestoredConversion | null> {
  const b = bridge();
  if (!b) return null;
  const res = await b.historyLoad(id);
  if (!res.ok || !res.entryJson) return null;
  const entry = JSON.parse(res.entryJson) as HistoryManifest;
  return {
    id: entry.id,
    createdAt: entry.createdAt,
    mode: entry.mode,
    fileName: entry.fileName,
    mmd: entry.mmd,
    notes: entry.notes ?? [],
    issues: entry.issues ?? [],
    disagreements: entry.disagreements ?? [],
    // Cùng lý do với `normalizeToggles`: mục lưu trước 1.3 không có `pageNumbers`, để trần thì
    // ô tích số trang nhận `checked={undefined}` và chết cứng.
    wordOptions: normalizeWordOptions(entry.wordOptions),
    // KHÔNG được để trần `entry.toggles`: mục cũ thiếu công tắc mới sinh sau nó, và
    // `OptionToggles` nhận `checked={undefined}` thì ô tích chết cứng. Xem `normalizeToggles`.
    toggles: normalizeToggles(entry.toggles),
    figures: recordsToFigureMap(entry.figures ?? [], res.figures ?? []),
    figuresOmitted: Boolean(entry.figuresOmitted),
  };
}

export async function list(): Promise<HistoryIndexRow[]> {
  const b = bridge();
  if (!b) return [];
  const res = await b.historyIndex();
  const rows = (res.rows ?? []) as HistoryIndexRow[];
  return rows.sort((a, b2) => b2.updatedAt - a.updatedAt);
}

export async function thumbs(ids: string[]): Promise<Map<string, string>> {
  const b = bridge();
  const out = new Map<string, string>();
  if (!b || !ids.length) return out;
  const res = await b.historyThumbs(ids);
  for (const t of res.thumbs ?? []) {
    const blob = new Blob([new Uint8Array(t.bytes)], { type: 'image/jpeg' });
    out.set(t.id, URL.createObjectURL(blob));
  }
  return out;
}

export const remove = (id: string) => bridge()?.historyDelete(id) ?? Promise.resolve({ ok: false });
export const clear = () => bridge()?.historyClear() ?? Promise.resolve({ ok: false });
export const stats = () =>
  bridge()?.historyStats() ??
  Promise.resolve({ ok: false, count: 0, bytes: 0, maxEntries: 0, maxBytes: 0 });
