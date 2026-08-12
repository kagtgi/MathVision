/**
 * Lược đồ lịch sử chuyển đổi.
 *
 * Mục tiêu duy nhất: mở lại một lần chuyển cũ và **xuất Word ra y như cũ, không tốn thêm một
 * lượt gọi API nào**.
 *
 * VÌ SAO TÁCH THÀNH BA TẦNG FILE (index / entry / figures):
 * `PDF_RENDER_SCALE = 2` nên một trang A4 render ra ~1190×1684 px, mỗi hình cắt 150-400 KB.
 * Đề 20 trang chục hình là 2-6 MB PNG, so với 50-400 KB của MMD. Hai hệ quả:
 *   (a) KHÔNG BAO GIỜ base64 hình vào JSON — vừa phình 33% vừa buộc parse cả khối chỉ để đọc
 *       một dòng danh sách;
 *   (b) KHÔNG BAO GIỜ ghi lại hình khi người dùng sửa MMD — nếu ghi cả file mỗi lần đổi thì
 *       mỗi nhịp debounce là 5 MB ra đĩa.
 * Tách ra thì sửa MMD chỉ ghi `entry.json` (~300 KB) cộng một dòng index.
 */

import type { QcIssue } from '../pipeline/qc.ts';
import type { FigureSource } from '../pipeline/figures.ts';
import type { WordOptionsValue } from '../pipeline/wordOptions.ts';
import type { PipelineToggles } from '../components/OptionToggles.tsx';

export const HISTORY_SCHEMA_VERSION = 1;

export type HistoryMode = 'pdf-to-word' | 'image-to-word';

/** Trần lưu trữ. Prune chạy trong tiến trình main vì main sở hữu đĩa. */
export const MAX_ENTRIES = 40;
export const MAX_TOTAL_BYTES = 250 * 1024 * 1024;
/** Vượt ngưỡng này thì lưu chỉ-văn-bản, và UI phải NÓI RÕ là thiếu hình. */
export const MAX_ENTRY_BYTES = 40 * 1024 * 1024;

/** Chỉ những gì DANH SÁCH cần — nằm trong index.json nên phải nhỏ. */
export interface HistoryPreview {
  /** Nguồn DUY NHẤT cho tên file .docx khi mở lại. */
  fileName: string;
  mode: HistoryMode;
  pageCount: number;
  /** <=160 ký tự, đã bỏ math và markdown. */
  excerpt: string;
  /** <=4000 ký tự, đã hạ chữ thường, để tìm kiếm. */
  searchText: string;
  format: string;
  figureCount: number;
  errorCount: number;
  warnCount: number;
  hasThumb: boolean;
  figuresOmitted: boolean;
}

export interface HistoryIndexRow {
  id: string;
  createdAt: number;
  updatedAt: number;
  /** Tổng dung lượng thư mục entry, để prune. */
  bytes: number;
  schema: number;
  /** `main.cjs` KHÔNG parse khối này, chỉ chuyển tiếp nguyên xi. */
  preview: HistoryPreview;
}

export interface HistoryFigureRecord {
  /** Khoá trong FigureMap, đúng như MMD tham chiếu (không có dấu `#`). */
  id: string;
  /**
   * Tên file do CHỈ MỤC sinh (`fig-0.png`), KHÔNG BAO GIỜ lấy từ `id`.
   * Id do model sinh ra: nhánh JSON dự phòng của `prompts.ts` từng nhận mọi chuỗi, kể cả
   * `../evil`, nên dùng id làm tên file là mở đường ghi ra ngoài thư mục.
   */
  file: string;
  w: number;
  h: number;
  source: FigureSource;
  bytes: number;
  sha256?: string;
}

/** entry.json — phần nặng, CHỈ đọc khi mở lại một mục. */
export interface HistoryManifest {
  schema: number;
  id: string;
  createdAt: number;
  updatedAt: number;
  mode: HistoryMode;
  fileName: string;
  pageCount: number;
  /** NGUỒN CHÂN LÝ: đúng chuỗi đang nằm trong ô soạn thảo lúc lưu. */
  mmd: string;
  notes: string[];
  issues: QcIssue[];
  /** BẮT BUỘC: `onMmdChange` truyền lại vào `recheck`, thiếu là mất cảnh báo hai lượt lệch. */
  disagreements: string[];
  wordOptions: WordOptionsValue;
  toggles: PipelineToggles;
  figures: HistoryFigureRecord[];
  figuresOmitted: boolean;
  meta?: { models?: string[]; durationMs?: number; appVersion?: string };
}

/** Một hình khi đọc/ghi qua cầu nối: bytes đi riêng, không nhồi vào JSON. */
export interface HistoryFigureBlob {
  file: string;
  bytes: Uint8Array;
}
