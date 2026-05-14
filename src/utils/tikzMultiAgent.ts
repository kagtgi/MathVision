/**
 * Multi-Agent TikZ Generation Pipeline — Optimized
 *
 * 2-phase, 2-round-trip architecture:
 *   Phase 1 (parallel):  Initial classify+extract (Draft A) runs alongside
 *                         an independent Draft B — both see the original image.
 *   Phase 2 (sequential): Verifier compares both drafts, merges the best parts,
 *                          fixes errors, outputs final compilable code.
 *
 * When Draft A is provided by the caller (from the initial classify call),
 * only Draft B + Verify are needed — saving one full API round-trip.
 */

import { GoogleGenAI } from '@google/genai';
import { TIKZJAX_COMPAT_RULES } from './sharedPrompts';

// ─── Constants ───────────────────────────────────────────────────────────────

const MODEL = 'gemini-pro-latest';
const AGENT_TIMEOUT_MS = 120_000; // 2 minutes (reduced from 3 — Gemini Pro rarely needs >90s)

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TikzGenerationResult {
  tikzCode: string;
  candidates: string[];
  reasoning: string;
  log: string[];
}

export interface TikzProgressCallback {
  (stage: string, detail: string): void;
}

// ─── Prompts ─────────────────────────────────────────────────────────────────

const DRAFT_B_PROMPT = `You are an expert TikZ code generator. Analyze this geometric figure image and produce complete, compilable TikZ code that faithfully reproduces it.

BEFORE WRITING CODE — observe carefully:
• Identify every labeled point and estimate its coordinates to fit within [0,6]×[0,6].
• Note which edges are solid (principal) vs dashed (altitude/auxiliary/construction).
• Note every angle arc, right-angle mark, equal-segment tick, or parallel mark.
• Note any circles, coordinate axes, or other special elements.

REQUIRED TEMPLATE — follow this structure exactly:
% Required: \\usepackage{tikz}
% \\usetikzlibrary{angles, quotes, calc, decorations.markings, arrows.meta}

\\begin{tikzpicture}[scale=1]
  % ── 1. ALL coordinates defined here, before any draw command ─────────────
  \\coordinate (A) at (0, 0);
  \\coordinate (B) at (5, 0);
  \\coordinate (C) at (2.5, 4.33);  % pre-computed decimal, never sqrt()
  \\coordinate (H) at (2.5, 0);

  % ── 2. Edges ─────────────────────────────────────────────────────────────
  \\draw[thick] (A) -- (B) -- (C) -- cycle;
  \\draw[dashed] (C) -- (H);

  % ── 3. Marks ─────────────────────────────────────────────────────────────
  % Right-angle mark (library: angles) — vertex is the MIDDLE argument:
  \\pic[draw, angle radius=5pt]{right angle = A--H--C};

  % Labeled angle arc (libraries: angles + quotes) — vertex is MIDDLE:
  \\pic["$60{}^\\circ$", draw, angle radius=10mm, angle eccentricity=1.5]{angle = C--A--B};

  % Single equal-segment tick (library: decorations.markings):
  \\draw[decoration={markings, mark=at position 0.5 with {\\draw (-0pt,-2.5pt)--(-0pt,2.5pt);}},
        postaction={decorate}] (A) -- (B);

  % Double tick for double-equal sides:
  \\draw[decoration={markings,
    mark=at position 0.5 with {\\draw (-1.5pt,-2.5pt)--(-1.5pt,2.5pt); \\draw (1.5pt,-2.5pt)--(1.5pt,2.5pt);}},
        postaction={decorate}] (B) -- (C);

  % Circle with center O (use pre-computed decimal radius):
  % \\draw[thick] (O) circle (2.5);

  % ── 4. Point dots and labels ─────────────────────────────────────────────
  \\fill (A) circle (1.5pt); \\node[below left]  at (A) {$A$};
  \\fill (B) circle (1.5pt); \\node[below right] at (B) {$B$};
  \\fill (C) circle (1.5pt); \\node[above]       at (C) {$C$};
  \\fill (H) circle (1.5pt); \\node[below]       at (H) {$H$};
\\end{tikzpicture}

MANDATORY RULES:
1. ALL \\coordinate declarations MUST appear before ANY \\draw or \\fill that references them.
2. Every visible labeled point: \\fill (X) circle (1.5pt); AND \\node[anchor] at (X) {$X$};
3. ALL math in node text uses $...$  — including single letters {$A$}, degrees {$60{}^\\circ$}.
4. [thick] for principal edges; [dashed] for altitudes, medians, auxiliary/construction lines.
5. Right-angle mark: \\pic[draw, angle radius=5pt]{right angle = P--VERTEX--Q};  (vertex in MIDDLE)
6. Angle arc: \\pic["LABEL", draw, angle radius=Xmm, angle eccentricity=Y]{angle = C--VERTEX--A};  (vertex in MIDDLE)
7. ALL coordinate values must be plain decimals — never sqrt(), sin(), cos(), or any function call.
8. Fit all coordinates within [0,6]×[0,6].
9. Declare ONLY the libraries you actually use.
10. Include EVERY element visible in the image. Add NOTHING not visible.
${TIKZJAX_COMPAT_RULES}
Output ONLY the TikZ code starting with % Required. No markdown fences. No explanation.`;

const VERIFY_FIX_PROMPT = `You are a TikZ code quality verifier. You have the original image plus two candidate TikZ drafts. Systematically verify both, then produce the best possible final code.

## VERIFICATION CHECKLIST

For EACH draft, check every item:

### Completeness (vs. the image)
□ Every labeled point has \\fill (X) circle (1.5pt) + \\node
□ Every line segment and edge is drawn
□ Every angle arc is present (correct vertex, correct label if shown)
□ Every right-angle mark is present (at the correct corner)
□ Every equal-segment tick is present (on the correct sides)
□ Every parallel mark / arrow is present if shown
□ Circles and arcs are present if shown
□ Coordinate axes are present if shown
□ All text labels and measurements are included

### Accuracy (vs. the image)
□ Coordinate proportions match the image layout
□ Angle arcs are at the correct vertices (vertex is MIDDLE in {angle = C--B--A})
□ Right-angle marks are at the correct corners
□ Tick marks are on the correct segments
□ Dashed lines are only used for auxiliary/construction lines

### Compilation correctness
□ ALL \\coordinate declarations appear before their first use
□ All libraries used are declared in \\usetikzlibrary{...}
□ All braces and brackets are balanced
□ All \\draw statements end with semicolons
□ All \\pic commands have correct syntax (vertex in MIDDLE position)
□ All coordinate values are plain decimals — no sqrt(), sin(), cos(), or any function

### Anti-hallucination
□ No elements added that are NOT visible in the image
□ No labels invented that are NOT shown in the image

## MERGE STRATEGY

Priority order:
1. If one draft is complete and correct → use it, fix any compile errors only
2. If both are partially correct → take the better coordinate layout; add missing elements from the other
3. If both miss visible elements → add those missing elements to the better base draft
4. If either draft adds elements NOT in the image → remove them from the final output

## REQUIRED OUTPUT FORMAT

Your response must contain EXACTLY these two sections in this order:

REASONING:
(Step-by-step analysis. For each issue found, state: which draft, what is wrong, how you fixed it.
Reference specific coordinates, element names, or line content — be concrete.)

FINAL_CODE:
% Required: \\usepackage{tikz}
% \\usetikzlibrary{...}

\\begin{tikzpicture}[scale=1]
  % ── Coordinates ──────────────────────────────────────────────────────
  \\coordinate (A) at (x, y);
  ...

  % ── Drawing commands ─────────────────────────────────────────────────
  \\draw[thick] ...;
  ...

  % ── Labels ───────────────────────────────────────────────────────────
  \\fill (A) circle (1.5pt); \\node[anchor] at (A) {$A$};
  ...
\\end{tikzpicture}

Rules for FINAL_CODE:
- Must begin with % Required: \\usepackage{tikz}
- Must end with \\end{tikzpicture}
- Must compile cleanly with pdflatex
- Every \\coordinate must be defined before its first use
- Every coordinate value must be a plain decimal number
${TIKZJAX_COMPAT_RULES}`;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  const timeout = new Promise<T>((_, reject) =>
    setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms),
  );
  return Promise.race([promise, timeout]);
}

export function extractTikzCode(text: string): string {
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

/**
 * Optimized pipeline: accepts an existing Draft A (from the initial classify call)
 * so only Draft B + Verify need to run — 2 API calls instead of 3.
 *
 * If draftA is not provided, falls back to generating both drafts (3 calls total).
 */
export async function generateTikzMultiAgent(
  apiKey: string,
  imageBase64: string,
  mimeType: string,
  options?: { onProgress?: TikzProgressCallback; draftA?: string },
): Promise<TikzGenerationResult> {
  const { onProgress, draftA } = options ?? {};
  const ai = new GoogleGenAI({ apiKey });
  const img = { inlineData: { data: imageBase64, mimeType } };
  const log: string[] = [];
  const candidates: string[] = [];

  // ── Phase 1: Get Draft B (+ Draft A if not provided) ──────────────────────

  if (draftA && draftA.includes('\\begin{tikzpicture}')) {
    // Draft A already available from the initial classify call — skip redundant generation
    candidates.push(draftA);
    log.push('Using initial TikZ output as Draft A (saved one API call).');

    onProgress?.('describe', 'Generating independent Draft B for comparison...');
    log.push('Step 1: Generating independent Draft B...');

    try {
      const respB = await withTimeout(
        callModel(ai, [{ text: DRAFT_B_PROMPT }, img], 0.4),
        AGENT_TIMEOUT_MS,
        'DraftB',
      );
      const codeB = extractTikzCode(respB.text || '');
      if (codeB.includes('\\begin{tikzpicture}')) {
        candidates.push(codeB);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      console.warn('DraftB failed:', msg);
      log.push(`Draft B failed: ${msg}`);
    }
  } else {
    // No Draft A provided — fire both in parallel (3 API calls total)
    onProgress?.('describe', 'Generating two TikZ drafts in parallel...');
    log.push('Step 1: Running two independent drafts in parallel...');

    const callA = withTimeout(
      callModel(ai, [{ text: DRAFT_B_PROMPT }, img], 0.15),
      AGENT_TIMEOUT_MS,
      'DraftA',
    );
    const callB = withTimeout(
      callModel(ai, [{ text: DRAFT_B_PROMPT }, img], 0.4),
      AGENT_TIMEOUT_MS,
      'DraftB',
    );

    const [respA, respB] = await Promise.allSettled([callA, callB]);

    if (respA.status === 'fulfilled') {
      const codeA = extractTikzCode(respA.value.text || '');
      if (codeA.includes('\\begin{tikzpicture}')) candidates.push(codeA);
    } else {
      log.push(`Draft A failed: ${respA.reason?.message || 'unknown error'}`);
    }

    if (respB.status === 'fulfilled') {
      const codeB = extractTikzCode(respB.value.text || '');
      if (codeB.includes('\\begin{tikzpicture}')) candidates.push(codeB);
    } else {
      log.push(`Draft B failed: ${respB.reason?.message || 'unknown error'}`);
    }
  }

  if (candidates.length === 0) {
    throw new Error('TikZ generation failed. Please try again.');
  }

  log.push(`Got ${candidates.length} valid draft${candidates.length > 1 ? 's' : ''}.`);

  // ── Phase 2: Verify + Fix ─────────────────────────────────────────────────

  // If only one candidate, skip verify and return it directly — saves another round-trip
  if (candidates.length === 1) {
    log.push('Only one draft available — returning it directly (skipping verify).');
    onProgress?.('complete', 'TikZ generation complete.');
    return {
      tikzCode: candidates[0],
      candidates,
      reasoning: 'Single draft — no verification needed.',
      log,
    };
  }

  onProgress?.('verify', 'Verifying drafts against image — picking best result...');
  log.push('Step 2: Verifying both drafts against the image...');

  const draftText = candidates
    .map((code, i) => `=== DRAFT ${String.fromCharCode(65 + i)} ===\n${code}`)
    .join('\n\n');

  const verifyResponse = await withTimeout(
    callModel(
      ai,
      [
        { text: VERIFY_FIX_PROMPT },
        img,
        { text: `${draftText}\n\nVerify and produce the final code.` },
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
      candidates,
      reasoning: reasoning || 'Verification produced no code; using draft A.',
      log,
    };
  }

  log.push('Final TikZ code produced successfully.');
  onProgress?.('complete', 'TikZ generation complete.');

  return {
    tikzCode: finalCode,
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
