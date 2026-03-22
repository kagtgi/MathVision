import { useState, useCallback, useRef, memo } from 'react';
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
import { latexToImage, tikzToImage } from './utils/latexToImage';
import { generateTikzMultiAgent } from './utils/tikzMultiAgent';

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_PDF_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB
const MAX_PDF_SIZE_MB = 50;
const PDF_RENDER_SCALE = 2;
const JPEG_QUALITY = 0.85;
const DOCX_MAX_IMAGE_WIDTH = 500; // points (~6.9 inches)
const GEMINI_MODEL = 'gemini-2.5-pro-preview-06-05';
const GEMINI_TEMPERATURE = 0.1;
const API_TIMEOUT_MS = 120_000; // 120 seconds per page (pro model is slower)

// ─── PDF.js Worker Setup ─────────────────────────────────────────────────────

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

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
  equationImage?: {       // rendered equation as image
    bytes: Uint8Array;
    width: number;
    height: number;
  };
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
    {"type": "image", "bbox": [10, 20, 30, 25], "caption": "Figure 1: Description", "tikz": "\\\\begin{tikzpicture}...\\\\end{tikzpicture}"}
  ]
}

Rules:
1. Extract ALL content top-to-bottom, left-to-right in reading order
2. "heading": for titles, section headers, chapter titles. Use level 1, 2, or 3
3. "paragraph": for text blocks. Wrap inline math with $...$ delimiters. Treat every mathematical expression as an image-to-LaTeX task — reproduce the exact notation, symbols, spacing, and structure visible in the image
4. "equation": for standalone/display equations on their own line. Put LaTeX WITHOUT $ delimiters in the "latex" field. Convert with image-to-LaTeX quality: capture every symbol, subscript, superscript, fraction, operator, and decoration exactly as shown
5. "table": for tables. Each cell is a string. Use $...$ for LaTeX math or plain text in cells. Include header row as first row
6. "image": for figures, diagrams, geometric drawings, charts, and graphs:
   - bbox = [x%, y%, width%, height%] as percentage of page dimensions — be VERY precise with bounding box coordinates
   - Include caption if visible
   - Do NOT include a "tikz" field — TikZ code will be generated separately by a specialized pipeline
7. Preserve ALL text EXACTLY as shown (including non-English characters)
8. Convert ALL mathematical expressions to proper LaTeX notation with maximum accuracy:
   - Use \\frac{}{} for fractions, \\sqrt{} for roots, \\widehat{} for angle notation
   - Use \\overrightarrow{} for vectors/rays, \\triangle for triangles
   - Use correct Greek letters (\\alpha, \\beta, \\gamma, etc.)
   - Use \\left( \\right) for auto-sized delimiters
   - Reproduce every detail: superscripts, subscripts, decorations, operators
9. For numbered lists or bullet points, include the number/bullet in the paragraph content
10. Return ONLY the JSON object — no markdown formatting, no code blocks, no explanation`;

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

          // Prefer rendered equation image for highest quality
          if (el.equationImage) {
            const { bytes, width, height } = el.equationImage;
            const maxWidth = DOCX_MAX_IMAGE_WIDTH;
            const scale = width > maxWidth ? maxWidth / width : 1;
            children.push(
              new Paragraph({
                children: [
                  new ImageRun({
                    data: bytes,
                    transformation: {
                      width: Math.round(width * scale),
                      height: Math.round(height * scale),
                    },
                    type: 'png',
                  }),
                ],
                alignment: AlignmentType.CENTER,
                spacing: { before: 120, after: 120 },
              })
            );
          } else {
            // Fallback: OMML equation
            try {
              const mathChildren = latexToMathChildren(el.latex);
              children.push(
                new Paragraph({
                  children: [new OfficeMath({ children: mathChildren })],
                  alignment: AlignmentType.CENTER,
                  spacing: { before: 120, after: 120 },
                })
              );
            } catch {
              // Fallback: insert as text
              children.push(
                new Paragraph({
                  children: [new TextRun({ text: el.latex, italics: true })],
                  alignment: AlignmentType.CENTER,
                  spacing: { before: 120, after: 120 },
                })
              );
            }
          }
          break;
        }

        case 'table': {
          if (!el.rows || el.rows.length === 0) break;
          const tableRows = el.rows.map((row, rowIdx) => {
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
          // Prefer TikZ-compiled image over cropped image for diagrams
          const imgSource = el.tikzImage
            ? el.tikzImage
            : el.imageData && el.bbox && page.pageCanvas
              ? (() => {
                  try {
                    return cropImageFromCanvas(page.pageCanvas, el.bbox);
                  } catch {
                    return null;
                  }
                })()
              : null;

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
          } else if (el.caption) {
            children.push(
              new Paragraph({
                children: [new TextRun({ text: `[Image: ${el.caption}]`, italics: true })],
                spacing: { after: 120 },
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

// ─── Claude-style Document Viewer ───────────────────────────────────────────

function DocxViewer({
  pages,
  fileName,
  onDownload,
  isGenerating,
  onClose,
}: {
  pages: PageContent[];
  fileName: string;
  onDownload: () => void;
  isGenerating: boolean;
  onClose: () => void;
}) {
  const [zoom, setZoom] = useState(100);
  const [copied, setCopied] = useState(false);

  const totalElements = pages.reduce((acc, p) => acc + p.elements.length, 0);

  const handleCopyText = async () => {
    // Extract all text content for clipboard
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

      {/* ─── Document body — scrollable area with paper pages ─── */}
      <div className="flex-1 overflow-auto py-8 px-4">
        <div
          className="mx-auto flex flex-col items-center gap-8"
          style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top center' }}
        >
          {pages.map((page, pageIdx) => (
            <div
              key={pageIdx}
              className="bg-white shadow-[0_2px_8px_rgba(0,0,0,0.3)] relative"
              style={{
                width: '8.5in',
                minHeight: '11in',
                padding: '1in',
                boxSizing: 'border-box',
              }}
            >
              {/* Page number label */}
              <div
                className="absolute top-3 right-4 text-[8pt] text-gray-300 select-none"
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
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function PdfToDocxConverter({ apiKey }: { apiKey: string }) {
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, status: '' });
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
    pageCanvasesRef.current.clear();

    try {
      const ai = new GoogleGenAI({ apiKey });

      // Load PDF
      setProgress({ current: 0, total: 0, status: 'Loading PDF...' });
      const arrayBuffer = await pdfFile.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const totalPages = pdf.numPages;

      setProgress({ current: 0, total: totalPages, status: 'Analyzing pages...' });

      const allPages: PageContent[] = [];

      for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        // Check if user cancelled
        if (controller.signal.aborted) return;

        setProgress({
          current: pageNum,
          total: totalPages,
          status: `Rendering page ${pageNum} of ${totalPages}...`,
        });

        // Render page to canvas
        const canvas = await renderPdfPage(pdf, pageNum, PDF_RENDER_SCALE);
        pageCanvasesRef.current.set(pageNum, canvas);

        if (controller.signal.aborted) return;

        // Convert to base64 for Gemini
        setProgress({
          current: pageNum,
          total: totalPages,
          status: `Analyzing page ${pageNum} of ${totalPages}...`,
        });
        const imageDataUrl = canvasToBase64(canvas, JPEG_QUALITY);
        const base64Data = imageDataUrl.split(',')[1];

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
            temperature: GEMINI_TEMPERATURE,
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

        // Process image elements: crop + run multi-agent TikZ pipeline
        for (const el of imageElements) {
          if (controller.signal.aborted) return;

          const { dataUrl } = cropImageFromCanvas(canvas, el.bbox!);
          el.imageData = dataUrl;

          // Run multi-agent TikZ generation on the cropped image
          setProgress({
            current: pageNum,
            total: totalPages,
            status: `Page ${pageNum}: generating TikZ for figure (multi-agent)...`,
          });

          try {
            const cropBase64 = dataUrl.split(',')[1];
            const result = await generateTikzMultiAgent(
              apiKey,
              cropBase64,
              'image/png',
              (stage, detail) => {
                setProgress({
                  current: pageNum,
                  total: totalPages,
                  status: `Page ${pageNum}: ${detail || stage}`,
                });
              },
            );

            el.tikz = result.tikzCode;

            // Compile the generated TikZ to image
            try {
              const tikzResult = await tikzToImage(result.tikzCode);
              if (tikzResult) {
                el.tikzImage = tikzResult;
              }
            } catch {
              // TikZ browser compilation failed — keep tikz code but fall back to cropped image
            }
          } catch (tikzErr) {
            console.warn('Multi-agent TikZ generation failed for image element:', tikzErr);
            // Fall back: if Gemini's initial analysis included tikz, try compiling that
            if (el.tikz) {
              try {
                const tikzResult = await tikzToImage(el.tikz);
                if (tikzResult) {
                  el.tikzImage = tikzResult;
                }
              } catch {
                // TikZ compilation failed — fall back to cropped image
              }
            }
          }
        }

        // Process equation elements
        for (const el of elements) {
          if (controller.signal.aborted) return;

          // Render display equations as images for high-quality Word output
          if (el.type === 'equation' && el.latex) {
            try {
              const eqImg = await latexToImage(el.latex, true);
              el.equationImage = eqImg;
            } catch {
              // Equation image rendering failed — will fall back to OMML
            }
          }
        }

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
    pageCanvasesRef.current.clear();
  };

  const fileName = pdfFile?.name?.replace(/\.pdf$/i, '') || 'document';

  return (
    <>
      {/* ─── Fullscreen Document Viewer (Claude-style artifact) ─── */}
      {showViewer && documentContent && (
        <DocxViewer
          pages={documentContent}
          fileName={fileName}
          onDownload={downloadDocx}
          isGenerating={isGeneratingDocx}
          onClose={() => setShowViewer(false)}
        />
      )}

      {/* ─── Main input UI ─── */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-6">
          {/* Upload Section */}
          <div className="bg-white rounded-2xl shadow-sm border border-[#00186E]/10 overflow-hidden">
            <div className="p-4 border-b border-[#00186E]/5 bg-[#00186E]/[0.02]">
              <h2 className="font-medium text-[#00186E] flex items-center gap-2 font-sans-brand">
                <FileText className="w-4 h-4 text-[#FFAD1D]" />
                Input PDF
              </h2>
            </div>

            <div className="p-4">
              {!pdfFile ? (
                <div
                  {...getRootProps()}
                  role="button"
                  aria-label="Upload a PDF file"
                  className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors duration-200 ${
                    isDragActive
                      ? 'border-[#FFAD1D] bg-[#FFAD1D]/10'
                      : 'border-[#00186E]/20 hover:border-[#FFAD1D] hover:bg-[#FFAD1D]/5'
                  }`}
                >
                  <input {...getInputProps()} />
                  <Upload className="w-10 h-10 text-[#00186E]/30 mx-auto mb-4" />
                  <p className="text-sm font-medium text-[#00186E]/70 mb-1 font-sans-brand">
                    Drag & drop a PDF here
                  </p>
                  <p className="text-xs text-[#00186E]/40 font-sans-brand">
                    or click to select a file (max 50MB)
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* File info */}
                  <div className="flex items-center gap-3 p-3 bg-[#00186E]/[0.03] rounded-xl border border-[#00186E]/10">
                    <div className="w-10 h-10 bg-[#FFAD1D]/20 rounded-lg flex items-center justify-center">
                      <FileText className="w-5 h-5 text-[#FFAD1D]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#00186E] truncate font-sans-brand">
                        {pdfFile.name}
                      </p>
                      <p className="text-xs text-[#00186E]/50 font-sans-brand">
                        {(pdfFile.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>
                    <button
                      onClick={reset}
                      className="text-xs text-[#00186E]/50 hover:text-[#00186E] transition-colors font-sans-brand"
                      title="Remove file"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Progress */}
                  {isProcessing && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm text-[#00186E]/70 font-sans-brand">
                        <Loader2 className="w-4 h-4 animate-spin text-[#FFAD1D]" />
                        {progress.status}
                      </div>
                      {progress.total > 0 && (
                        <div className="w-full bg-[#00186E]/10 rounded-full h-2">
                          <div
                            className="bg-[#FFAD1D] h-2 rounded-full transition-all duration-500"
                            style={{
                              width: `${(progress.current / progress.total) * 100}%`,
                            }}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Error */}
                  {error && (
                    <div className="bg-red-50 text-red-800 rounded-xl p-4 flex items-start gap-3 border border-red-100">
                      <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                      <div>
                        <h3 className="font-medium mb-1 font-sans-brand">Error</h3>
                        <p className="text-sm text-red-700/90">{error}</p>
                      </div>
                    </div>
                  )}

                  {/* Convert button */}
                  {!documentContent && !isProcessing && (
                    <button
                      onClick={processPdf}
                      disabled={isProcessing}
                      className="w-full bg-[#FFAD1D] hover:bg-[#e89c10] text-[#00186E] font-semibold py-3 px-4 rounded-xl shadow-sm transition-colors disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2 font-sans-brand"
                    >
                      <ChevronRight className="w-5 h-5" />
                      Convert to DOCX
                    </button>
                  )}

                  {/* Post-processing actions */}
                  {documentContent && (
                    <div className="space-y-3">
                      {/* Open document viewer */}
                      <button
                        onClick={() => setShowViewer(true)}
                        className="w-full bg-[#00186E] hover:bg-[#001050] text-white font-semibold py-3 px-4 rounded-xl shadow-sm transition-colors flex items-center justify-center gap-2 font-sans-brand"
                      >
                        <FileDown className="w-5 h-5" />
                        View Document
                      </button>

                      {/* Download */}
                      <button
                        onClick={downloadDocx}
                        disabled={isGeneratingDocx}
                        className="w-full border-2 border-[#00186E] text-[#00186E] hover:bg-[#00186E]/5 font-semibold py-3 px-4 rounded-xl transition-colors disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2 font-sans-brand"
                      >
                        {isGeneratingDocx ? (
                          <>
                            <Loader2 className="w-5 h-5 animate-spin" />
                            Generating DOCX...
                          </>
                        ) : (
                          <>
                            <Download className="w-5 h-5" />
                            Download DOCX
                          </>
                        )}
                      </button>

                      <button
                        onClick={reset}
                        className="w-full border border-[#00186E]/20 text-[#00186E]/70 hover:text-[#00186E] hover:border-[#00186E]/40 font-medium py-2.5 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 font-sans-brand text-sm"
                      >
                        <RotateCcw className="w-4 h-4" />
                        Convert Another PDF
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Instructions */}
          <div className="bg-[#B9CF7C]/20 rounded-2xl border border-[#B9CF7C]/40 p-5">
            <h3 className="text-sm font-semibold text-[#00186E] mb-2 font-sans-brand">
              How it works
            </h3>
            <ul className="text-sm text-[#00186E]/70 space-y-2 list-disc list-inside font-serif-brand">
              <li>Upload a PDF file with text, equations, tables, and images.</li>
              <li>
                AI analyzes each page to detect structure and convert equations to{' '}
                <strong>LaTeX</strong>, quality as image to LaTeX.
              </li>
              <li>
                Equations are converted to LaTeX equation as image to LaTeX{' '}
                <code className="text-xs bg-[#00186E]/5 px-1 rounded">$...$</code> and put in Word.
              </li>
              <li>
                Tables are preserved as <strong>Word tables</strong> with LaTeX math or text in each cell.
              </li>
              <li>
                Images are extracted, then generate <strong>TikZ code</strong>, compile to image,
                and placed at correct positions.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}
