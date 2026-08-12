/**
 * MMD -> .docx theo đúng chuẩn file mẫu K11-Đề-tặng-kèm-số-1_Đề-và-đact.docx.
 *
 * Port nguyên văn tools/mmd2docx.js (dòng 76-457). Mọi hằng số twip, màu, ngưỡng độ
 * dài phương án, tab stop được giữ từng ký tự — bản Node đã kiểm chứng trên 25 đề.
 *
 * KHÁC bản gốc đúng một điểm: bỏ khối `headers:` (yêu cầu của người dùng), giữ footer
 * "Trang {PAGE}".
 *
 * Ảnh: bản gốc đọc file từ đĩa; bản này nhận `resolveFigure` để lấy PNG từ bộ nhớ
 * (ảnh crop từ trang PDF hoặc hình TikZ vừa render).
 */

import {
  AlignmentType,
  Document,
  Footer,
  ImageRun,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TabStopType,
  TextRun,
  WidthType,
} from 'docx';

import { braceMath, cleanText, segmentLine } from './mmdSegment.ts';
import { optionsPerLine, parseMmdBlocks } from './mmdBlocks.ts';
import {
  cauNumberingConfig,
  EMPTY_CAU_PLAN,
  planCauNumbering,
  type CauNumberingPlan,
} from './cauNumbering.ts';
import { fontPreset, type FontPreset } from './fonts.ts';

const BLUE = '0000FF';
const RED = 'FF0000';

export interface FigureData {
  bytes: Uint8Array;
  w: number;
  h: number;
}

/** Trả dữ liệu PNG cho một tham chiếu ảnh trong MMD (`figures/x.png` hoặc `#p1_f1`). */
export type FigureResolver = (ref: string) => FigureData | null;

/** Đọc kích thước PNG từ IHDR — không phụ thuộc Buffer của Node. */
export function pngSize(bytes: Uint8Array): { w: number; h: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { w: view.getUint32(16), h: view.getUint32(20) };
}

/** `highlight` là TÊN highlight của Word (không phải mã hex) — bản gốc dùng 'green'. */
export type WordHighlight = NonNullable<ConstructorParameters<typeof TextRun>[0] extends string
  ? never
  : NonNullable<Exclude<ConstructorParameters<typeof TextRun>[0], string>>['highlight']>;

export interface RunStyle {
  bold?: boolean;
  color?: string;
  highlight?: WordHighlight;
}

/** Chuyển 1 đoạn text thường (đã tách math) thành runs; xử lý **đậm** và "Chọn X". */
function textToRuns(text: string, base: RunStyle = {}): TextRun[] {
  const runs: TextRun[] = [];
  const parts = text.split(/(Chọn\s+\*{0,2}[A-D?]\*{0,2}\.?)/g);
  for (const part of parts) {
    if (!part) continue;
    const chon = part.match(/^Chọn\s+\*{0,2}([A-D?])\*{0,2}(\.?)$/);
    if (chon) {
      runs.push(
        new TextRun({
          text: `Chọn ${chon[1]}${chon[2]}`,
          bold: true,
          color: BLUE,
          highlight: 'green',
          ...base,
        }),
      );
      continue;
    }
    const boldParts = part.split(/\*\*([^*]+)\*\*/g);
    boldParts.forEach((p, idx) => {
      if (!p) return;
      runs.push(
        new TextRun({
          text: p,
          bold: base.bold || idx % 2 === 1,
          ...base,
          ...(idx % 2 === 1 ? { bold: true } : {}),
        }),
      );
    });
  }
  return runs;
}

/** Cả dòng -> runs (math giữ nguyên + bọc {}, text qua textToRuns). */
export function lineToRuns(line: string, base: RunStyle = {}): TextRun[] {
  const runs: TextRun[] = [];
  for (const seg of segmentLine(line)) {
    if (seg.math) {
      runs.push(
        new TextRun({
          text: braceMath(seg.text),
          bold: base.bold,
          color: base.color,
          highlight: base.highlight,
        }),
      );
      continue;
    }
    const cleaned = cleanText(seg.text);
    if (!cleaned) continue;
    runs.push(...textToRuns(cleaned, base));
  }
  return runs;
}

// Spacing/indent đo trực tiếp từ file mẫu K11-Đề-tặng-kèm-số-1:
//   đề bài       : line 264 auto, ind 0
//   phương án    : line 264 auto, after 120, ind 426
//   "Lời giải"   : line 276 auto, after 240, ind 992, canh giữa
//   "Chọn X"     : line 276 auto, ind 992
//   thân lời giải: line 276 auto, ind 992, canh đều
const BODY_SPACING = { line: 264, lineRule: 'auto' as const, after: 40 };
const OPTION_SPACING = { line: 264, lineRule: 'auto' as const, after: 120 };
const SOL_SPACING = { line: 276, lineRule: 'auto' as const };
const SOL_INDENT = { left: 992 };

function makeBodyParagraph(children: TextRun[], alignment?: (typeof AlignmentType)[keyof typeof AlignmentType]): Paragraph {
  return new Paragraph({
    spacing: BODY_SPACING,
    alignment: alignment || AlignmentType.JUSTIFIED,
    children,
  });
}

function makeSolutionParagraph(children: TextRun[]): Paragraph {
  return new Paragraph({
    spacing: SOL_SPACING,
    indent: SOL_INDENT,
    alignment: AlignmentType.JUSTIFIED,
    children,
  });
}

export function buildTable(rows: string[][], headerBold = true): Table {
  const tableRows = rows.map(
    (cells, r) =>
      new TableRow({
        children: cells.map(
          (cellText) =>
            new TableCell({
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: lineToRuns(cellText, headerBold && r === 0 ? { bold: true } : {}),
                }),
              ],
            }),
        ),
      }),
  );
  return new Table({ rows: tableRows, width: { size: 100, type: WidthType.PERCENTAGE } });
}

/**
 * Trần RỘNG (docx px, tức px @96dpi vì `docx` nhân 9525 EMU). 340 px = 9,00 cm = đúng 50% cột
 * chữ A4 sau lề 851 twip mỗi bên.
 */
const IMG_MAX_W = 340;

/**
 * Trần CAO. Bản trước chỉ kẹp chiều rộng, nên một hình cao hẹp (200×1200 px) ra 3,97 × 23,81 cm
 * — gần trọn 27,7 cm chiều cao chữ, một hình chiếm cả trang.
 *
 * 420 px = 11,1 cm, chọn CÓ ĐO: hình cao nhất trong 25 đề golden là 342 px và hình cao nhất
 * trong bộ 47 hình corpus là 375 px, nên trần này KHÔNG co thêm hình nào đang có ⇒ `document.xml`
 * không đổi một byte ⇒ `verify-docx` vẫn 25/25 mà không phải sửa oracle (`ref-mmd2docx.cjs` bị
 * CONTRIBUTING cấm sửa). Nó là guard cho hình dị dạng, không phải phép co cho hình bình thường.
 */
const IMG_MAX_H = 420;

export interface ImageParagraphOpts {
  spacing?: Record<string, unknown>;
  /** Thụt lề để hình canh giữa theo CỘT LỜI GIẢI, không phải theo cột đầy đủ. */
  indent?: Record<string, unknown>;
  /** Nền, chỉ chuẩn VDC dùng. K11 không truyền ⇒ output không đổi. */
  shading?: Record<string, unknown>;
}

export function makeImageParagraph(
  ref: string,
  resolveFigure: FigureResolver,
  o: ImageParagraphOpts = {},
): Paragraph | null {
  const fig = resolveFigure(ref);
  if (!fig) return null;

  const scale = Math.min(
    1,
    IMG_MAX_W / (fig.w * 0.75),
    IMG_MAX_H / (fig.h * 0.75),
  );
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: o.spacing ?? BODY_SPACING,
    ...(o.indent ? { indent: o.indent } : {}),
    ...(o.shading ? { shading: o.shading } : {}),
    children: [
      new ImageRun({
        type: 'png', // thiếu `type` -> docx đặt tên media là *.undefined
        data: fig.bytes,
        transformation: {
          width: Math.round(fig.w * 0.75 * scale),
          height: Math.round(fig.h * 0.75 * scale),
        },
      }),
    ],
  });
}

export function isEmptyParagraph(p: Paragraph): boolean {
  try {
    const root = (p as unknown as { root: Array<{ rootKey?: string }> }).root;
    return root.filter((x) => x && x.rootKey === 'w:r').length === 0;
  } catch {
    return false;
  }
}

export function mmdToDocxChildren(
  mmd: string,
  resolveFigure: FigureResolver,
  cauPlan: CauNumberingPlan = EMPTY_CAU_PLAN,
): Array<Paragraph | Table> {
  const children: Array<Paragraph | Table> = [];
  const blocks = parseMmdBlocks(mmd);

  for (let bi = 0; bi < blocks.length; bi++) {
    const b = blocks[bi];
    switch (b.kind) {
      case 'raw':
        children.push(makeBodyParagraph([new TextRun({ text: b.line })]));
        break;

      case 'table':
        children.push(buildTable(b.rows, b.headerBold), new Paragraph({ children: [] }));
        break;

      case 'image': {
        // Hình TRONG lời giải canh giữa theo cột lời giải (thụt 992) chứ không theo cột đầy đủ:
        // để nguyên indent 0 thì hình lệch 0,87 cm so với khối chữ nó minh hoạ. `before` cho nó
        // rời khỏi dòng "Chọn X." phía trên. Hình trong khối ĐỀ giữ y nguyên bản cũ nên 25 file
        // golden (12/12 dòng ảnh đều ở khối đề) vẫn trùng từng byte.
        const p = b.inSolution
          ? makeImageParagraph(b.ref, resolveFigure, {
              spacing: { ...SOL_SPACING, before: 80, after: 80 },
              indent: SOL_INDENT,
            })
          : makeImageParagraph(b.ref, resolveFigure);
        // Không tìm được ảnh thì rơi về dòng thường, y như bản gốc.
        if (p) children.push(p);
        else {
          const runs = lineToRuns(b.line);
          if (runs.length) children.push(makeBodyParagraph(runs));
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
            spacing: b.afterSolution ? { ...BODY_SPACING, before: 200 } : BODY_SPACING,
            alignment: AlignmentType.JUSTIFIED,
            children: lineToRuns(b.text, { bold: true, color: RED }),
          }),
        );
        break;

      case 'loiGiai':
        children.push(
          new Paragraph({
            spacing: { ...SOL_SPACING, after: 240 },
            indent: SOL_INDENT,
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: 'Lời giải', bold: true, color: BLUE })],
          }),
        );
        break;

      case 'chon':
        children.push(
          new Paragraph({
            spacing: SOL_SPACING,
            indent: SOL_INDENT,
            children: textToRuns(b.text),
          }),
        );
        break;

      case 'dapSo':
        children.push(
          new Paragraph({
            spacing: SOL_SPACING,
            indent: SOL_INDENT,
            children: lineToRuns(b.text, { bold: true, color: BLUE, highlight: 'green' }),
          }),
        );
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
                bold: true,
                color: BLUE,
                ...(o.correct ? { underline: {} } : {}),
              }),
            );
            runs.push(...lineToRuns(o.body));
          });
          children.push(
            new Paragraph({
              spacing: OPTION_SPACING,
              indent: { left: 426 },
              tabStops:
                perLine === 4
                  ? [
                      { type: TabStopType.LEFT, position: 3119 },
                      { type: TabStopType.LEFT, position: 5669 },
                      { type: TabStopType.LEFT, position: 8222 },
                    ]
                  : [{ type: TabStopType.LEFT, position: 5669 }],
              children: runs,
            }),
          );
        }
        break;
      }

      case 'cau': {
        const spacing = b.afterSolution ? { ...BODY_SPACING, before: 160 } : BODY_SPACING;
        const reference = cauPlan.refOf(bi);
        if (reference) {
          // Đoạn dùng numbering: `ind left=0 firstLine=0` triệt tiêu hanging của level để
          // chữ chạy từ lề, tab 851 đưa nội dung ra sau nhãn — đúng như file mẫu K11.
          children.push(
            new Paragraph({
              numbering: { reference, level: 0 },
              spacing,
              alignment: AlignmentType.JUSTIFIED,
              indent: { left: 0, firstLine: 0 },
              tabStops: [{ type: TabStopType.LEFT, position: 851 }],
              children: lineToRuns(b.rest),
            }),
          );
          break;
        }
        children.push(
          new Paragraph({
            spacing,
            alignment: AlignmentType.JUSTIFIED,
            children: [
              new TextRun({ text: b.prefix + ' ', bold: true, color: BLUE }),
              ...lineToRuns(b.rest),
            ],
          }),
        );
        break;
      }

      // Chuẩn K11 để nguyên `a) **Đúng**. giải thích` trên một dòng như dòng thường.
      case 'verdict':
      case 'text': {
        const runs = lineToRuns(b.line);
        if (runs.length) {
          children.push(b.inSolution ? makeSolutionParagraph(runs) : makeBodyParagraph(runs));
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

const NO_FIGURES: FigureResolver = () => null;

export interface ExamDocxOptions {
  /** Preset font; mặc định Times New Roman 12pt như file mẫu K11. */
  font?: FontPreset;
  /**
   * Đánh "Câu N." bằng numbering thật của Word. Mặc định BẬT.
   *
   * `verify-docx.mjs` truyền `false`: harness đó so từng ký tự `document.xml` với oracle
   * đóng băng `scripts/ref-mmd2docx.cjs`, thêm `<w:numPr>` sẽ lệch cả 25/25 file. Tắt
   * numbering ở đó giữ nguyên bảo chứng "mọi thứ còn lại byte-identical" mà không phải sửa
   * oracle; phần numbering do `verify-numbering.mjs` che.
   */
  autoNumberCau?: boolean;
  /**
   * In footer "Trang N". Mặc định BẬT — đúng file mẫu K11, nên 25 đề golden không đổi một byte.
   *
   * Tắt khi đề in ghép vào tài liệu khác, hoặc khi thầy tự đánh số bằng máy in.
   */
  pageNumbers?: boolean;
}

export function buildExamDocx(
  mmd: string,
  resolveFigure: FigureResolver = NO_FIGURES,
  opts: ExamDocxOptions = {},
): Document {
  const font = opts.font ?? fontPreset('tnr');
  const plan =
    opts.autoNumberCau === false ? EMPTY_CAU_PLAN : planCauNumbering(parseMmdBlocks(mmd));
  const children = mmdToDocxChildren(mmd, resolveFigure, plan);
  return new Document({
    styles: {
      default: {
        document: { run: { font: font.name, size: font.size } }, // TNR 12pt như file mẫu
      },
    },
    numbering: cauNumberingConfig(plan.runs, {
      font: font.name,
      size: font.size,
      color: BLUE,
    }),
    sections: [
      {
        properties: {
          page: {
            margin: { top: 568, right: 851, bottom: 567, left: 851, header: 284, footer: 0, gutter: 0 },
          },
        },
        // Tắt số trang thì BỎ HẲN khối `footers`, không phải đưa vào một footer rỗng: footer
        // rỗng vẫn sinh `footer1.xml` và vẫn chừa chỗ trắng cuối trang.
        ...(opts.pageNumbers === false
          ? {}
          : {
              footers: {
                default: new Footer({
                  children: [
                    new Paragraph({
                      alignment: AlignmentType.CENTER,
                      children: [
                        new TextRun({ text: 'Trang ', size: 20 }),
                        new TextRun({ children: [PageNumber.CURRENT], size: 20 }),
                      ],
                    }),
                  ],
                }),
              },
            }),
        children,
      },
    ],
  });
}
