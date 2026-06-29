import { useState, useCallback, useRef, useEffect, memo } from 'react';
import { GoogleGenAI } from '@google/genai';
import * as pdfjsLib from 'pdfjs-dist';
import {
  Document as DocxDocument,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  Math as OfficeMath,
  ImageRun,
  WidthType,
  AlignmentType,
  convertInchesToTwip,
} from 'docx';
import { useDropzone } from 'react-dropzone';
import {
  Upload,
  FileText,
  Loader2,
  Download,
  AlertCircle,
  ChevronRight,
  FileDown,
  RotateCcw,
  X,
  Copy,
  CheckCircle2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import { latexToMathChildren, parseTextWithMath } from './utils/latexToDocxMath';
import { sanitizeLatexExpr } from './utils/latexSanitizer';
import { tikzToImage } from './utils/latexToImage';
import { generateTikzMultiAgent, generateTikzSingleAgent } from './utils/tikzMultiAgent';
import { GEMINI_MODEL, TEMP_PRECISE, LATEX_MATH_RULES, ANTI_HALLUCINATION, OUTPUT_FORMAT_RULES } from './utils/sharedPrompts';
// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_PDF_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB
const MAX_PDF_SIZE_MB = 50;
const PDF_RENDER_SCALE = 2;
const JPEG_QUALITY = 0.85;
const JPEG_QUALITY_API = 0.7; // Lower quality for Gemini API (faster upload, same accuracy)
const DOCX_MAX_IMAGE_WIDTH = 500; // points (~6.9 inches)
const API_TIMEOUT_MS = 120_000; // 120 seconds per page (pro model is slower)

// ─── PDF.js Worker Setup ─────────────────────────────────────────────────────

// Production (Electron): worker is copied to dist/ by vite.config.ts copyPdfjsWorker plugin.
// Dev: load from CDN (developer has internet; no Electron CDN restrictions in dev).
pdfjsLib.GlobalWorkerOptions.workerSrc = import.meta.env.PROD
  ? './pdf.worker.min.mjs'
  : `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

// ─── Types ───────────────────────────────────────────────────────────────────

interface DocumentElement {
  type: 'heading' | 'paragraph' | 'equation' | 'table' | 'image';
  level?: number;
  content?: string;
  latex?: string;
  tikz?: string;         // TikZ code for diagrams/figures
  rows?: string[][];
  bbox?: number[];
  caption?: string;
  imageData?: string;     // base64 data URL for cropped image
  tikzImage?: {           // compiled TikZ as image
    bytes: Uint8Array;
    width: number;
    height: number;
  };
}

interface PageContent {
  pageNumber: number;
  elements: DocumentElement[];
  pageCanvas?: HTMLCanvasElement;
}

// ─── Gemini Prompt ───────────────────────────────────────────────────────────

const PDF_ANALYSIS_PROMPT = `You are a high-quality PDF document analyzer specializing in image-to-LaTeX conversion. Analyze this PDF page image and extract ALL content in reading order with maximum fidelity.

Return ONLY a valid JSON object (no markdown code blocks, no explanations, no extra text). The response must start with { and end with }.

JSON structure:
{
  "elements": [
    {"type": "heading", "level": 1, "content": "Section Title"},
    {"type": "paragraph", "content": "Regular text. Use $x^2$ for inline math."},
    {"type": "equation", "latex": "E = mc^2"},
    {"type": "table", "rows": [["Header 1", "Header 2"], ["$\\\\frac{a}{b}$", "text value"]]},
    {"type": "image", "bbox": [10, 20, 30, 25], "caption": "Figure 1: Description"}
  ]
}

Rules:
1. Extract ALL content top-to-bottom, left-to-right in reading order
2. "heading": for titles, section headers, chapter titles. Use level 1, 2, or 3
3. "paragraph": for text blocks. Wrap inline math with $...$ delimiters. Treat every mathematical expression as an image-to-LaTeX task — reproduce the exact notation, symbols, spacing, and structure visible in the image
4. "equation": for standalone/display equations on their own line. Put LaTeX WITHOUT $ delimiters in the "latex" field. For single-line equations use plain LaTeX (e.g. "\\frac{a}{b} = c"). For multi-line aligned equations use: "\\begin{align*} f(x) &= x^2 + 1 \\\\\\\\ g(x) &= 2x \\end{align*}". Convert with image-to-LaTeX quality: capture every symbol, subscript, superscript, fraction, operator, and decoration exactly as shown
5. "table": for tables. Each cell is a string. Use $...$ for LaTeX math or plain text in cells. Include header row as first row
6. "image": for figures, diagrams, geometric drawings, charts, and graphs:
   - bbox = [x%, y%, width%, height%] as percentage of page dimensions — be VERY precise with bounding box coordinates
   - Include caption if visible
   - Do NOT include a "tikz" field — TikZ code will be generated separately by a specialized pipeline
7. Preserve ALL text EXACTLY as shown (including non-English characters)
8. Convert ALL mathematical expressions to proper LaTeX notation with maximum accuracy:
${LATEX_MATH_RULES}
9. For numbered lists or bullet points, include the number/bullet in the paragraph content
10. Return ONLY the JSON object — no markdown formatting, no code blocks, no explanation

${ANTI_HALLUCINATION}
${OUTPUT_FORMAT_RULES}`;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseGeminiResponse(text: string): DocumentElement[] {
  let jsonStr = text.trim();

  // Remove markdown code blocks if present
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(jsonStr);
    return Array.isArray(parsed.elements) ? parsed.elements : [];
  } catch {
    // Try to extract JSON object from text
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return Array.isArray(parsed.elements) ? parsed.elements : [];
      } catch {
        // Fallback: treat entire text as a paragraph
        return [{ type: 'paragraph', content: text }];
      }
    }
    return [{ type: 'paragraph', content: text }];
  }
}

async function renderPdfPage(pdf: pdfjsLib.PDFDocumentProxy, pageNum: number, scale = 2): Promise<HTMLCanvasElement> {
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d')!;
  // PDF.js types require canvas alongside canvasContext
  await page.render({ canvasContext: ctx, canvas, viewport } as Parameters<typeof page.render>[0]).promise;
  return canvas;
}

function canvasToBase64(canvas: HTMLCanvasElement, quality = 0.85): string {
  return canvas.toDataURL('image/jpeg', quality);
}

function cropImageFromCanvas(canvas: HTMLCanvasElement, bbox: number[]): { dataUrl: string; bytes: Uint8Array; width: number; height: number } {
  const [xPct, yPct, wPct, hPct] = bbox;
  const x = Math.round((canvas.width * xPct) / 100);
  const y = Math.round((canvas.height * yPct) / 100);
  const w = Math.max(1, Math.round((canvas.width * wPct) / 100));
  const h = Math.max(1, Math.round((canvas.height * hPct) / 100));

  const cropCvs = document.createElement('canvas');
  cropCvs.width = w;
  cropCvs.height = h;
  const ctx = cropCvs.getContext('2d')!;
  ctx.drawImage(canvas, x, y, w, h, 0, 0, w, h);

  const dataUrl = cropCvs.toDataURL('image/png');
  const base64 = dataUrl.split(',')[1];
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return { dataUrl, bytes, width: w, height: h };
}

// ─── DOCX Builder ────────────────────────────────────────────────────────────

function buildDocxParagraphChildren(text: string): (TextRun | OfficeMath)[] {
  return parseTextWithMath(text);
}

function buildDocx(pages: PageContent[], fileName: string): DocxDocument {
  const children: (Paragraph | Table)[] = [];

  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi];

    // Add page separator (except for first page)
    if (pi > 0) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: '', break: 1 })],
          spacing: { before: 200 },
        })
      );
    }

    for (const el of page.elements) {
      switch (el.type) {
        case 'heading': {
          const headingMap: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
            1: HeadingLevel.HEADING_1,
            2: HeadingLevel.HEADING_2,
            3: HeadingLevel.HEADING_3,
          };
          const level = headingMap[el.level || 1] || HeadingLevel.HEADING_1;
          const headingChildren = el.content ? buildDocxParagraphChildren(el.content) : [new TextRun('')];
          children.push(
            new Paragraph({
              children: headingChildren,
              heading: level,
              spacing: { before: 240, after: 120 },
            })
          );
          break;
        }

        case 'paragraph': {
          if (!el.content) break;
          const paraChildren = buildDocxParagraphChildren(el.content);
          children.push(
            new Paragraph({
              children: paraChildren,
              spacing: { after: 120 },
            })
          );
          break;
        }

        case 'equation': {
          if (!el.latex) break;
          // Use OMML so equations are editable in Word/MathType (Toggle TeX).
          // PNG images are non-editable — MathType cannot open them at all.
          try {
            const cleanLatex = sanitizeLatexExpr(el.latex);
            const mathChildren = latexToMathChildren(cleanLatex);
            children.push(
              new Paragraph({
                children: [new OfficeMath({ children: mathChildren })],
                alignment: AlignmentType.CENTER,
                spacing: { before: 120, after: 120 },
              })
            );
          } catch {
            // Last resort: plain italic text so content is not lost
            children.push(
              new Paragraph({
                children: [new TextRun({ text: el.latex, italics: true })],
                alignment: AlignmentType.CENTER,
                spacing: { before: 120, after: 120 },
              })
            );
          }
          break;
        }

        case 'table': {
          if (!el.rows || el.rows.length === 0) break;
          const tableRows = el.rows.map((row) => {
            const cells = row.map((cellText) => {
              const cellChildren = buildDocxParagraphChildren(cellText || '');
              return new TableCell({
                children: [
                  new Paragraph({
                    children: cellChildren,
                    spacing: { before: 40, after: 40 },
                  }),
                ],
                width: { size: Math.floor(100 / row.length), type: WidthType.PERCENTAGE },
              });
            });
            return new TableRow({ children: cells });
          });

          children.push(
            new Table({
              rows: tableRows,
              width: { size: 100, type: WidthType.PERCENTAGE },
            })
          );

          // Add spacing after table
          children.push(new Paragraph({ children: [new TextRun('')], spacing: { after: 120 } }));
          break;
        }

        case 'image': {
          // Use TikZ-compiled image — never fall back to cropped screenshots
          const imgSource = el.tikzImage ?? null;

          if (imgSource) {
            const { bytes, width, height } = imgSource;
            const maxWidth = DOCX_MAX_IMAGE_WIDTH;
            const scale = width > maxWidth ? maxWidth / width : 1;
            const imgWidth = Math.round(width * scale);
            const imgHeight = Math.round(height * scale);

            children.push(
              new Paragraph({
                children: [
                  new ImageRun({
                    data: bytes,
                    transformation: { width: imgWidth, height: imgHeight },
                    type: 'png',
                  }),
                ],
                alignment: AlignmentType.CENTER,
                spacing: { before: 120, after: 60 },
              })
            );

            // Caption
            if (el.caption) {
              children.push(
                new Paragraph({
                  children: [new TextRun({ text: el.caption, italics: true, size: 20 })],
                  alignment: AlignmentType.CENTER,
                  spacing: { after: 120 },
                })
              );
            }
          } else {
            // TikZ generation failed — insert placeholder with caption/tikz code reference
            const label = el.caption ? `[Figure: ${el.caption}]` : '[Figure — TikZ generation failed]';
            children.push(
              new Paragraph({
                children: [new TextRun({ text: label, italics: true })],
                alignment: AlignmentType.CENTER,
                spacing: { before: 120, after: 120 },
              })
            );
          }
          break;
        }
      }
    }
  }

  // Ensure at least one paragraph
  if (children.length === 0) {
    children.push(new Paragraph({ children: [new TextRun('')] }));
  }

  return new DocxDocument({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(1),
              right: convertInchesToTwip(1),
              bottom: convertInchesToTwip(1),
              left: convertInchesToTwip(1),
            },
          },
        },
        children,
      },
    ],
  });
}

// ─── Preview Components ──────────────────────────────────────────────────────

function InlineMathText({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkMath, remarkGfm]}
      rehypePlugins={[rehypeKatex]}
      components={{
        p: ({ children }) => <span>{children}</span>,
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

const DocxPageElement = memo(function DocxPageElement({ element }: { element: DocumentElement }) {
  switch (element.type) {
    case 'heading': {
      const styles: Record<number, string> = {
        1: 'text-[16pt] font-bold mt-[18pt] mb-[8pt] text-[#1a1a1a] tracking-tight leading-snug',
        2: 'text-[13pt] font-bold mt-[14pt] mb-[6pt] text-[#2a2a2a] leading-snug',
        3: 'text-[11pt] font-bold mt-[12pt] mb-[4pt] text-[#3a3a3a] leading-snug',
      };
      const style = styles[element.level || 1] || styles[1];
      return (
        <div className={style} style={{ fontFamily: '"Calibri", "Segoe UI", sans-serif' }}>
          <InlineMathText text={element.content || ''} />
        </div>
      );
    }

    case 'paragraph':
      return (
        <div
          className="mb-[6pt] text-[11pt] text-[#1a1a1a] leading-[1.5]"
          style={{ fontFamily: '"Calibri", "Segoe UI", sans-serif' }}
        >
          <InlineMathText text={element.content || ''} />
        </div>
      );

    case 'equation':
      return (
        <div className="my-[10pt] text-center px-[20pt]">
          <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
            {`$$${element.latex || ''}$$`}
          </ReactMarkdown>
        </div>
      );

    case 'table': {
      if (!element.rows || element.rows.length === 0) return null;
      return (
        <div className="my-[10pt] overflow-x-auto">
          <table
            className="w-full border-collapse text-[10pt]"
            style={{ fontFamily: '"Calibri", "Segoe UI", sans-serif' }}
          >
            <thead>
              <tr>
                {element.rows[0].map((cell, ci) => (
                  <th
                    key={ci}
                    className="border border-[#8eaadb] bg-[#4472c4] text-white px-[6pt] py-[4pt] text-left font-semibold"
                  >
                    <InlineMathText text={cell || ''} />
                  </th>
                ))}
              </tr>
            </thead>
            {element.rows.length > 1 && (
              <tbody>
                {element.rows.slice(1).map((row, ri) => (
                  <tr key={ri} className={ri % 2 === 0 ? 'bg-[#d9e2f3]' : 'bg-white'}>
                    {row.map((cell, ci) => (
                      <td
                        key={ci}
                        className="border border-[#8eaadb] px-[6pt] py-[4pt] text-left text-[#1a1a1a]"
                      >
                        <InlineMathText text={cell || ''} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        </div>
      );
    }

    case 'image':
      return (
        <div className="my-[10pt] text-center">
          {element.imageData ? (
            <div className="inline-block">
              <img
                src={element.imageData}
                alt={element.caption || 'Figure'}
                className="max-w-full h-auto border border-gray-200"
                style={{ maxHeight: '300px' }}
              />
              {element.tikz && (
                <details className="mt-[4pt] text-left">
                  <summary className="text-[8pt] text-gray-400 cursor-pointer hover:text-gray-600" style={{ fontFamily: '"Calibri", sans-serif' }}>
                    View TikZ source
                  </summary>
                  <pre className="mt-[2pt] text-[7pt] bg-gray-50 border border-gray-200 rounded p-2 overflow-x-auto text-gray-600 whitespace-pre-wrap font-mono">
                    {element.tikz}
                  </pre>
                </details>
              )}
              {element.caption && (
                <p
                  className="text-[9pt] text-gray-500 italic mt-[4pt]"
                  style={{ fontFamily: '"Calibri", sans-serif' }}
                >
                  {element.caption}
                </p>
              )}
            </div>
          ) : (
            <div
              className="inline-block bg-gray-50 border border-gray-200 px-[16pt] py-[10pt] text-gray-400 text-[9pt]"
              style={{ fontFamily: '"Calibri", sans-serif' }}
            >
              [Image{element.caption ? `: ${element.caption}` : ''}]
            </div>
          )}
        </div>
      );

    default:
      return null;
  }
});

// ─── PDF Page Canvas Display ─────────────────────────────────────────────────

// Cache canvas-to-dataURL conversions to avoid expensive re-encoding
const _canvasDataUrlCache = new WeakMap<HTMLCanvasElement, string>();

function getCachedCanvasDataUrl(canvas: HTMLCanvasElement): string {
  let url = _canvasDataUrlCache.get(canvas);
  if (!url) {
    url = canvas.toDataURL('image/jpeg', 0.85); // JPEG is ~5x faster to encode than PNG
    _canvasDataUrlCache.set(canvas, url);
  }
  return url;
}

const PdfPageCanvas = memo(function PdfPageCanvas({ canvas }: { canvas: HTMLCanvasElement }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !canvas) return;

    // Create an img from cached canvas data for clean display
    const img = document.createElement('img');
    img.src = getCachedCanvasDataUrl(canvas);
    img.style.width = '100%';
    img.style.height = 'auto';
    img.style.display = 'block';
    img.alt = 'PDF page';

    container.innerHTML = '';
    container.appendChild(img);
  }, [canvas]);

  return <div ref={containerRef} />;
});

// ─── Side-by-Side Document Viewer (PDF input | DOCX output) ─────────────────

function DocxViewer({
  pages,
  pageCanvases,
  fileName,
  onDownload,
  isGenerating,
  onClose,
}: {
  pages: PageContent[];
  pageCanvases: Map<number, HTMLCanvasElement>;
  fileName: string;
  onDownload: () => void;
  isGenerating: boolean;
  onClose: () => void;
}) {
  const [zoom, setZoom] = useState(100);
  const [copied, setCopied] = useState(false);

  const totalElements = pages.reduce((acc, p) => acc + p.elements.length, 0);

  const handleCopyText = async () => {
    const textParts: string[] = [];
    for (const page of pages) {
      for (const el of page.elements) {
        if (el.type === 'heading' || el.type === 'paragraph') {
          textParts.push(el.content || '');
        } else if (el.type === 'equation') {
          textParts.push(`$$${el.latex || ''}$$`);
        } else if (el.type === 'table' && el.rows) {
          textParts.push(el.rows.map((r) => r.join('\t')).join('\n'));
        } else if (el.type === 'image' && el.caption) {
          textParts.push(`[Figure: ${el.caption}]`);
        }
      }
    }
    try {
      await navigator.clipboard.writeText(textParts.join('\n\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard not available
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#2b2b2b]">
      {/* ─── Toolbar ─── */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-[#1e1e1e] border-b border-[#3a3a3a] shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 bg-[#4285f4]/20 rounded-lg flex items-center justify-center shrink-0">
            <FileText className="w-4 h-4 text-[#4285f4]" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-white truncate">
              {fileName}.docx
            </h3>
            <p className="text-[10px] text-gray-400">
              {pages.length} page{pages.length !== 1 ? 's' : ''} &middot; {totalElements} elements
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {/* Zoom controls */}
          <button
            onClick={() => setZoom((z) => Math.max(50, z - 10))}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-md transition-colors"
            title="Zoom out"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-xs text-gray-400 w-10 text-center tabular-nums">{zoom}%</span>
          <button
            onClick={() => setZoom((z) => Math.min(200, z + 10))}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-md transition-colors"
            title="Zoom in"
          >
            <ZoomIn className="w-4 h-4" />
          </button>

          <div className="w-px h-5 bg-[#3a3a3a] mx-1" />

          {/* Copy text */}
          <button
            onClick={handleCopyText}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-md transition-colors"
            title="Copy text content"
          >
            {copied ? <CheckCircle2 className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
          </button>

          {/* Download */}
          <button
            onClick={onDownload}
            disabled={isGenerating}
            className="ml-1 flex items-center gap-1.5 px-3 py-1.5 bg-[#4285f4] hover:bg-[#3275e4] text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-60"
          >
            {isGenerating ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            {isGenerating ? 'Generating...' : 'Download'}
          </button>

          <div className="w-px h-5 bg-[#3a3a3a] mx-1" />

          {/* Close */}
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-md transition-colors"
            title="Close preview"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ─── Side-by-side body ─── */}
      <div className="flex-1 flex min-h-0">
        {/* ─── LEFT: PDF Input ─── */}
        <div className="w-1/2 flex flex-col border-r border-[#3a3a3a]">
          <div className="px-4 py-2 bg-[#252525] border-b border-[#3a3a3a] shrink-0">
            <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wider">PDF Input</h4>
          </div>
          <div className="flex-1 overflow-auto py-6 px-4 bg-[#333]">
            <div
              className="mx-auto flex flex-col items-center gap-6"
              style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top center' }}
            >
              {pages.map((page) => {
                const canvas = pageCanvases.get(page.pageNumber);
                return (
                  <div
                    key={page.pageNumber}
                    className="bg-white shadow-[0_2px_8px_rgba(0,0,0,0.3)] relative"
                    style={{ width: '100%', maxWidth: '7in' }}
                  >
                    {/* Page number label */}
                    <div className="absolute top-2 right-3 text-[8pt] text-gray-400 bg-white/80 px-1.5 py-0.5 rounded select-none z-10">
                      Page {page.pageNumber}
                    </div>
                    {canvas ? (
                      <PdfPageCanvas canvas={canvas} />
                    ) : (
                      <div className="p-8 text-center text-gray-400 text-sm">
                        PDF page not available
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ─── RIGHT: DOCX Output ─── */}
        <div className="w-1/2 flex flex-col">
          <div className="px-4 py-2 bg-[#252525] border-b border-[#3a3a3a] shrink-0">
            <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wider">DOCX Output</h4>
          </div>
          <div className="flex-1 overflow-auto py-6 px-4">
            <div
              className="mx-auto flex flex-col items-center gap-6"
              style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top center' }}
            >
              {pages.map((page, pageIdx) => (
                <div
                  key={pageIdx}
                  className="bg-white shadow-[0_2px_8px_rgba(0,0,0,0.3)] relative"
                  style={{
                    width: '100%',
                    maxWidth: '7in',
                    minHeight: '9in',
                    padding: '0.75in',
                    boxSizing: 'border-box',
                  }}
                >
                  {/* Page number label */}
                  <div
                    className="absolute top-2 right-3 text-[8pt] text-gray-300 select-none"
                    style={{ fontFamily: '"Calibri", sans-serif' }}
                  >
                    Page {page.pageNumber}
                  </div>

                  {/* Page content */}
                  <div className="relative">
                    {page.elements.map((el, elIdx) => (
                      <DocxPageElement key={`${pageIdx}-${elIdx}`} element={el} />
                    ))}
                    {page.elements.length === 0 && (
                      <div
                        className="text-gray-300 text-[10pt] italic text-center py-[40pt]"
                        style={{ fontFamily: '"Calibri", sans-serif' }}
                      >
                        (empty page)
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function PdfToDocxConverter({ apiKey }: { apiKey: string }) {
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, status: '' });
  const [reasoningLog, setReasoningLog] = useState<string[]>([]);
  const [documentContent, setDocumentContent] = useState<PageContent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isGeneratingDocx, setIsGeneratingDocx] = useState(false);
  const [showViewer, setShowViewer] = useState(false);
  const pageCanvasesRef = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const abortRef = useRef<AbortController | null>(null);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;
    if (file.size > MAX_PDF_SIZE_BYTES) {
      setError(`File is too large. Maximum size is ${MAX_PDF_SIZE_MB}MB.`);
      return;
    }
    setPdfFile(file);
    setDocumentContent(null);
    setError(null);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    maxFiles: 1,
    maxSize: MAX_PDF_SIZE_BYTES,
  });

  const processPdf = async () => {
    if (!pdfFile || !apiKey) return;

    // Cancel any in-flight processing
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsProcessing(true);
    setError(null);
    setDocumentContent(null);
    setReasoningLog([]);
    pageCanvasesRef.current.clear();

    try {
      const ai = new GoogleGenAI({ apiKey });

      // Load PDF
      setProgress({ current: 0, total: 0, status: 'Loading PDF...' });
      const arrayBuffer = await pdfFile.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const totalPages = pdf.numPages;

      setProgress({ current: 0, total: totalPages, status: 'Pre-rendering pages...' });

      // ── Phase 1: Pre-render all PDF pages in parallel for faster pipeline ──
      const canvasMap = new Map<number, HTMLCanvasElement>();
      const base64Map = new Map<number, string>();

      // Render pages in small batches to avoid memory pressure
      const RENDER_BATCH_SIZE = 4;
      for (let batch = 0; batch < totalPages; batch += RENDER_BATCH_SIZE) {
        if (controller.signal.aborted) return;
        const batchEnd = Math.min(batch + RENDER_BATCH_SIZE, totalPages);
        const batchPromises = [];
        for (let p = batch + 1; p <= batchEnd; p++) {
          batchPromises.push(
            renderPdfPage(pdf, p, PDF_RENDER_SCALE).then((canvas) => {
              canvasMap.set(p, canvas);
              pageCanvasesRef.current.set(p, canvas);
              // Pre-encode to base64 for API (lower quality = smaller payload = faster upload)
              const dataUrl = canvasToBase64(canvas, JPEG_QUALITY_API);
              base64Map.set(p, dataUrl.split(',')[1]);
            }),
          );
        }
        await Promise.all(batchPromises);
        setProgress({
          current: batchEnd,
          total: totalPages,
          status: `Pre-rendered ${batchEnd} of ${totalPages} pages...`,
        });
      }

      // ── Phase 2: Analyze pages with API (rendering is already done) ──
      const allPages: PageContent[] = [];

      for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        if (controller.signal.aborted) return;

        const canvas = canvasMap.get(pageNum)!;
        const base64Data = base64Map.get(pageNum)!;

        setProgress({
          current: pageNum,
          total: totalPages,
          status: `Analyzing page ${pageNum} of ${totalPages}...`,
        });

        // Send to Gemini for analysis with timeout
        const apiCall = ai.models.generateContent({
          model: GEMINI_MODEL,
          contents: [
            {
              role: 'user',
              parts: [
                { text: PDF_ANALYSIS_PROMPT },
                {
                  inlineData: {
                    data: base64Data,
                    mimeType: 'image/jpeg',
                  },
                },
              ],
            },
          ],
          config: {
            temperature: TEMP_PRECISE,
          },
        });

        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`API timeout: page ${pageNum} took too long`)), API_TIMEOUT_MS),
        );

        const response = await Promise.race([apiCall, timeoutPromise]);

        if (controller.signal.aborted) return;

        const responseText = response.text || '';
        const elements = parseGeminiResponse(responseText);

        // Process elements: extract images, render equations, compile TikZ
        setProgress({
          current: pageNum,
          total: totalPages,
          status: `Processing elements on page ${pageNum}...`,
        });

        // Collect image elements that need multi-agent TikZ generation
        const imageElements = elements.filter(
          (el) => el.type === 'image' && el.bbox && el.bbox.length === 4,
        );

        // Process image elements: crop for reference, then generate TikZ as the real output
        for (let imgIdx = 0; imgIdx < imageElements.length; imgIdx++) {
          const el = imageElements[imgIdx];
          if (controller.signal.aborted) return;

          // Crop image for reference display only (the DOCX will use TikZ-compiled image)
          const { dataUrl } = cropImageFromCanvas(canvas, el.bbox!);
          el.imageData = dataUrl;

          const figLabel = imageElements.length > 1
            ? `figure ${imgIdx + 1}/${imageElements.length}`
            : 'figure';

          // Run multi-agent TikZ generation on the cropped image
          setProgress({
            current: pageNum,
            total: totalPages,
            status: `Page ${pageNum}: generating TikZ for ${figLabel} (multi-agent)...`,
          });

          const cropBase64 = dataUrl.split(',')[1];

          // Attempt 1: full multi-agent pipeline
          let tikzSuccess = false;
          setReasoningLog((prev) => [...prev, `── Page ${pageNum}, ${figLabel} ──`]);
          try {
            const result = await generateTikzMultiAgent(
              apiKey,
              cropBase64,
              'image/png',
              {
                onProgress: (stage, detail) => {
                  setProgress({
                    current: pageNum,
                    total: totalPages,
                    status: `Page ${pageNum} ${figLabel}: ${detail}`,
                  });
                  setReasoningLog((prev) => [...prev, detail]);
                },
              },
            );

            el.tikz = result.tikzCode;

            // Append agent reasoning to visible log
            if (result.log.length > 0) {
              setReasoningLog((prev) => [...prev, ...result.log]);
            }

            // Compile TikZ to image
            setProgress({
              current: pageNum,
              total: totalPages,
              status: `Page ${pageNum} ${figLabel}: compiling TikZ to image...`,
            });
            const tikzResult = await tikzToImage(result.tikzCode);
            if (tikzResult) {
              el.tikzImage = tikzResult;
              tikzSuccess = true;
              setReasoningLog((prev) => [...prev, 'TikZ compiled to image successfully.']);
            } else {
              setReasoningLog((prev) => [...prev, 'TikZ browser compilation returned empty — will retry.']);
            }
          } catch (tikzErr) {
            const msg = tikzErr instanceof Error ? tikzErr.message : String(tikzErr);
            console.warn(`Multi-agent TikZ failed for ${figLabel}:`, tikzErr);
            setReasoningLog((prev) => [...prev, `Multi-agent pipeline failed: ${msg}. Retrying...`]);
          }

          // Attempt 2: single-agent fallback
          if (!tikzSuccess) {
            setProgress({
              current: pageNum,
              total: totalPages,
              status: `Page ${pageNum} ${figLabel}: retrying with single agent...`,
            });

            try {
              const singleCode = await generateTikzSingleAgent(apiKey, cropBase64, 'image/png');
              if (singleCode) {
                el.tikz = singleCode;
                const tikzResult = await tikzToImage(singleCode);
                if (tikzResult) {
                  el.tikzImage = tikzResult;
                  setReasoningLog((prev) => [...prev, 'Single-agent fallback succeeded.']);
                }
              }
            } catch {
              setReasoningLog((prev) => [...prev, 'Single-agent fallback also failed.']);
            }
          }
        }

        // Free the pre-encoded base64 to reduce memory
        base64Map.delete(pageNum);

        allPages.push({
          pageNumber: pageNum,
          elements,
          pageCanvas: canvas,
        });
      }

      if (controller.signal.aborted) return;

      setDocumentContent(allPages);
      setShowViewer(true);
      setProgress({ current: totalPages, total: totalPages, status: 'Done!' });
    } catch (err: unknown) {
      if (controller.signal.aborted) return; // user cancelled, no error

      console.error('Error processing PDF:', err);
      const message = err instanceof Error ? err.message : String(err);
      const lower = message.toLowerCase();

      if (lower.includes('api key') || lower.includes('401') || lower.includes('403') || lower.includes('authenticate')) {
        setError('Invalid API key. Please check your Gemini API key.');
      } else if (lower.includes('quota') || lower.includes('429') || lower.includes('rate')) {
        setError('API rate limit reached. Please wait a moment and try again.');
      } else if (lower.includes('password') || lower.includes('encrypted')) {
        setError('This PDF is password-protected. Please provide an unprotected PDF.');
      } else if (lower.includes('timeout')) {
        setError('Request timed out. The page may be too complex. Please try again.');
      } else if (lower.includes('network') || lower.includes('fetch') || lower.includes('failed to fetch')) {
        setError('Network error. Please check your internet connection.');
      } else {
        setError(message || 'An unexpected error occurred.');
      }
    } finally {
      setIsProcessing(false);
      abortRef.current = null;
    }
  };

  const downloadDocx = async () => {
    if (!documentContent) return;
    setIsGeneratingDocx(true);

    try {
      const fileName = pdfFile?.name?.replace(/\.pdf$/i, '') || 'document';
      const doc = buildDocx(documentContent, fileName);
      const blob = await Packer.toBlob(doc);

      // Download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${fileName}.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error generating DOCX:', err);
      setError('Failed to generate DOCX file. Please try again.');
    } finally {
      setIsGeneratingDocx(false);
    }
  };

  const reset = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPdfFile(null);
    setDocumentContent(null);
    setError(null);
    setShowViewer(false);
    setIsProcessing(false);
    setProgress({ current: 0, total: 0, status: '' });
    setReasoningLog([]);
    pageCanvasesRef.current.clear();
  };

  const fileName = pdfFile?.name?.replace(/\.pdf$/i, '') || 'document';

  const rightPanelTitle = isProcessing ? 'Processing' : documentContent ? 'Summary' : 'How it works';

  return (
    <>
      {/* ─── Fullscreen Document Viewer ─── */}
      {showViewer && documentContent && (
        <DocxViewer
          pages={documentContent}
          pageCanvases={pageCanvasesRef.current}
          fileName={fileName}
          onDownload={downloadDocx}
          isGenerating={isGeneratingDocx}
          onClose={() => setShowViewer(false)}
        />
      )}

      {/* ─── Split workspace ─── */}
      <div className="flex-1 flex overflow-hidden min-h-0">

        {/* ─── LEFT: dark input workspace ─── */}
        <div className="w-[360px] xl:w-[400px] shrink-0 flex flex-col border-r border-[#1f2e45] overflow-hidden">
          <div className="shrink-0 px-4 py-2.5 border-b border-[#1f2e45]">
            <span className="text-[10px] font-semibold text-white/20 uppercase tracking-widest font-sans-brand">Source PDF</span>
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-dark p-4">
            {!pdfFile ? (
              /* ── Drop zone ── */
              <div
                {...getRootProps()}
                role="button"
                aria-label="Upload a PDF file"
                className={`relative rounded-xl overflow-hidden cursor-pointer transition-all duration-200 group ${
                  isDragActive
                    ? 'ring-2 ring-[#FFAD1D] ring-offset-2 ring-offset-[#0c1017]'
                    : 'hover:ring-1 hover:ring-white/10'
                }`}
                style={{ minHeight: '300px' }}
              >
                <input {...getInputProps()} />
                <div className="graph-bg absolute inset-0 rounded-xl" />
                <div className="relative flex flex-col items-center justify-center py-14 text-center">
                  {isDragActive ? (
                    <>
                      <div className="w-14 h-14 rounded-2xl bg-[#FFAD1D]/15 border border-[#FFAD1D]/30 flex items-center justify-center mb-3">
                        <Upload className="w-6 h-6 text-[#FFAD1D]" />
                      </div>
                      <p className="text-sm font-medium text-[#FFAD1D] font-sans-brand">Release to upload</p>
                    </>
                  ) : (
                    <>
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none overflow-hidden rounded-xl">
                        <span className="text-[130px] font-serif-brand text-white/[0.032] leading-none -mt-4">∂</span>
                      </div>
                      <div className="w-10 h-10 rounded-xl bg-[#1a2438] border border-[#1f2e45] flex items-center justify-center mb-3 group-hover:border-[#FFAD1D]/30 group-hover:bg-[#FFAD1D]/8 transition-all">
                        <Upload className="w-4 h-4 text-white/30 group-hover:text-[#FFAD1D]/60 transition-colors" />
                      </div>
                      <p className="text-sm font-medium text-white/50 mb-1 font-sans-brand group-hover:text-white/70 transition-colors">Drop PDF here</p>
                      <p className="text-xs text-white/22 font-sans-brand">PDF — max 50 MB</p>
                    </>
                  )}
                </div>
              </div>
            ) : (
              /* ── File selected ── */
              <div className="space-y-3">
                {/* File chip */}
                <div className="flex items-center gap-3 p-3 bg-[#1a2438] rounded-xl border border-[#1f2e45]">
                  <div className="w-9 h-9 bg-[#FFAD1D]/15 rounded-lg flex items-center justify-center shrink-0">
                    <FileText className="w-4 h-4 text-[#FFAD1D]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white/80 truncate font-sans-brand">{pdfFile.name}</p>
                    <p className="text-xs text-white/30 font-sans-brand">{(pdfFile.size / 1024 / 1024).toFixed(2)} MB</p>
                  </div>
                  <button onClick={reset} className="text-white/25 hover:text-white/60 transition-colors" title="Remove file">
                    <RotateCcw className="w-4 h-4" />
                  </button>
                </div>

                {/* Error */}
                {error && (
                  <div className="bg-red-950/40 rounded-xl p-3.5 flex items-start gap-3 border border-red-900/30">
                    <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-red-300 mb-0.5 font-sans-brand">Error</p>
                      <p className="text-xs text-red-300/70 font-sans-brand">{error}</p>
                    </div>
                  </div>
                )}

                {/* Convert button */}
                {!documentContent && !isProcessing && (
                  <button
                    onClick={processPdf}
                    className="btn-gold w-full text-[#0c1017] font-semibold py-3 px-4 rounded-xl text-sm flex items-center justify-center gap-2 font-sans-brand"
                  >
                    Convert to DOCX
                    <ChevronRight className="w-4 h-4" />
                  </button>
                )}

                {/* Cancel during processing */}
                {isProcessing && (
                  <button
                    onClick={() => abortRef.current?.abort()}
                    className="w-full text-[11px] text-white/30 hover:text-white/55 transition-colors border border-white/8 hover:border-white/15 rounded-lg py-2 font-sans-brand"
                  >
                    Cancel conversion
                  </button>
                )}

                {/* Post-conversion actions */}
                {documentContent && !isProcessing && (
                  <div className="space-y-2">
                    <button
                      onClick={() => setShowViewer(true)}
                      className="btn-gold w-full text-[#0c1017] font-semibold py-3 px-4 rounded-xl text-sm flex items-center justify-center gap-2 font-sans-brand"
                    >
                      <FileDown className="w-4 h-4" />
                      View Document
                    </button>
                    <button
                      onClick={downloadDocx}
                      disabled={isGeneratingDocx}
                      className="w-full flex items-center justify-center gap-1.5 text-[11px] font-medium text-white/35 hover:text-white/65 border border-white/8 hover:border-white/18 rounded-xl py-2.5 transition-all font-sans-brand disabled:opacity-40"
                    >
                      {isGeneratingDocx ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                      {isGeneratingDocx ? 'Generating…' : 'Download DOCX'}
                    </button>
                    <button
                      onClick={reset}
                      className="w-full flex items-center justify-center gap-1.5 text-[11px] text-white/22 hover:text-white/45 transition-colors py-2 font-sans-brand"
                    >
                      <RotateCcw className="w-3 h-3" />
                      Convert another PDF
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Bottom hint */}
          <div className="shrink-0 px-4 py-2.5 border-t border-[#1f2e45]">
            <p className="text-[10px] text-white/18 font-sans-brand leading-relaxed">
              PDF → Word &nbsp;·&nbsp; OMML equations &nbsp;·&nbsp; TikZ figures &nbsp;·&nbsp; MathType compatible
            </p>
          </div>
        </div>

        {/* ─── RIGHT: light output pane ─── */}
        <div className="flex-1 flex flex-col bg-[#f8f7f4] overflow-hidden min-w-0">
          <div className="shrink-0 px-4 py-2.5 border-b border-black/6 bg-white/50">
            <span className="text-[10px] font-semibold text-black/25 uppercase tracking-widest font-sans-brand">{rightPanelTitle}</span>
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-light p-5">
            {isProcessing ? (
              <div className="space-y-4">
                {/* Progress status */}
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-[#FFAD1D] shrink-0" />
                  <p className="text-sm text-black/50 font-sans-brand">{progress.status}</p>
                </div>
                {progress.total > 0 && (
                  <div className="w-full bg-black/8 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="progress-shimmer h-full rounded-full transition-all duration-500"
                      style={{ width: `${(progress.current / progress.total) * 100}%` }}
                    />
                  </div>
                )}
                {/* Agent log — terminal style */}
                {reasoningLog.length > 0 && (
                  <div className="rounded-xl overflow-hidden shadow-[0_4px_24px_rgba(0,0,0,0.15)]" style={{ background: '#141924' }}>
                    <div className="flex items-center gap-3 px-4 py-2.5 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                      <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: '#FF5F57' }} />
                        <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: '#FFBD2E' }} />
                        <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: '#28C840' }} />
                      </div>
                      <span className="text-[10px] text-white/30 uppercase tracking-widest font-sans-brand">Agent Log</span>
                    </div>
                    <div className="p-4 max-h-72 overflow-y-auto scrollbar-dark space-y-0.5">
                      {reasoningLog.map((line, i) => (
                        <p
                          key={i}
                          className={`text-[11px] leading-relaxed ${
                            line.startsWith('──')
                              ? 'text-[#FFAD1D]/60 font-semibold mt-2'
                              : line.startsWith('  ')
                                ? 'text-white/30 pl-2'
                                : 'text-white/45'
                          }`}
                          style={{ fontFamily: 'Consolas, "Cascadia Code", "Fira Code", monospace' }}
                        >
                          {line}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : documentContent ? (
              /* ── Conversion summary ── */
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm font-medium text-black/60 font-sans-brand">
                  <CheckCircle2 className="w-4 h-4 text-[#B9CF7C]" />
                  Converted {documentContent.length} page{documentContent.length !== 1 ? 's' : ''}
                </div>
                {/* Element type counts */}
                {(() => {
                  const counts: Record<string, number> = {};
                  for (const page of documentContent) {
                    for (const el of page.elements) {
                      counts[el.type] = (counts[el.type] || 0) + 1;
                    }
                  }
                  const labels: Record<string, string> = {
                    heading: 'Headings',
                    paragraph: 'Paragraphs',
                    equation: 'Equations',
                    table: 'Tables',
                    image: 'Figures',
                  };
                  return (
                    <div className="grid grid-cols-2 gap-2">
                      {Object.entries(counts).map(([type, count]) => (
                        <div key={type} className="bg-white rounded-xl border border-black/6 px-4 py-3">
                          <p className="text-[10px] text-black/30 uppercase tracking-widest font-sans-brand mb-0.5">{labels[type] ?? type}</p>
                          <p className="text-xl font-semibold text-black/70 font-serif-brand">{count}</p>
                        </div>
                      ))}
                    </div>
                  );
                })()}
                {/* Reasoning log (post-processing, collapsed) */}
                {reasoningLog.length > 0 && (
                  <details className="group">
                    <summary className="text-[11px] text-black/35 hover:text-black/55 cursor-pointer font-sans-brand select-none">
                      View agent log ({reasoningLog.length} lines)
                    </summary>
                    <div className="mt-2 rounded-xl overflow-hidden" style={{ background: '#141924' }}>
                      <div className="p-3 max-h-56 overflow-y-auto scrollbar-dark space-y-0.5">
                        {reasoningLog.map((line, i) => (
                          <p
                            key={i}
                            className={`text-[10px] leading-relaxed ${
                              line.startsWith('──') ? 'text-[#FFAD1D]/60 font-semibold mt-1.5' : 'text-white/35'
                            }`}
                            style={{ fontFamily: 'Consolas, monospace' }}
                          >
                            {line}
                          </p>
                        ))}
                      </div>
                    </div>
                  </details>
                )}
              </div>
            ) : (
              /* ── How it works ── */
              <div className="space-y-3">
                {[
                  { num: '1', text: 'Upload a PDF — text, equations, tables, figures all supported.' },
                  { num: '2', text: 'AI reads each page with image-to-LaTeX precision, capturing every symbol and notation.' },
                  { num: '3', text: 'Equations become OMML — editable in Word via MathType Toggle TeX.' },
                  { num: '4', text: 'Figures run through a multi-agent TikZ pipeline and are compiled to crisp images.' },
                  { num: '5', text: 'Download the .docx — open in Word and start editing immediately.' },
                ].map(({ num, text }) => (
                  <div key={num} className="flex gap-3">
                    <span className="shrink-0 w-6 h-6 rounded-full bg-black/6 flex items-center justify-center text-[11px] font-semibold text-black/35 font-sans-brand">{num}</span>
                    <p className="text-sm text-black/50 leading-relaxed font-sans-brand pt-0.5">{text}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>
    </>
  );
}
