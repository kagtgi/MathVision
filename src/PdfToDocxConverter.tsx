import { useState, useCallback, useRef } from 'react';
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
  BorderStyle,
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
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import { latexToMathChildren, parseTextWithMath } from './utils/latexToDocxMath';
import { latexToImage, tikzToImage } from './utils/latexToImage';

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
   - bbox = [x%, y%, width%, height%] as percentage of page dimensions
   - Include caption if visible
   - IMPORTANT: For geometric figures, diagrams, graphs, and mathematical drawings, also generate a "tikz" field with complete TikZ code (\\begin{tikzpicture}...\\end{tikzpicture}) that faithfully reproduces the figure. Use TikZ libraries: calc, arrows.meta, decorations.markings, angles, quotes. Include labels, colors, line styles, and all visual details. For photos or non-geometric images, omit the "tikz" field.
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
  await page.render({ canvasContext: ctx, canvas, viewport } as any).promise;
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
            const maxWidth = 500;
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
            const maxWidth = 500;
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
  // Split text on $...$ and render with KaTeX via ReactMarkdown
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

function PreviewElement({ element }: { element: DocumentElement }) {
  switch (element.type) {
    case 'heading': {
      const classes: Record<number, string> = {
        1: 'text-2xl font-bold mt-6 mb-3 text-[#00186E]',
        2: 'text-xl font-semibold mt-5 mb-2 text-[#00186E]',
        3: 'text-lg font-medium mt-4 mb-2 text-[#00186E]/90',
      };
      const cls = classes[element.level || 1] || classes[1];
      return (
        <div className={`${cls} font-sans-brand`}>
          <InlineMathText text={element.content || ''} />
        </div>
      );
    }

    case 'paragraph':
      return (
        <div className="mb-3 text-[#00186E]/80 leading-relaxed font-serif-brand">
          <InlineMathText text={element.content || ''} />
        </div>
      );

    case 'equation':
      return (
        <div className="my-4 text-center">
          <ReactMarkdown
            remarkPlugins={[remarkMath]}
            rehypePlugins={[rehypeKatex]}
          >
            {`$$${element.latex || ''}$$`}
          </ReactMarkdown>
        </div>
      );

    case 'table': {
      if (!element.rows || element.rows.length === 0) return null;
      return (
        <div className="my-4 overflow-x-auto">
          <table className="w-full border-collapse border border-[#00186E]/20 text-sm">
            <thead>
              <tr className="bg-[#00186E]/5 font-semibold">
                {element.rows[0].map((cell, ci) => (
                  <th
                    key={ci}
                    className="border border-[#00186E]/20 px-3 py-2 text-left"
                  >
                    <InlineMathText text={cell || ''} />
                  </th>
                ))}
              </tr>
            </thead>
            {element.rows.length > 1 && (
              <tbody>
                {element.rows.slice(1).map((row, ri) => (
                  <tr key={ri}>
                    {row.map((cell, ci) => (
                      <td
                        key={ci}
                        className="border border-[#00186E]/20 px-3 py-2 text-left"
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
        <div className="my-4 text-center">
          {element.imageData ? (
            <>
              <img
                src={element.imageData}
                alt={element.caption || 'Extracted image'}
                className="max-w-full h-auto inline-block rounded-lg border border-[#00186E]/10"
              />
              {element.tikz && (
                <details className="mt-2 text-left inline-block max-w-lg">
                  <summary className="text-xs text-[#00186E]/40 cursor-pointer font-sans-brand hover:text-[#00186E]/60">
                    TikZ code generated
                  </summary>
                  <pre className="mt-1 text-xs bg-[#00186E]/5 rounded-lg p-3 overflow-x-auto text-[#00186E]/70 whitespace-pre-wrap">
                    {element.tikz}
                  </pre>
                </details>
              )}
              {element.caption && (
                <p className="text-sm text-[#00186E]/50 italic mt-2 font-sans-brand">
                  {element.caption}
                </p>
              )}
            </>
          ) : (
            <div className="inline-block bg-[#00186E]/5 rounded-lg px-6 py-4 text-[#00186E]/40 text-sm font-sans-brand">
              [Image{element.caption ? `: ${element.caption}` : ''}]
            </div>
          )}
        </div>
      );

    default:
      return null;
  }
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function PdfToDocxConverter({ apiKey }: { apiKey: string }) {
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, status: '' });
  const [documentContent, setDocumentContent] = useState<PageContent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isGeneratingDocx, setIsGeneratingDocx] = useState(false);
  const pageCanvasesRef = useRef<Map<number, HTMLCanvasElement>>(new Map());

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) {
      setError('File is too large. Maximum size is 50MB.');
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
    maxSize: 50 * 1024 * 1024,
  });

  const processPdf = async () => {
    if (!pdfFile || !apiKey) return;

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
        setProgress({
          current: pageNum,
          total: totalPages,
          status: `Processing page ${pageNum} of ${totalPages}...`,
        });

        // Render page to canvas
        const canvas = await renderPdfPage(pdf, pageNum, 2);
        pageCanvasesRef.current.set(pageNum, canvas);

        // Convert to base64 for Gemini
        const imageDataUrl = canvasToBase64(canvas, 0.85);
        const base64Data = imageDataUrl.split(',')[1];

        // Send to Gemini for analysis
        const response = await ai.models.generateContent({
          model: 'gemini-2.0-flash',
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
            temperature: 0.1,
          },
        });

        const responseText = response.text || '';
        const elements = parseGeminiResponse(responseText);

        // Process elements: extract images, render equations, compile TikZ
        for (const el of elements) {
          if (el.type === 'image' && el.bbox && el.bbox.length === 4) {
            const { dataUrl } = cropImageFromCanvas(canvas, el.bbox);
            el.imageData = dataUrl;

            // If TikZ code was generated for this image, compile it to a rendered image
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

      setDocumentContent(allPages);
      setProgress({ current: totalPages, total: totalPages, status: 'Done!' });
    } catch (err: unknown) {
      console.error('Error processing PDF:', err);
      const message = err instanceof Error ? err.message : String(err);
      const lower = message.toLowerCase();

      if (lower.includes('api key') || lower.includes('401') || lower.includes('403') || lower.includes('authenticate')) {
        setError('Invalid API key. Please check your Gemini API key.');
      } else if (lower.includes('quota') || lower.includes('429') || lower.includes('rate')) {
        setError('API rate limit reached. Please wait a moment and try again.');
      } else if (lower.includes('password') || lower.includes('encrypted')) {
        setError('This PDF is password-protected. Please provide an unprotected PDF.');
      } else if (lower.includes('network') || lower.includes('fetch') || lower.includes('failed to fetch')) {
        setError('Network error. Please check your internet connection.');
      } else {
        setError(message || 'An unexpected error occurred.');
      }
    } finally {
      setIsProcessing(false);
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
    setPdfFile(null);
    setDocumentContent(null);
    setError(null);
    setProgress({ current: 0, total: 0, status: '' });
    pageCanvasesRef.current.clear();
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
        {/* Left Column — Input */}
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

                  {/* Convert button */}
                  {!documentContent && (
                    <button
                      onClick={processPdf}
                      disabled={isProcessing}
                      className="w-full bg-[#FFAD1D] hover:bg-[#e89c10] text-[#00186E] font-semibold py-3 px-4 rounded-xl shadow-sm transition-colors disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2 font-sans-brand"
                    >
                      {isProcessing ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          Processing PDF...
                        </>
                      ) : (
                        <>
                          <ChevronRight className="w-5 h-5" />
                          Convert to DOCX
                        </>
                      )}
                    </button>
                  )}

                  {/* Download button (shown after processing) */}
                  {documentContent && (
                    <div className="space-y-3">
                      <button
                        onClick={downloadDocx}
                        disabled={isGeneratingDocx}
                        className="w-full bg-[#00186E] hover:bg-[#001050] text-white font-semibold py-3 px-4 rounded-xl shadow-sm transition-colors disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2 font-sans-brand"
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

        {/* Right Column — Preview */}
        <div className="lg:sticky lg:top-24">
          <div className="bg-white rounded-2xl shadow-sm border border-[#00186E]/10 min-h-[400px] lg:min-h-[calc(100vh-8rem)] flex flex-col overflow-hidden">
            <div className="p-4 border-b border-[#00186E]/5 bg-[#00186E]/[0.02] flex items-center justify-between">
              <h2 className="font-medium text-[#00186E] flex items-center gap-2 font-sans-brand">
                <FileDown className="w-4 h-4 text-[#FFAD1D]" />
                Document Preview
              </h2>
              {documentContent && (
                <span className="text-xs text-[#00186E]/40 font-sans-brand">
                  {documentContent.length} page{documentContent.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>

            <div className="flex-1 p-0 overflow-y-auto">
              {isProcessing ? (
                <div className="h-full flex flex-col items-center justify-center text-[#00186E]/40 space-y-4 p-8">
                  <Loader2 className="w-10 h-10 animate-spin text-[#FFAD1D]" />
                  <div className="text-center">
                    <p className="text-sm font-medium animate-pulse font-sans-brand">
                      {progress.status || 'Analyzing PDF...'}
                    </p>
                    {progress.total > 0 && (
                      <p className="text-xs text-[#00186E]/30 mt-1 font-sans-brand">
                        Page {progress.current} of {progress.total}
                      </p>
                    )}
                  </div>
                </div>
              ) : error ? (
                <div className="p-6">
                  <div className="bg-red-50 text-red-800 rounded-xl p-4 flex items-start gap-3 border border-red-100">
                    <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                    <div>
                      <h3 className="font-medium mb-1 font-sans-brand">
                        Error processing PDF
                      </h3>
                      <p className="text-sm text-red-700/90">{error}</p>
                    </div>
                  </div>
                </div>
              ) : documentContent ? (
                <div className="p-6">
                  {/* DOCX Preview */}
                  <div className="bg-white border border-[#00186E]/10 rounded-xl shadow-inner p-6 min-h-[300px]">
                    {documentContent.map((page, pageIdx) => (
                      <div key={pageIdx}>
                        {pageIdx > 0 && (
                          <div className="border-t-2 border-dashed border-[#00186E]/10 my-6 relative">
                            <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-white px-3 text-xs text-[#00186E]/30 font-sans-brand">
                              Page {page.pageNumber}
                            </span>
                          </div>
                        )}
                        {page.elements.map((el, elIdx) => (
                          <PreviewElement key={`${pageIdx}-${elIdx}`} element={el} />
                        ))}
                      </div>
                    ))}
                  </div>

                  {/* Download button in preview */}
                  <div className="mt-6 text-center">
                    <button
                      onClick={downloadDocx}
                      disabled={isGeneratingDocx}
                      className="inline-flex items-center gap-2 bg-[#00186E] hover:bg-[#001050] text-white font-semibold py-3 px-8 rounded-xl shadow-sm transition-colors disabled:opacity-70 font-sans-brand"
                    >
                      {isGeneratingDocx ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          Generating...
                        </>
                      ) : (
                        <>
                          <Download className="w-5 h-5" />
                          Download DOCX
                        </>
                      )}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-[#00186E]/30 p-8 text-center">
                  <div className="w-16 h-16 bg-[#00186E]/5 rounded-full flex items-center justify-center mb-4">
                    <FileText className="w-7 h-7 text-[#00186E]/20" />
                  </div>
                  <p className="text-sm font-medium text-[#00186E]/50 font-sans-brand">
                    No document yet
                  </p>
                  <p className="text-xs text-[#00186E]/30 mt-1 max-w-xs font-sans-brand">
                    Upload a PDF and click "Convert to DOCX" to see the preview here.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
