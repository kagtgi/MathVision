/**
 * Xem trước ĐÚNG file Word sắp tải về.
 *
 * Trước đây tab xem trước dựng lại từ markdown, nên nó cho thấy NỘI DUNG chứ không cho
 * thấy ĐỊNH DẠNG: không có "Câu N." đậm xanh, không thấy bốn phương án nằm cùng dòng
 * theo tab, không thấy đáp án bôi vàng, không thấy lề và khổ giấy. Người dùng muốn nhìn
 * thấy thành phẩm nên bản này dựng thẳng từ file .docx vừa sinh ra — cùng một hàm dùng
 * cho nút Tải, nên cái nhìn thấy đúng là cái tải về.
 *
 * Một điều chỉnh so với file thật: công thức trong docx đang ở dạng chữ `${...}$` (chờ
 * MathType chuyển sau khi tải). Để soát bài được, ở đây thay chúng bằng công thức đã
 * render. Đó là khác biệt CÓ CHỦ Ý duy nhất, và cũng chính là thứ người dùng sẽ thấy sau
 * khi chạy Toggle TeX.
 */

import { renderAsync } from 'docx-preview';

import { loadMathpixRenderer, renderInlineMath } from './mathpixPreview.ts';

/** Công thức lặp lại rất nhiều trong một đề (đề + phần đáp án) nên nhớ lại cho nhanh. */
const mathCache = new Map<string, string>();

const MATH_RE = /\$([^$\n]+)\$/g;

/** Bỏ lớp `{}` mà braceMath thêm vào để chống MathType bỏ sót — chỉ để hiển thị. */
function unbrace(tex: string): string {
  const t = tex.trim();
  return t.startsWith('{') && t.endsWith('}') ? t.slice(1, -1) : t;
}

/**
 * Thay mọi `$...$` trong cây DOM bằng công thức đã render.
 * Duyệt text node để không phá cấu trúc đoạn/ô bảng mà docx-preview vừa dựng.
 */
function replaceMathInDom(root: HTMLElement): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    if (node.nodeValue && node.nodeValue.includes('$')) targets.push(node as Text);
    node = walker.nextNode();
  }

  for (const text of targets) {
    const src = text.nodeValue ?? '';
    MATH_RE.lastIndex = 0;
    if (!MATH_RE.test(src)) continue;
    MATH_RE.lastIndex = 0;

    const frag = document.createDocumentFragment();
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = MATH_RE.exec(src)) !== null) {
      if (m.index > last) frag.append(src.slice(last, m.index));
      const tex = unbrace(m[1]);
      let html = mathCache.get(tex);
      if (html === undefined) {
        html = renderInlineMath(tex);
        mathCache.set(tex, html);
      }
      const span = document.createElement('span');
      span.className = 'mv-math';
      if (html) span.innerHTML = html;
      else span.textContent = m[0]; // render hỏng thì để nguyên chữ, không nuốt nội dung
      frag.append(span);
      last = m.index + m[0].length;
    }
    if (last < src.length) frag.append(src.slice(last));
    text.replaceWith(frag);
  }
}

export interface DocxPreviewResult {
  ok: boolean;
  error?: string;
}

/**
 * Dựng bản xem trước vào `container`. Gọi lại được nhiều lần, tự xoá bản cũ.
 */
export async function renderDocxPreview(
  container: HTMLElement,
  blob: Blob,
): Promise<DocxPreviewResult> {
  container.replaceChildren();
  try {
    await renderAsync(blob, container, undefined, {
      className: 'docx',
      inWrapper: true,
      breakPages: true,
      renderHeaders: true,
      renderFooters: true,
      renderFootnotes: false,
      ignoreWidth: false,
      ignoreHeight: false,
      // Font trong docx là Times New Roman / Palatino Linotype — giữ nguyên để nhìn
      // đúng thành phẩm, đừng ép về font giao diện.
      useBase64URL: true,
      experimental: true,
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Không dựng được bản xem trước.' };
  }

  const ready = await loadMathpixRenderer();
  if (ready) {
    try {
      replaceMathInDom(container);
    } catch {
      // Thay công thức hỏng thì vẫn còn bản chữ `$...$` — không chặn xem trước.
    }
  }
  return { ok: true };
}
