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
import { generateTikzMultiAgent } from './utils/tikzMultiAgent';

type AppMode = 'image-to-latex' | 'pdf-to-docx';

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

## Geometry naming rules (CRITICAL — apply these every time)

### Points
- A single labeled point → $A$, $B$, $M$, $N$, $O$, $H$, $I$ (capital italic letter, no decoration)
- Midpoint label stays italic: $M$ is midpoint of $AB$

### Segments, lines, rays
- Segment between two points → $AB$ (no bar, no arrow, just the two letters)
- Length of segment → $AB$ with context, or $|AB|$ if needed to distinguish from the segment itself
- Line through A and B → $\\overleftrightarrow{AB}$
- Ray from A through B → $\\overrightarrow{AB}$
- Vector from A to B → $\\overrightarrow{AB}$ (same as ray — context determines meaning)

### Angles
- Angle with vertex B, arms BA and BC → $\\widehat{ABC}$ (Vietnamese convention) or $\\angle ABC$
  Use whichever notation is shown in the image; default to $\\widehat{ABC}$
- Angle named by a single letter → $\\widehat{A}$ or $\\angle A$
- Angle value: $\\widehat{ABC} = 60{}^\\circ$ (always use {}^\\circ, never bare ° or ^\\circ)

### Triangles and polygons
- Triangle with vertices A, B, C → $\\triangle ABC$
- Quadrilateral / polygon → $ABCD$, $ABCDE$ (no special command needed)
- Congruent triangles → $\\triangle ABC \\cong \\triangle DEF$
- Similar triangles → $\\triangle ABC \\sim \\triangle DEF$

### Circles
- Circle with center O → $(O)$ or $(O; R)$ when radius R is given
- Arc from A to B → $\\overset{\\frown}{AB}$

### Geometric relations
- Perpendicular: $AB \\perp CD$ (at point H: $AB \\perp CD$ tại $H$)
- Parallel: $AB \\parallel CD$
- Equal segments: $AB = CD$
- Midpoint: $M$ là trung điểm của $AB$ (Vietnamese) / $M$ is the midpoint of $AB$
- Bisector: đường phân giác of $\\widehat{BAC}$
- Altitude, median, bisector labels: $AH$, $AM$, $AD$ — just segment notation

### Areas and special notation
- Area of triangle ABC → $S_{\\triangle ABC}$ or $S_{ABC}$
- Radius → $R$ (circumradius), $r$ (inradius)
- Diagonal of polygon → $AC$, $BD$ — segment notation

## Number and expression recognition rules

### Integers and decimals
- Integers: $5$, $-3$, $100$, $0$
- Decimal with dot (English): $3.14$, $0.5$
- Decimal with comma (Vietnamese): $3{,}14$ — wrap the comma in braces: $3{,}14$
- Negative numbers: $-5$, $-\\frac{1}{2}$

### Fractions and roots
- Fraction: $\\frac{a}{b}$ — always use \\frac, never a/b
- Mixed number shown in image: render as $2\\dfrac{1}{3}$ or $\\frac{7}{3}$ (prefer improper fraction if ambiguous)
- Square root: $\\sqrt{5}$, $\\sqrt{a^2 + b^2}$
- nth root: $\\sqrt[3]{8}$, $\\sqrt[n]{x}$

### Scientific and special notation
- Scientific notation: $2 \\times 10^{5}$, $1{,}6 \\times 10^{-19}$
- Percentage: $75\\%$
- Absolute value: $\\left| x \\right|$ (use \\left\\vert...\\right\\vert if inside large expressions)
- Floor/ceiling: $\\lfloor x \\rfloor$, $\\lceil x \\rceil$
- Infinity: $+\\infty$, $-\\infty$, $\\infty$

### Subscripts and superscripts
- Variable with subscript: $x_1$, $a_n$, $u_k$
- Variable with superscript: $x^2$, $a^n$
- Both: $a_n^2$, $x_i^k$
- Named constants: $e$ (Euler's number), $\\pi$, $i$ (imaginary unit)

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

Generate a complete, compilable TikZ figure that faithfully and accurately reproduces the image.

### Required libraries (declare as comments at top of code block)
Always include exactly the libraries you use from this list:
- angles, quotes — for angle arcs and labels
- calc — for coordinate arithmetic ($(A)!0.5!(B)$ midpoints, intersections)
- arrows.meta — for custom arrowheads (Stealth, LaTeX)
- intersections — for named path intersections
- patterns — for hatching/shading regions
- decorations.markings — for tick marks on equal segments
- decorations.pathmorphing — for wavy/zigzag lines
- positioning — for relative node placement

### Coordinate and scaling guidelines
- Choose coordinates so the figure fits naturally in a [0,6] × [0,6] region (adjust scale if needed)
- Use [scale=1] by default; increase for small figures (scale=1.5) or decrease for large ones (scale=0.7)
- Use named coordinates: \\coordinate (A) at (0,0); — then refer to (A) everywhere, never repeat raw numbers
- Compute midpoints with calc: \\coordinate (M) at ($(A)!0.5!(B)$);
- Compute foot of perpendicular or intersection points precisely using calc or intersections

### Points and labels
- Mark every labeled point with a small filled circle: \\fill[black] (A) circle (1.5pt);
- Place point labels offset from the point using anchor:
  - Bottom-left points: \\node[below left] at (A) {$A$};
  - Top points: \\node[above] at (B) {$B$};
  - Right points: \\node[right] at (C) {$C$};
  - Choose anchor direction away from the figure interior
- Use font=\\small inside nodes for consistency: \\node[above, font=\\small] at (B) {$B$};
- All point names in nodes MUST use math mode: {$A$}, {$B$}, {$M$}

### Lines, segments, and sides
- Segments: \\draw[thick] (A) -- (B); (use thick for main figure edges)
- Extended lines: \\draw[dashed] (A) -- ($(A)!1.3!(B)$); (use dashed for extensions/construction lines)
- Auxiliary lines: \\draw[dashed, thin] ...
- Parallel arrows (tick marks for equal segments): use decorations.markings with a single or double tick
  \\draw[decoration={markings, mark=at position 0.5 with {\\draw (0,-2pt) -- (0,2pt);}}, decorate] (A) -- (B);
- For double tick marks on equal segments: use two marks at 0.45 and 0.55

### Angles
- Always use the angles + quotes library for angle arcs:
  \\pic[draw, angle radius=8pt, "$\\alpha$", angle eccentricity=1.5] {angle = C--B--A};
- Right angle: \\pic[draw] {right angle = A--H--B}; (no label needed)
- Large angles: increase angle radius to 12pt or 16pt so the arc is visible
- Angle label placement: angle eccentricity=1.5 to 2.0 keeps the label clear of the arc

### Circles and arcs
- Full circle: \\draw[thick] (O) circle (r);
- Arc: \\draw[thick] (A) arc[start angle=30, end angle=150, radius=2cm];
- Or via coordinates: \\draw[thick] ($(O)+(30:2)$) arc[start angle=30, end angle=150, radius=2];
- Center point: \\fill (O) circle (1.5pt); \\node[below] at (O) {$O$};

### Axes and coordinate systems
- x-axis: \\draw[->] (-0.3,0) -- (5,0) node[right] {$x$};
- y-axis: \\draw[->] (0,-0.3) -- (0,5) node[above] {$y$};
- Origin label: \\node[below left] at (0,0) {$O$};
- Grid ticks: \\foreach \\x in {1,2,3,4} { \\draw (\\x,2pt) -- (\\x,-2pt) node[below] {$\\x$}; }
- Negative axis: extend with dashed line if values go negative

### Function graphs
- Smooth curve: \\draw[domain=0:4, smooth, samples=100, thick] plot (\\x, {\\x*\\x/4});
- Named function: \\draw[domain=-2:2, smooth, thick, blue] plot (\\x, {exp(-\\x*\\x)}) node[right] {$y=e^{-x^2}$};
- Asymptote: \\draw[dashed, thin] (0,1) -- (5,1);

### Shading and patterns
- Fill a region: \\fill[gray!20] (A) -- (B) -- (C) -- cycle;
- Hatch: \\fill[pattern=north east lines] (A) -- (B) -- (C) -- cycle;

### Quality checklist before outputting
1. All \\usetikzlibrary{...} needed by the code are declared
2. Every named coordinate is defined before use
3. Every labeled point has a \\fill circle and a \\node label
4. Right angles use pic {right angle=...}
5. Equal segments have tick marks via decorations.markings
6. Angle arcs use \\pic with angles library — not bare \\draw arcs for labeled angles
7. All node math is inside $...$
8. Figure is centered and scaled to fit (not cut off, not tiny)
9. Code compiles with pdfLaTeX + \\usepackage{tikz} and declared \\usetikzlibraries

Output format:
\`\`\`latex
% Required packages: \\usepackage{tikz}
% \\usetikzlibrary{angles, quotes, calc, arrows.meta, decorations.markings}

\\begin{tikzpicture}[scale=1]
  % Define coordinates
  \\coordinate (A) at (0,0);
  \\coordinate (B) at (4,0);
  \\coordinate (C) at (2,3);

  % Draw triangle sides
  \\draw[thick] (A) -- (B) -- (C) -- cycle;

  % Mark points
  \\fill (A) circle (1.5pt); \\node[below left] at (A) {$A$};
  \\fill (B) circle (1.5pt); \\node[below right] at (B) {$B$};
  \\fill (C) circle (1.5pt); \\node[above] at (C) {$C$};
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
- Apply geometry naming rules above for all points, segments, angles, triangles
- Apply number recognition rules above for all numeric values
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
- Standard commands: \\frac{a}{b}, \\int_{a}^{b} f(x)\\,dx, \\sum_{i=1}^{n}, \\lim_{x \\to \\infty}, \\sqrt{...}, \\sqrt[n]{...}, \\vec{v}, \\overrightarrow{AB}, \\alpha \\beta \\theta \\pi \\Delta \\Sigma (etc.)
- For piecewise functions or systems of equations use cases:
    \\begin{cases}
      2x + y = 5 \\\\
      x - y = 1
    \\end{cases}

Output format:
\`\`\`latex
$x^2 + y^2 = r^2$
$\\left( x - a \\right)^2 + \\left( y - b \\right)^2 = r^2$
$\\widehat{ABC} = 90{}^\\circ$
$\\triangle ABC \\cong \\triangle DEF$
$AB \\perp CD$
$\\overrightarrow{AB} + \\overrightarrow{BC} = \\overrightarrow{AC}$
$S_{\\triangle ABC} = \\frac{1}{2} \\cdot AB \\cdot h$
$\{y\}' = 2x$
\`\`\`

---

## Format rules
- Output ONLY the code block(s) — no prose, no preamble, no annotation, no explanation before or after
- If both TYPE A and TYPE B are present, output Step 2A block first, then Step 2B block — nothing else
- Never explain what TikZ or LaTeX is
- If the image is blank, unreadable, or contains no math, say so in one sentence only
- If the image contains Vietnamese text labels (e.g. "Bài 1:", "đường thẳng AB"), include them as \\node labels or comments using UTF-8 encoding
`;

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
    setProcessingStatus('Classifying image content...');

    try {
      if (!apiKey) {
        throw new Error("Please enter your Gemini API key first.");
      }

      const ai = new GoogleGenAI({ apiKey });

      // Extract base64 data (remove the data:image/...;base64, part)
      const base64Data = imagePreview.split(',')[1];
      const mimeTypeMatch = imagePreview.match(/^data:(image\/[a-zA-Z]*);base64,/);
      const mimeType = mimeTypeMatch ? mimeTypeMatch[1] : 'image/jpeg';

      // Phase 1: Classify the image content type
      setProcessingStatus('Classifying image...');
      const classifyResponse = await ai.models.generateContent({
        model: 'gemini-2.5-pro-preview-06-05',
        contents: [{
          role: 'user',
          parts: [
            { text: 'Classify this image. Does it contain: (A) geometric figures/diagrams/graphs, (B) mathematical formulas/expressions, or (C) both? Respond with ONLY one word: "GEOMETRIC", "FORMULA", or "BOTH".' },
            { inlineData: { data: base64Data, mimeType: mimeType || 'image/jpeg' } },
          ],
        }],
        config: { temperature: 0.0 },
      });

      const classification = (classifyResponse.text || '').trim().toUpperCase();
      const hasGeometric = classification.includes('GEOMETRIC') || classification.includes('BOTH');
      const hasFormula = classification.includes('FORMULA') || classification.includes('BOTH');

      let tikzPart = '';
      let formulaPart = '';

      // Phase 2A: If geometric, run multi-agent TikZ pipeline
      if (hasGeometric) {
        setProcessingStatus('Running multi-agent TikZ generation...');
        try {
          const tikzResult = await generateTikzMultiAgent(
            apiKey,
            base64Data,
            mimeType || 'image/jpeg',
            (_stage, detail) => setProcessingStatus(detail || _stage),
          );
          tikzPart = '```latex\n' + tikzResult.tikzCode + '\n```';
        } catch (tikzErr) {
          console.warn('Multi-agent TikZ failed, falling back to single-pass:', tikzErr);
          // Fallback to original single-pass approach for TikZ
          setProcessingStatus('Generating TikZ (fallback)...');
          const fallbackResponse = await ai.models.generateContent({
            model: 'gemini-2.5-pro-preview-06-05',
            contents: [{
              role: 'user',
              parts: [
                { text: SYSTEM_INSTRUCTION },
                { inlineData: { data: base64Data, mimeType: mimeType || 'image/jpeg' } },
                { text: 'Please process this image. Focus on the geometric figure and generate TikZ code.' },
              ],
            }],
            config: { temperature: 0.2 },
          });
          tikzPart = fallbackResponse.text || '';
        }
      }

      // Phase 2B: If formula, extract LaTeX formulas
      if (hasFormula) {
        setProcessingStatus('Extracting LaTeX formulas...');
        const formulaResponse = await ai.models.generateContent({
          model: 'gemini-2.5-pro-preview-06-05',
          contents: [{
            role: 'user',
            parts: [
              { text: SYSTEM_INSTRUCTION },
              { inlineData: { data: base64Data, mimeType: mimeType || 'image/jpeg' } },
              { text: 'Please process this image according to the instructions above. Focus on extracting all mathematical formulas and expressions.' },
            ],
          }],
          config: { temperature: 0.2 },
        });
        formulaPart = formulaResponse.text || '';
      }

      // If neither was detected, do a full pass with the original approach
      if (!hasGeometric && !hasFormula) {
        setProcessingStatus('Processing image...');
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-pro-preview-06-05',
          contents: [{
            role: 'user',
            parts: [
              { text: SYSTEM_INSTRUCTION },
              { inlineData: { data: base64Data, mimeType: mimeType || 'image/jpeg' } },
              { text: 'Please process this image according to the instructions above.' },
            ],
          }],
          config: { temperature: 0.2 },
        });
        formulaPart = response.text || '';
      }

      // Combine results
      const combined = [tikzPart, formulaPart].filter(Boolean).join('\n\n');
      if (combined) {
        setResult(combined);
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
    a.click();
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

function TikzRendererWithRef({ code, onImageReady }: { code: string, onImageReady?: (dataUrl: string | null) => void }) {
  const [pngDataUrl, setPngDataUrl] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(true);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const idRef = useRef(Math.random().toString(36).slice(2));

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.tikzId !== idRef.current) return;
      const iframe = iframeRef.current;
      if (!iframe) return;

      setTimeout(() => {
        const svgEl = iframe.contentDocument?.querySelector('svg');
        if (!svgEl) { setIsRendering(false); onImageReady?.(null); return; }

        const svgClone = svgEl.cloneNode(true) as SVGElement;
        if (!svgClone.getAttribute('xmlns')) svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        const svgData = new XMLSerializer().serializeToString(svgClone);
        const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(svgBlob);

        const img = new Image();
        img.onload = () => {
          const scale = 2;
          const canvas = document.createElement('canvas');
          canvas.width = img.width * scale;
          canvas.height = img.height * scale;
          const ctx = canvas.getContext('2d')!;
          ctx.fillStyle = 'white';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.scale(scale, scale);
          ctx.drawImage(img, 0, 0);
          URL.revokeObjectURL(url);
          const dataUrl = canvas.toDataURL('image/png');
          setPngDataUrl(dataUrl);
          setIsRendering(false);
          onImageReady?.(dataUrl);
        };
        img.onerror = () => { URL.revokeObjectURL(url); setIsRendering(false); onImageReady?.(null); };
        img.src = url;
      }, 500);
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [onImageReady]);

  const tikzId = idRef.current;
  const escapedCode = code.replace(/<\/script/gi, '<\\/script');
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
      {/* Hidden iframe for tikzjax rendering */}
      <iframe
        ref={iframeRef}
        srcDoc={srcDoc}
        style={{ display: 'none' }}
        title="TikZ Renderer"
      />
      {isRendering ? (
        <div className="flex items-center justify-center w-full h-48 text-[#00186E]/40">
          <Loader2 className="w-6 h-6 animate-spin mr-2 text-[#FFAD1D]" />
          <span className="text-sm font-sans-brand">Rendering figure...</span>
        </div>
      ) : pngDataUrl ? (
        <img src={pngDataUrl} alt="TikZ figure" className="max-w-full h-auto" />
      ) : (
        <div className="flex items-center justify-center w-full h-48 text-red-400">
          <span className="text-sm font-sans-brand">Failed to render figure</span>
        </div>
      )}
    </div>
  );
}
