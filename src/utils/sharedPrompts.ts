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
### Geometry naming (Vietnamese + international conventions)

**Points**: $A$, $B$, $M$, $O$, $H$ — capital italic, no decoration.

**Segments/lines/rays**:
- Segment: $AB$ (no bar, no arrow)
- Length: $AB$ or $|AB|$
- Line: $\\overleftrightarrow{AB}$
- Ray/vector: $\\overrightarrow{AB}$

**Angles**:
- Angle at vertex B: $\\widehat{ABC}$ (Vietnamese default) or $\\angle ABC$
- Use whichever notation the image shows; default $\\widehat{ABC}$
- Degree values: $60{}^\\circ$ — always use {}^\\circ, never bare ° or ^\\circ

**Shapes**:
- Triangle: $\\triangle ABC$
- Congruent: $\\triangle ABC \\cong \\triangle DEF$
- Similar: $\\triangle ABC \\sim \\triangle DEF$
- Circle center O: $(O)$ or $(O; R)$
- Arc: $\\overset{\\frown}{AB}$

**Relations**:
- Perpendicular: $AB \\perp CD$
- Parallel: $AB \\parallel CD$
- Area: $S_{\\triangle ABC}$

### Number and expression rules

- Fractions: $\\frac{a}{b}$ — always \\frac, never a/b
- Roots: $\\sqrt{x}$, $\\sqrt[3]{8}$
- Decimals (Vietnamese): $3{,}14$ — comma in braces
- Percentage: $75\\%$
- Absolute value: $\\left| x \\right|$
- Scientific: $2 \\times 10^{5}$

### Bracket rules — ALWAYS use \\left and \\right

- Parentheses: $\\left( ... \\right)$
- Square: $\\left[ ... \\right]$
- Curly: $\\left\\{ ... \\right\\}$

### Derivative and degree notation

- Derivatives: $\\{f\\}'(x)$, $\\{y\\}''$ — wrap base in braces before prime
- Degrees: $30{}^\\circ$ — braces before ^\\circ

### Standard commands
\\frac{a}{b}, \\int_{a}^{b} f(x)\\,dx, \\sum_{i=1}^{n}, \\lim_{x \\to \\infty}, \\sqrt{}, \\sqrt[n]{}, \\vec{v}, \\overrightarrow{AB}, \\alpha \\beta \\gamma \\theta \\pi \\Delta \\Sigma

### Systems and matrices
- Systems: $\\begin{cases} ... \\end{cases}$
- Matrices: $\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}$
`;

// ─── Anti-hallucination rules ────────────────────────────────────────────────

export const ANTI_HALLUCINATION = `
CRITICAL — accuracy rules you MUST follow:
1. Reproduce EXACTLY what is shown — never simplify, solve, or alter the math.
2. Never add symbols, labels, or decorations that are not visible in the image.
3. Never guess missing information — if something is unclear, omit it rather than guess.
4. If text is in Vietnamese, preserve it exactly as shown (UTF-8).
5. Only output what you can confidently read from the image.
6. Do NOT infer hidden values — if a number or symbol is partially obscured, mark it with \\text{[unclear]} rather than guessing.
7. Do NOT "improve" or "correct" what appears to be a mistake in the original — reproduce it as-is.
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
