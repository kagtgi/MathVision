/**
 * Multi-Agent TikZ Generation Pipeline
 *
 * Lean 3-phase architecture prioritizing correctness:
 *   1. Describe  — natural-language inventory of every visible element
 *   2. Generate  — 2 independent TikZ drafts in parallel
 *   3. Verify+Fix — compare both drafts against the image, merge the best
 *                   parts, fix errors, output final compilable code
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

const DESCRIBE_PROMPT = `Look at this image carefully. List every visible geometric element. Be precise and exhaustive — do not invent anything that is not visible, and do not omit anything that is.

Write a numbered inventory using this format:

1. POINTS: List every labeled point with its approximate position described relative to the figure (e.g. "A is at the bottom-left vertex of the triangle"). Include the label exactly as shown.

2. SEGMENTS/LINES: List every line segment, ray, or line. For each one state:
   - endpoints (e.g. "segment from A to B")
   - style: solid, dashed, dotted, or thick
   - any arrowheads
   - any tick marks indicating equal length (single tick, double tick, etc.)

3. ANGLES: List every marked angle. For each one state:
   - the three points defining it (vertex in the middle, e.g. "angle ABC with vertex B")
   - whether it has a right-angle square mark
   - any arc drawn to mark the angle
   - any label or value shown (e.g. "α", "60°")

4. CIRCLES/ARCS: List any circles or arcs with center, radius information, and style.

5. AXES/GRIDS: If a coordinate system is present, describe the axes, tick marks, labels, and range.

6. CURVES: Any function graphs or freehand curves — describe shape and any labels.

7. SHADING/FILL: Any filled or hatched regions.

8. TEXT: Any text labels or annotations not associated with points.

9. PROPORTIONS: Describe the overall aspect ratio and how points are positioned relative to each other (e.g. "the triangle is roughly equilateral", "B is directly below C", "H is on segment BC about one-third from B").

Rules:
- Only describe what you actually see. Never guess or assume hidden elements.
- If a label is in Vietnamese, write it exactly as shown.
- Be specific about positions: use relative language (left, right, above, below, midpoint, one-third, etc.)`;

const GENERATE_PROMPT = `You are a TikZ expert. You will receive an image of a geometric figure and a text description of its elements.

Your task: write COMPLETE, COMPILABLE TikZ code that faithfully reproduces the figure.

TEMPLATE — follow this structure exactly:
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

RULES:
1. Define \\coordinate for EVERY named point BEFORE using it.
2. Use \\fill (X) circle (1.5pt) and \\node for every labeled point.
3. Put all math labels inside $...$: {$A$}, {$60^\\circ$}.
4. Use [thick] for main edges, [dashed] for construction lines.
5. Use the angles library for angle arcs: \\pic[draw, angle radius=8pt, "$\\alpha$", angle eccentricity=1.5] {angle = C--B--A};
6. Use right angle for 90° marks: \\pic[draw] {right angle = A--H--B};
7. Use decorations.markings for equal-segment tick marks.
8. Place coordinates in a [0,6]×[0,6] region. Match the proportions from the description.
9. Declare only the tikzlibraries you actually use.
10. The code MUST compile with pdflatex + tikz. Do not use undefined macros.
11. Include EVERY element from the description. Do not skip anything.
12. Do not add elements that are not in the description or image.

Output ONLY the TikZ code. No explanation, no markdown fences.`;

const VERIFY_FIX_PROMPT = `You are a TikZ quality verifier. You receive:
1. The original image of a geometric figure
2. A description of what the figure contains
3. Two candidate TikZ code drafts

Your job has two parts:

PART 1 — VERIFY (write your reasoning step by step):
a) List every element from the description.
b) For each element, check: is it present and correct in Draft A? In Draft B?
c) Check each draft for compilation errors:
   - Any \\coordinate used before being defined?
   - Any undefined macros or missing libraries?
   - Syntax errors (unmatched braces, missing semicolons)?
d) Compare proportions: which draft better matches the image layout?

PART 2 — OUTPUT:
Based on your verification, produce the FINAL TikZ code. You may:
- Pick the better draft as-is if it is correct
- Merge the best parts from both drafts
- Fix any errors you found

Your response MUST have exactly this format:

REASONING:
(your step-by-step analysis from Part 1 — be specific, reference exact lines)

FINAL_CODE:
% Required: \\usepackage{tikz}
% \\usetikzlibrary{...}

\\begin{tikzpicture}[scale=1]
...
\\end{tikzpicture}

Rules:
- The FINAL_CODE must be complete and compile with pdflatex.
- Every element from the description must be present.
- Do not add elements that are not in the image.
- Do not hallucinate labels, points, or decorations that do not exist in the image.
- If both drafts miss an element that IS in the description, add it yourself.
- If both drafts include something NOT in the image, remove it.`;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  const timeout = new Promise<T>((_, reject) =>
    setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms),
  );
  return Promise.race([promise, timeout]);
}

function extractTikzCode(text: string): string {
  // From FINAL_CODE: marker
  const finalCodeMatch = text.match(/FINAL_CODE:\s*\n([\s\S]*)/);
  if (finalCodeMatch) {
    const afterMarker = finalCodeMatch[1].trim();
    // Extract tikzpicture from within
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

function extractReasoning(text: string): string {
  const match = text.match(/REASONING:\s*\n([\s\S]*?)(?=\nFINAL_CODE:)/);
  if (match) return match[1].trim();
  // If no marker, take everything before tikzpicture
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

  // ── Phase 1: Describe ──────────────────────────────────────────────────────

  onProgress?.('describe', 'Analyzing the figure — identifying every element...');
  log.push('Step 1: Describing every visible element in the image...');

  const descResponse = await withTimeout(
    callModel(ai, [{ text: DESCRIBE_PROMPT }, img], 0.1),
    AGENT_TIMEOUT_MS,
    'Describer',
  );

  const description = descResponse.text || '';
  if (!description || description.length < 30) {
    throw new Error('Failed to describe the figure. The image may not contain a geometric diagram.');
  }

  // Count elements found for the log
  const pointCount = (description.match(/\b[A-Z]\b(?=\s+is\b|\s+at\b)/g) || []).length;
  log.push(`Found description with ~${pointCount} labeled points.`);

  // ── Phase 2: Generate (2 drafts in parallel) ──────────────────────────────

  onProgress?.('generate', 'Writing two independent TikZ drafts...');
  log.push('Step 2: Generating two independent TikZ code drafts...');

  const genPromises = [0, 1].map(async (i) => {
    try {
      const resp = await withTimeout(
        callModel(
          ai,
          [
            { text: GENERATE_PROMPT },
            img,
            { text: `DESCRIPTION OF THE FIGURE:\n${description}\n\nWrite the TikZ code now. Output ONLY the code.` },
          ],
          i === 0 ? 0.15 : 0.4, // draft A is conservative, draft B has more variation
        ),
        AGENT_TIMEOUT_MS,
        `Generator ${String.fromCharCode(65 + i)}`,
      );
      return extractTikzCode(resp.text || '');
    } catch (err) {
      console.warn(`Generator ${String.fromCharCode(65 + i)} failed:`, err);
      return null;
    }
  });

  const results = await Promise.all(genPromises);
  const candidates = results.filter((c): c is string =>
    c !== null && c.length > 0 && c.includes('\\begin{tikzpicture}'),
  );

  if (candidates.length === 0) {
    throw new Error('Both TikZ generators failed. Please try again.');
  }

  log.push(`Got ${candidates.length} valid draft${candidates.length > 1 ? 's' : ''}.`);

  // If only one candidate, still run verify to catch errors
  if (candidates.length === 1) {
    candidates.push(candidates[0]); // duplicate so verify can still work
  }

  // ── Phase 3: Verify + Fix ─────────────────────────────────────────────────

  onProgress?.('verify', 'Verifying drafts against image — checking every element...');
  log.push('Step 3: Verifying both drafts against the image and description...');

  const draftText = candidates
    .map((code, i) => `=== DRAFT ${String.fromCharCode(65 + i)} ===\n${code}`)
    .join('\n\n');

  const verifyResponse = await withTimeout(
    callModel(
      ai,
      [
        { text: VERIFY_FIX_PROMPT },
        img,
        {
          text: `DESCRIPTION:\n${description}\n\n${draftText}\n\nVerify and produce the final code.`,
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
    // Extract key findings for the log
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
    // Verifier failed to produce code — use best candidate
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
          { text: GENERATE_PROMPT },
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
