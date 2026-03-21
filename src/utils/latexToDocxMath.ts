import {
  Math as OfficeMath,
  MathRun,
  MathFraction,
  MathSuperScript,
  MathSubScript,
  MathSubSuperScript,
  MathRadical,
  TextRun,
  type MathComponent,
} from 'docx';

// ─── Greek Letters ───────────────────────────────────────────────────────────

const GREEK: Record<string, string> = {
  '\\alpha': 'α', '\\beta': 'β', '\\gamma': 'γ', '\\delta': 'δ',
  '\\epsilon': 'ε', '\\varepsilon': 'ε', '\\zeta': 'ζ', '\\eta': 'η',
  '\\theta': 'θ', '\\vartheta': 'ϑ', '\\iota': 'ι', '\\kappa': 'κ',
  '\\lambda': 'λ', '\\mu': 'μ', '\\nu': 'ν', '\\xi': 'ξ',
  '\\pi': 'π', '\\varpi': 'ϖ', '\\rho': 'ρ', '\\varrho': 'ϱ',
  '\\sigma': 'σ', '\\varsigma': 'ς', '\\tau': 'τ', '\\upsilon': 'υ',
  '\\phi': 'φ', '\\varphi': 'φ', '\\chi': 'χ', '\\psi': 'ψ',
  '\\omega': 'ω',
  '\\Gamma': 'Γ', '\\Delta': 'Δ', '\\Theta': 'Θ', '\\Lambda': 'Λ',
  '\\Xi': 'Ξ', '\\Pi': 'Π', '\\Sigma': 'Σ', '\\Upsilon': 'Υ',
  '\\Phi': 'Φ', '\\Psi': 'Ψ', '\\Omega': 'Ω',
};

// ─── Symbols & Operators ─────────────────────────────────────────────────────

const SYMBOLS: Record<string, string> = {
  '\\times': '×', '\\cdot': '·', '\\div': '÷', '\\pm': '±', '\\mp': '∓',
  '\\leq': '≤', '\\geq': '≥', '\\neq': '≠', '\\approx': '≈',
  '\\equiv': '≡', '\\sim': '∼', '\\simeq': '≃', '\\cong': '≅',
  '\\propto': '∝', '\\perp': '⊥', '\\parallel': '∥',
  '\\subset': '⊂', '\\supset': '⊃', '\\subseteq': '⊆', '\\supseteq': '⊇',
  '\\in': '∈', '\\notin': '∉', '\\cup': '∪', '\\cap': '∩',
  '\\emptyset': '∅', '\\varnothing': '∅',
  '\\forall': '∀', '\\exists': '∃', '\\neg': '¬',
  '\\wedge': '∧', '\\vee': '∨',
  '\\infty': '∞', '\\partial': '∂', '\\nabla': '∇',
  '\\to': '→', '\\rightarrow': '→', '\\leftarrow': '←',
  '\\Rightarrow': '⇒', '\\Leftarrow': '⇐', '\\Leftrightarrow': '⇔',
  '\\ldots': '…', '\\cdots': '⋯', '\\vdots': '⋮', '\\ddots': '⋱',
  '\\circ': '∘', '\\bullet': '•', '\\star': '⋆',
  '\\triangle': '△', '\\angle': '∠', '\\widehat': '', // handled separately
  '\\overrightarrow': '', // handled separately
  '\\overleftrightarrow': '', // handled separately
  '\\overset': '', // handled separately
  '\\%': '%', '\\$': '$', '\\&': '&', '\\#': '#',
  '\\,': ' ', '\\;': ' ', '\\:': ' ', '\\!': '', '\\quad': '  ', '\\qquad': '    ',
  '\\\\': '\n',
  '\\lfloor': '⌊', '\\rfloor': '⌋', '\\lceil': '⌈', '\\rceil': '⌉',
  '\\langle': '⟨', '\\rangle': '⟩',
  '\\sum': '∑', '\\prod': '∏', '\\int': '∫', '\\oint': '∮',
  '\\iint': '∬', '\\iiint': '∭',
  '\\lim': 'lim', '\\limsup': 'limsup', '\\liminf': 'liminf',
};

const FUNCTION_NAMES = [
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc',
  'arcsin', 'arccos', 'arctan',
  'sinh', 'cosh', 'tanh', 'coth',
  'log', 'ln', 'exp', 'det', 'dim', 'ker', 'gcd', 'lcm',
  'min', 'max', 'sup', 'inf', 'arg',
];

// ─── Tokenizer ───────────────────────────────────────────────────────────────

type TokenType = 'TEXT' | 'COMMAND' | 'OPEN_BRACE' | 'CLOSE_BRACE' | 'CARET' | 'UNDERSCORE' | 'OPERATOR' | 'SPACE' | 'OPEN_BRACKET' | 'CLOSE_BRACKET' | 'EOF';

interface Token {
  type: TokenType;
  value: string;
}

function tokenize(latex: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < latex.length) {
    const ch = latex[i];

    if (ch === '{') {
      tokens.push({ type: 'OPEN_BRACE', value: '{' });
      i++;
    } else if (ch === '}') {
      tokens.push({ type: 'CLOSE_BRACE', value: '}' });
      i++;
    } else if (ch === '^') {
      tokens.push({ type: 'CARET', value: '^' });
      i++;
    } else if (ch === '_') {
      tokens.push({ type: 'UNDERSCORE', value: '_' });
      i++;
    } else if (ch === '[') {
      tokens.push({ type: 'OPEN_BRACKET', value: '[' });
      i++;
    } else if (ch === ']') {
      tokens.push({ type: 'CLOSE_BRACKET', value: ']' });
      i++;
    } else if (ch === '\\') {
      let cmd = '\\';
      i++;
      if (i < latex.length && /[a-zA-Z]/.test(latex[i])) {
        while (i < latex.length && /[a-zA-Z]/.test(latex[i])) {
          cmd += latex[i];
          i++;
        }
      } else if (i < latex.length) {
        cmd += latex[i];
        i++;
      }
      tokens.push({ type: 'COMMAND', value: cmd });
    } else if (/\s/.test(ch)) {
      // Collapse whitespace
      while (i < latex.length && /\s/.test(latex[i])) i++;
      tokens.push({ type: 'SPACE', value: ' ' });
    } else if ('+-=<>*/.,;:!?|&'.includes(ch)) {
      tokens.push({ type: 'OPERATOR', value: ch });
      i++;
    } else if (ch === '(' || ch === ')') {
      tokens.push({ type: 'TEXT', value: ch });
      i++;
    } else {
      // Letters, digits, other characters
      tokens.push({ type: 'TEXT', value: ch });
      i++;
    }
  }
  tokens.push({ type: 'EOF', value: '' });
  return tokens;
}

// ─── Parser ──────────────────────────────────────────────────────────────────

class LatexParser {
  private tokens: Token[];
  private pos: number;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
    this.pos = 0;
  }

  private peek(): Token {
    return this.tokens[this.pos] || { type: 'EOF', value: '' };
  }

  private consume(): Token {
    return this.tokens[this.pos++] || { type: 'EOF', value: '' };
  }

  parseExpression(): MathComponent[] {
    const children: MathComponent[] = [];
    while (
      this.peek().type !== 'EOF' &&
      this.peek().type !== 'CLOSE_BRACE' &&
      this.peek().type !== 'CLOSE_BRACKET'
    ) {
      const items = this.parseTerm();
      children.push(...items);
    }
    return children;
  }

  private parseTerm(): MathComponent[] {
    const base = this.parseAtom();

    // Check for sub/superscripts
    let sub: MathComponent[] | null = null;
    let sup: MathComponent[] | null = null;

    // Can appear in either order: x^a_b or x_b^a
    for (let i = 0; i < 2; i++) {
      if (this.peek().type === 'CARET' && !sup) {
        this.consume();
        sup = this.parseGroup();
      } else if (this.peek().type === 'UNDERSCORE' && !sub) {
        this.consume();
        sub = this.parseGroup();
      }
    }

    if (sub && sup) {
      return [new MathSubSuperScript({
        children: base,
        subScript: sub,
        superScript: sup,
      })];
    }
    if (sup) {
      return [new MathSuperScript({
        children: base,
        superScript: sup,
      })];
    }
    if (sub) {
      return [new MathSubScript({
        children: base,
        subScript: sub,
      })];
    }

    return base;
  }

  private parseGroup(): MathComponent[] {
    if (this.peek().type === 'OPEN_BRACE') {
      this.consume(); // {
      const result = this.parseExpression();
      if (this.peek().type === 'CLOSE_BRACE') this.consume(); // }
      return result.length > 0 ? result : [new MathRun('')];
    }
    // Single token
    return this.parseAtom();
  }

  private parseAtom(): MathComponent[] {
    const token = this.peek();

    if (token.type === 'OPEN_BRACE') {
      this.consume();
      const result = this.parseExpression();
      if (this.peek().type === 'CLOSE_BRACE') this.consume();
      return result;
    }

    if (token.type === 'COMMAND') {
      return this.parseCommand();
    }

    if (token.type === 'TEXT' || token.type === 'OPERATOR') {
      this.consume();
      return [new MathRun(token.value)];
    }

    if (token.type === 'SPACE') {
      this.consume();
      return [new MathRun(' ')];
    }

    // Skip unknown tokens
    this.consume();
    return [];
  }

  private parseCommand(): MathComponent[] {
    const token = this.consume();
    const cmd = token.value;

    // ── Fractions ──
    if (cmd === '\\frac' || cmd === '\\dfrac' || cmd === '\\tfrac') {
      const num = this.parseGroup();
      const den = this.parseGroup();
      return [new MathFraction({ numerator: num, denominator: den })];
    }

    // ── Square / nth root ──
    if (cmd === '\\sqrt') {
      let degree: MathComponent[] | undefined;
      if (this.peek().type === 'OPEN_BRACKET') {
        this.consume(); // [
        const degreeItems: MathComponent[] = [];
        while (this.peek().type !== 'CLOSE_BRACKET' && this.peek().type !== 'EOF') {
          degreeItems.push(...this.parseTerm());
        }
        if (this.peek().type === 'CLOSE_BRACKET') this.consume(); // ]
        degree = degreeItems;
      }
      const content = this.parseGroup();
      return [new MathRadical({ children: content, degree })];
    }

    // ── Decorators that take a group: \widehat{ABC}, \overrightarrow{AB}, etc. ──
    if (cmd === '\\widehat' || cmd === '\\hat') {
      const content = this.parseGroup();
      // Render as the content with a hat description
      return [new MathRun('̂'), ...content]; // combining circumflex
    }
    if (cmd === '\\overrightarrow' || cmd === '\\vec') {
      const content = this.parseGroup();
      return [...content, new MathRun('⃗')]; // combining right arrow
    }
    if (cmd === '\\overleftrightarrow') {
      const content = this.parseGroup();
      return [...content, new MathRun('⃡')];
    }
    if (cmd === '\\overline' || cmd === '\\bar') {
      const content = this.parseGroup();
      return [...content, new MathRun('̄')]; // combining overline
    }
    if (cmd === '\\underline') {
      const content = this.parseGroup();
      return [...content];
    }
    if (cmd === '\\overset') {
      // \overset{top}{base}
      const top = this.parseGroup();
      const base = this.parseGroup();
      return [new MathSuperScript({ children: base, superScript: top })];
    }

    // ── \text{...} ──
    if (cmd === '\\text' || cmd === '\\textbf' || cmd === '\\textit' || cmd === '\\mathrm' || cmd === '\\mathbf' || cmd === '\\mathit' || cmd === '\\mathcal' || cmd === '\\mathbb') {
      const content = this.parseGroup();
      return content;
    }

    // ── \left ... \right ──
    if (cmd === '\\left') {
      const openDelim = this.consume();
      const openChar = openDelim.value === '.' ? '' : (openDelim.value === '\\{' ? '{' : openDelim.value);
      const content = this.parseExpression();

      // Consume \right
      let closeChar = '';
      if (this.peek().type === 'COMMAND' && this.peek().value === '\\right') {
        this.consume(); // \right
        const closeDelim = this.consume();
        closeChar = closeDelim.value === '.' ? '' : (closeDelim.value === '\\}' ? '}' : closeDelim.value);
      }

      const result: MathComponent[] = [];
      if (openChar) result.push(new MathRun(openChar));
      result.push(...content);
      if (closeChar) result.push(new MathRun(closeChar));
      return result;
    }

    if (cmd === '\\right') {
      // Orphan \right — just consume the delimiter
      this.consume();
      return [];
    }

    // ── \begin{...} ... \end{...} ──
    if (cmd === '\\begin') {
      return this.parseEnvironment();
    }

    if (cmd === '\\end') {
      // Consume the environment name
      this.parseGroup();
      return [];
    }

    // ── Greek letters ──
    if (GREEK[cmd]) {
      return [new MathRun(GREEK[cmd])];
    }

    // ── Symbols ──
    if (SYMBOLS[cmd] !== undefined) {
      const sym = SYMBOLS[cmd];
      return sym ? [new MathRun(sym)] : [];
    }

    // ── Named functions ──
    const funcName = cmd.slice(1); // remove backslash
    if (FUNCTION_NAMES.includes(funcName)) {
      return [new MathRun(funcName)];
    }

    // ── Unknown command — output as text ──
    return [new MathRun(cmd)];
  }

  private parseEnvironment(): MathComponent[] {
    // Get environment name
    const nameTokens: string[] = [];
    if (this.peek().type === 'OPEN_BRACE') {
      this.consume();
      while (this.peek().type !== 'CLOSE_BRACE' && this.peek().type !== 'EOF') {
        nameTokens.push(this.consume().value);
      }
      if (this.peek().type === 'CLOSE_BRACE') this.consume();
    }
    const envName = nameTokens.join('');

    // Collect content until \end{envName}
    const contentTokens: MathComponent[] = [];

    if (envName === 'cases') {
      // Parse cases environment: each line separated by \\, columns by &
      contentTokens.push(new MathRun('{'));
      const caseContent = this.parseCasesContent();
      contentTokens.push(...caseContent);
      contentTokens.push(new MathRun(''));
    } else if (envName === 'matrix' || envName === 'pmatrix' || envName === 'bmatrix' || envName === 'vmatrix' || envName === 'Vmatrix') {
      const brackets: Record<string, [string, string]> = {
        'matrix': ['', ''],
        'pmatrix': ['(', ')'],
        'bmatrix': ['[', ']'],
        'vmatrix': ['|', '|'],
        'Vmatrix': ['‖', '‖'],
      };
      const [open, close] = brackets[envName] || ['', ''];
      if (open) contentTokens.push(new MathRun(open));
      const matrixContent = this.parseMatrixContent();
      contentTokens.push(...matrixContent);
      if (close) contentTokens.push(new MathRun(close));
    } else {
      // Generic: just parse until \end
      while (this.peek().type !== 'EOF') {
        if (this.peek().type === 'COMMAND' && this.peek().value === '\\end') {
          this.consume();
          this.parseGroup(); // consume {envName}
          break;
        }
        contentTokens.push(...this.parseTerm());
      }
    }

    return contentTokens;
  }

  private parseCasesContent(): MathComponent[] {
    const items: MathComponent[] = [];

    while (this.peek().type !== 'EOF') {
      if (this.peek().type === 'COMMAND' && this.peek().value === '\\end') {
        this.consume();
        this.parseGroup();
        break;
      }

      if (this.peek().type === 'COMMAND' && this.peek().value === '\\\\') {
        this.consume();
        items.push(new MathRun(', '));
        continue;
      }

      if (this.peek().type === 'OPERATOR' && this.peek().value === '&') {
        this.consume();
        items.push(new MathRun('  '));
        continue;
      }

      items.push(...this.parseTerm());
    }

    return items;
  }

  private parseMatrixContent(): MathComponent[] {
    const items: MathComponent[] = [];

    while (this.peek().type !== 'EOF') {
      if (this.peek().type === 'COMMAND' && this.peek().value === '\\end') {
        this.consume();
        this.parseGroup();
        break;
      }

      if (this.peek().type === 'COMMAND' && this.peek().value === '\\\\') {
        this.consume();
        items.push(new MathRun(' ; '));
        continue;
      }

      if (this.peek().type === 'OPERATOR' && this.peek().value === '&') {
        this.consume();
        items.push(new MathRun(' , '));
        continue;
      }

      items.push(...this.parseTerm());
    }

    return items;
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Convert a LaTeX math string (without $ delimiters) into docx Math children.
 */
export function latexToMathChildren(latex: string): MathComponent[] {
  try {
    const tokens = tokenize(latex.trim());
    const parser = new LatexParser(tokens);
    const result = parser.parseExpression();
    return result.length > 0 ? result : [new MathRun(latex)];
  } catch {
    // Fallback: return raw text
    return [new MathRun(latex)];
  }
}

/**
 * Parse text that may contain inline math ($...$) into a mix of TextRun and OfficeMath.
 * For use as Paragraph children in docx.
 */
export function parseTextWithMath(text: string): (TextRun | OfficeMath)[] {
  const parts: (TextRun | OfficeMath)[] = [];
  // Match $...$ (non-greedy, no nested $)
  const regex = /\$([^$]+?)\$/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    // Text before math
    if (match.index > lastIndex) {
      parts.push(new TextRun({ text: text.slice(lastIndex, match.index) }));
    }
    // Math
    const latex = match[1];
    try {
      const children = latexToMathChildren(latex);
      parts.push(new OfficeMath({ children }));
    } catch {
      parts.push(new TextRun({ text: match[0] }));
    }
    lastIndex = regex.lastIndex;
  }

  // Remaining text
  if (lastIndex < text.length) {
    parts.push(new TextRun({ text: text.slice(lastIndex) }));
  }

  // If nothing was parsed, return original text
  if (parts.length === 0) {
    parts.push(new TextRun({ text }));
  }

  return parts;
}
