/**
 * Multi-Agent TikZ Generation Pipeline
 *
 * Optimized 2-phase architecture:
 *   1. Describe + Draft  — natural-language inventory + 2 parallel TikZ drafts
 *                          Draft A gets the description in-context (single round-trip)
 *                          Draft B runs in parallel with a fresh eye on the image
 *   2. Verify + Fix      — compare both drafts against the image, merge the best
 *                          parts, fix errors, output final compilable code
 *
 * All agents use gemini-pro-latest. Every agent sees the original image
 * so nothing is lost in translation.
 */

import { GoogleGenAI } from '@google/genai';

// ─── Constants ───────────────────────────────────────────────────────────────

const MODEL = 'gemini-pro-latest';
const AGENT_TIMEOUT_MS = 180_000; // 3 minutes

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TikzGenerationResult {
  tikzCode: string;
  description: string;
  candidates: string[];
  reasoning: string;
  log: string[];           // step-by-step reasoning log for display
}

export interface TikzProgressCallback {
  (stage: string, detail: string): void;
}

// ─── Prompts ─────────────────────────────────────────────────────────────────

const DESCRIBE_AND_DRAFT_PROMPT = `You are a TikZ expert. Perform BOTH tasks below in a single response.

TASK 1 — DESCRIBE: List every visible geometric element in the image. Be precise and exhaustive.

Use this format:
1. POINTS: Every labeled point with approximate relative position (e.g. "A is at the bottom-left vertex").
2. SEGMENTS/LINES: Each segment/ray/line with endpoints, style (solid/dashed/dotted/thick), arrowheads, tick marks.
3. ANGLES: Each marked angle with 3 defining points (vertex in middle), right-angle squares, arcs, labels/values.
4. CIRCLES/ARCS: Center, radius info, style.
5. AXES/GRIDS: Coordinate axes, tick marks, labels, range.
6. CURVES: Function graphs or freehand curves with shape and labels.
7. SHADING/FILL: Any filled or hatched regions.
8. TEXT: Labels or annotations not associated with points.
9. PROPORTIONS: Overall aspect ratio, relative point positions.

TASK 2 — GENERATE TikZ: Write COMPLETE, COMPILABLE TikZ code reproducing the figure.

Follow this structure exactly:
% Required: \\usepackage{tikz}
% \\usetikzlibrary{angles, quotes, calc, arrows.meta, decorations.markings}

\\begin{tikzpicture}[scale=1]
  % --- Coordinates ---
  \\coordinate (A) at (x, y);
  % --- Draw segments/shapes ---
  \\draw[thick] (A) -- (B) -- (C) -- cycle;
  % --- Angle marks ---
  \\pic[draw, angle radius=8pt] {angle = C--B--A};
  % --- Right angle marks ---
  \\pic[draw] {right angle = A--H--B};
  % --- Equal-length tick marks ---
  \\draw[decoration={markings, mark=at position 0.5 with {\\draw (0,-2pt) -- (0,2pt);}}, postaction={decorate}] (A) -- (B);
  % --- Point labels ---
  \\fill (A) circle (1.5pt); \\node[below left] at (A) {$A$};
\\end{tikzpicture}

TikZ RULES:
1. Define \\coordinate for EVERY named point BEFORE using it.
2. Use \\fill (X) circle (1.5pt) and \\node for every labeled point.
3. All math labels inside $...$: {$A$}, {$60^\\circ$}.
4. [thick] for main edges, [dashed] for construction lines.
5. angles library for angle arcs. right angle for 90° marks.
6. decorations.markings for equal-segment tick marks.
7. Coordinates in [0,6]×[0,6]. Match proportions from description.
8. Only declare tikzlibraries you actually use.
9. Must compile with pdflatex + tikz. No undefined macros.
10. Include EVERY element from the description. Skip NOTHING.
11. Do NOT add elements not in the image.

Your response MUST have exactly this format:

DESCRIPTION:
(your numbered inventory from Task 1)

TIKZ_CODE:
(your complete TikZ code from Task 2)`;

const DRAFT_B_PROMPT = `You are a TikZ expert. Look at this image of a geometric figure carefully.

Write COMPLETE, COMPILABLE TikZ code that faithfully reproduces the figure.

TEMPLATE — follow this structure:
% Required: \\usepackage{tikz}
% \\usetikzlibrary{angles, quotes, calc, arrows.meta, decorations.markings}

\\begin{tikzpicture}[scale=1]
  \\coordinate (A) at (x, y);
  \\draw[thick] (A) -- (B) -- (C) -- cycle;
  \\pic[draw, angle radius=8pt] {angle = C--B--A};
  \\pic[draw] {right angle = A--H--B};
  \\draw[decoration={markings, mark=at position 0.5 with {\\draw (0,-2pt) -- (0,2pt);}}, postaction={decorate}] (A) -- (B);
  \\fill (A) circle (1.5pt); \\node[below left] at (A) {$A$};
\\end{tikzpicture}

RULES:
1. Define \\coordinate for EVERY named point BEFORE using it.
2. \\fill + \\node for every labeled point. All math in $...$
3. [thick] for main edges, [dashed] for construction lines.
4. angles library for arcs, right angle for 90° marks, decorations.markings for tick marks.
5. Coordinates in [0,6]×[0,6]. Match the image proportions.
6. Only libraries you use. Must compile with pdflatex.
7. Include EVERY visible element. Do NOT add anything not in the image.

Output ONLY the TikZ code. No explanation, no markdown fences.`;

const VERIFY_FIX_PROMPT = `You are a TikZ quality verifier. You receive:
1. The original image of a geometric figure
2. A description of what the figure contains
3. Two candidate TikZ code drafts

PART 1 — VERIFY (step by step):
a) List every element from the description.
b) For each element, check: present and correct in Draft A? In Draft B?
c) Check each draft for compilation errors:
   - Any \\coordinate used before being defined?
   - Any undefined macros or missing libraries?
   - Syntax errors (unmatched braces, missing semicolons)?
d) Compare proportions: which draft better matches the image layout?

PART 2 — OUTPUT:
Produce the FINAL TikZ code. You may:
- Pick the better draft as-is if correct
- Merge best parts from both
- Fix any errors found

Your response MUST have exactly this format:

REASONING:
(your step-by-step analysis — be specific, reference exact lines)

FINAL_CODE:
% Required: \\usepackage{tikz}
% \\usetikzlibrary{...}

\\begin{tikzpicture}[scale=1]
...
\\end{tikzpicture}

Rules:
- FINAL_CODE must be complete and compile with pdflatex.
- Every element from the description must be present.
- Do not add elements not in the image.
- Do not hallucinate labels, points, or decorations not in the image.
- If both drafts miss an element from the description, add it.
- If both drafts include something NOT in the image, remove it.`;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  const timeout = new Promise<T>((_, reject) =>
    setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms),
  );
  return Promise.race([promise, timeout]);
}

function extractTikzCode(text: string): string {
  // From FINAL_CODE: or TIKZ_CODE: marker
  const markerMatch = text.match(/(?:FINAL_CODE|TIKZ_CODE):\s*\n([\s\S]*)/);
  if (markerMatch) {
    const afterMarker = markerMatch[1].trim();
    const envMatch = afterMarker.match(/((?:% Required[\s\S]*?)?\\begin\{tikzpicture\}[\s\S]*?\\end\{tikzpicture\})/);
    if (envMatch) return envMatch[1].trim();
    return afterMarker;
  }

  // From code block
  const codeBlockMatch = text.match(/```(?:latex|tex)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (codeBlockMatch) return codeBlockMatch[1].trim();

  // With header comment
  const tikzMatch = text.match(/(% Required[\s\S]*?\\end\{tikzpicture\})/);
  if (tikzMatch) return tikzMatch[1].trim();

  // Just the environment
  const envMatch = text.match(/(\\begin\{tikzpicture\}[\s\S]*?\\end\{tikzpicture\})/);
  if (envMatch) return envMatch[1].trim();

  return text.trim();
}

function extractDescription(text: string): string {
  const match = text.match(/DESCRIPTION:\s*\n([\s\S]*?)(?=\nTIKZ_CODE:)/);
  if (match) return match[1].trim();
  // Fallback: everything before tikzpicture
  const beforeCode = text.match(/([\s\S]*?)(?=% Required|\\begin\{tikzpicture\})/);
  if (beforeCode && beforeCode[1].trim().length > 20) return beforeCode[1].trim();
  return '';
}

function extractReasoning(text: string): string {
  const match = text.match(/REASONING:\s*\n([\s\S]*?)(?=\nFINAL_CODE:)/);
  if (match) return match[1].trim();
  const beforeCode = text.match(/([\s\S]*?)(?=% Required|\\begin\{tikzpicture\})/);
  if (beforeCode && beforeCode[1].trim().length > 20) return beforeCode[1].trim();
  return '';
}

function callModel(
  ai: GoogleGenAI,
  parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }>,
  temperature: number,
) {
  return ai.models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts }],
    config: { temperature },
  });
}

// ─── Pipeline ────────────────────────────────────────────────────────────────

export async function generateTikzMultiAgent(
  apiKey: string,
  imageBase64: string,
  mimeType: string,
  onProgress?: TikzProgressCallback,
): Promise<TikzGenerationResult> {
  const ai = new GoogleGenAI({ apiKey });
  const img = { inlineData: { data: imageBase64, mimeType } };
  const log: string[] = [];

  // ── Phase 1: Describe+DraftA and DraftB in parallel (2 API calls instead of 3) ──

  onProgress?.('describe', 'Analyzing figure + generating two TikZ drafts in parallel...');
  log.push('Step 1: Running description+draft A and independent draft B in parallel...');

  // Call A: Describe + Generate in one round-trip (saves ~3-5s)
  const callA = withTimeout(
    callModel(ai, [{ text: DESCRIBE_AND_DRAFT_PROMPT }, img], 0.15),
    AGENT_TIMEOUT_MS,
    'Describer+DraftA',
  );

  // Call B: Independent draft with fresh eye (runs in parallel)
  const callB = withTimeout(
    callModel(ai, [{ text: DRAFT_B_PROMPT }, img], 0.4),
    AGENT_TIMEOUT_MS,
    'DraftB',
  );

  const [respA, respB] = await Promise.allSettled([callA, callB]);

  // Extract description from Call A
  let description = '';
  const candidates: string[] = [];

  if (respA.status === 'fulfilled') {
    const textA = respA.value.text || '';
    description = extractDescription(textA);
    const codeA = extractTikzCode(textA);
    if (codeA.includes('\\begin{tikzpicture}')) {
      candidates.push(codeA);
    }
  } else {
    console.warn('Describer+DraftA failed:', respA.reason);
    log.push(`Draft A failed: ${respA.reason?.message || 'unknown error'}`);
  }

  if (respB.status === 'fulfilled') {
    const codeB = extractTikzCode(respB.value.text || '');
    if (codeB.includes('\\begin{tikzpicture}')) {
      candidates.push(codeB);
    }
  } else {
    console.warn('DraftB failed:', respB.reason);
    log.push(`Draft B failed: ${respB.reason?.message || 'unknown error'}`);
  }

  if (candidates.length === 0) {
    throw new Error('Both TikZ generators failed. Please try again.');
  }

  log.push(`Got ${candidates.length} valid draft${candidates.length > 1 ? 's' : ''}.`);

  // If no description was extracted, note it
  if (!description) {
    log.push('Description extraction failed; verifier will work from image only.');
  }

  // If only one candidate, duplicate for verifier
  if (candidates.length === 1) {
    candidates.push(candidates[0]);
  }

  // ── Phase 2: Verify + Fix ─────────────────────────────────────────────────

  onProgress?.('verify', 'Verifying drafts against image — checking every element...');
  log.push('Step 2: Verifying both drafts against the image...');

  const draftText = candidates
    .map((code, i) => `=== DRAFT ${String.fromCharCode(65 + i)} ===\n${code}`)
    .join('\n\n');

  const descSection = description ? `DESCRIPTION:\n${description}\n\n` : '';

  const verifyResponse = await withTimeout(
    callModel(
      ai,
      [
        { text: VERIFY_FIX_PROMPT },
        img,
        {
          text: `${descSection}${draftText}\n\nVerify and produce the final code.`,
        },
      ],
      0.1,
    ),
    AGENT_TIMEOUT_MS,
    'Verifier',
  );

  const verifyText = verifyResponse.text || '';
  const reasoning = extractReasoning(verifyText);
  const finalCode = extractTikzCode(verifyText);

  if (reasoning) {
    const lines = reasoning.split('\n').filter((l) => l.trim().length > 0);
    const summary = lines.slice(0, 5).map((l) => l.trim());
    log.push('Verification findings:');
    for (const s of summary) {
      log.push(`  ${s}`);
    }
    if (lines.length > 5) {
      log.push(`  ... and ${lines.length - 5} more checks.`);
    }
  }

  if (!finalCode.includes('\\begin{tikzpicture}')) {
    log.push('Verifier did not produce valid code. Using best draft directly.');
    return {
      tikzCode: candidates[0],
      description,
      candidates,
      reasoning: reasoning || 'Verification produced no code; using draft A.',
      log,
    };
  }

  log.push('Final TikZ code produced successfully.');
  onProgress?.('complete', 'TikZ generation complete.');

  return {
    tikzCode: finalCode,
    description,
    candidates,
    reasoning,
    log,
  };
}

/**
 * Single-agent fallback — one direct generation pass.
 */
export async function generateTikzSingleAgent(
  apiKey: string,
  imageBase64: string,
  mimeType: string,
): Promise<string | null> {
  const ai = new GoogleGenAI({ apiKey });

  try {
    const resp = await withTimeout(
      callModel(
        ai,
        [
          { text: DRAFT_B_PROMPT },
          { inlineData: { data: imageBase64, mimeType } },
          { text: 'Look at this image and write complete, compilable TikZ code that reproduces it. Output ONLY the TikZ code.' },
        ],
        0.2,
      ),
      AGENT_TIMEOUT_MS,
      'Single Generator',
    );
    const code = extractTikzCode(resp.text || '');
    return code.includes('\\begin{tikzpicture}') ? code : null;
  } catch {
    return null;
  }
}
