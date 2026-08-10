// mmd2docx.js — Mathpix markdown (.mmd) -> .docx
// Định dạng bám theo file mẫu K11-Đề-tặng-kèm-số-1_Đề-và-đact.docx:
//   - A4, lề trên 568 / dưới 567 / trái 851 / phải 851 twip; TNR 12; giãn dòng 264 auto
//   - "Câu N." đậm xanh 0000FF; "PHẦN ..." đậm đỏ FF0000
//   - 4 phương án A-D gộp 1 đoạn, tab 3119/5669/8222, chữ cái đậm xanh
//   - "Chọn X" đậm xanh + highlight xanh lá
//   - LaTeX $...$ giữ nguyên (bọc ${...}$ khi sinh docx cho MathType — xem braceMath)
//   - bảng markdown -> Word table; ảnh cục bộ -> nhúng, canh giữa, inline with text
// Usage: node mmd2docx.js <input.mmd|inputDir> <output.docx|outputDir>

const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, ImageRun,
  Table, TableRow, TableCell, WidthType, AlignmentType, TabStopType,
  Header, Footer, PageNumber,
} = require('docx');

const BLUE = '0000FF';
const RED = 'FF0000';

// ---------- inline segmentation: math vs text ----------
function segmentLine(line) {
  const segs = [];
  let buf = '';
  let i = 0;
  const push = (math) => { if (buf) segs.push({ math, text: buf }); buf = ''; };
  while (i < line.length) {
    const ch = line[i];
    if (ch === '\\' && i + 1 < line.length && (line[i + 1] === '(' || line[i + 1] === '[')) {
      const close = line[i + 1] === '(' ? '\\)' : '\\]';
      const end = line.indexOf(close, i + 2);
      if (end !== -1) {
        push(false);
        buf = line.slice(i, end + 2); push(true);
        i = end + 2; continue;
      }
    }
    if (ch === '$') {
      const dbl = line[i + 1] === '$';
      const delim = dbl ? '$$' : '$';
      const end = line.indexOf(delim, i + delim.length);
      if (end !== -1) {
        push(false);
        buf = line.slice(i, end + delim.length); push(true);
        i = end + delim.length; continue;
      }
    }
    if (ch === '\\' && i + 1 < line.length) { buf += ch + line[i + 1]; i += 2; continue; }
    buf += ch; i += 1;
  }
  push(false);
  return segs;
}

// MathType Toggle TeX bỏ qua run là ký hiệu ghép trần ($X L$, $4 x$...) — bọc {} thì nhận.
function braceMath(run) {
  if (!run.startsWith('$') || run.startsWith('$$')) return run;
  const inner = run.slice(1, -1);
  return inner.startsWith('{') && inner.endsWith('}') ? run : '${' + inner + '}$';
}

function cleanText(t) {
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

// Chuyển 1 đoạn text thường (đã tách math) thành runs; xử lý **đậm** và "Chọn X".
function textToRuns(text, base = {}) {
  const runs = [];
  // "Chọn X" (đáp án) -> đậm xanh, highlight xanh lá — giống file mẫu
  const parts = text.split(/(Chọn\s+\*{0,2}[A-D?]\*{0,2}\.?)/g);
  for (const part of parts) {
    if (!part) continue;
    const chon = part.match(/^Chọn\s+\*{0,2}([A-D?])\*{0,2}(\.?)$/);
    if (chon) {
      runs.push(new TextRun({ text: `Chọn ${chon[1]}${chon[2]}`, bold: true, color: BLUE, highlight: 'green', ...base }));
      continue;
    }
    const boldParts = part.split(/\*\*([^*]+)\*\*/g);
    boldParts.forEach((p, idx) => {
      if (!p) return;
      runs.push(new TextRun({ text: p, bold: base.bold || idx % 2 === 1, ...base, ...(idx % 2 === 1 ? { bold: true } : {}) }));
    });
  }
  return runs;
}

// Cả dòng -> runs (math giữ nguyên + bọc {}, text qua textToRuns)
function lineToRuns(line, base = {}) {
  const runs = [];
  for (const seg of segmentLine(line)) {
    if (seg.math) {
      runs.push(new TextRun({ text: braceMath(seg.text), bold: base.bold, color: base.color, highlight: base.highlight }));
      continue;
    }
    const cleaned = cleanText(seg.text);
    if (!cleaned) continue;
    runs.push(...textToRuns(cleaned, base));
  }
  return runs;
}

// Dòng bắt đầu bằng "Câu N." / "**Câu N.**" -> prefix đậm xanh
const CAU_RE = /^\s*\*{0,2}(Câu\s+\d+\s*[.:]?)\*{0,2}\s*(.*)$/;
// Dòng phương án "A. ..." (cho phép **A.** và __A.__ = đáp án đúng gạch chân)
const OPT_RE = /^\s*(?:\*\*|__)?([A-D])\s*[.)](?:\*\*|__)?\s+(.*)$/;
const OPT_UNDER_RE = /^\s*__([A-D])\s*[.)]__\s/;
// Dòng "PHẦN ..." / "I. PHẦN ..." / "II. Câu hỏi tự luận ..."
const PHAN_RE = /^\s*\*{0,2}((?:[IVX\d]+\s*\.\s*)?(?:PHẦN|Phần)\b[^*\n]*?|[IVX]+\s*\.\s*Câu hỏi[^*\n]*?)\*{0,2}\s*$/;

// Spacing/indent đo trực tiếp từ file mẫu K11-Đề-tặng-kèm-số-1:
//   đề bài      : line 264 auto, ind 0
//   phương án   : line 264 auto, after 120, ind 426
//   "Lời giải"  : line 276 auto, after 240, ind 992, canh giữa
//   "Chọn X"    : line 276 auto, ind 992
//   thân lời giải: line 276 auto, ind 992, canh đều
const BODY_SPACING = { line: 264, lineRule: 'auto', after: 40 };
const OPTION_SPACING = { line: 264, lineRule: 'auto', after: 120 };
const SOL_SPACING = { line: 276, lineRule: 'auto' };
const SOL_INDENT = { left: 992 };

function makeBodyParagraph(children, opts = {}) {
  return new Paragraph({
    spacing: BODY_SPACING,
    alignment: opts.alignment || AlignmentType.JUSTIFIED,
    ...opts.paraProps,
    children,
  });
}

// Đoạn thuộc phần lời giải -> thụt 992, giãn dòng 276, canh đều
function makeSolutionParagraph(children) {
  return new Paragraph({
    spacing: SOL_SPACING,
    indent: SOL_INDENT,
    alignment: AlignmentType.JUSTIFIED,
    children,
  });
}

// ---------- table helpers ----------
function splitRow(row) {
  const cells = [];
  let buf = '';
  let inMath = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === '\\' && i + 1 < row.length) { buf += ch + row[i + 1]; i++; continue; }
    if (ch === '$') { inMath = !inMath; buf += ch; continue; }
    if (ch === '|' && !inMath) { cells.push(buf); buf = ''; continue; }
    buf += ch;
  }
  cells.push(buf);
  if (cells.length && cells[0].trim() === '') cells.shift();
  if (cells.length && cells[cells.length - 1].trim() === '') cells.pop();
  return cells.map(c => c.trim().replace(/\\\|/g, '|'));
}

const isPipeRow = (l) => /^\s*\|.*\|\s*$/.test(l);
const isSeparatorRow = (l) => /^\s*\|?[\s:\-|]+\|?\s*$/.test(l) && l.includes('-');

function buildTable(rows, { headerBold = true } = {}) {
  const tableRows = rows.map((cells, r) => new TableRow({
    children: cells.map(cellText => new TableCell({
      children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        children: lineToRuns(cellText, headerBold && r === 0 ? { bold: true } : {}),
      })],
    })),
  }));
  return new Table({
    rows: tableRows,
    width: { size: 100, type: WidthType.PERCENTAGE },
  });
}

// ---------- ảnh cục bộ (hình TikZ vẽ lại): canh giữa, inline with text ----------
let IMAGE_BASE = process.cwd();

function pngSize(buf) {
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function makeImageParagraph(relPath) {
  const candidates = [
    path.resolve(IMAGE_BASE, relPath),
    path.resolve(IMAGE_BASE, '..', relPath),
    path.resolve(__dirname, '..', relPath),
  ];
  const file = candidates.find(p => fs.existsSync(p));
  if (!file) return null;
  const buf = fs.readFileSync(file);
  const { w, h } = pngSize(buf);
  const maxW = 340;
  const scale = Math.min(1, maxW / (w * 0.75));
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: BODY_SPACING,
    children: [new ImageRun({
      type: 'png',
      data: buf,
      transformation: { width: Math.round(w * 0.75 * scale), height: Math.round(h * 0.75 * scale) },
    })],
  });
}

// ---------- main conversion ----------
function mmdToDocxChildren(mmd) {
  const lines = mmd.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n');
  const children = [];
  let i = 0;
  let inDisplayMath = false;
  let inSolution = false;  // đang trong thân lời giải (sau dòng "Lời giải")

  while (i < lines.length) {
    const line = lines[i];

    if (inDisplayMath) {
      children.push(makeBodyParagraph([new TextRun({ text: line })]));
      if (line.includes('$$')) inDisplayMath = false;
      i++; continue;
    }
    const dollarCount = (line.match(/\$\$/g) || []).length;
    if (dollarCount % 2 === 1) {
      children.push(makeBodyParagraph([new TextRun({ text: line })]));
      inDisplayMath = true;
      i++; continue;
    }

    // \begin{tabular} ... \end{tabular}
    if (/\\begin\{tabular\}/.test(line)) {
      let block = '';
      while (i < lines.length) {
        block += lines[i] + '\n';
        if (/\\end\{tabular\}/.test(lines[i])) { i++; break; }
        i++;
      }
      const body = block
        .replace(/\\begin\{tabular\}\s*(\{[^}]*\})?/, '')
        .replace(/\\end\{tabular\}/, '')
        .replace(/\\hline/g, '')
        .trim();
      const rows = body.split(/\\\\/).map(r => r.trim()).filter(Boolean)
        .map(r => r.split('&').map(c => c.trim()));
      if (rows.length) children.push(buildTable(rows, { headerBold: false }), new Paragraph({ children: [] }));
      continue;
    }

    // markdown pipe table
    if (isPipeRow(line) && i + 1 < lines.length && isPipeRow(lines[i + 1]) && isSeparatorRow(lines[i + 1])) {
      const rows = [splitRow(line)];
      i += 2;
      while (i < lines.length && isPipeRow(lines[i])) { rows.push(splitRow(lines[i])); i++; }
      children.push(buildTable(rows), new Paragraph({ children: [] }));
      continue;
    }

    // ảnh cục bộ -> nhúng canh giữa
    const img = line.match(/^\s*!\[[^\]]*\]\(([^)]+)\)\s*$/);
    if (img && !/^https?:/i.test(img[1])) {
      const p = makeImageParagraph(img[1]);
      if (p) { children.push(p); i++; continue; }
      console.error(`  cảnh báo: không tìm thấy ảnh ${img[1]}`);
    }

    if (line.trim() === '') {
      // Dòng trống trong markdown KHÔNG sinh đoạn rỗng trong Word — giống file mẫu.
      // Khoảng cách giữa các câu đã do spacing lo (after 120 ở phương án, before 160
      // ở "Câu N"); thêm đoạn rỗng nữa sẽ hở gấp đôi.
      i++; continue;
    }

    // heading markdown: # ĐÁP ÁN CHI TIẾT, ## tiêu đề đề thi, ...
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const txt = h[2].trim();
      const isDapAn = /^ĐÁP ÁN CHI TIẾT/.test(txt);
      const isPhan = /^(PHẦN|Phần)/.test(txt) || isDapAn;
      children.push(new Paragraph({
        spacing: BODY_SPACING,
        alignment: (h[1].length === 1 || isDapAn) ? AlignmentType.CENTER : AlignmentType.JUSTIFIED,
        // "ĐÁP ÁN CHI TIẾT" bắt đầu trang mới, giống file mẫu
        ...(isDapAn ? { pageBreakBefore: true } : {}),
        children: lineToRuns(txt, { bold: true, color: isPhan ? RED : undefined }),
      }));
      i++; continue;
    }

    // "PHẦN ..." không có ## -> đậm đỏ
    const phan = line.match(PHAN_RE);
    if (phan) {
      const wasInSolution = inSolution;
      inSolution = false;
      children.push(new Paragraph({
        spacing: wasInSolution ? { ...BODY_SPACING, before: 200 } : BODY_SPACING,
        alignment: AlignmentType.JUSTIFIED,
        children: lineToRuns(phan[1].trim(), { bold: true, color: RED }),
      }));
      i++; continue;
    }

    // Dòng "Lời giải" -> canh giữa, đậm xanh (giống file mẫu)
    if (/^\s*\*{0,2}Lời giải\*{0,2}\s*$/.test(line)) {
      children.push(new Paragraph({
        spacing: { ...SOL_SPACING, after: 240 },
        indent: SOL_INDENT,
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: 'Lời giải', bold: true, color: BLUE })],
      }));
      inSolution = true;
      i++; continue;
    }

    // Dòng "Chọn X." hoặc "Đáp số: ..." đứng riêng -> thụt 992, đậm xanh + highlight xanh lá
    const chonLine = line.match(/^\s*(Chọn\s+[A-D?]\.?)\s*$/);
    const dapso = line.match(/^\s*(Đáp số\s*:.*?)\s*$/);
    if (chonLine || dapso) {
      const runs = chonLine
        ? textToRuns(chonLine[1])
        : lineToRuns(dapso[1], { bold: true, color: BLUE, highlight: 'green' });
      children.push(new Paragraph({
        spacing: SOL_SPACING,
        indent: SOL_INDENT,
        children: runs,
      }));
      i++; continue;
    }

    // Gộp các dòng phương án A-D liên tiếp, chữ cái đậm xanh. Giống file mẫu:
    // phương án ngắn -> 4/dòng (tab 3119/5669/8222), vừa -> 2/dòng (tab 5669), dài -> 1/dòng.
    if (OPT_RE.test(line)) {
      const opts = [];
      while (i < lines.length && OPT_RE.test(lines[i]) && opts.length < 4) {
        const m = lines[i].match(OPT_RE);
        opts.push({ letter: m[1], body: m[2].trim(), underline: OPT_UNDER_RE.test(lines[i]) });
        i++;
      }
      const est = o => o.body
        .replace(/\\[a-zA-Z]+/g, 'xx').replace(/[${}^_]/g, '').length;
      const maxLen = Math.max(...opts.map(est));
      let perLine = 4;
      if (maxLen > 52) perLine = 1;
      else if (maxLen > 22) perLine = 2;
      for (let k = 0; k < opts.length; k += perLine) {
        const chunk = opts.slice(k, k + perLine);
        const runs = [];
        chunk.forEach((o, idx) => {
          if (idx > 0) runs.push(new TextRun({ text: '\t' }));
          runs.push(new TextRun({
            text: `${o.letter}. `, bold: true, color: BLUE,
            ...(o.underline ? { underline: {} } : {}),
          }));
          runs.push(...lineToRuns(o.body));
        });
        children.push(new Paragraph({
          spacing: OPTION_SPACING,
          indent: { left: 426 },
          tabStops: perLine === 4
            ? [
                { type: TabStopType.LEFT, position: 3119 },
                { type: TabStopType.LEFT, position: 5669 },
                { type: TabStopType.LEFT, position: 8222 },
              ]
            : [{ type: TabStopType.LEFT, position: 5669 }],
          children: runs,
        }));
      }
      continue;
    }

    // "Câu N." -> prefix đậm xanh; bắt đầu câu mới thì kết thúc vùng lời giải
    const cau = line.match(CAU_RE);
    if (cau) {
      const wasInSolution = inSolution;
      inSolution = false;
      const runs = [
        new TextRun({ text: cau[1].replace(/\s+/g, ' ') + ' ', bold: true, color: BLUE }),
        ...lineToRuns(cau[2]),
      ];
      // tách khỏi lời giải câu trước
      children.push(new Paragraph({
        spacing: wasInSolution ? { ...BODY_SPACING, before: 160 } : BODY_SPACING,
        alignment: AlignmentType.JUSTIFIED,
        children: runs,
      }));
      i++; continue;
    }

    const runs = lineToRuns(line);
    if (runs.length) children.push(inSolution ? makeSolutionParagraph(runs) : makeBodyParagraph(runs));
    i++;
  }

  while (children.length && children[0] instanceof Paragraph && isEmptyParagraph(children[0])) children.shift();
  while (children.length && children[children.length - 1] instanceof Paragraph && isEmptyParagraph(children[children.length - 1])) children.pop();
  return children;
}

function isEmptyParagraph(p) {
  try { return p.root.filter(x => x && x.rootKey === 'w:r').length === 0; } catch { return false; }
}

async function convertFile(inFile, outFile) {
  IMAGE_BASE = path.dirname(path.resolve(inFile));
  const mmd = fs.readFileSync(inFile, 'utf8');
  const children = mmdToDocxChildren(mmd);
  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: 'Times New Roman', size: 24 } }, // 12pt như file mẫu
      },
    },
    sections: [{
      properties: {
        page: {
          margin: { top: 568, right: 851, bottom: 567, left: 851, header: 284, footer: 0, gutter: 0 },
        },
      },
      // header/footer sao chép từ file mẫu K11-Đề-tặng-kèm-số-1
      headers: {
        default: new Header({
          children: [new Paragraph({
            tabStops: [{ type: TabStopType.RIGHT, position: 10204 }],
            children: [
              new TextRun({ text: 'Đáp án chi tiết có tại ', size: 20 }),
              new TextRun({ text: 'Group 11 Bhp 2027', bold: true, size: 20 }),
              new TextRun({ text: '\t' }),
              new TextRun({ text: 'Team Trợ giảng 11 Bhp', bold: true, size: 20 }),
            ],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: 'Trang ', size: 20 }),
              new TextRun({ children: [PageNumber.CURRENT], size: 20 }),
            ],
          })],
        }),
      },
      children,
    }],
  });
  const buf = await Packer.toBuffer(doc);
  fs.writeFileSync(outFile, buf);
}

async function main() {
  const [, , input, output] = process.argv;
  if (!input || !output) {
    console.error('Usage: node mmd2docx.js <input.mmd|inputDir> <output.docx|outputDir>');
    process.exit(1);
  }
  const stat = fs.statSync(input);
  const jobs = [];
  if (stat.isDirectory()) {
    fs.mkdirSync(output, { recursive: true });
    for (const f of fs.readdirSync(input)) {
      if (f.toLowerCase().endsWith('.mmd')) {
        jobs.push([path.join(input, f), path.join(output, f.replace(/\.mmd$/i, '.docx'))]);
      }
    }
  } else {
    jobs.push([input, output]);
  }
  let ok = 0, fail = 0;
  for (const [inF, outF] of jobs) {
    try {
      await convertFile(inF, outF);
      console.log(`OK   ${path.basename(inF)} -> ${path.basename(outF)}`);
      ok++;
    } catch (e) {
      console.error(`FAIL ${path.basename(inF)}: ${e.message}`);
      fail++;
    }
  }
  console.log(`Done: ${ok} ok, ${fail} failed`);
  if (fail > 0) process.exit(2);
}

main();
