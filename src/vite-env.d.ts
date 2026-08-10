/// <reference types="vite/client" />

/**
 * Cầu nối do electron/preload.cjs cài vào. Chỉ có trong bản đóng gói; chạy trong trình
 * duyệt lúc phát triển thì `undefined`, nên chỗ dùng phải kiểm tra trước.
 */
interface MathVisionBridge {
  saveFile(
    suggestedName: string,
    data: Uint8Array,
  ): Promise<{ ok: boolean; path?: string; error?: string; canceled?: boolean }>;
}

interface Window {
  mathvision?: MathVisionBridge;
}
