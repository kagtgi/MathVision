import React, { useState, useCallback, useEffect, useRef } from 'react';
import { GoogleGenAI } from '@google/genai';
import { Upload, Image as ImageIcon, Loader2, Copy, CheckCircle2, AlertCircle, Key } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { motion, AnimatePresence } from 'framer-motion';

const SYSTEM_INSTRUCTION = `You are MathTeacherVision, an expert assistant for mathematics teachers in Vietnam.
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

  $f(x) = x^2 + 2x + 1$
  $f(x) = (x+1)^2$
  $f'(x) = 2(x+1)$

- For piecewise / systems, use $...$ containing a cases environment:

  $\\begin{cases} 2x + y = 5 \\\\ x - y = 1 \\end{cases}$

- For matrices:

  $\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}$

- Plain text (labels, descriptions, problem numbers) → type as-is, no LaTeX
- Never use \\[ \\], align, align*, equation, gather, \\textbf, \\textit, or \\color

### Transcription rules
- Reproduce exactly what is shown — do NOT simplify, factor, or solve
- Preserve ALL exponents, subscripts, superscripts exactly as written
- Preserve ALL parentheses, brackets, and braces; use \\left( \\right) for dynamic sizing around tall content (fractions, integrals, matrices)
- Standard commands: \\frac{a}{b}, \\int_{a}^{b} f(x)\\,dx, \\sum_{i=1}^{n}, \\lim_{x \\to \\infty}, \\sqrt{...}, \\sqrt[n]{...}, \\vec{v}, \\mathbf{v}, \\alpha \\beta \\theta \\pi \\Delta \\Sigma (etc.)
- For piecewise functions or systems of equations use cases:
    \\begin{cases}
      2x + y = 5 \\\\
      x - y = 1
    \\end{cases}

Output format:
\`\`\`latex
% Paste directly into MathType or any LaTeX editor

$x^2 + y^2 = r^2$
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
    if (file) {
      setImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        const img = new Image();
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
        img.src = reader.result as string;
      };
      reader.readAsDataURL(file);
      setResult(null);
      setError(null);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.png', '.jpg', '.jpeg', '.webp']
    },
    maxFiles: 1
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
                inlineData: {
                  data: base64Data,
                  mimeType: mimeType || 'image/jpeg',
                },
              },
              {
                text: 'Please process this image according to your instructions.',
              },
            ],
          }
        ],
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
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
      if (message.includes('not valid JSON') || message.includes('Failed to execute')) {
        setError("Failed to get a valid response from the AI service. Please check your API key and try again.");
      } else {
        setError(message || "An error occurred while processing the image.");
      }
    } finally {
      setIsProcessing(false);
    }
  };

  if (!apiKeySubmitted) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl shadow-lg border border-slate-200 p-8 max-w-md w-full"
        >
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white font-bold text-2xl">
              ∑
            </div>
            <div>
              <h1 className="text-xl font-semibold text-slate-900">MathTeacherVision</h1>
              <p className="text-sm text-slate-500">LaTeX & TikZ Assistant</p>
            </div>
          </div>

          <div className="mb-6">
            <label htmlFor="api-key" className="block text-sm font-medium text-slate-700 mb-2">
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
              className="w-full px-4 py-3 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
            />
            <p className="mt-2 text-xs text-slate-500">
              Get your free API key from{' '}
              <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">
                Google AI Studio
              </a>. Your key is only used in your browser and never stored on any server.
            </p>
          </div>

          <button
            onClick={() => { if (apiKey.trim()) setApiKeySubmitted(true); }}
            disabled={!apiKey.trim()}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-3 px-4 rounded-xl shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Start Using MathTeacherVision
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-bold text-xl">
              ∑
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">MathTeacherVision</h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-sm text-slate-500 font-medium">
              LaTeX & TikZ Assistant
            </div>
            <button
              onClick={() => { setApiKey(''); setApiKeySubmitted(false); }}
              className="text-xs text-slate-400 hover:text-slate-600 border border-slate-200 rounded-lg px-2.5 py-1.5 transition-colors"
            >
              Change API Key
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Left Column: Upload & Preview */}
          <div className="lg:col-span-5 space-y-6">
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="p-4 border-b border-slate-100 bg-slate-50/50">
                <h2 className="font-medium text-slate-800 flex items-center gap-2">
                  <ImageIcon className="w-4 h-4 text-indigo-500" />
                  Input Image
                </h2>
              </div>
              
              <div className="p-4">
                {!imagePreview ? (
                  <div 
                    {...getRootProps()} 
                    className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors duration-200 ${
                      isDragActive ? 'border-indigo-500 bg-indigo-50/50' : 'border-slate-300 hover:border-indigo-400 hover:bg-slate-50'
                    }`}
                  >
                    <input {...getInputProps()} />
                    <Upload className="w-10 h-10 text-slate-400 mx-auto mb-4" />
                    <p className="text-sm font-medium text-slate-700 mb-1">
                      Drag & drop an image here
                    </p>
                    <p className="text-xs text-slate-500">
                      or click to select a file
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="relative rounded-xl overflow-hidden border border-slate-200 bg-slate-100 group">
                      <img 
                        src={imagePreview} 
                        alt="Uploaded math content" 
                        className="w-full h-auto max-h-[400px] object-contain"
                      />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <button 
                          {...getRootProps()}
                          className="bg-white text-slate-900 px-4 py-2 rounded-lg text-sm font-medium shadow-sm hover:bg-slate-50 transition-colors"
                        >
                          <input {...getInputProps()} />
                          Replace Image
                        </button>
                      </div>
                    </div>
                    
                    <button
                      onClick={processImage}
                      disabled={isProcessing}
                      className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-3 px-4 rounded-xl shadow-sm transition-colors disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
            <div className="bg-indigo-50/50 rounded-2xl border border-indigo-100 p-5">
              <h3 className="text-sm font-semibold text-indigo-900 mb-2">How it works</h3>
              <ul className="text-sm text-indigo-800/80 space-y-2 list-disc list-inside">
                <li>Upload a photo or screenshot of math problems or geometric figures.</li>
                <li>The AI will generate compilable <strong>TikZ</strong> code for geometry.</li>
                <li>It will generate clean <strong>LaTeX</strong> for formulas (MathType compatible).</li>
                <li>Results are formatted exactly as shown, without solving.</li>
              </ul>
            </div>
          </div>

          {/* Right Column: Results */}
          <div className="lg:col-span-7">
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 h-full min-h-[600px] flex flex-col overflow-hidden">
              <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                <h2 className="font-medium text-slate-800 flex items-center gap-2">
                  Output
                </h2>
              </div>
              
              <div className="flex-1 p-0 overflow-y-auto bg-slate-50/30">
                {isProcessing ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-4 p-8">
                    <Loader2 className="w-10 h-10 animate-spin text-indigo-500" />
                    <p className="text-sm font-medium animate-pulse">Analyzing math content and generating LaTeX...</p>
                  </div>
                ) : error ? (
                  <div className="p-6">
                    <div className="bg-red-50 text-red-800 rounded-xl p-4 flex items-start gap-3 border border-red-100">
                      <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                      <div>
                        <h3 className="font-medium mb-1">Error processing image</h3>
                        <p className="text-sm text-red-700/90">{error}</p>
                      </div>
                    </div>
                  </div>
                ) : result ? (
                  <div className="p-6">
                    <ResultRenderer content={result} />
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-slate-400 p-8 text-center">
                    <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
                      <span className="text-2xl font-serif italic text-slate-300">f(x)</span>
                    </div>
                    <p className="text-sm font-medium text-slate-500">No output yet</p>
                    <p className="text-xs text-slate-400 mt-1 max-w-xs">Upload an image and click "Convert to LaTeX" to see the results here.</p>
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
              <code className="bg-slate-100 text-indigo-600 px-1.5 py-0.5 rounded-md font-mono text-xs" {...props}>
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
  const ref = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    if (ref.current) {
      ref.current.innerHTML = '';
      const script = document.createElement('script');
      script.type = 'text/tikz';
      script.textContent = code;
      ref.current.appendChild(script);
    }
  }, [code]);

  return (
    <div className="flex justify-center bg-white p-4 rounded-lg overflow-auto min-h-[200px] border border-slate-200">
      <div ref={ref} />
    </div>
  );
}

function FormulaPreview({ code }: { code: string }) {
  return (
    <div className="bg-white p-4 rounded-lg text-slate-900 overflow-auto prose prose-slate max-w-none border border-slate-200 min-h-[200px]">
      <ReactMarkdown
        remarkPlugins={[remarkMath]}
        rehypePlugins={[rehypeKatex]}
      >
        {code}
      </ReactMarkdown>
    </div>
  );
}

function CodeBlock({ language, code }: { language: string, code: string }) {
  const [copied, setCopied] = useState(false);
  const [view, setView] = useState<'both' | 'code' | 'preview'>('both');

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isTikz = code.includes('\\begin{tikzpicture}');

  return (
    <div className="my-6 rounded-xl overflow-hidden border border-slate-200 bg-slate-900 shadow-sm">
      <div className="flex items-center justify-between px-4 py-2 bg-slate-800 border-b border-slate-700">
        <div className="flex items-center gap-4">
          <span className="text-xs font-medium text-slate-300 uppercase tracking-wider">{language}</span>
          <div className="flex bg-slate-700 rounded-md p-0.5">
            <button 
              onClick={() => setView('preview')}
              className={`px-2.5 py-1 text-xs font-medium rounded-sm transition-colors ${view === 'preview' ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
            >
              Preview
            </button>
            <button 
              onClick={() => setView('code')}
              className={`px-2.5 py-1 text-xs font-medium rounded-sm transition-colors ${view === 'code' ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
            >
              Code
            </button>
            <button 
              onClick={() => setView('both')}
              className={`px-2.5 py-1 text-xs font-medium rounded-sm transition-colors ${view === 'both' ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
            >
              Split
            </button>
          </div>
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-white transition-colors"
        >
          {copied ? (
            <>
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-emerald-400">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      
      <div className={`flex flex-col ${view === 'both' ? 'lg:flex-row' : ''} divide-y lg:divide-y-0 lg:divide-x divide-slate-700`}>
        {(view === 'preview' || view === 'both') && (
          <div className={`flex flex-col bg-slate-50 ${view === 'both' ? 'lg:w-1/2' : 'w-full'}`}>
            {view === 'both' && (
              <div className="px-4 py-2 bg-slate-100 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Preview
              </div>
            )}
            <div className="p-4 flex-1">
              {isTikz ? <TikzRenderer code={code} /> : <FormulaPreview code={code} />}
            </div>
          </div>
        )}
        
        {(view === 'code' || view === 'both') && (
          <div className={`flex flex-col ${view === 'both' ? 'lg:w-1/2' : 'w-full'}`}>
            {view === 'both' && (
              <div className="px-4 py-2 bg-slate-800/50 border-b border-slate-700 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                LaTeX Code
              </div>
            )}
            <div className="p-4 overflow-x-auto flex-1">
              <pre className="!m-0 !p-0 !bg-transparent">
                <code className="text-sm font-mono text-slate-50 leading-relaxed whitespace-pre">
                  {code}
                </code>
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
