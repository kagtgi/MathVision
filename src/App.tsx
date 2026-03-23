import { useState, useCallback, useEffect, useRef } from 'react';
import { GoogleGenAI } from '@google/genai';
import { Upload, Image as ImageIcon, Loader2, Copy, CheckCircle2, AlertCircle, Key, ImageDown, Eye, Code, FileText, ArrowRightLeft } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { motion } from 'framer-motion';
import PdfToDocxConverter from './PdfToDocxConverter';
import { generateTikzMultiAgent, extractTikzCode } from './utils/tikzMultiAgent';
import { waitForTikzSvg, getReusableCanvas, preprocessTikzForTikzJax } from './utils/latexToImage';
import { GEMINI_MODEL, LATEX_MATH_RULES, ANTI_HALLUCINATION, OUTPUT_FORMAT_RULES } from './utils/sharedPrompts';

type AppMode = 'image-to-latex' | 'pdf-to-docx';

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

const SYSTEM_INSTRUCTION = `You are MathVision, an expert assistant for mathematics teachers in Vietnam.
Convert handwritten or printed math content from images into clean LaTeX.

## Rules
- Respond in the same language the teacher uses (Vietnamese or English).
- Be concise — output ONLY the code block(s), no prose, no preamble.
- Never simplify, solve, or alter the math — reproduce exactly what is shown.
- If the image is unreadable or contains no math, say so in one sentence only.
- Preserve Vietnamese text exactly as shown (UTF-8).
${ANTI_HALLUCINATION}

## Step 1 — Classify the image content
Determine what the image contains. There are exactly two categories:
- TYPE A — GEOMETRIC FIGURE (shapes, diagrams, coordinate systems, graphs)
- TYPE B — FORMULA / EXPRESSION (equations, integrals, matrices, etc.)
If BOTH present, output both (TikZ block first, then LaTeX block).

## Step 2A — Geometric figures → TikZ code

Output a complete, compilable TikZ figure inside a \`\`\`latex code block.
The multi-agent pipeline will refine it, but make a best effort:

- Wrap in \\begin{tikzpicture}[scale=1]...\\end{tikzpicture}
- Declare \\usetikzlibrary{...} as comments at the top
- Use named \\coordinate for every point BEFORE using it
- Mark every labeled point: \\fill (A) circle (1.5pt); \\node[anchor] at (A) {$A$};
- All math labels in $...$
- [thick] for main edges, [dashed] for construction lines
- Right angles: \\pic[draw] {right angle = A--H--B};
- Angle arcs: \\pic[draw, angle radius=8pt, "$\\alpha$", angle eccentricity=1.5] {angle = C--B--A};
- Equal-segment ticks: decorations.markings
- Fit in [0,6]×[0,6], scale=1 default
- Do NOT add elements not visible in the image.

## Step 2B — Formulas → LaTeX

- Wrap ALL math in $...$. One $...$ per line for multi-line derivations.
- Never use \\[ \\], align, align*, equation, gather, or display environments.
- Plain text (labels, problem numbers) → as-is, no LaTeX wrapper.
- Never use \\textbf, \\textit, \\emph, \\color.
${LATEX_MATH_RULES}

## Output format — STRICT
- Output ONLY code block(s) — no explanation before or after.
- If both types: TikZ block first, then LaTeX block.
- Never say "Here is..." or "The code is..." — just output the code.
- Every response must start with either \`\`\`latex or a plain text line from the image.
${OUTPUT_FORMAT_RULES}`;

export default function App() {
  const [apiKey, setApiKey] = useState('');
  const [apiKeySubmitted, setApiKeySubmitted] = useState(false);
  const [appMode, setAppMode] = useState<AppMode>('image-to-latex');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState('');
  const [processingLog, setProcessingLog] = useState<string[]>([]);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    setProcessingStatus('Analyzing image...');
    setProcessingLog([]);

    try {
      if (!apiKey) {
        throw new Error("Please enter your Gemini API key first.");
      }

      const ai = new GoogleGenAI({ apiKey });

      const base64Data = imagePreview.split(',')[1];
      const mimeTypeMatch = imagePreview.match(/^data:(image\/[a-zA-Z]*);base64,/);
      const mimeType = mimeTypeMatch ? mimeTypeMatch[1] : 'image/jpeg';

      // Phase 1: Single call — classify + extract in one pass
      setProcessingStatus('Processing image with AI...');
      setProcessingLog((prev) => [...prev, 'Sending image to Gemini Pro for analysis...']);

      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: [{
          role: 'user',
          parts: [
            { text: SYSTEM_INSTRUCTION },
            { inlineData: { data: base64Data, mimeType: mimeType || 'image/jpeg' } },
            { text: 'Process this image according to the instructions above.' },
          ],
        }],
        config: { temperature: 0.2 },
      });

      let output = response.text || '';
      if (!output) {
        setError("No text returned from the model.");
        return;
      }

      setProcessingLog((prev) => [...prev, 'Initial analysis complete.']);

      // Phase 2: If TikZ code was produced, enhance it via multi-agent pipeline
      const hasTikz = output.includes('\\begin{tikzpicture}');
      if (hasTikz) {
        setProcessingStatus('Enhancing TikZ with multi-agent pipeline...');
        setProcessingLog((prev) => [...prev, 'Geometric figure detected — running Draft B + Verify pipeline...']);

        // Extract the initial TikZ as Draft A — avoids regenerating it from scratch
        const initialDraftA = extractTikzCode(output);

        try {
          const tikzResult = await generateTikzMultiAgent(
            apiKey,
            base64Data,
            mimeType || 'image/jpeg',
            {
              onProgress: (_stage, detail) => {
                setProcessingStatus(detail);
                setProcessingLog((prev) => [...prev, detail]);
              },
              draftA: initialDraftA,
            },
          );

          if (tikzResult.log.length > 0) {
            setProcessingLog((prev) => [...prev, ...tikzResult.log]);
          }

          // Replace the initial TikZ block with the enhanced version
          const enhancedTikz = '```latex\n' + tikzResult.tikzCode + '\n```';
          // Remove the original tikz code block and replace
          output = output.replace(/```latex\s*\n(?:% Required[\s\S]*?)?\\begin\{tikzpicture\}[\s\S]*?\\end\{tikzpicture\}\s*\n```/g, enhancedTikz);

          // If replacement didn't work (different format), prepend
          if (!output.includes(tikzResult.tikzCode)) {
            const formulaPart = output.replace(/```latex\s*\n[\s\S]*?\\begin\{tikzpicture\}[\s\S]*?\\end\{tikzpicture\}\s*\n```/g, '').trim();
            output = [enhancedTikz, formulaPart].filter(Boolean).join('\n\n');
          }
        } catch (tikzErr) {
          console.warn('Multi-agent TikZ enhancement failed, keeping initial output:', tikzErr);
          setProcessingLog((prev) => [...prev, 'Multi-agent enhancement failed — keeping initial TikZ output.']);
        }
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

  if (!apiKeySubmitted) {
    return (
      <div className="min-h-screen bg-[#f8f7f4] flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl shadow-lg border border-[#00186E]/10 p-8 max-w-md w-full"
        >
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-[#00186E] rounded-xl flex items-center justify-center text-white font-bold text-2xl">
              ∑
            </div>
            <div>
              <h1 className="text-xl font-semibold text-[#00186E] font-serif-brand">MathVision</h1>
              <p className="text-sm text-[#00186E]/50 font-sans-brand">LaTeX & TikZ Assistant</p>
            </div>
          </div>

          <div className="mb-6">
            <label htmlFor="api-key" className="block text-sm font-medium text-[#00186E]/70 mb-2 font-sans-brand">
              <Key className="w-4 h-4 inline mr-1.5 -mt-0.5" />
              Gemini API Key
            </label>
            <input
              id="api-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && apiKey.trim()) setApiKeySubmitted(true); }}
              placeholder="Enter your Gemini API key..."
              className="w-full px-4 py-3 border border-[#00186E]/20 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#FFAD1D] focus:border-[#FFAD1D] transition-colors font-sans-brand"
            />
            <p className="mt-2 text-xs text-[#00186E]/50 font-sans-brand">
              Get your free API key from{' '}
              <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-[#FFAD1D] hover:underline font-medium">
                Google AI Studio
              </a>. Your key is only used in your browser and never stored on any server.
            </p>
          </div>

          <button
            onClick={() => { if (apiKey.trim()) setApiKeySubmitted(true); }}
            disabled={!apiKey.trim()}
            className="w-full bg-[#00186E] hover:bg-[#001050] text-white font-medium py-3 px-4 rounded-xl shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-sans-brand"
          >
            Start Using MathVision
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8f7f4] text-[#00186E]">
      <header className="bg-[#00186E] sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-[#FFAD1D] rounded-lg flex items-center justify-center text-[#00186E] font-bold text-xl">
                ∑
              </div>
              <h1 className="text-xl font-semibold tracking-tight text-white font-serif-brand">MathVision</h1>
            </div>

            {/* Mode Tabs */}
            <div className="hidden sm:flex items-center ml-4 bg-white/10 rounded-lg p-0.5">
              <button
                onClick={() => setAppMode('image-to-latex')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all font-sans-brand ${
                  appMode === 'image-to-latex'
                    ? 'bg-[#FFAD1D] text-[#00186E] shadow-sm'
                    : 'text-white/60 hover:text-white'
                }`}
              >
                <ImageIcon className="w-3.5 h-3.5" />
                Image → LaTeX
              </button>
              <button
                onClick={() => setAppMode('pdf-to-docx')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all font-sans-brand ${
                  appMode === 'pdf-to-docx'
                    ? 'bg-[#FFAD1D] text-[#00186E] shadow-sm'
                    : 'text-white/60 hover:text-white'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                PDF → DOCX
              </button>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Mobile mode toggle */}
            <button
              onClick={() => setAppMode(appMode === 'image-to-latex' ? 'pdf-to-docx' : 'image-to-latex')}
              className="sm:hidden flex items-center gap-1.5 text-xs text-white/60 hover:text-white border border-white/20 rounded-lg px-2.5 py-1.5 transition-colors font-sans-brand"
            >
              <ArrowRightLeft className="w-3.5 h-3.5" />
              {appMode === 'image-to-latex' ? 'PDF → DOCX' : 'Image → LaTeX'}
            </button>
            <button
              onClick={() => { setApiKey(''); setApiKeySubmitted(false); setResult(null); setError(null); }}
              className="text-xs text-white/50 hover:text-white border border-white/20 rounded-lg px-2.5 py-1.5 transition-colors font-sans-brand"
            >
              Change API Key
            </button>
          </div>
        </div>
      </header>

      {appMode === 'pdf-to-docx' ? (
        <PdfToDocxConverter apiKey={apiKey} />
      ) : (
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
            {/* Left Column — Input */}
            <div className="space-y-6">
              {/* Upload Section */}
              <div className="bg-white rounded-2xl shadow-sm border border-[#00186E]/10 overflow-hidden">
                <div className="p-4 border-b border-[#00186E]/5 bg-[#00186E]/[0.02]">
                  <h2 className="font-medium text-[#00186E] flex items-center gap-2 font-sans-brand">
                    <ImageIcon className="w-4 h-4 text-[#FFAD1D]" />
                    Input Image
                  </h2>
                </div>

                <div className="p-4">
                  {!imagePreview ? (
                    <div
                      {...getRootProps()}
                      role="button"
                      aria-label="Upload an image of math content"
                      className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors duration-200 ${
                        isDragActive ? 'border-[#FFAD1D] bg-[#FFAD1D]/10' : 'border-[#00186E]/20 hover:border-[#FFAD1D] hover:bg-[#FFAD1D]/5'
                      }`}
                    >
                      <input {...getInputProps()} />
                      <Upload className="w-10 h-10 text-[#00186E]/30 mx-auto mb-4" />
                      <p className="text-sm font-medium text-[#00186E]/70 mb-1 font-sans-brand">
                        Drag & drop an image here
                      </p>
                      <p className="text-xs text-[#00186E]/40 font-sans-brand">
                        or click to select a file (PNG, JPG, WebP — max 20MB)
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="relative rounded-xl overflow-hidden border border-[#00186E]/10 bg-[#f8f7f4] group">
                        <img
                          src={imagePreview}
                          alt="Uploaded math content"
                          className="w-full h-auto max-h-[400px] object-contain"
                        />
                        <div className="absolute inset-0 bg-[#00186E]/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <button
                            {...getRootProps()}
                            className="bg-white text-[#00186E] px-4 py-2 rounded-lg text-sm font-medium shadow-sm hover:bg-[#f8f7f4] transition-colors font-sans-brand"
                          >
                            <input {...getInputProps()} />
                            Replace Image
                          </button>
                        </div>
                      </div>

                      <button
                        onClick={processImage}
                        disabled={isProcessing}
                        className="w-full bg-[#FFAD1D] hover:bg-[#e89c10] text-[#00186E] font-semibold py-3 px-4 rounded-xl shadow-sm transition-colors disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2 font-sans-brand"
                      >
                        {isProcessing ? (
                          <>
                            <Loader2 className="w-5 h-5 animate-spin" />
                            Processing Image...
                          </>
                        ) : (
                          <>
                            Convert to LaTeX
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Instructions Card */}
              <div className="bg-[#B9CF7C]/20 rounded-2xl border border-[#B9CF7C]/40 p-5">
                <h3 className="text-sm font-semibold text-[#00186E] mb-2 font-sans-brand">How it works</h3>
                <ul className="text-sm text-[#00186E]/70 space-y-2 list-disc list-inside font-serif-brand">
                  <li>Upload a photo or screenshot of math problems or geometric figures.</li>
                  <li>The AI will generate compilable <strong>TikZ</strong> code for geometry.</li>
                  <li>It will generate clean <strong>LaTeX</strong> for formulas (MathType compatible).</li>
                  <li>Results are formatted exactly as shown, without solving.</li>
                </ul>
              </div>
            </div>

            {/* Right Column — Output */}
            <div className="lg:sticky lg:top-24">
              <div className="bg-white rounded-2xl shadow-sm border border-[#00186E]/10 min-h-[400px] lg:min-h-[calc(100vh-8rem)] flex flex-col overflow-hidden">
                <div className="p-4 border-b border-[#00186E]/5 bg-[#00186E]/[0.02] flex items-center justify-between">
                  <h2 className="font-medium text-[#00186E] flex items-center gap-2 font-sans-brand">
                    Output
                  </h2>
                </div>

                <div className="flex-1 p-0 overflow-y-auto">
                  {isProcessing ? (
                    <div className="h-full flex flex-col items-center justify-center text-[#00186E]/40 space-y-4 p-8">
                      <Loader2 className="w-10 h-10 animate-spin text-[#FFAD1D]" />
                      <p className="text-sm font-medium animate-pulse font-sans-brand">{processingStatus || 'Analyzing math content and generating LaTeX...'}</p>
                      {/* Reasoning log */}
                      {processingLog.length > 0 && (
                        <div className="w-full max-w-md bg-[#00186E]/[0.03] rounded-lg border border-[#00186E]/10 p-3 max-h-40 overflow-y-auto text-left">
                          <p className="text-[10px] font-semibold text-[#00186E]/40 uppercase tracking-wider mb-1.5 font-sans-brand">
                            Agent reasoning
                          </p>
                          <div className="space-y-0.5">
                            {processingLog.map((line, i) => (
                              <p key={i} className="text-xs text-[#00186E]/50 font-sans-brand">
                                {line}
                              </p>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : error ? (
                    <div className="p-6">
                      <div className="bg-red-50 text-red-800 rounded-xl p-4 flex items-start gap-3 border border-red-100">
                        <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                        <div>
                          <h3 className="font-medium mb-1 font-sans-brand">Error processing image</h3>
                          <p className="text-sm text-red-700/90">{error}</p>
                        </div>
                      </div>
                    </div>
                  ) : result ? (
                    <div className="p-6">
                      <ResultRenderer content={result} />
                    </div>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-[#00186E]/30 p-8 text-center">
                      <div className="w-16 h-16 bg-[#00186E]/5 rounded-full flex items-center justify-center mb-4">
                        <span className="text-2xl font-serif-brand italic text-[#00186E]/20">f(x)</span>
                      </div>
                      <p className="text-sm font-medium text-[#00186E]/50 font-sans-brand">No output yet</p>
                      <p className="text-xs text-[#00186E]/30 mt-1 max-w-xs font-sans-brand">Upload an image and click "Convert to LaTeX" to see the results here.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </main>
      )}
    </div>
  );
}

// Component to render the markdown result with custom code block styling
function ResultRenderer({ content }: { content: string }) {
  return (
    <div className="prose prose-slate prose-sm max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          code(props: any) {
            const { className, children } = props;
            const match = /language-(\w+)/.exec(className || '');

            if (match) {
              return (
                <CodeBlock language={match[1]} code={String(children).replace(/\n$/, '')} />
              );
            }

            return (
              <code className="bg-[#00186E]/5 text-[#00186E] px-1.5 py-0.5 rounded-md font-mono text-xs">
                {children}
              </code>
            );
          }
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}


function FormulaPreview({ code }: { code: string }) {
  return (
    <div className="bg-white p-4 rounded-lg text-[#00186E] overflow-auto prose prose-slate max-w-none border border-[#00186E]/10 min-h-[200px]">
      <ReactMarkdown
        remarkPlugins={[remarkMath]}
        rehypePlugins={[rehypeKatex]}
      >
        {code}
      </ReactMarkdown>
    </div>
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
      className="flex items-center gap-1.5 text-xs font-medium text-white/50 hover:text-white transition-colors font-sans-brand"
    >
      {copied ? (
        <>
          <CheckCircle2 className="w-3.5 h-3.5 text-[#B9CF7C]" />
          <span className="text-[#B9CF7C]">Copied</span>
        </>
      ) : (
        <>
          <Copy className="w-3.5 h-3.5" />
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
      className="flex items-center gap-1.5 text-xs font-medium text-[#00186E]/50 hover:text-[#00186E] transition-colors font-sans-brand"
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
      className="flex items-center gap-1.5 text-xs font-medium text-[#00186E]/50 hover:text-[#00186E] transition-colors font-sans-brand"
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
    <div className="my-4 rounded-xl overflow-hidden border border-[#00186E]/20 shadow-sm bg-white">
      <div className="flex items-center justify-between px-4 py-2 bg-[#00186E]/5 border-b border-[#00186E]/10">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-[#00186E]/60 uppercase tracking-wider font-sans-brand">
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
    <div className="my-4 rounded-xl overflow-hidden border border-[#00186E]/20 shadow-sm">
      <div className="bg-[#00186E]">
        <div className="flex items-center justify-between px-4 py-2 bg-[#00186E] border-b border-white/10">
          <div className="flex items-center gap-1.5 text-xs font-medium text-white/60 uppercase tracking-wider font-sans-brand">
            <Code className="w-3.5 h-3.5" />
            {label}
          </div>
          <CopyCodeButton code={code} />
        </div>
        <div className="p-4 overflow-x-auto">
          <pre className="!m-0 !p-0 !bg-transparent">
            <code className="text-sm font-mono text-white/90 leading-relaxed whitespace-pre">
              {code}
            </code>
          </pre>
        </div>
      </div>
    </div>
  );
}

function CodeBlock({ language, code }: { language: string, code: string }) {
  const [tikzImageUrl, setTikzImageUrl] = useState<string | null>(null);
  const isTikz = code.includes('\\begin{tikzpicture}');

  if (isTikz) {
    return (
      <>
        {/* TikZ Preview Block */}
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

        {/* TikZ Code Block */}
        <CodeBlockPanel label="TikZ Code" code={code} />
      </>
    );
  }

  return (
    <>
      {/* Math Preview Block */}
      <PreviewBlock
        title="Math Preview"
        icon={<Eye className="w-3.5 h-3.5 mr-1" />}
      >
        <FormulaPreview code={code} />
      </PreviewBlock>

      {/* Math Code Block */}
      <CodeBlockPanel label="LaTeX Code" code={code} />
    </>
  );
}

const TIKZ_DOM_TIMEOUT_MS = 30_000; // Match TIKZ_RENDER_TIMEOUT_MS; complex figures need full 30s

function TikzRendererWithRef({ code, onImageReady }: { code: string, onImageReady?: (dataUrl: string | null) => void }) {
  const [pngDataUrl, setPngDataUrl] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(true);
  const [renderError, setRenderError] = useState(false);
  const onImageReadyRef = useRef(onImageReady);
  onImageReadyRef.current = onImageReady;

  useEffect(() => {
    let cancelled = false;

    const renderDiv = document.createElement('div');
    renderDiv.style.position = 'absolute';
    renderDiv.style.left = '-9999px';
    renderDiv.style.top = '-9999px';
    renderDiv.style.visibility = 'hidden';
    document.body.appendChild(renderDiv);

    const script = document.createElement('script');
    script.type = 'text/tikz';
    script.textContent = preprocessTikzForTikzJax(code);
    renderDiv.appendChild(script);

    waitForTikzSvg(renderDiv, TIKZ_DOM_TIMEOUT_MS).then((svg) => {
      if (cancelled) return;
      if (!svg) {
        // Clean up the off-screen div immediately on failure instead of
        // waiting for component unmount, to avoid accumulating DOM nodes.
        if (renderDiv.parentNode) document.body.removeChild(renderDiv);
        setIsRendering(false);
        setRenderError(true);
        onImageReadyRef.current?.(null);
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
        const scale = 2;
        const w = img.width * scale;
        const h = img.height * scale;
        const { canvas, ctx } = getReusableCanvas(w, h);
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        const dataUrl = canvas.toDataURL('image/png');
        setPngDataUrl(dataUrl);
        setIsRendering(false);
        onImageReadyRef.current?.(dataUrl);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        if (!cancelled) { setIsRendering(false); onImageReadyRef.current?.(null); }
      };
      img.src = url;
    });

    return () => {
      cancelled = true;
      if (renderDiv.parentNode) document.body.removeChild(renderDiv);
    };
  }, [code]);

  return (
    <div className="flex justify-center bg-white rounded-lg overflow-hidden min-h-[200px]">
      {isRendering ? (
        <div className="flex items-center justify-center w-full h-48 text-[#00186E]/40">
          <Loader2 className="w-6 h-6 animate-spin mr-2 text-[#FFAD1D]" />
          <span className="text-sm font-sans-brand">Rendering figure...</span>
        </div>
      ) : pngDataUrl ? (
        <img src={pngDataUrl} alt="TikZ figure" className="max-w-full h-auto" />
      ) : (
        <div className="flex items-center justify-center w-full h-48 text-red-400">
          <span className="text-sm font-sans-brand">
            {renderError ? 'Rendering timed out — TikZ code may be invalid' : 'Failed to render figure'}
          </span>
        </div>
      )}
    </div>
  );
}
