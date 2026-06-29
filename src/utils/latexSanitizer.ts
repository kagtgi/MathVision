/**
 * Post-processing sanitizer for AI-generated LaTeX output.
 * Catches common model mistakes before rendering or embedding.
 */

/**
 * Sanitize a single LaTeX expression (content between $...$, without delimiters).
 *
 * Fixes known AI output patterns that produce wrong LaTeX:
 * 1. Visible-brace derivative: \{f\}' → {f}'   (\{ renders a literal brace)
 * 2. Legacy degree notation: {}^\circ → ^{\circ}
 * 3. Double-dollar normalization: $$expr$$ → $expr$  (handled at block level)
 */
export function sanitizeLatexExpr(expr: string): string {
  let s = expr;

  // Fix visible-brace derivative: \{X\}' → {X}'
  // \{ in LaTeX outputs a literal curly brace — use plain grouping braces instead
  s = s.replace(/\\{([^{}]+?)\\}''/g, '{$1}\'\'');
  s = s.replace(/\\{([^{}]+?)\\}'/g, '{$1}\'');

  // Fix legacy degree notation: {}^\circ → ^{\circ}
  s = s.replace(/\{\}(\^\\circ)/g, '^{\\circ}');
  // Also catch the common variant: ^\circ → ^{\circ}  (bare ^ without braces)
  s = s.replace(/\^\\circ(?!\})/g, '^{\\circ}');

  // Normalize \left. \right. (invisible delimiters) — keep as-is, they're valid

  return s;
}

/**
 * Process a full ```latex block from the AI output.
 * Splits by lines, sanitizes each math expression, returns cleaned block.
 */
export function sanitizeLatexBlock(block: string): string {
  const lines = block.split('\n');
  return lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;

    // Lines that are pure $...$ expressions — sanitize the inner content
    const inlineMatch = trimmed.match(/^\$([^$]+)\$$/);
    if (inlineMatch) {
      const cleaned = sanitizeLatexExpr(inlineMatch[1]);
      return `$${cleaned}$`;
    }

    // Lines that aren't wrapped in $ (plain text, environment delimiters) — leave as-is
    return line;
  }).join('\n');
}

/**
 * Check if a LaTeX block has mismatched $ delimiters.
 * Logs a warning to console; does not throw.
 */
export function warnMismatchedDollars(block: string, context: string): void {
  // Count unescaped $ signs
  const count = (block.match(/(?<!\\)\$/g) || []).length;
  if (count % 2 !== 0) {
    console.warn(`[latexSanitizer] Odd number of $ signs (${count}) in ${context}. Output may render incorrectly.`);
  }
}
