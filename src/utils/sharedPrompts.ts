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
CRITICAL — accuracy rules:
- Reproduce EXACTLY what is shown — never simplify, solve, or alter the math.
- Never add symbols, labels, or decorations that are not visible in the image.
- Never guess missing information — if something is unclear, omit it rather than guess.
- If text is in Vietnamese, preserve it exactly as shown (UTF-8).
- Only output what you can confidently read from the image.
`;
