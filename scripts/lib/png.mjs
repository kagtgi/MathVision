/**
 * Dựng PNG thật cho harness — đủ hợp lệ để `pngSize()` đọc IHDR và Word mở được.
 *
 * Vì sao phải là PNG THẬT chứ không phải vài byte giả: `pngSize` (`mmdToDocx.ts`) đọc THẲNG
 * offset 16/20 mà không kiểm signature, và `ImageRun({ type: 'png' })` đóng đuôi `.png` lên bất
 * cứ thứ gì — nên một fixture giả sẽ cho `transformation` rác mà harness vẫn "đạt".
 *
 * Ba harness cần đúng hàm này (`verify-history`, `verify-solver-shape`, `verify-vdc`), nên nó
 * nằm ở đây thay vì được chép ba lần.
 */

import zlib from 'node:zlib';

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** PNG xám w×h, mỗi hàng một byte filter + w byte pixel. `seed` để hai hình khác bytes. */
export function makePng(w, h, seed = 0) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w + 1)] = 0;
    for (let x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = (x * 7 + y * 13 + seed * 31) & 0xff;
  }
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', zlib.deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}
