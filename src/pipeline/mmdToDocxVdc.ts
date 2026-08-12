/**
 * MMD -> .docx theo chuẩn nhóm VDC Bhp.
 *
 * Toàn bộ hằng số dưới đây ĐO TRỰC TIẾP từ hai file mẫu của người dùng
 * (`16-18_Mitu.docx`, `65-68_Mitu.docx`) bằng cách đọc `word/document.xml`:
 *
 *   trang       A4 11907x16840, lề 850 bốn phía, header 340, footer 340
 *   header      1 đoạn, canh trái, Palatino Linotype sz 20:
 *               "Thực hiện bởi " + đậm "Group 11 VDC Bhp 2027"; KHÔNG có footer
 *   thân        Palatino Linotype sz 23 (11.5pt)
 *   đề bài      ind 0 firstLine 0, contextualSpacing, canh đều, nền C5E0B3 phủ cả khối đề
 *               (đoạn câu + các dòng nối + ý a)-d), KHÔNG phủ lời giải);
 *               đoạn câu: after 0, line 276 auto, tab trái 900/1170
 *               -> nhãn "Câu N." bằng NUMBERING, xem `cauNumbering.ts`
 *   phương án   MỘT đoạn, ind 900, after 0, line 276 auto, canh đều,
 *               tab trái 3330 / 6030 / 8370; chữ cái đậm xanh 0000FF
 *               đáp án đúng: đậm ĐỎ FF0000 + highlight vàng + gạch chân,
 *               highlight phủ cả nội dung và dấu chấm cuối
 *   "Lời giải"  canh giữa, đậm xanh, ind 992, after 0, line 276
 *   thân giải   ind 720, canh đều, line 276
 *   đúng/sai    dòng RIÊNG "a) SAI" đậm xanh + highlight vàng, ind 720, after 120,
 *               chữ ĐÚNG/SAI viết HOA; giải thích xuống đoạn dưới
 *   trả lời ngắn bảng 1 hàng x 4 ô, mỗi ô rộng 360, viền đơn đen, nền FFFF00,
 *               chữ đậm đỏ FF0000, MỘT ký tự mỗi ô
 *
 * Không có dòng "Chọn X." — đáp án đúng được đánh dấu ngay trên phương án.
 *
 * SỬA 1.1.0 — nhãn "Câu N.": bản trước ghi "chuẩn VDC KHÔNG in Câu N." và bỏ hẳn nhãn. Đó
 * là LỖI ĐO: phép đo cũ đọc text của `document.xml`, mà nhãn nằm trong `numbering.xml` nên
 * không thấy. Đo lại `K11_Tuan1.docx` (0 lần `>Câu N` / 50 `<w:numPr>`) và `65-68_Mitu.docx`
 * (0 / 4, `w:start=65`) thì cả hai đều CÓ nhãn, dạng numbering, Palatino sz23 đậm 0000FF,
 * `ind left=992 hanging=992`.
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  Header,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TabStopType,
  TextRun,
  WidthType,
} from 'docx';

import { optionsPerLine, parseMmdBlocks } from './mmdBlocks.ts';
import {
  buildTable,
  isEmptyParagraph,
  lineToRuns,
  makeImageParagraph,
  type FigureResolver,
  type RunStyle,
} from './mmdToDocx.ts';
import {
  cauNumberingConfig,
  EMPTY_CAU_PLAN,
  planCauNumbering,
  type CauNumberingPlan,
} from './cauNumbering.ts';
import { fontPreset, type FontPreset } from './fonts.ts';

const DEFAULT_FONT = fontPreset('palatino');
const BLUE = '0000FF';
const RED = 'FF0000';
const YELLOW = 'FFFF00';
/** Nền xanh lá nhạt phủ khối đề, đo từ `65-68_Mitu.docx`. */
const STEM_FILL = 'C5E0B3';

const BODY_SPACING = { after: 120, line: 240, lineRule: 'auto' as const };
const CAU_SPACING = { after: 0, line: 276, lineRule: 'auto' as const };
const OPTION_SPACING = { after: 0, line: 276, lineRule: 'auto' as const };
const SOL_SPACING = { after: 0, line: 276, lineRule: 'auto' as const };
const SOL_INDENT = { left: 720 };

const STEM_SHADING = { type: ShadingType.CLEAR, color: 'auto', fill: STEM_FILL } as const;

/** Header mặc định; người dùng đổi được ở UI. */
export const VDC_HEADER_DEFAULT = { plain: 'Thực hiện bởi ', bold: 'Group 11 VDC Bhp 2027' };

const NO_FIGURES: FigureResolver = () => null;

function bodyParagraph(children: TextRun[], shaded = false): Paragraph {
  return new Paragraph({
    spacing: BODY_SPACING,
    alignment: AlignmentType.JUSTIFIED,
    indent: { left: 0, firstLine: 0 },
    contextualSpacing: true,
    tabStops: [{ type: TabStopType.LEFT, position: 851 }],
    ...(shaded ? { shading: STEM_SHADING } : {}),
    children,
  });
}

function solutionParagraph(children: TextRun[]): Paragraph {
  return new Paragraph({
    spacing: SOL_SPACING,
    indent: SOL_INDENT,
    alignment: AlignmentType.JUSTIFIED,
    children,
  });
}

/**
 * Ô đáp án của câu trả lời ngắn: mỗi ký tự một ô, đúng 4 ô như file mẫu.
 * Đáp số dài hơn 4 ký tự thì nới thêm ô cho khỏi mất chữ, ngắn hơn thì để ô trống.
 */
function answerBox(value: string, font: FontPreset): Table {
  const chars = [...value.replace(/\s/g, '')];
  const cellCount = Math.max(4, chars.length);
  const cells = Array.from({ length: cellCount }, (_, i) => {
    return new TableCell({
      width: { size: 360, type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, color: 'auto', fill: YELLOW },
      children: [
        new Paragraph({
          spacing: { line: 276, lineRule: 'auto' },
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({
              text: chars[i] ?? '',
              bold: true,
              color: RED,
              font: font.name,
              size: font.size,
            }),
          ],
        }),
      ],
    });
  });
  return new Table({
    width: { size: 360 * cellCount, type: WidthType.DXA },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
      left: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
      right: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
      insideVertical: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
    },
    rows: [new TableRow({ children: cells })],
  });
}

export function mmdToVdcChildren(
  mmd: string,
  resolveFigure: FigureResolver,
  cauPlan: CauNumberingPlan = EMPTY_CAU_PLAN,
  font: FontPreset = DEFAULT_FONT,
): Array<Paragraph | Table> {
  const children: Array<Paragraph | Table> = [];
  const optionStyle = (correct: boolean): RunStyle =>
    correct ? { bold: true, color: RED, highlight: 'yellow' } : { bold: true, color: BLUE };

  /**
   * Nền C5E0B3 phủ từ đoạn câu tới hết phần đề bài. Trong file mẫu, khối tô gồm đoạn câu,
   * các dòng nối tiếp của đề và các ý a)-d); phương án và lời giải KHÔNG tô. Nên cờ này bật
   * ở `cau` và tắt ở mốc cấu trúc kế tiếp.
   */
  let inStem = false;

  const blocks = parseMmdBlocks(mmd);
  for (let bi = 0; bi < blocks.length; bi++) {
    const b = blocks[bi];
    if (
      b.kind === 'options' ||
      b.kind === 'loiGiai' ||
      b.kind === 'heading' ||
      b.kind === 'phan' ||
      b.kind === 'dapSo'
    ) {
      inStem = false;
    }
    switch (b.kind) {
      case 'raw':
        children.push(bodyParagraph([new TextRun({ text: b.line })]));
        break;

      case 'table':
        children.push(buildTable(b.rows, b.headerBold), new Paragraph({ children: [] }));
        break;

      case 'image': {
        // Hình trong khối ĐỀ phải TÔ NỀN cùng khối. Bản trước không tô, mà `image` cũng không
        // reset `inStem`, nên nền C5E0B3 bị chẻ thành hai dải xanh với một khe TRẮNG ở giữa —
        // xảy ra với cả 6 hình của 25 đề golden khi chọn định dạng này, và `verify-vdc` chỉ có
        // một assert `w:fill="C5E0B3"` nên không thấy.
        // ĐO trên 6 file mẫu VDC (K11_Tuan1-2, K12_Tuan1-4): 29/29 đoạn ảnh nằm giữa hai đoạn
        // đã tô thì ĐỀU có nền. Không đoán, không suy từ phần chữ của document.xml.
        // Hình trong LỜI GIẢI thì thụt theo cột lời giải và không tô, giống chữ quanh nó.
        const p = b.inSolution
          ? makeImageParagraph(b.ref, resolveFigure, {
              spacing: { ...SOL_SPACING, before: 80, after: 80 },
              indent: SOL_INDENT,
            })
          : makeImageParagraph(b.ref, resolveFigure, {
              spacing: BODY_SPACING,
              ...(inStem ? { shading: STEM_SHADING } : {}),
            });
        if (p) children.push(p);
        else {
          const runs = lineToRuns(b.line);
          if (runs.length) children.push(bodyParagraph(runs));
        }
        break;
      }

      case 'heading':
        children.push(
          new Paragraph({
            spacing: BODY_SPACING,
            alignment:
              b.level === 1 || b.isDapAn ? AlignmentType.CENTER : AlignmentType.JUSTIFIED,
            ...(b.isDapAn ? { pageBreakBefore: true } : {}),
            children: lineToRuns(b.text, { bold: true, color: b.isPhan ? RED : undefined }),
          }),
        );
        break;

      case 'phan':
        children.push(
          new Paragraph({
            spacing: BODY_SPACING,
            alignment: AlignmentType.JUSTIFIED,
            children: lineToRuns(b.text, { bold: true, color: RED }),
          }),
        );
        break;

      case 'loiGiai':
        children.push(
          new Paragraph({
            spacing: SOL_SPACING,
            indent: { left: 992 },
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: 'Lời giải', bold: true, color: BLUE })],
          }),
        );
        break;

      // File mẫu VDC không có dòng "Chọn X." — đáp án đúng đã bôi trên phương án.
      case 'chon':
        break;

      case 'dapSo':
        children.push(answerBox(b.value, font), new Paragraph({ children: [] }));
        break;

      case 'options': {
        const perLine = optionsPerLine(b.opts);
        for (let k = 0; k < b.opts.length; k += perLine) {
          const chunk = b.opts.slice(k, k + perLine);
          const runs: TextRun[] = [];
          chunk.forEach((o, idx) => {
            if (idx > 0) runs.push(new TextRun({ text: '\t' }));
            runs.push(
              new TextRun({
                text: `${o.letter}. `,
                ...optionStyle(o.correct),
                ...(o.correct ? { underline: {} } : {}),
              }),
            );
            // Highlight phủ luôn nội dung và dấu chấm cuối, y như file mẫu.
            runs.push(...lineToRuns(o.body, o.correct ? { highlight: 'yellow' } : {}));
          });
          children.push(
            new Paragraph({
              spacing: OPTION_SPACING,
              indent: { left: 900 },
              alignment: AlignmentType.JUSTIFIED,
              tabStops: [
                { type: TabStopType.LEFT, position: 3330 },
                { type: TabStopType.LEFT, position: 6030 },
                { type: TabStopType.LEFT, position: 8370 },
              ],
              children: runs,
            }),
          );
        }
        break;
      }

      case 'cau': {
        inStem = true;
        const runs = lineToRuns(b.rest);
        const reference = cauPlan.refOf(bi);
        if (reference) {
          children.push(
            new Paragraph({
              numbering: { reference, level: 0 },
              spacing: CAU_SPACING,
              alignment: AlignmentType.JUSTIFIED,
              indent: { left: 0, firstLine: 0 },
              contextualSpacing: true,
              shading: STEM_SHADING,
              tabStops: [
                { type: TabStopType.LEFT, position: 900 },
                { type: TabStopType.LEFT, position: 1170 },
              ],
              children: runs,
            }),
          );
          break;
        }
        // Dãy không đánh số được: in nhãn thành chữ, cùng kiểu đậm xanh như level numbering.
        children.push(
          bodyParagraph(
            [new TextRun({ text: b.prefix + ' ', bold: true, color: BLUE }), ...runs],
            true,
          ),
        );
        break;
      }

      case 'verdict': {
        children.push(
          new Paragraph({
            spacing: { after: 120 },
            indent: SOL_INDENT,
            alignment: AlignmentType.JUSTIFIED,
            children: [
              new TextRun({
                text: `${b.label}) ${b.dung ? 'ĐÚNG' : 'SAI'}`,
                bold: true,
                color: BLUE,
                highlight: 'yellow',
              }),
            ],
          }),
        );
        if (b.explain) children.push(solutionParagraph(lineToRuns(b.explain)));
        break;
      }

      case 'text': {
        const runs = lineToRuns(b.line);
        if (runs.length) {
          children.push(
            b.inSolution ? solutionParagraph(runs) : bodyParagraph(runs, inStem),
          );
        }
        break;
      }
    }
  }

  while (children.length && children[0] instanceof Paragraph && isEmptyParagraph(children[0])) {
    children.shift();
  }
  while (
    children.length &&
    children[children.length - 1] instanceof Paragraph &&
    isEmptyParagraph(children[children.length - 1] as Paragraph)
  ) {
    children.pop();
  }
  return children;
}

export interface VdcDocxOptions {
  headerText?: { plain: string; bold: string };
  /** Preset font; mặc định Palatino Linotype 11.5 như file mẫu. */
  font?: FontPreset;
  /** Số câu bắt đầu do người dùng nhập — xem `PlanOptions.startNumber`. */
  startNumber?: number;
  /** Tắt numbering (dự phòng cho harness so sánh); mặc định BẬT. */
  autoNumberCau?: boolean;
}

export function buildVdcDocx(
  mmd: string,
  resolveFigure: FigureResolver = NO_FIGURES,
  opts: VdcDocxOptions = {},
): Document {
  const headerText = opts.headerText ?? VDC_HEADER_DEFAULT;
  const font = opts.font ?? DEFAULT_FONT;
  const plan =
    opts.autoNumberCau === false
      ? EMPTY_CAU_PLAN
      : planCauNumbering(parseMmdBlocks(mmd), { startNumber: opts.startNumber });
  const children = mmdToVdcChildren(mmd, resolveFigure, plan, font);
  return new Document({
    styles: { default: { document: { run: { font: font.name, size: font.size } } } },
    numbering: cauNumberingConfig(plan.runs, {
      font: font.name,
      size: font.size,
      color: BLUE,
    }),
    sections: [
      {
        properties: {
          page: {
            size: { width: 11907, height: 16840 },
            margin: { top: 850, right: 850, bottom: 850, left: 850, header: 340, footer: 340, gutter: 0 },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                children: [
                  new TextRun({ text: headerText.plain, size: 20, font: font.name }),
                  new TextRun({ text: headerText.bold, bold: true, size: 20, font: font.name }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
}
