/**
 * Ảnh nhỏ cho danh sách lịch sử. Chỉ dùng DOM nên harness Node không import file này.
 *
 * Lệch có chủ ý so với OpenMathpix: nó dựng thumbnail ở main process bằng
 * `nativeImage…toJPEG(60)` vì đường chụp màn hình của nó nằm ở main. Ở đây canvas đã sẵn
 * trong renderer, nên downscale bằng canvas rồi lấy JPEG — khỏi thêm một IPC, cùng cỡ 8-20 KB.
 */

const THUMB_WIDTH = 200;
const THUMB_QUALITY = 0.6;

/**
 * PHẢI gọi TRONG `process()`, không phải lúc lưu.
 *
 * `canvases` là `Map` cục bộ bên trong `process()` và không được giữ vào ref nào, nên sau khi
 * `process()` trả về thì pixel trang đã mất — đọc lúc lưu là đọc vào chỗ trống.
 */
export async function canvasThumbJpeg(src: HTMLCanvasElement): Promise<Uint8Array | undefined> {
  try {
    const scale = Math.min(1, THUMB_WIDTH / src.width);
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(src.width * scale));
    out.height = Math.max(1, Math.round(src.height * scale));
    const ctx = out.getContext('2d');
    if (!ctx) return undefined;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(src, 0, 0, out.width, out.height);
    const blob = await new Promise<Blob | null>((r) => out.toBlob(r, 'image/jpeg', THUMB_QUALITY));
    if (!blob) return undefined;
    return new Uint8Array(await blob.arrayBuffer());
  } catch {
    // Thiếu ảnh nhỏ thì danh sách vẫn dùng được — đừng làm vỡ cả lượt lưu vì chuyện này.
    return undefined;
  }
}
