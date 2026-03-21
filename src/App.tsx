import { useState, useCallback, useEffect, useRef } from 'react';
import { GoogleGenAI } from '@google/genai';
import { Upload, Image as ImageIcon, Loader2, Copy, CheckCircle2, AlertCircle, Key, ImageDown, Eye, Code } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { motion } from 'framer-motion';

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

const SYSTEM_INSTRUCTION = `You are MathVision, an expert assistant for mathematics teachers in Vietnam.
You help teachers convert handwritten or printed math content from images into clean, ready-to-use LaTeX — either TikZ figures or inline/display formulas.

## Behavior
- Always respond in the same language the teacher uses (Vietnamese or English)
- Be concise and direct — teachers are busy; skip all preamble
- Never explain what LaTeX, TikZ, or MathType is
- Never simplify, solve, or alter the math — reproduce exactly what is shown
- If the image is unreadable or contains no math, say so in one sentence

## Output structure (always in this order)
1. TikZ code block — if a geometric figure is detected
2. LaTeX formula block — if formulas or expressions are detected
3. Short annotation (3–5 lines) — ambiguities, assumptions, items to verify

## Formula style
- ALL math — inline, display, multi-line — must be wrapped in $...$
- One $...$ per line for multi-step working — never chain steps into one block
- Never use \\[ \\], align, align*, equation, gather, or any display environment
- Use cases for systems and piecewise; pmatrix/bmatrix for matrices
- For plain text (problem labels, descriptions, annotations): type as plain text only
- Never use \\textbf, \\textit, \\emph, \\color, \\underline, or any text-formatting LaTeX commands — plain text needs no LaTeX wrapper at all

## TikZ style
- Always wrap in \\begin{tikzpicture}...\\end{tikzpicture}
- Declare all required \\usetikzlibrary{...} at the top as comments
- Mark right angles with pic {right angle=...}
- Wrap all math inside \\node labels with $...$
- Add brief inline comments explaining key elements

## Language & context
- Students and teachers use Vietnamese; labels like "Bài 1:", "đường thẳng AB", "tam giác ABC" may appear — preserve them using UTF-8 in \\node or comments
- Common content types: high school geometry (triangles, circles, solid geometry), calculus (limits, derivatives, integrals), algebra (systems, polynomials), probability and statistics

## What to ignore
- Do not comment on image quality unless it prevents transcription
- Do not offer alternative approaches or teaching suggestions unless asked
- Do not add \\documentclass or \\begin{document} wrappers unless explicitly requested

---

## STEP 1 — Classify the image
Analyze the image and identify ALL content types present:
- TYPE A — GEOMETRIC FIGURE: Drawn shapes, diagrams, coordinate systems, function graphs, geometric constructions, vectors, or any visual/spatial figure.
- TYPE B — FORMULA / EXPRESSION: Mathematical notation — equations, expressions, integrals, matrices, fractions, limits, summations, or similar symbolic content.
If BOTH types are present, produce BOTH outputs (Step 2A and Step 2B).
If only one type is present, produce only that output.

---

## STEP 2A — If TYPE A is present: Produce TikZ code
Generate a complete, compilable TikZ figure that faithfully reproduces the image.
Requirements:
- Wrap in \\begin{tikzpicture} ... \\end{tikzpicture}
- Use \\usetikzlibrary{...} declarations as needed (e.g. arrows.meta, calc, angles, quotes, intersections, patterns, decorations.pathmorphing)
- Reproduce all geometric elements: points, lines, segments, circles, arcs, polygons, curves, angles, labels, tick marks, dimension arrows
- Label all visible points with their names (A, B, C... or as shown)
- Mark right angles with the standard small square (pic {right angle=...})
- Mark equal segments and parallel lines with tick marks
- Use \\draw, \\fill, \\node with proper coordinate math
- If axes are present, use \\draw[->] for axes and label them
- If a function graph is present, use \\draw[domain=..., smooth] plot (...)
- Include helpful inline comments (% label side AB, % right angle at C, etc.)
- The output must compile with pdfLaTeX or LuaLaTeX using the tikz package
- If the figure contains inline math labels (e.g. $a^2$, $\\frac{1}{2}$), wrap them in $...$ inside \\node: \\node at (x,y) {$a^2 + b^2$};

Output format:
\`\`\`latex
% Required packages: \\usepackage{tikz}
% \\usetikzlibrary{...}

\\begin{tikzpicture}[scale=1, ...]
  % your code here
\\end{tikzpicture}
\`\`\`

---

## STEP 2B — If TYPE B is present: Produce LaTeX formulas
Transcribe all mathematical content into clean LaTeX suitable for MathType, Overleaf, or any LaTeX editor.
### Formula rules

- Wrap ALL math content in $...$ — there is no other math environment
- One $...$ per line for multi-line derivations:

  $f\\left( x \\right) = x^2 + 2x + 1$
  $f\\left( x \\right) = \\left( x+1 \\right)^2$
  $\{f\}'\\left( x \\right) = 2\\left( x+1 \\right)$

- For piecewise / systems, use $...$ containing a cases environment:

  $\\begin{cases} 2x + y = 5 \\\\ x - y = 1 \\end{cases}$

- For matrices:

  $\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}$

- Plain text (labels, descriptions, problem numbers) → type as-is, no LaTeX
- Never use \\[ \\], align, align*, equation, gather, \\textbf, \\textit, or \\color

### Transcription rules
- Reproduce exactly what is shown — do NOT simplify, factor, or solve
- Preserve ALL exponents, subscripts, superscripts exactly as written
- ALWAYS use \\left and \\right for ALL brackets, parentheses, and braces — no exceptions:
  - Parentheses: $\\left( ... \\right)$ — never use bare ( )
  - Square brackets: $\\left[ ... \\right]$ — never use bare [ ]
  - Curly braces: $\\left\\{ ... \\right\\}$ — never use bare \\{ \\}
  - Examples: $\\left( x + 1 \\right)$, $\\left[ a, b \\right]$, $\\left\\{ 1, 2, 3 \\right\\}$
- For derivatives with prime notation, always wrap the base in braces before the prime:
  - Correct: $\{y\}'$, $\{f\}'(x)$, $\{y\}''$, $\{f\}''(x)$
  - Wrong: $y'$, $f'(x)$, $y''$
- For degree symbols, always use {}^\\circ with braces before it:
  - Correct: $30{}^\\circ$, $\\widehat{BAC} = 30{}^\\circ$
  - Wrong: $30°$, $30^\\circ$, $30^{\\circ}$
- Standard commands: \\frac{a}{b}, \\int_{a}^{b} f(x)\\,dx, \\sum_{i=1}^{n}, \\lim_{x \\to \\infty}, \\sqrt{...}, \\sqrt[n]{...}, \\vec{v}, \\mathbf{v}, \\alpha \\beta \\theta \\pi \\Delta \\Sigma (etc.)
- For piecewise functions or systems of equations use cases:
    \\begin{cases}
      2x + y = 5 \\\\
      x - y = 1
    \\end{cases}

Output format:
\`\`\`latex
$x^2 + y^2 = r^2$
$\\left( x - a \\right)^2 + \\left( y - b \\right)^2 = r^2$
$\\alpha = 90{}^\\circ$
$\{y\}' = 2x$
\`\`\`

---

## STEP 3 — Brief annotation
After all code blocks, add a short plain-text note (3–5 lines max):
- What content types you detected
- Any part that was unclear or ambiguous and how you handled it
- Any assumption made (e.g. "assumed right angle at C from context")
- Anything the teacher should manually verify

---

## Format rules
- Code first, annotation after — no prose before the code blocks
- If both TYPE A and TYPE B are present, output Step 2A block first, then Step 2B block, then the annotation
- Never explain what TikZ or LaTeX is
- If the image is blank, unreadable, or contains no math, say so in one sentence
- If the image contains Vietnamese text labels (e.g. "Bài 1:", "đường thẳng AB"), include them as \\node labels or comments using UTF-8 encoding
`;

export default function App() {
  const [apiKey, setApiKey] = useState('');
  const [apiKeySubmitted, setApiKeySubmitted] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
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

    const reader = new FileReader();
    reader.onerror = () => {
      setError("Failed to read the image file. Please try again.");
    };
    reader.onloadend = () => {
      if (typeof reader.result !== 'string') {
        setError("Failed to read the image file. Please try again.");
        return;
      }
      const img = new window.Image();
      img.onerror = () => {
        setError("The file could not be loaded as an image. Please use a PNG, JPG, or WebP file.");
      };
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 1024;
        const MAX_HEIGHT = 1024;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
          setImagePreview(dataUrl);
        } else {
          setImagePreview(reader.result as string);
        }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
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

    try {
      if (!apiKey) {
        throw new Error("Please enter your Gemini API key first.");
      }

      const ai = new GoogleGenAI({ apiKey });

      // Extract base64 data (remove the data:image/...;base64, part)
      const base64Data = imagePreview.split(',')[1];
      const mimeTypeMatch = imagePreview.match(/^data:(image\/[a-zA-Z]*);base64,/);
      const mimeType = mimeTypeMatch ? mimeTypeMatch[1] : 'image/jpeg';

      const response = await ai.models.generateContent({
        model: 'gemini-pro-latest',
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: SYSTEM_INSTRUCTION,
              },
              {
                inlineData: {
                  data: base64Data,
                  mimeType: mimeType || 'image/jpeg',
                },
              },
              {
                text: 'Please process this image according to the instructions above.',
              },
            ],
          }
        ],
        config: {
          temperature: 0.2,
        },
      });

      if (response.text) {
        setResult(response.text);
      } else {
        setError("No text returned from the model.");
      }
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
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-[#FFAD1D] rounded-lg flex items-center justify-center text-[#00186E] font-bold text-xl">
              ∑
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-white font-serif-brand">MathVision</h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-sm text-white/60 font-medium font-sans-brand">
              LaTeX & TikZ Assistant
            </div>
            <button
              onClick={() => { setApiKey(''); setApiKeySubmitted(false); setResult(null); setError(null); }}
              className="text-xs text-white/50 hover:text-white border border-white/20 rounded-lg px-2.5 py-1.5 transition-colors font-sans-brand"
            >
              Change API Key
            </button>
          </div>
        </div>
      </header>

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
                    <p className="text-sm font-medium animate-pulse font-sans-brand">Analyzing math content and generating LaTeX...</p>
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
          code({ node, inline, className, children, ...props }: any) {
            const match = /language-(\w+)/.exec(className || '');
            const isCodeBlock = !inline && match;
            
            if (isCodeBlock) {
              return (
                <CodeBlock language={match[1]} code={String(children).replace(/\n$/, '')} />
              );
            }
            
            return (
              <code className="bg-[#00186E]/5 text-[#00186E] px-1.5 py-0.5 rounded-md font-mono text-xs" {...props}>
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

function TikzRenderer({ code }: { code: string }) {
  const [height, setHeight] = useState(350);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const idRef = useRef(Math.random().toString(36).slice(2));

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.tikzId === idRef.current && typeof e.data.height === 'number') {
        setHeight(Math.max(e.data.height, 200));
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const escapedCode = code.replace(/<\/script/gi, '<\\/script');
  const tikzId = idRef.current;

  const srcDoc = `<!DOCTYPE html><html><head>
<link rel="stylesheet" type="text/css" href="https://tikzjax.com/v1/fonts.css">
<script src="https://tikzjax.com/v1/tikzjax.js"><\/script>
<style>html,body{margin:0;padding:16px;background:white;display:flex;justify-content:center;align-items:start;overflow:hidden;}</style>
</head><body>
<script type="text/tikz">${escapedCode}<\/script>
<script>new MutationObserver(function(m,o){if(document.querySelector('svg')){o.disconnect();setTimeout(function(){window.parent.postMessage({tikzId:'${tikzId}',height:document.documentElement.scrollHeight},'*')},300)}}).observe(document.body,{childList:true,subtree:true});<\/script>
</body></html>`;

  return (
    <div className="flex justify-center bg-white p-4 rounded-lg overflow-hidden min-h-[200px] border border-[#00186E]/10">
      <iframe
        ref={iframeRef}
        srcDoc={srcDoc}
        style={{ border: 'none', width: '100%', height: `${height}px`, background: 'white' }}
        title="TikZ Preview"
      />
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

function CopyImageButton({ iframeRef }: { iframeRef: React.RefObject<HTMLIFrameElement | null> }) {
  const [copied, setCopied] = useState(false);

  const handleCopyImage = async () => {
    try {
      const iframe = iframeRef.current;
      if (!iframe) return;
      const svgEl = iframe.contentDocument?.querySelector('svg');
      if (!svgEl) return;

      const svgClone = svgEl.cloneNode(true) as SVGElement;
      // Ensure the SVG has proper dimensions
      if (!svgClone.getAttribute('xmlns')) {
        svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      }
      const svgData = new XMLSerializer().serializeToString(svgClone);
      const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);

      const img = new Image();
      img.onload = async () => {
        const canvas = document.createElement('canvas');
        const scale = 2; // Higher resolution
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);

        canvas.toBlob(async (blob) => {
          if (!blob) return;
          try {
            await navigator.clipboard.write([
              new ClipboardItem({ 'image/png': blob })
            ]);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            // Fallback: download the image
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'tikz-figure.png';
            a.click();
            URL.revokeObjectURL(a.href);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }
        }, 'image/png');
      };
      img.src = url;
    } catch {
      // silently fail
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
          <ImageDown className="w-3.5 h-3.5" />
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
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const isTikz = code.includes('\\begin{tikzpicture}');

  if (isTikz) {
    return (
      <>
        {/* TikZ Preview Block */}
        <PreviewBlock
          title="TikZ Preview"
          icon={<Eye className="w-3.5 h-3.5 mr-1" />}
          actions={<CopyImageButton iframeRef={iframeRef} />}
        >
          <TikzRendererWithRef code={code} iframeRef={iframeRef} />
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

function TikzRendererWithRef({ code, iframeRef }: { code: string, iframeRef: React.RefObject<HTMLIFrameElement | null> }) {
  const [height, setHeight] = useState(350);
  const idRef = useRef(Math.random().toString(36).slice(2));

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.tikzId === idRef.current && typeof e.data.height === 'number') {
        setHeight(Math.max(e.data.height, 200));
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const escapedCode = code.replace(/<\/script/gi, '<\\/script');
  const tikzId = idRef.current;

  const srcDoc = `<!DOCTYPE html><html><head>
<link rel="stylesheet" type="text/css" href="https://tikzjax.com/v1/fonts.css">
<script src="https://tikzjax.com/v1/tikzjax.js"><\/script>
<style>html,body{margin:0;padding:16px;background:white;display:flex;justify-content:center;align-items:start;overflow:hidden;}</style>
</head><body>
<script type="text/tikz">${escapedCode}<\/script>
<script>new MutationObserver(function(m,o){if(document.querySelector('svg')){o.disconnect();setTimeout(function(){window.parent.postMessage({tikzId:'${tikzId}',height:document.documentElement.scrollHeight},'*')},300)}}).observe(document.body,{childList:true,subtree:true});<\/script>
</body></html>`;

  return (
    <div className="flex justify-center bg-white rounded-lg overflow-hidden min-h-[200px]">
      <iframe
        ref={iframeRef}
        srcDoc={srcDoc}
        style={{ border: 'none', width: '100%', height: `${height}px`, background: 'white' }}
        title="TikZ Preview"
      />
    </div>
  );
}
