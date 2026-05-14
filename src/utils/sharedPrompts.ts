/**
 * Shared prompt fragments used by both Image→LaTeX and PDF→DOCX modes.
 * Single source of truth for LaTeX quality rules, math conventions,
 * and anti-hallucination instructions.
 */

// ─── Model ───────────────────────────────────────────────────────────────────

export const GEMINI_MODEL = 'gemini-pro-latest';

// ─── LaTeX Math Transcription Rules ──────────────────────────────────────────
// Used by both Image→LaTeX (SYSTEM_INSTRUCTION) and PDF→DOCX (PDF_ANALYSIS_PROMPT)

export const LATEX_MATH_RULES = `
### Geometry notation (Vietnamese + international)

**Points**: $A$, $B$, $M$, $O$, $H$ — capital italic letter, no decoration.

**Segments / lengths / lines / rays / vectors**:
- Segment AB (no bar, no arrow): $AB$
- Length of segment: $AB$ or $|AB|$
- Line through A and B: $\\overleftrightarrow{AB}$
- Ray from A through B: $\\overrightarrow{AB}$
- Vector from A to B: $\\overrightarrow{AB}$

**Angles**:
- Angle at vertex B in ∠ABC: $\\widehat{ABC}$ (Vietnamese default) or $\\angle ABC$
- Use whichever notation the image shows; default to $\\widehat{ABC}$
- Degree value: $60{}^\\circ$ — ALWAYS use {}^\\circ, NEVER bare ° or ^\\circ without braces

**Shapes and geometric relations**:
- Triangle: $\\triangle ABC$
- Congruent triangles: $\\triangle ABC \\cong \\triangle DEF$
- Similar triangles: $\\triangle ABC \\sim \\triangle DEF$
- Circle with center O: $(O)$ or $(O; R)$
- Arc AB: $\\overset{\\frown}{AB}$
- Perpendicular: $AB \\perp CD$
- Parallel: $AB \\parallel CD$
- Area of triangle: $S_{\\triangle ABC}$

### Arithmetic and algebra

- Fractions: $\\frac{a}{b}$ — ALWAYS \\frac, NEVER write a/b inline
- Square root: $\\sqrt{x}$
- nth root: $\\sqrt[n]{x}$ — e.g. $\\sqrt[3]{8}$
- Absolute value: $\\left| x \\right|$ — use \\left and \\right
- Percentage: $75\\%$
- Scientific notation: $2 \\times 10^{5}$
- Vietnamese decimal comma: $3{,}14$ — comma enclosed in braces

### Delimiters — ALWAYS use \\left and \\right for non-trivial content

- Parentheses: $\\left( \\cdots \\right)$
- Square brackets: $\\left[ \\cdots \\right]$
- Curly braces: $\\left\\{ \\cdots \\right\\}$

### Calculus and advanced notation

- Derivatives: $\\{f\\}'(x)$, $\\{y\\}''$ — wrap the base in braces before every prime
- Definite integral: $\\int_{a}^{b} f(x)\\,dx$
- Summation: $\\sum_{i=1}^{n} a_i$
- Limit: $\\lim_{x \\to \\infty} f(x)$
- Infinity: $\\infty$

### Standard command reference
$\\frac{a}{b}$, $\\int_{a}^{b} f(x)\\,dx$, $\\sum_{i=1}^{n}$, $\\lim_{x \\to \\infty}$,
$\\sqrt{x}$, $\\sqrt[n]{x}$, $\\vec{v}$, $\\overrightarrow{AB}$, $\\widehat{ABC}$,
$\\alpha$, $\\beta$, $\\gamma$, $\\delta$, $\\theta$, $\\pi$, $\\varphi$, $\\omega$,
$\\Delta$, $\\Sigma$, $\\Pi$, $\\Omega$

### Systems and matrices

- System of equations: $\\begin{cases} f_1 \\\\ f_2 \\end{cases}$
- Matrix (parentheses): $\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}$
- Matrix (brackets): $\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}$
`;

// ─── Anti-hallucination rules ────────────────────────────────────────────────

export const ANTI_HALLUCINATION = `
CRITICAL ACCURACY RULES — violating any of these is a hard failure:

1. Reproduce EXACTLY what is shown — never simplify, rearrange, solve, or "improve" the math.
2. Never add symbols, labels, decorations, or elements that are not visible in the image.
3. Never guess obscured information — if a number or symbol is partially hidden, write \\text{[unclear]} rather than guessing.
4. If text is in Vietnamese, preserve it EXACTLY as shown, including every diacritical mark.
5. Only output what you can confidently read — when uncertain, \\text{[unclear]} is always safer than a guess.
6. Never "correct" what appears to be a mistake in the original — reproduce errors as-is.
7. Never infer context from surrounding content — treat each element independently.
`;

// ─── TikZJax compatibility rules ─────────────────────────────────────────────
// TikZJax (browser-based renderer) does NOT support PGF math functions.
// Using them causes a silent hang until the 30-second timeout.

export const TIKZJAX_COMPAT_RULES = `
CRITICAL — TikZJax browser renderer restrictions (violations = silent hang or compile error):

FORBIDDEN — never use these in coordinates, lengths, or expressions:
  sqrt(), sin(), cos(), tan(), abs(), pow(), mod(), ln(), exp(),
  min(), max(), floor(), ceil(), round(), rnd(), pi, e

PRE-COMPUTE all values to plain decimal numbers BEFORE writing the code:
  ✗ BAD:  \\coordinate (C) at (3, {sqrt(3)});
  ✓ GOOD: \\coordinate (C) at (3, 1.73205);

  ✗ BAD:  \\coordinate (P) at ({2*cos(60)}, {2*sin(60)});
  ✓ GOOD: \\coordinate (P) at (1.0, 1.73205);

  ✗ BAD:  \\draw (0,0) -- ({3*cos(30)},{3*sin(30)});
  ✓ GOOD: \\draw (0,0) -- (2.59808, 1.5);

  ✗ BAD:  \\coordinate (M) at ($(A)!{sqrt(2)/2}!(B)$);
  ✓ GOOD: \\coordinate (M) at ($(A)!0.70711!(B)$);

  ✗ BAD:  \\draw (0,0) arc (0:{asin(0.5)*180/pi}:2);
  ✓ GOOD: \\draw (0,0) arc (0:30:2);

Common pre-computed values (use these directly):
  sin(30°)=0.5, cos(30°)=0.86603, sin(45°)=0.70711, cos(45°)=0.70711
  sin(60°)=0.86603, cos(60°)=0.5, sqrt(2)=1.41421, sqrt(3)=1.73205

Every coordinate value must be a plain integer or decimal. No {} around computed
expressions. No function calls. No PGF math operators inside coordinate values.
`;

// ─── Output format guardrails ────────────────────────────────────────────────
// Shared constraints to reduce LLM output variability

export const OUTPUT_FORMAT_RULES = `
OUTPUT FORMAT — strict rules:
- Never wrap output in markdown code fences unless explicitly told to use \`\`\`latex.
- Never add explanatory text before or after the code/JSON.
- Never add comments like "Here is the code:" or "Note:".
- If asked for JSON, output ONLY the JSON object starting with { and ending with }.
- If asked for TikZ, output ONLY the TikZ code starting with % Required or \\begin{tikzpicture}.
- If asked for LaTeX, output ONLY the LaTeX wrapped in $...$.
`;
