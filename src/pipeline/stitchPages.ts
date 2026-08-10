/**
 * Ghép MMD của từng trang thành một tài liệu liền mạch.
 *
 * Prompt đã dặn mô hình bỏ header/footer trang và nối tiếp câu bị cắt trang, nhưng
 * đây là lưới an toàn: mô hình vẫn hay (a) chép lại số trang, (b) nhắc lại đuôi ngữ
 * cảnh ta vừa gửi, (c) lặp lại hàng tiêu đề của bảng bị cắt sang trang mới.
 */

const PAGE_FURNITURE: RegExp[] = [
  /^Trang\s*\d+\s*(?:\/\s*\d+)?$/i,
  /^Page\s*\d+\s*(?:\/\s*\d+)?$/i,
  /^\d+\s*\/\s*\d+$/,
  /^-{1,3}\s*\d+\s*-{1,3}$/,
];

const isPipe = (l: string): boolean => /^\s*\|.*\|\s*$/.test(l);
const isSep = (l: string): boolean => /^\s*\|?[\s:\-|]+\|?\s*$/.test(l) && l.includes('-');
const squash = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase();

function dropFurniture(lines: string[]): string[] {
  return lines.filter((l) => {
    const t = l.trim();
    if (!t) return true;
    return !PAGE_FURNITURE.some((re) => re.test(t));
  });
}

/**
 * Mô hình nhận đuôi trang trước làm ngữ cảnh nên đôi khi chép lại chính đoạn đó.
 * Cắt phần đầu trang sau nếu nó trùng khít với đuôi phần đã có.
 */
function trimEchoedOverlap(acc: string, next: string, minLen = 30, maxLen = 900): string {
  const limit = Math.min(maxLen, acc.length, next.length);
  for (let k = limit; k >= minLen; k--) {
    if (acc.endsWith(next.slice(0, k))) return next.slice(k).replace(/^\n+/, '');
  }
  return next;
}

/**
 * Bảng bị cắt sang trang mới thường được in lại hàng tiêu đề. Nếu trang sau mở đầu
 * bằng đúng hàng tiêu đề + dòng phân cách của bảng đang dở thì bỏ hai dòng đó, các
 * hàng còn lại tự nối vào bảng cũ (mmd2docx gom mọi hàng pipe liên tiếp).
 */
function mergeSplitTable(accLines: string[], nextLines: string[]): string[] {
  let lastNonEmpty = accLines.length - 1;
  while (lastNonEmpty >= 0 && !accLines[lastNonEmpty].trim()) lastNonEmpty--;
  if (lastNonEmpty < 0 || !isPipe(accLines[lastNonEmpty])) return nextLines;

  let first = 0;
  while (first < nextLines.length && !nextLines[first].trim()) first++;
  if (first + 1 >= nextLines.length) return nextLines;
  if (!isPipe(nextLines[first]) || !isSep(nextLines[first + 1])) return nextLines;

  // Tìm hàng tiêu đề của bảng đang dở trong acc
  let head = lastNonEmpty;
  while (head > 0 && isPipe(accLines[head - 1])) head--;
  if (squash(accLines[head]) !== squash(nextLines[first])) return nextLines;

  const rest = nextLines.slice(first + 2);
  // Bỏ luôn dòng trắng vừa lộ ra giữa hai mảnh bảng
  while (rest.length && !rest[0].trim()) rest.shift();
  return rest;
}

/** Khối tiêu đề đề thi bị in lại ở giữa tài liệu (trang 2 lặp lại tên trường...). */
function dropRepeatedHeader(firstPageLines: string[], nextLines: string[]): string[] {
  const head = firstPageLines.filter((l) => l.trim()).slice(0, 3).map(squash);
  if (head.length < 2) return nextLines;

  const out = [...nextLines];
  let matched = 0;
  let idx = 0;
  while (idx < out.length && matched < head.length) {
    const t = out[idx].trim();
    if (!t) {
      idx++;
      continue;
    }
    if (squash(t) !== head[matched]) break;
    matched++;
    idx++;
  }
  return matched >= 2 ? out.slice(idx) : out;
}

export interface StitchResult {
  mmd: string;
  notes: string[];
}

export function stitchPages(pages: string[]): StitchResult {
  const notes: string[] = [];
  const cleaned = pages.map((p) => dropFurniture(p.replace(/\r\n/g, '\n').split('\n')));

  let accLines: string[] = cleaned[0] ? [...cleaned[0]] : [];
  const firstPageLines = accLines;

  for (let i = 1; i < cleaned.length; i++) {
    let nextLines = cleaned[i];

    const beforeHeader = nextLines.length;
    nextLines = dropRepeatedHeader(firstPageLines, nextLines);
    if (nextLines.length !== beforeHeader) notes.push(`Trang ${i + 1}: bỏ tiêu đề đề thi lặp lại.`);

    const beforeTable = nextLines.length;
    nextLines = mergeSplitTable(accLines, nextLines);
    if (nextLines.length !== beforeTable) notes.push(`Trang ${i + 1}: nối bảng bị cắt trang.`);

    const acc = accLines.join('\n').replace(/\n+$/, '');
    const nextText = nextLines.join('\n').replace(/^\n+/, '');
    const trimmed = trimEchoedOverlap(acc, nextText);
    if (trimmed !== nextText) notes.push(`Trang ${i + 1}: bỏ đoạn chép lặp từ ngữ cảnh trang trước.`);

    const joiner = trimmed.startsWith('|') && acc.endsWith('|') ? '\n' : '\n\n';
    accLines = (acc + (trimmed ? joiner + trimmed : '')).split('\n');
  }

  const mmd = accLines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '') + '\n';
  return { mmd, notes };
}
