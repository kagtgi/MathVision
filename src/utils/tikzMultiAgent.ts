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
2. Two candidate TikZ code drafts

PART 1 — VERIFY (step by step):
a) Compare each draft against the original image element by element.
b) Check each draft for compilation errors:
   - Any \\coordinate used before being defined?
   - Any undefined macros or missing libraries?
   - Syntax errors (unmatched braces, missing semicolons)?
c) Compare proportions: which draft better matches the image layout?

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
- Every element visible in the image must be present.
- Do not add elements not in the image.
- Do not hallucinate labels, points, or decorations not in the image.
- If both drafts miss a visible element, add it.
- If both drafts include something NOT in the image, remove it.`;

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
    description: '',
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
