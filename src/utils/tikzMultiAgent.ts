/**
 * Multi-Agent TikZ Generation Pipeline
 *
 * Uses multiple specialized Gemini agents to produce high-quality TikZ code
 * from images of geometric figures. Prioritizes correctness over token cost.
 *
 * Pipeline:
 *   1. Analyzer Agent   — deeply describes every geometric element in the image
 *   2. Generator Agents — 3 independent generators produce TikZ candidates in parallel
 *   3. Judge Agent      — evaluates all candidates against the image, picks/synthesizes best
 *   4. Refiner Agent    — final correction pass on the chosen code
 */

import { GoogleGenAI } from '@google/genai';

// ─── Constants ───────────────────────────────────────────────────────────────

const TIKZ_MODEL = 'gemini-2.5-pro-preview-06-05';
const ANALYSIS_TEMPERATURE = 0.1;
const GENERATION_TEMPERATURE = 0.4; // moderate creativity for diversity across generators
const JUDGE_TEMPERATURE = 0.1;
const REFINE_TEMPERATURE = 0.1;
const AGENT_TIMEOUT_MS = 120_000; // 2 minutes per agent call

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TikzGenerationResult {
  tikzCode: string;
  analysis: string;
  candidates: string[];
  selectedIndex: number;
  judgeReasoning: string;
}

export interface TikzProgressCallback {
  (stage: string, detail?: string): void;
}

// ─── Prompts ─────────────────────────────────────────────────────────────────

const ANALYZER_PROMPT = `You are a precision geometry analyzer. Your job is to deeply analyze an image of a geometric figure and produce an exhaustive, structured description that another agent can use to generate perfect TikZ code.

Analyze the image and output a JSON object with this structure:
{
  "figureType": "triangle | quadrilateral | circle | coordinate_system | function_graph | composite | other",
  "description": "One-sentence summary of the figure",
  "boundingBox": { "estimatedWidth": number, "estimatedHeight": number, "aspectRatio": number },
  "points": [
    {
      "label": "A",
      "position": { "x": number, "y": number },
      "anchor": "below left | above | right | ...",
      "isCenter": false,
      "notes": "optional special role like midpoint, foot of altitude, etc."
    }
  ],
  "segments": [
    {
      "from": "A", "to": "B",
      "style": "solid | dashed | dotted | thick",
      "hasArrow": false,
      "tickMarks": 0,
      "label": null,
      "notes": ""
    }
  ],
  "angles": [
    {
      "vertex": "B",
      "from": "A",
      "to": "C",
      "isRightAngle": false,
      "label": "α",
      "value": "60°",
      "notes": ""
    }
  ],
  "circles": [
    {
      "center": "O",
      "radiusValue": 2.5,
      "radiusLabel": "R",
      "style": "solid",
      "notes": ""
    }
  ],
  "arcs": [
    {
      "center": "O",
      "startAngle": 30,
      "endAngle": 150,
      "radius": 2,
      "label": "",
      "notes": ""
    }
  ],
  "axes": {
    "hasXAxis": false,
    "hasYAxis": false,
    "xRange": [-1, 5],
    "yRange": [-1, 5],
    "gridLines": false,
    "tickLabels": true
  },
  "curves": [
    {
      "type": "function | parametric | freehand",
      "expression": "x^2/4",
      "domain": [0, 4],
      "style": "solid",
      "label": "y = f(x)",
      "notes": ""
    }
  ],
  "filledRegions": [
    {
      "vertices": ["A", "B", "C"],
      "style": "gray!20 | pattern=north east lines",
      "notes": ""
    }
  ],
  "textAnnotations": [
    {
      "text": "any text labels not associated with points",
      "position": { "x": 3, "y": 4 },
      "notes": ""
    }
  ],
  "symmetries": "any mirror/rotational symmetry observed",
  "specialProperties": "parallel lines, perpendicular lines, equal segments, tangent lines, etc.",
  "coordinateEstimates": "Describe how you estimated the coordinate positions based on visual proportions"
}

CRITICAL RULES:
- Estimate coordinates carefully based on visual proportions. Place the figure in a [0,6] × [0,6] region.
- Identify ALL labeled points, segments, angles, and their relationships.
- Note equal segments (tick marks), right angles (square corner marks), parallel lines (arrow marks).
- Note dashed vs solid lines, thick vs thin lines, arrows on lines.
- Note any shading, hatching, or filled regions.
- If you see Vietnamese text labels, include them exactly as shown.
- Be exhaustive — missing a single element will cause errors in the generated TikZ.
- Output ONLY the JSON object, no markdown, no explanation.`;

const makeGeneratorPrompt = (index: number) => `You are TikZ Generator #${index + 1}, an expert at writing compilable TikZ code for geometric figures.

You will receive:
1. An image of a geometric figure
2. A structured analysis of the figure (JSON)

Your job: produce COMPLETE, COMPILABLE TikZ code that faithfully reproduces the figure.

REQUIRED STRUCTURE:
\`\`\`
% Required packages: \\usepackage{tikz}
% \\usetikzlibrary{angles, quotes, calc, arrows.meta, decorations.markings, positioning, intersections, patterns}

\\begin{tikzpicture}[scale=1]
  % Define coordinates
  ...
  % Draw elements
  ...
  % Mark points and labels
  ...
\\end{tikzpicture}
\`\`\`

MANDATORY RULES:
1. Every named coordinate must be defined with \\coordinate before use
2. Every labeled point gets: \\fill[black] (X) circle (1.5pt); \\node[anchor] at (X) {$X$};
3. Use [thick] for main figure edges, [dashed] for construction/auxiliary lines
4. Right angles: \\pic[draw] {right angle = A--H--B};
5. Labeled angles: \\pic[draw, angle radius=8pt, "$\\alpha$", angle eccentricity=1.5] {angle = C--B--A};
6. Equal segment tick marks: use decorations.markings with mark at position 0.5
7. All math in nodes must be in $...$
8. Fit figure in [0,6] × [0,6] region, use scale=1 by default
9. Include ALL elements from the analysis — missing elements are failures
10. Use calc library for midpoints: \\coordinate (M) at ($(A)!0.5!(B)$);
11. Include comments explaining each section
12. Code must compile with pdflatex + tikz + declared libraries

${index === 0 ? 'Focus on GEOMETRIC PRECISION — get coordinates and proportions exactly right.' : ''}
${index === 1 ? 'Focus on COMPLETENESS — ensure every single element from the analysis is included.' : ''}
${index === 2 ? 'Focus on VISUAL FIDELITY — match the visual appearance (line styles, labels, spacing) as closely as possible.' : ''}

Output ONLY the TikZ code block. No explanation, no markdown formatting.`;

const JUDGE_PROMPT = `You are a TikZ code judge. You will receive:
1. An image of a geometric figure
2. The structured analysis of the figure
3. Three candidate TikZ code blocks

Your job: evaluate each candidate against the original image and analysis, then produce the BEST possible TikZ code.

EVALUATION CRITERIA (score each 1-10):
1. **Geometric Accuracy**: Are coordinates, proportions, and positions correct?
2. **Completeness**: Are ALL elements from the image included (points, segments, angles, labels, decorations)?
3. **Compilability**: Will the code compile without errors? Are all coordinates defined before use? Are library calls correct?
4. **Visual Fidelity**: Do line styles, thicknesses, colors, and label positions match the image?
5. **Code Quality**: Clean structure, good comments, proper use of TikZ idioms?

OUTPUT FORMAT (return ONLY this JSON, no markdown):
{
  "evaluation": [
    {
      "candidateIndex": 0,
      "scores": { "accuracy": 8, "completeness": 7, "compilability": 9, "fidelity": 7, "quality": 8 },
      "totalScore": 39,
      "strengths": "...",
      "weaknesses": "..."
    },
    {
      "candidateIndex": 1,
      "scores": { "accuracy": 9, "completeness": 9, "compilability": 8, "fidelity": 8, "quality": 7 },
      "totalScore": 41,
      "strengths": "...",
      "weaknesses": "..."
    },
    {
      "candidateIndex": 2,
      "scores": { "accuracy": 7, "completeness": 8, "compilability": 9, "fidelity": 9, "quality": 8 },
      "totalScore": 41,
      "strengths": "...",
      "weaknesses": "..."
    }
  ],
  "selectedIndex": 1,
  "reasoning": "Why this candidate was selected or how the best was synthesized",
  "bestCode": "THE COMPLETE BEST TIKZ CODE HERE — either the selected candidate as-is, or a synthesized version combining the best parts of multiple candidates. Must be complete and compilable."
}

CRITICAL:
- The "bestCode" field must contain COMPLETE, COMPILABLE TikZ code
- You may synthesize a new version combining strengths of multiple candidates
- Fix any compilation errors you spot (undefined coordinates, missing libraries, syntax errors)
- Ensure ALL elements from the analysis are present in the final code
- If all candidates miss an element, ADD it in the bestCode`;

const REFINER_PROMPT = `You are a TikZ code refiner. You will receive:
1. An image of a geometric figure
2. TikZ code that was selected as the best candidate

Your job: do a FINAL quality pass on the code, comparing it against the original image, and fix any remaining issues.

CHECK AND FIX:
1. **Missing elements**: Compare every visible element in the image against the code. Add anything missing.
2. **Wrong positions**: Check if point positions match the visual proportions in the image. Adjust if needed.
3. **Label placement**: Ensure labels don't overlap with lines or other labels. Adjust anchors.
4. **Right angles**: Verify all right angles visible in the image have \\pic[draw] {right angle = ...}
5. **Equal segments**: Verify tick marks on equal segments
6. **Line styles**: Solid vs dashed vs dotted — must match the image exactly
7. **Arrows**: Check if any lines/segments should have arrowheads
8. **Angle arcs**: Verify all marked angles have proper arcs with labels
9. **Compilability**: Ensure every \\coordinate is defined before use, all libraries are declared
10. **Scale and proportions**: Figure should be well-proportioned and not cramped or oversized

OUTPUT: Return ONLY the final refined TikZ code. No explanation, no markdown formatting, no code fences.
Start directly with "% Required packages:" and end with "\\end{tikzpicture}".`;

// ─── Helper Functions ────────────────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  const timeout = new Promise<T>((_, reject) =>
    setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms),
  );
  return Promise.race([promise, timeout]);
}

function extractTikzCode(text: string): string {
  // Try to extract from code block
  const codeBlockMatch = text.match(/```(?:latex|tex)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  // Try to find tikzpicture directly
  const tikzMatch = text.match(/(% Required packages[\s\S]*?\\end\{tikzpicture\})/);
  if (tikzMatch) {
    return tikzMatch[1].trim();
  }

  // Try just the tikzpicture environment
  const envMatch = text.match(/(\\begin\{tikzpicture\}[\s\S]*?\\end\{tikzpicture\})/);
  if (envMatch) {
    return envMatch[1].trim();
  }

  // Return as-is if nothing matched
  return text.trim();
}

function extractJson(text: string): string {
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return jsonMatch[0].trim();
  }
  return text.trim();
}

// ─── Multi-Agent Pipeline ────────────────────────────────────────────────────

/**
 * Run the full multi-agent TikZ generation pipeline.
 *
 * @param apiKey      Gemini API key
 * @param imageBase64 Base64-encoded image data (without data URL prefix)
 * @param mimeType    Image MIME type (e.g. "image/jpeg")
 * @param onProgress  Optional callback for progress updates
 * @returns           TikzGenerationResult with the final TikZ code and metadata
 */
export async function generateTikzMultiAgent(
  apiKey: string,
  imageBase64: string,
  mimeType: string,
  onProgress?: TikzProgressCallback,
): Promise<TikzGenerationResult> {
  const ai = new GoogleGenAI({ apiKey });

  const imageInlineData = {
    inlineData: { data: imageBase64, mimeType },
  };

  // ── Phase 1: Analysis ──────────────────────────────────────────────────────

  onProgress?.('analysis', 'Deeply analyzing the geometric figure...');

  const analysisResponse = await withTimeout(
    ai.models.generateContent({
      model: TIKZ_MODEL,
      contents: [{
        role: 'user',
        parts: [
          { text: ANALYZER_PROMPT },
          imageInlineData,
          { text: 'Analyze this geometric figure image. Output ONLY the JSON analysis.' },
        ],
      }],
      config: { temperature: ANALYSIS_TEMPERATURE },
    }),
    AGENT_TIMEOUT_MS,
    'Analyzer Agent',
  );

  const analysisText = analysisResponse.text || '';
  const analysisJson = extractJson(analysisText);

  // Validate that we got valid JSON analysis
  let parsedAnalysis: Record<string, unknown>;
  try {
    parsedAnalysis = JSON.parse(analysisJson);
  } catch {
    // If analysis failed to parse, still continue — generators get the raw text
    parsedAnalysis = { raw: analysisText };
  }

  const analysisForGenerators = JSON.stringify(parsedAnalysis, null, 2);

  // ── Phase 2: Parallel Generation ───────────────────────────────────────────

  onProgress?.('generation', 'Generating 3 TikZ candidates in parallel...');

  const generatorPromises = [0, 1, 2].map(async (index) => {
    try {
      const response = await withTimeout(
        ai.models.generateContent({
          model: TIKZ_MODEL,
          contents: [{
            role: 'user',
            parts: [
              { text: makeGeneratorPrompt(index) },
              imageInlineData,
              { text: `Here is the structured analysis of this figure:\n\n${analysisForGenerators}\n\nGenerate the TikZ code now. Output ONLY the TikZ code.` },
            ],
          }],
          config: { temperature: GENERATION_TEMPERATURE },
        }),
        AGENT_TIMEOUT_MS,
        `Generator #${index + 1}`,
      );
      return extractTikzCode(response.text || '');
    } catch (err) {
      console.warn(`Generator #${index + 1} failed:`, err);
      return null;
    }
  });

  const candidateResults = await Promise.all(generatorPromises);
  const candidates = candidateResults.filter((c): c is string => c !== null && c.length > 0);

  if (candidates.length === 0) {
    throw new Error('All TikZ generators failed. Please try again.');
  }

  // If only one candidate, skip judging and go straight to refinement
  if (candidates.length === 1) {
    onProgress?.('refinement', 'Refining the TikZ code...');
    const refined = await runRefiner(ai, imageInlineData, candidates[0]);
    return {
      tikzCode: refined,
      analysis: analysisForGenerators,
      candidates,
      selectedIndex: 0,
      judgeReasoning: 'Only one candidate was available.',
    };
  }

  // ── Phase 3: Judging ───────────────────────────────────────────────────────

  onProgress?.('judging', `Evaluating ${candidates.length} candidates...`);

  const candidateText = candidates
    .map((code, i) => `=== CANDIDATE ${i + 1} ===\n${code}\n`)
    .join('\n');

  const judgeResponse = await withTimeout(
    ai.models.generateContent({
      model: TIKZ_MODEL,
      contents: [{
        role: 'user',
        parts: [
          { text: JUDGE_PROMPT },
          imageInlineData,
          { text: `ANALYSIS:\n${analysisForGenerators}\n\nCANDIDATES:\n${candidateText}\n\nEvaluate and output the JSON result.` },
        ],
      }],
      config: { temperature: JUDGE_TEMPERATURE },
    }),
    AGENT_TIMEOUT_MS,
    'Judge Agent',
  );

  const judgeText = judgeResponse.text || '';
  let selectedCode: string;
  let selectedIndex = 0;
  let judgeReasoning = '';

  try {
    const judgeJson = JSON.parse(extractJson(judgeText));
    selectedIndex = judgeJson.selectedIndex ?? 0;
    judgeReasoning = judgeJson.reasoning ?? '';
    selectedCode = judgeJson.bestCode
      ? extractTikzCode(judgeJson.bestCode)
      : candidates[selectedIndex] || candidates[0];
  } catch {
    // If judge JSON parsing fails, take the first candidate
    selectedCode = candidates[0];
    judgeReasoning = 'Judge output could not be parsed; using first candidate.';
  }

  // ── Phase 4: Refinement ────────────────────────────────────────────────────

  onProgress?.('refinement', 'Final refinement pass...');

  const refinedCode = await runRefiner(ai, imageInlineData, selectedCode);

  onProgress?.('complete', 'TikZ generation complete!');

  return {
    tikzCode: refinedCode,
    analysis: analysisForGenerators,
    candidates,
    selectedIndex,
    judgeReasoning,
  };
}

async function runRefiner(
  ai: GoogleGenAI,
  imageInlineData: { inlineData: { data: string; mimeType: string } },
  code: string,
): Promise<string> {
  try {
    const response = await withTimeout(
      ai.models.generateContent({
        model: TIKZ_MODEL,
        contents: [{
          role: 'user',
          parts: [
            { text: REFINER_PROMPT },
            imageInlineData,
            { text: `Here is the TikZ code to refine:\n\n${code}\n\nCompare against the image and output the final refined TikZ code ONLY.` },
          ],
        }],
        config: { temperature: REFINE_TEMPERATURE },
      }),
      AGENT_TIMEOUT_MS,
      'Refiner Agent',
    );
    const refined = extractTikzCode(response.text || '');
    // If refiner produced valid output, use it; otherwise keep the input
    return refined.includes('\\begin{tikzpicture}') ? refined : code;
  } catch {
    // Refinement failed — return the unrefined code
    return code;
  }
}

/**
 * Quick single-agent TikZ generation (fallback for non-geometric images or
 * when speed is preferred over quality).
 */
export async function generateTikzSingleAgent(
  apiKey: string,
  imageBase64: string,
  mimeType: string,
): Promise<string | null> {
  const ai = new GoogleGenAI({ apiKey });

  try {
    const response = await withTimeout(
      ai.models.generateContent({
        model: TIKZ_MODEL,
        contents: [{
          role: 'user',
          parts: [
            { text: makeGeneratorPrompt(0) },
            { inlineData: { data: imageBase64, mimeType } },
            { text: 'Generate TikZ code for this figure. Use a dummy analysis — focus on visual reproduction. Output ONLY the TikZ code.' },
          ],
        }],
        config: { temperature: 0.2 },
      }),
      AGENT_TIMEOUT_MS,
      'Single TikZ Generator',
    );
    const code = extractTikzCode(response.text || '');
    return code.includes('\\begin{tikzpicture}') ? code : null;
  } catch {
    return null;
  }
}
