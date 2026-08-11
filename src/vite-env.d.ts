/// <reference types="vite/client" />

/**
 * Cầu nối do electron/preload.cjs cài vào. Chỉ có trong bản đóng gói; chạy trong trình
 * duyệt lúc phát triển thì `undefined`, nên chỗ dùng phải kiểm tra trước.
 */
interface UpdateState {
  /**
   * `idle` không có gì mới · `checking` đang hỏi · `downloading` đang tải (bản cài) ·
   * `ready` tải xong, chờ khởi động lại · `available-portable` có bản mới nhưng bản
   * portable không tự thay được, chỉ mở link tải.
   */
  status: 'idle' | 'checking' | 'downloading' | 'ready' | 'available-portable';
  /** Phiên bản mới, chỉ có khi status khác `idle`/`checking`. */
  version?: string;
  currentVersion?: string;
  percent?: number;
  url?: string;
  portable?: boolean;
}

interface MathVisionBridge {
  saveFile(
    suggestedName: string,
    data: Uint8Array,
  ): Promise<{ ok: boolean; path?: string; error?: string; canceled?: boolean }>;
  getVersion(): Promise<string>;
  getUpdateState(): Promise<UpdateState>;
  checkUpdates(): Promise<UpdateState>;
  applyUpdate(): Promise<{ ok: boolean; opened?: boolean; error?: string }>;
  /** Trả về hàm huỷ đăng ký. */
  onUpdateState(cb: (state: UpdateState) => void): () => void;
}

interface Window {
  mathvision?: MathVisionBridge;
}
