/**
 * Tách dòng MMD thành đoạn math / text, và các tiện ích dùng chung.
 *
 * Port nguyên văn từ tools/mmd2docx.js (segmentLine, braceMath, cleanText, splitRow)
 * và tools/mmd_normalize.js (segmentLineDollarOnly). Regex và thứ tự xử lý được giữ
 * từng ký tự để output khớp với pipeline đã kiểm chứng trên 25 đề.
 */

export interface Segment {
  math: boolean;
  text: string;
}

/**
 * Bản đầy đủ (mmd2docx.js:23-54): hiểu cả `\(...\)`, `\[...\]`, `$...$`, `$$...$$`.
 * Escape `\x` đi theo cặp nên `\$` không bao giờ mở math.
 */
export function segmentLine(line: string): Segment[] {
  const segs: Segment[] = [];
  let buf = '';
  let i = 0;
  const push = (math: boolean) => {
    if (buf) segs.push({ math, text: buf });
    buf = '';
  };
  while (i < line.length) {
    const ch = line[i];
    if (ch === '\\' && i + 1 < line.length && (line[i + 1] === '(' || line[i + 1] === '[')) {
      const close = line[i + 1] === '(' ? '\\)' : '\\]';
      const end = line.indexOf(close, i + 2);
      if (end !== -1) {
        push(false);
        buf = line.slice(i, end + 2);
        push(true);
        i = end + 2;
        continue;
      }
    }
    if (ch === '$') {
      const dbl = line[i + 1] === '$';
      const delim = dbl ? '$$' : '$';
      const end = line.indexOf(delim, i + delim.length);
      if (end !== -1) {
        push(false);
        buf = line.slice(i, end + delim.length);
        push(true);
        i = end + delim.length;
        continue;
      }
    }
    if (ch === '\\' && i + 1 < line.length) {
      buf += ch + line[i + 1];
      i += 2;
      continue;
    }
    buf += ch;
    i += 1;
  }
  push(false);
  return segs;
}

/**
 * Bản chỉ hiểu `$`/`$$` (mmd_normalize.js:19-41). Normalizer dùng bản này, nên phải
 * giữ riêng — dùng nhầm bản đầy đủ sẽ đổi kết quả trên các dòng có `\(`.
 */
export function segmentLineDollarOnly(line: string): Segment[] {
  const segs: Segment[] = [];
  let buf = '';
  let i = 0;
  const push = (math: boolean) => {
    if (buf) segs.push({ math, text: buf });
    buf = '';
  };
  while (i < line.length) {
    const ch = line[i];
    if (ch === '$') {
      const dbl = line[i + 1] === '$';
      const delim = dbl ? '$$' : '$';
      const end = line.indexOf(delim, i + delim.length);
      if (end !== -1) {
        push(false);
        buf = line.slice(i, end + delim.length);
        push(true);
        i = end + delim.length;
        continue;
      }
    }
    if (ch === '\\' && i + 1 < line.length) {
      buf += ch + line[i + 1];
      i += 2;
      continue;
    }
    buf += ch;
    i += 1;
  }
  push(false);
  return segs;
}

/**
 * MathType Toggle TeX âm thầm bỏ qua run là ký hiệu ghép trần (`$X L$`, `$4 x$`),
 * bọc thêm một cặp ngoặc nhóm thì nhận. Chỉ áp dụng lúc sinh docx — file .mmd giữ sạch.
 */
export function braceMath(run: string): string {
  if (!run.startsWith('$') || run.startsWith('$$')) return run;
  const inner = run.slice(1, -1);
  return inner.startsWith('{') && inner.endsWith('}') ? run : '${' + inner + '}$';
}

export function cleanText(t: string): string {
  return t
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<\/?[a-zA-Z][^>]*>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\\section\*?\{([^}]*)\}/g, '$1')
    .replace(/\\subsection\*?\{([^}]*)\}/g, '$1')
    .replace(/\\title\{([^}]*)\}/g, '$1')
    .replace(/\\text(bf|it)\{([^}]*)\}/g, '$2');
}

/** Tách ô của một hàng pipe table; `|` bên trong `$...$` không phải dấu ngăn ô. */
export function splitRow(row: string): string[] {
  const cells: string[] = [];
  let buf = '';
  let inMath = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === '\\' && i + 1 < row.length) {
      buf += ch + row[i + 1];
      i++;
      continue;
    }
    if (ch === '$') {
      inMath = !inMath;
      buf += ch;
      continue;
    }
    if (ch === '|' && !inMath) {
      cells.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  cells.push(buf);
  if (cells.length && cells[0].trim() === '') cells.shift();
  if (cells.length && cells[cells.length - 1].trim() === '') cells.pop();
  return cells.map((c) => c.trim().replace(/\\\|/g, '|'));
}

export const isPipeRow = (l: string): boolean => /^\s*\|.*\|\s*$/.test(l);
export const isSeparatorRow = (l: string): boolean =>
  /^\s*\|?[\s:\-|]+\|?\s*$/.test(l) && l.includes('-');
