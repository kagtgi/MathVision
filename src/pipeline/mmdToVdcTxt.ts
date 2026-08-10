/**
 * MMD -> .txt theo skill "vn-exam-extractor".
 *
 * Đây là bản giao cho nhóm nhập liệu, nên tuân đúng các luật của skill:
 *   - bỏ nhãn "Câu N."
 *   - phương án dùng dấu chấm, MỖI ĐÁP ÁN MỘT DÒNG (khác docx: docx dồn 4 phương án
 *     một dòng bằng tab, còn .txt thì tách dòng)
 *   - ý đúng/sai dùng `a)` `b)` `c)` `d)`
 *   - giữa hai câu đúng một dòng trống
 *   - bỏ header/footer, bảng đáp án tổng hợp, phiếu tô
 *   - hình vẽ ghi chú `[Hình vẽ: ...]` tại đúng vị trí
 *
 * Quy ước LaTeX (`{A}'`, `${O}xyz$`, `\int\limits`, `\left`/`\right`) do
 * applyVdcLatex lo trước khi gọi hàm này.
 */

import { parseMmdBlocks } from './mmdBlocks.ts';

/** Bảng markdown -> text thẳng hàng, vì .txt không có bảng. */
function tableToText(rows: string[][]): string[] {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 0, cell.length);
    });
  }
  return rows.map((row) => row.map((c, i) => c.padEnd(widths[i] ?? 0)).join('  ').trimEnd());
}

export function mmdToVdcTxt(mmd: string): string {
  const out: string[] = [];
  /** Chèn đúng một dòng trống, không bao giờ hai. */
  const blank = () => {
    if (out.length && out[out.length - 1] !== '') out.push('');
  };

  for (const b of parseMmdBlocks(mmd)) {
    switch (b.kind) {
      case 'cau':
        // Câu mới: cách câu trước một dòng trống, bỏ nhãn "Câu N.".
        blank();
        if (b.rest.trim()) out.push(b.rest.trim());
        break;

      case 'options':
        for (const o of b.opts) out.push(`${o.letter}. ${o.body}`);
        break;

      case 'verdict':
        out.push(`${b.label}) ${b.dung ? 'ĐÚNG' : 'SAI'}${b.explain ? '. ' + b.explain : ''}`);
        break;

      case 'image':
        out.push('[Hình vẽ]');
        break;

      case 'table':
        blank();
        out.push(...tableToText(b.rows));
        blank();
        break;

      case 'heading':
        blank();
        out.push(b.text);
        blank();
        break;

      case 'phan':
        blank();
        out.push(b.text);
        blank();
        break;

      case 'loiGiai':
        out.push('Lời giải');
        break;

      case 'dapSo':
        out.push(`Đáp số: ${b.value}`);
        break;

      // Chuẩn VDC không có dòng "Chọn X." trong bản giao.
      case 'chon':
        break;

      case 'raw':
      case 'text':
        if (b.line.trim()) out.push(b.line.trim());
        break;
    }
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
