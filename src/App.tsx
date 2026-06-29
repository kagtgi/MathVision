import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { GoogleGenAI } from '@google/genai';
import { Upload, Image as ImageIcon, Loader2, Copy, CheckCircle2, AlertCircle, Key, ImageDown, Eye, Code, FileText, ArrowRightLeft, Download } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { motion } from 'framer-motion';
import { Document as DocxDocument, Packer, Paragraph, TextRun, Math as OfficeMath, ImageRun, AlignmentType } from 'docx';
import PdfToDocxConverter from './PdfToDocxConverter';
import { waitForTikzSvg, preprocessTikzForTikzJax, tikzToImage } from './utils/latexToImage';
import { GEMINI_MODEL, TEMP_STANDARD, LATEX_MATH_RULES, ANTI_HALLUCINATION, OUTPUT_FORMAT_RULES, TIKZJAX_COMPAT_RULES } from './utils/sharedPrompts';
import { sanitizeLatexBlock, warnMismatchedDollars, sanitizeLatexExpr } from './utils/latexSanitizer';
import { latexToMathChildren } from './utils/latexToDocxMath';

type AppMode = 'image-to-latex' | 'pdf-to-docx';

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

const SYSTEM_INSTRUCTION = `You are MathVision, an expert LaTeX assistant for Vietnamese math teachers.
Analyze the image and output compilable LaTeX/TikZ code — nothing else.

## STEP 1 — Classify
Determine what the image contains:
- TYPE A: Geometric figure (shapes, triangles, circles, lines, coordinate axes, graphs)
- TYPE B: Math formulas, expressions, equations, text with math
- BOTH: contains a geometric figure AND formulas/text

## STEP 2A — For TYPE A (Geometric Figure) → TikZ code

Output a complete TikZ figure in a single \`\`\`latex code block.

REQUIRED STRUCTURE:
\`\`\`latex
% \\usepackage{tikz}
% \\usetikzlibrary{angles, quotes, calc, decorations.markings}

\\begin{tikzpicture}[scale=1]
  % --- coordinates ---
  \\coordinate (A) at (0, 0);
  \\coordinate (B) at (4, 0);

  % --- edges ---
  \\draw[thick] (A) -- (B);

  % --- labels ---
  \\fill (A) circle (1.5pt);
  \\node[below left] at (A) {$A$};
\\end{tikzpicture}
\`\`\`

RULES for TikZ (non-negotiable):
1. Declare ALL \\coordinate BEFORE any use — order matters.
2. Every visible labeled point: \\fill (X) circle (1.5pt); \\node[anchor] at (X) {$X$};
3. All math in node labels must be wrapped in $...$
4. [thick] for primary edges; [dashed] for auxiliary/construction lines.
5. Right-angle marks: draw a small square manually or use \\pic[draw]{right angle = A--H--B}; (requires angles library).
6. Angle arcs with label: \\pic["$\\alpha$", draw, angle radius=8mm, angle eccentricity=1.6]{angle = C--B--A}; (requires angles, quotes).
7. Equal-segment ticks: use decorations.markings with a tick mark pattern.
8. Fit the whole figure inside [0, 6]×[0, 6]. Adjust coordinates to match image proportions.
9. Only declare libraries you actually use.
10. Do NOT draw anything not visible in the image.
${TIKZJAX_COMPAT_RULES}

## STEP 2B — For TYPE B (Formulas/Text) → LaTeX expressions

Output ALL math expressions in a single \`\`\`latex code block, one per line:

\`\`\`latex
$expression_1$
$expression_2$
plain text (no dollar signs)
\`\`\`

RULES for formulas:
- Every math expression wrapped in $...$
- Fractions: \\frac{a}{b} — NEVER write a/b; use \\dfrac{a}{b} when the fraction should appear taller
- Roots: \\sqrt{x}, \\sqrt[3]{8}
- Vietnamese angles: \\widehat{ABC} (default) or \\angle ABC
- Degrees: $60^{\\circ}$ — always ^{\\circ}, never {}^\\circ or bare °
- Absolute value: $\\left| x \\right|$
- Brackets: always \\left( \\right), \\left[ \\right], \\left\\{ \\right\\}
- Derivatives: $\{f\}'(x)$, $\{y\}''$ — plain grouping braces (not \\{)
- Vietnamese decimals: $3{,}14$
- Vectors/rays: \\overrightarrow{AB}; abstract vectors: \\boldsymbol{v}; segments: $AB$
- Number sets: $\\mathbb{R}$, $\\mathbb{N}$, $\\mathbb{Z}$, $\\mathbb{Q}$
- Never wrap output in \\[ \\] — use $...$ per expression, one per line
- Multi-line structures go INSIDE $...$: $\\begin{cases}...\\end{cases}$, $\\begin{pmatrix}...\\end{pmatrix}$
- Never use top-level align, equation, gather as output wrappers
- Never use \\textbf, \\textit, \\emph, \\color, \\newcommand, \\def
- Plain text labels or problem numbers → outside $...$

EXAMPLES of correct output:
$x = \\dfrac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$
$\\lim_{x \\to 0} \\dfrac{\\sin x}{x} = 1$
$\\int_{0}^{\\pi} \\sin x \\, dx = 2$
$\\overrightarrow{AB} = \\overrightarrow{AC} + \\overrightarrow{CB}$
$\\triangle ABC \\cong \\triangle DEF$
$\\widehat{BAC} = 60^{\\circ}$
$\\begin{cases} 2x + y = 5 \\\\ x - y = 1 \\end{cases}$
${LATEX_MATH_RULES}

## STEP 2C — For BOTH → Two separate code blocks

First output the TikZ \`\`\`latex block, then the formula \`\`\`latex block.

## OUTPUT FORMAT — ABSOLUTE RULES
- Output ONLY the \`\`\`latex code block(s). Zero prose. Zero explanation.
- Do NOT say "Here is...", "The code is...", "Note:", or anything outside the blocks.
- If image is unreadable or has no math: output exactly one line → Không đọc được ảnh.
- Never start with anything other than \`\`\`latex or the above error line.
${ANTI_HALLUCINATION}
${OUTPUT_FORMAT_RULES}`;

export default function App() {
  const [apiKey, setApiKey] = useState('');
  const [apiKeySubmitted, setApiKeySubmitted] = useState(false);
  const [appMode, setAppMode] = useState<AppMode>('image-to-latex');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDownloadingDocx, setIsDownloadingDocx] = useState(false);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;

    if (file.size > MAX_FILE_SIZE) {
      setError(`File is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum size is 20MB.`);
      return;
    }

    setImageFile(file);
    setResult(null);
    setError(null);

    // Use createImageBitmap for faster, off-main-thread image decoding
    const MAX_DIM = 1024;

    createImageBitmap(file)
      .then((bitmap) => {
        let width = bitmap.width;
        let height = bitmap.height;

        if (width > height) {
          if (width > MAX_DIM) {
            height *= MAX_DIM / width;
            width = MAX_DIM;
          }
        } else {
          if (height > MAX_DIM) {
            width *= MAX_DIM / height;
            height = MAX_DIM;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(bitmap, 0, 0, width, height);
          bitmap.close(); // Free memory
          const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
          setImagePreview(dataUrl);
        } else {
          // Fallback: read as data URL directly
          bitmap.close();
          const reader = new FileReader();
          reader.onloadend = () => {
            if (typeof reader.result === 'string') setImagePreview(reader.result);
          };
          reader.readAsDataURL(file);
        }
      })
      .catch(() => {
        setError("The file could not be loaded as an image. Please use a PNG, JPG, or WebP file.");
      });
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.png', '.jpg', '.jpeg', '.webp']
    },
    maxFiles: 1,
    maxSize: MAX_FILE_SIZE,
  });

  const processImage = async () => {
    if (!imageFile || !imagePreview) return;

    setIsProcessing(true);
    setError(null);
    setResult(null);
    setProcessingStatus('Sending image to AI…');

    try {
      if (!apiKey) {
        throw new Error("Please enter your Gemini API key first.");
      }

      const ai = new GoogleGenAI({ apiKey });

      const base64Data = imagePreview.split(',')[1];
      const mimeTypeMatch = imagePreview.match(/^data:(image\/[\w+.-]+);base64,/);
      const mimeType = mimeTypeMatch ? mimeTypeMatch[1] : 'image/jpeg';

      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: [{
          role: 'user',
          parts: [
            { text: SYSTEM_INSTRUCTION },
            { inlineData: { data: base64Data, mimeType } },
            { text: 'Convert this image to LaTeX/TikZ code following the instructions above.' },
          ],
        }],
        config: { temperature: TEMP_STANDARD },
      });

      const output = response.text?.trim() || '';
      if (!output) {
        setError("The model returned an empty response. Please try again.");
        return;
      }

      setResult(output);
    } catch (err: unknown) {
      console.error("Error processing image:", err);
      const message = err instanceof Error ? err.message : String(err);
      const lowerMessage = message.toLowerCase();
      if (lowerMessage.includes('api key') || lowerMessage.includes('401') || lowerMessage.includes('403') || lowerMessage.includes('authenticate')) {
        setError("Invalid API key. Please check your Gemini API key and try again. You can get a key at https://aistudio.google.com/apikey");
      } else if (lowerMessage.includes('quota') || lowerMessage.includes('429') || lowerMessage.includes('rate')) {
        setError("API rate limit reached. Please wait a moment and try again.");
      } else if (lowerMessage.includes('network') || lowerMessage.includes('fetch') || lowerMessage.includes('failed to fetch')) {
        setError("Network error. Please check your internet connection and try again.");
      } else {
        setError(message || "An unexpected error occurred. Please try again.");
      }
    } finally {
      setIsProcessing(false);
      setProcessingStatus('');
    }
  };

  const downloadAsDocx = async () => {
    if (!result) return;
    setIsDownloadingDocx(true);
    try {
      const { tikzBlocks, latexBlocks } = parseOutputBlocks(result);
      const docChildren: Paragraph[] = [];

      // TikZ blocks → compile to PNG and embed
      for (const tikzCode of tikzBlocks) {
        try {
          const tikzResult = await tikzToImage(tikzCode);
          if (tikzResult) {
            const maxW = 400;
            const scale = tikzResult.width > maxW ? maxW / tikzResult.width : 1;
            docChildren.push(
              new Paragraph({
                children: [
                  new ImageRun({
                    data: tikzResult.bytes,
                    transformation: {
                      width: Math.round(tikzResult.width * scale),
                      height: Math.round(tikzResult.height * scale),
                    },
                    type: 'png',
                  }),
                ],
                alignment: AlignmentType.CENTER,
                spacing: { before: 160, after: 160 },
              }),
            );
          }
        } catch { /* skip failed TikZ */ }
      }

      // LaTeX blocks → line by line, math expressions → OMML
      for (const latexCode of latexBlocks) {
        for (const line of latexCode.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          const mathMatch = trimmed.match(/^\$(.+)\$$/);
          if (mathMatch) {
            try {
              const mathChildren = latexToMathChildren(sanitizeLatexExpr(mathMatch[1]));
              docChildren.push(
                new Paragraph({
                  children: [new OfficeMath({ children: mathChildren })],
                  alignment: AlignmentType.CENTER,
                  spacing: { before: 120, after: 120 },
                }),
              );
            } catch {
              docChildren.push(
                new Paragraph({
                  children: [new TextRun({ text: trimmed, italics: true })],
                  spacing: { after: 60 },
                }),
              );
            }
          } else {
            docChildren.push(
              new Paragraph({
                children: [new TextRun({ text: trimmed })],
                spacing: { after: 60 },
              }),
            );
          }
        }
      }

      if (docChildren.length === 0) return;

      const doc = new DocxDocument({ sections: [{ children: docChildren }] });
      const blob = await Packer.toBlob(doc);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'mathvision-output.docx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('DOCX download failed:', err);
    } finally {
      setIsDownloadingDocx(false);
    }
  };

  if (!apiKeySubmitted) {
    return (
      <div className="min-h-screen bg-[#0c1017] flex items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-sm"
        >
          {/* Wordmark */}
          <div className="flex items-center gap-3 mb-10">
            <div className="w-11 h-11 bg-[#FFAD1D] rounded-xl flex items-center justify-center shadow-[0_0_28px_rgba(255,173,29,0.22)]">
              <span className="text-[#0c1017] font-bold text-2xl font-serif-brand leading-none select-none">∑</span>
            </div>
            <div>
              <h1 className="text-xl font-semibold text-white font-serif-brand tracking-tight leading-none">MathVision</h1>
              <p className="text-xs text-white/30 mt-0.5 tracking-wide font-sans-brand">LaTeX · TikZ · DOCX</p>
            </div>
          </div>

          {/* Card */}
          <div className="bg-[#131924] border border-[#1f2e45] rounded-2xl p-6 shadow-[0_24px_64px_rgba(0,0,0,0.5)]">
            <label htmlFor="api-key" className="block text-[11px] font-semibold text-white/35 mb-2.5 tracking-widest uppercase font-sans-brand">
              Gemini API Key
            </label>
            <div className="relative">
              <Key className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/20 pointer-events-none" />
              <input
                id="api-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && apiKey.trim()) setApiKeySubmitted(true); }}
                placeholder="AIza…"
                className="w-full bg-[#0c1017] border border-[#1f2e45] rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder-white/15 focus:outline-none focus:border-[#FFAD1D]/60 focus:ring-2 focus:ring-[#FFAD1D]/10 transition-all font-mono tracking-wide"
              />
            </div>
            <p className="mt-3 text-xs text-white/22 leading-relaxed font-sans-brand">
              Free key at{' '}
              <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-[#FFAD1D]/60 hover:text-[#FFAD1D] transition-colors">
                aistudio.google.com
              </a>
              {' '}— runs only in your browser.
            </p>

            <button
              onClick={() => { if (apiKey.trim()) setApiKeySubmitted(true); }}
              disabled={!apiKey.trim()}
              className="btn-gold mt-5 w-full text-[#0c1017] font-semibold py-3 px-4 rounded-xl text-sm font-sans-brand"
            >
              Open MathVision
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[#0c1017] text-[#c8d3e8] overflow-hidden">

      {/* ── Minimal header ── */}
      <header className="shrink-0 h-11 bg-[#0d1322] border-b border-[#1f2e45] flex items-center justify-between px-4 z-10">
        <div className="flex items-center gap-1">
          {/* Wordmark */}
          <div className="flex items-center gap-2 mr-3">
            <div className="w-6 h-6 bg-[#FFAD1D] rounded-md flex items-center justify-center shadow-[0_0_12px_rgba(255,173,29,0.2)]">
              <span className="text-[#0c1017] font-bold text-[11px] font-serif-brand leading-none select-none">∑</span>
            </div>
            <span className="text-white/65 font-semibold text-[13px] font-serif-brand tracking-tight">MathVision</span>
          </div>
          {/* Mode pills */}
          <div className="flex bg-[#0a0f1a] rounded-lg p-0.5 gap-0.5">
            <button
              onClick={() => setAppMode('image-to-latex')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-medium transition-all font-sans-brand ${
                appMode === 'image-to-latex'
                  ? 'bg-[#1a2438] text-[#FFAD1D]'
                  : 'text-white/25 hover:text-white/50'
              }`}
            >
              <ImageIcon className="w-3 h-3" />
              Image → LaTeX
            </button>
            <button
              onClick={() => setAppMode('pdf-to-docx')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-medium transition-all font-sans-brand ${
                appMode === 'pdf-to-docx'
                  ? 'bg-[#1a2438] text-[#FFAD1D]'
                  : 'text-white/25 hover:text-white/50'
              }`}
            >
              <FileText className="w-3 h-3" />
              PDF → DOCX
            </button>
          </div>
        </div>

        <button
          onClick={() => { setApiKey(''); setApiKeySubmitted(false); setResult(null); setError(null); }}
          className="flex items-center gap-1.5 text-[11px] text-white/25 hover:text-white/50 border border-white/8 hover:border-white/15 rounded-lg px-2.5 py-1 transition-all font-sans-brand"
        >
          <Key className="w-3 h-3" />
          API Key
        </button>
      </header>

      {/* ── Workspace ── */}
      {appMode === 'pdf-to-docx' ? (
        <PdfToDocxConverter apiKey={apiKey} />
      ) : (
        <div className="flex-1 flex overflow-hidden min-h-0">

          {/* ─── LEFT: dark input workspace ─── */}
          <div className="w-[360px] xl:w-[400px] shrink-0 flex flex-col border-r border-[#1f2e45] overflow-hidden">
            {/* Panel label */}
            <div className="shrink-0 px-4 py-2.5 border-b border-[#1f2e45]">
              <span className="text-[10px] font-semibold text-white/20 uppercase tracking-widest font-sans-brand">Source Image</span>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-dark p-4">
              {!imagePreview ? (
                /* ── Drop zone ── */
                <div
                  {...getRootProps()}
                  role="button"
                  aria-label="Upload an image of math content"
                  className={`relative rounded-xl overflow-hidden cursor-pointer transition-all duration-200 group ${
                    isDragActive
                      ? 'ring-2 ring-[#FFAD1D] ring-offset-2 ring-offset-[#0c1017]'
                      : 'hover:ring-1 hover:ring-white/10'
                  }`}
                  style={{ minHeight: '300px' }}
                >
                  <input {...getInputProps()} />
                  {/* Graph-paper ground */}
                  <div className="graph-bg absolute inset-0 rounded-xl" />
                  {/* Content */}
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
                        {/* Giant decorative ∫ — the aesthetic risk */}
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none overflow-hidden rounded-xl">
                          <span className="text-[140px] font-serif-brand text-white/[0.032] leading-none -mt-4">∫</span>
                        </div>
                        <div className="w-10 h-10 rounded-xl bg-[#1a2438] border border-[#1f2e45] flex items-center justify-center mb-3 group-hover:border-[#FFAD1D]/30 group-hover:bg-[#FFAD1D]/8 transition-all">
                          <Upload className="w-4.5 h-4.5 text-white/30 group-hover:text-[#FFAD1D]/60 transition-colors" />
                        </div>
                        <p className="text-sm font-medium text-white/50 mb-1 font-sans-brand group-hover:text-white/70 transition-colors">Drop image here</p>
                        <p className="text-xs text-white/22 font-sans-brand">PNG · JPG · WebP — max 20 MB</p>
                      </>
                    )}
                  </div>
                </div>
              ) : (
                /* ── Image preview + convert ── */
                <div className="space-y-3">
                  <div className="relative rounded-xl overflow-hidden border border-[#1f2e45] bg-[#101623] group" style={{ maxHeight: '320px' }}>
                    <img
                      src={imagePreview}
                      alt="Uploaded math content"
                      className="w-full h-auto max-h-[320px] object-contain"
                    />
                    <div className="absolute inset-0 bg-black/55 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <button
                        {...getRootProps()}
                        className="bg-white/10 backdrop-blur-sm text-white/90 border border-white/20 px-4 py-2 rounded-lg text-xs font-medium hover:bg-white/18 transition-colors font-sans-brand"
                      >
                        <input {...getInputProps()} />
                        Replace image
                      </button>
                    </div>
                  </div>

                  <button
                    onClick={processImage}
                    disabled={isProcessing}
                    className="btn-gold w-full text-[#0c1017] font-semibold py-3 px-4 rounded-xl text-sm flex items-center justify-center gap-2 font-sans-brand"
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Converting…
                      </>
                    ) : result ? (
                      <>
                        <ArrowRightLeft className="w-4 h-4" />
                        Convert Again
                      </>
                    ) : (
                      <>
                        Convert to LaTeX
                        <ArrowRightLeft className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>

            {/* Bottom hint strip */}
            <div className="shrink-0 px-4 py-2.5 border-t border-[#1f2e45]">
              <p className="text-[10px] text-white/18 font-sans-brand leading-relaxed">
                Geometry → TikZ &nbsp;·&nbsp; Equations → LaTeX &nbsp;·&nbsp; MathType compatible
              </p>
            </div>
          </div>

          {/* ─── RIGHT: light output — simulates a document page ─── */}
          <div className="flex-1 flex flex-col bg-[#f8f7f4] overflow-hidden min-w-0">
            {/* Output header */}
            <div className="shrink-0 px-4 py-2.5 border-b border-black/6 bg-white/50 flex items-center justify-between">
              <span className="text-[10px] font-semibold text-black/25 uppercase tracking-widest font-sans-brand">Output</span>
              {result && !isProcessing && (
                <div className="flex items-center gap-3">
                  <button
                    onClick={downloadAsDocx}
                    disabled={isDownloadingDocx}
                    className="flex items-center gap-1 text-[11px] font-medium text-black/30 hover:text-black/60 transition-colors font-sans-brand disabled:opacity-40"
                  >
                    {isDownloadingDocx
                      ? <Loader2 className="w-3 h-3 animate-spin" />
                      : <Download className="w-3 h-3" />}
                    {isDownloadingDocx ? 'Building…' : 'Download DOCX'}
                  </button>
                  <button
                    onClick={() => { setResult(null); setError(null); }}
                    className="text-[11px] text-black/25 hover:text-black/50 transition-colors font-sans-brand"
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-light">
              {isProcessing ? (
                <div className="h-full flex flex-col items-center justify-center gap-4 text-black/30">
                  <Loader2 className="w-7 h-7 animate-spin text-[#FFAD1D]" />
                  <p className="text-sm font-medium text-black/40 font-sans-brand">
                    {processingStatus || 'Analyzing image…'}
                  </p>
                </div>
              ) : error ? (
                <div className="p-5">
                  <div className="bg-red-50 text-red-900 rounded-xl p-4 flex items-start gap-3 border border-red-100/80">
                    <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold mb-1 font-sans-brand">Error</p>
                      <p className="text-sm text-red-700/80 font-sans-brand">{error}</p>
                      <button
                        onClick={processImage}
                        className="mt-2.5 text-xs font-medium text-red-600 hover:text-red-800 underline underline-offset-2 font-sans-brand"
                      >
                        Try again
                      </button>
                    </div>
                  </div>
                </div>
              ) : result ? (
                <div className="p-5">
                  <ResultRenderer content={result} />
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center select-none">
                  <span className="text-[72px] font-serif-brand leading-none text-black/[0.045] mb-3">f(x)</span>
                  <p className="text-sm font-medium text-black/25 font-sans-brand">Output appears here</p>
                  <p className="text-xs text-black/15 mt-1 font-sans-brand">Upload an image to begin</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Output parsing ──────────────────────────────────────────────────────────

/** Extract all ```latex / ```tex fenced code blocks from the AI output. */
function parseOutputBlocks(content: string): { tikzBlocks: string[]; latexBlocks: string[]; plainText: string } {
  const tikzBlocks: string[] = [];
  const latexBlocks: string[] = [];

  const regex = /```(?:latex|tex)\s*\n([\s\S]*?)\n?```/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const code = match[1].trim();
    if (!code) continue;
    if (code.includes('\\begin{tikzpicture}')) {
      tikzBlocks.push(code);
    } else {
      const sanitized = sanitizeLatexBlock(code);
      warnMismatchedDollars(sanitized, 'LaTeX block');
      latexBlocks.push(sanitized);
    }
  }

  // Plain text = everything left after stripping code fences
  const plainText = content.replace(/```(?:latex|tex)\s*\n[\s\S]*?\n?```/g, '').trim();

  return { tikzBlocks, latexBlocks, plainText };
}

// ─── Top-level result display ─────────────────────────────────────────────────

/**
 * Renders AI output in a guaranteed layout:
 *   1. TikZ Preview  (rendered figure)
 *   2. TikZ Code     (copyable source)
 *   3. LaTeX Preview (KaTeX rendered formulas)
 *   4. LaTeX Code    (copyable source)
 *   5. Plain text    (if no code blocks found — e.g. error message)
 */
function ResultRenderer({ content }: { content: string }) {
  const { tikzBlocks, latexBlocks, plainText } = useMemo(
    () => parseOutputBlocks(content),
    [content],
  );

  const hasBlocks = tikzBlocks.length > 0 || latexBlocks.length > 0;

  return (
    <div>
      {/* 1+2 — TikZ Preview → TikZ Code */}
      {tikzBlocks.map((code, i) => (
        <TikzSection key={`tikz-${i}`} code={code} />
      ))}

      {/* 3+4 — LaTeX Preview → LaTeX Code */}
      {latexBlocks.map((code, i) => (
        <LatexSection key={`latex-${i}`} code={code} />
      ))}

      {/* 5 — Plain text (error / unreadable message) */}
      {!hasBlocks && plainText && (
        <p className="p-4 text-sm text-black/50 font-sans-brand">{plainText}</p>
      )}
    </div>
  );
}


// ─── Section components ───────────────────────────────────────────────────────

/** Renders TikZ: Preview → Code (guaranteed order) */
function TikzSection({ code }: { code: string }) {
  const [tikzImageUrl, setTikzImageUrl] = useState<string | null>(null);

  return (
    <>
      <PreviewBlock
        title="TikZ Preview"
        icon={<Eye className="w-3.5 h-3.5 mr-1" />}
        actions={
          tikzImageUrl ? (
            <div className="flex items-center gap-3">
              <DownloadImageButton imageDataUrl={tikzImageUrl} />
              <CopyImageButton imageDataUrl={tikzImageUrl} />
            </div>
          ) : undefined
        }
      >
        <TikzRendererWithRef code={code} onImageReady={setTikzImageUrl} />
      </PreviewBlock>

      <CodeBlockPanel label="TikZ Code" code={code} />
    </>
  );
}

/** Renders LaTeX formulas: Preview → Code (guaranteed order) */
function LatexSection({ code }: { code: string }) {
  return (
    <>
      <PreviewBlock
        title="LaTeX Preview"
        icon={<Eye className="w-3.5 h-3.5 mr-1" />}
      >
        <div className="text-[#1a2035] overflow-auto prose prose-slate max-w-none">
          <ReactMarkdown
            remarkPlugins={[remarkMath]}
            rehypePlugins={[rehypeKatex]}
          >
            {code}
          </ReactMarkdown>
        </div>
      </PreviewBlock>

      <CodeBlockPanel label="LaTeX Code" code={code} />
    </>
  );
}

function CopyCodeButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = code;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      aria-label="Copy code to clipboard"
      className="flex items-center gap-1 text-[11px] font-medium text-white/30 hover:text-white/70 transition-colors font-sans-brand"
    >
      {copied ? (
        <>
          <CheckCircle2 className="w-3 h-3 text-[#B9CF7C]" />
          <span className="text-[#B9CF7C]">Copied</span>
        </>
      ) : (
        <>
          <Copy className="w-3 h-3" />
          <span>Copy</span>
        </>
      )}
    </button>
  );
}

function DownloadImageButton({ imageDataUrl }: { imageDataUrl: string }) {
  const handleDownload = () => {
    const a = document.createElement('a');
    a.href = imageDataUrl;
    a.download = 'tikz-figure.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <button
      onClick={handleDownload}
      aria-label="Download image as PNG"
      className="flex items-center gap-1.5 text-xs font-medium text-black/30 hover:text-black/60 transition-colors font-sans-brand"
    >
      <ImageDown className="w-3.5 h-3.5" />
      <span>Download</span>
    </button>
  );
}

function CopyImageButton({ imageDataUrl }: { imageDataUrl: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopyImage = async () => {
    try {
      const res = await fetch(imageDataUrl);
      const blob = await res.blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: download
      const a = document.createElement('a');
      a.href = imageDataUrl;
      a.download = 'tikz-figure.png';
      a.click();
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <button
      onClick={handleCopyImage}
      aria-label="Copy image to clipboard"
      className="flex items-center gap-1.5 text-xs font-medium text-black/30 hover:text-black/60 transition-colors font-sans-brand"
    >
      {copied ? (
        <>
          <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
          <span className="text-green-600">Copied</span>
        </>
      ) : (
        <>
          <Copy className="w-3.5 h-3.5" />
          <span>Copy Image</span>
        </>
      )}
    </button>
  );
}

function PreviewBlock({ title, icon, children, actions }: { title: string, icon: React.ReactNode, children: React.ReactNode, actions?: React.ReactNode }) {
  return (
    <div className="mb-3 rounded-xl overflow-hidden border border-black/8 shadow-sm bg-white">
      <div className="flex items-center justify-between px-4 py-2 bg-[#f5f4f1] border-b border-black/6">
        <div className="flex items-center gap-1 text-[10px] font-semibold text-black/30 uppercase tracking-widest font-sans-brand">
          {icon}
          {title}
        </div>
        {actions}
      </div>
      <div className="p-4">
        {children}
      </div>
    </div>
  );
}

function CodeBlockPanel({ label, code }: { label: string, code: string }) {
  return (
    <div className="mb-6 rounded-xl overflow-hidden shadow-[0_4px_24px_rgba(0,0,0,0.3)]" style={{ background: '#141924' }}>
      {/* macOS-style titlebar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        <div className="flex items-center gap-3">
          {/* Traffic lights — decorative */}
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full inline-block" style={{ background: '#FF5F57' }} />
            <span className="w-3 h-3 rounded-full inline-block" style={{ background: '#FFBD2E' }} />
            <span className="w-3 h-3 rounded-full inline-block" style={{ background: '#28C840' }} />
          </div>
          <div className="flex items-center gap-1.5 text-[10px] font-medium text-white/30 uppercase tracking-widest font-sans-brand">
            <Code className="w-3 h-3" />
            {label}
          </div>
        </div>
        <CopyCodeButton code={code} />
      </div>
      <div className="p-4 overflow-x-auto scrollbar-dark">
        <pre className="!m-0 !p-0 !bg-transparent">
          <code className="text-sm leading-relaxed whitespace-pre" style={{ color: '#a8c8f0', fontFamily: 'Consolas, "Cascadia Code", "Fira Code", "JetBrains Mono", monospace' }}>
            {code}
          </code>
        </pre>
      </div>
    </div>
  );
}


const TIKZ_DOM_TIMEOUT_MS = 30_000; // Match TIKZ_RENDER_TIMEOUT_MS; complex figures need full 30s

function TikzRendererWithRef({ code, onImageReady }: { code: string, onImageReady?: (dataUrl: string | null) => void }) {
  const [pngDataUrl, setPngDataUrl] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(true);
  const [renderError, setRenderError] = useState<string | null>(null);
  const onImageReadyRef = useRef(onImageReady);
  onImageReadyRef.current = onImageReady;

  useEffect(() => {
    let cancelled = false;

    const fail = (msg: string) => {
      if (cancelled) return;
      setIsRendering(false);
      setRenderError(msg);
      onImageReadyRef.current?.(null);
    };

    const renderDiv = document.createElement('div');
    renderDiv.style.position = 'absolute';
    renderDiv.style.left = '-9999px';
    renderDiv.style.top = '-9999px';
    renderDiv.style.visibility = 'hidden';
    document.body.appendChild(renderDiv);

    const cleanup = () => {
      if (renderDiv.parentNode) document.body.removeChild(renderDiv);
    };

    const script = document.createElement('script');
    script.type = 'text/tikz';
    script.textContent = preprocessTikzForTikzJax(code);
    renderDiv.appendChild(script);

    waitForTikzSvg(renderDiv, TIKZ_DOM_TIMEOUT_MS).then((svg) => {
      if (cancelled) return;
      if (!svg) {
        cleanup();
        fail('Preview failed — the TikZ code may contain unsupported syntax. The source is shown below; copy it to compile with pdflatex.');
        return;
      }

      const svgClone = svg.cloneNode(true) as SVGElement;
      if (!svgClone.getAttribute('xmlns')) svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      const svgData = new XMLSerializer().serializeToString(svgClone);
      const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);

      const img = new Image();
      img.onload = () => {
        if (cancelled) { URL.revokeObjectURL(url); return; }

        // Use naturalWidth — for off-DOM images it equals the intrinsic SVG width.
        // img.width can be 0 when the SVG has no explicit width attribute,
        // which would produce a blank 0×0 canvas that looks like a silent success.
        const scale = 2;
        const naturalW = img.naturalWidth || img.width;
        const naturalH = img.naturalHeight || img.height;

        if (!naturalW || !naturalH) {
          URL.revokeObjectURL(url);
          cleanup();
          fail('Rendered SVG has zero dimensions — the figure may be empty.');
          return;
        }

        const w = naturalW * scale;
        const h = naturalH * scale;

        // Use a local canvas — multiple TikzRendererWithRef components can
        // be active simultaneously (one per TikZ block in the result).
        // A shared canvas would be corrupted by concurrent img.onload calls.
        const localCanvas = document.createElement('canvas');
        localCanvas.width = w;
        localCanvas.height = h;
        const localCtx = localCanvas.getContext('2d');
        if (!localCtx) { cleanup(); return; }
        localCtx.fillStyle = 'white';
        localCtx.fillRect(0, 0, w, h);
        localCtx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        cleanup();
        const dataUrl = localCanvas.toDataURL('image/png');
        if (!cancelled) {
          setPngDataUrl(dataUrl);
          setIsRendering(false);
          onImageReadyRef.current?.(dataUrl);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        cleanup();
        fail('Could not load the rendered SVG — the TikZ code may have errors.');
      };
      img.src = url;
    });

    return () => {
      cancelled = true;
      if (renderDiv.parentNode) document.body.removeChild(renderDiv);
    };
  }, [code]);

  return (
    <div className="flex justify-center bg-white rounded-lg overflow-hidden" style={{ minHeight: '200px' }}>
      {isRendering ? (
        <div className="flex flex-col items-center justify-center w-full h-48 gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-[#FFAD1D]" />
          <div className="text-center">
            <p className="text-sm font-sans-brand text-black/40">Rendering figure…</p>
            <p className="text-xs font-sans-brand mt-0.5 text-black/25">Complex figures can take up to 30 s</p>
          </div>
        </div>
      ) : pngDataUrl ? (
        <img src={pngDataUrl} alt="TikZ figure" className="max-w-full h-auto" />
      ) : (
        <div className="flex flex-col items-center justify-center w-full min-h-[120px] p-4 gap-2">
          <AlertCircle className="w-5 h-5 text-amber-500 shrink-0" />
          <p className="text-sm font-sans-brand text-center text-amber-700">{renderError}</p>
        </div>
      )}
    </div>
  );
}
