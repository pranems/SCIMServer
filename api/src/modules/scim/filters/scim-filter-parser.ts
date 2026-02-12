/**
 * SCIM 2.0 Filter Parser — RFC 7644 §3.4.2.2
 *
 * Implements the full SCIM filter ABNF grammar:
 *   FILTER    = attrExp / logExp / valuePath / *1"not" "(" FILTER ")"
 *   logExp    = FILTER SP ("and" / "or") SP FILTER
 *   attrExp   = attrPath SP compareOp SP compValue
 *   attrExp   =/ attrPath SP "pr"
 *   valuePath = attrPath "[" valFilter "]"
 *   compValue = false / null / true / number / string
 *   compareOp = "eq" / "ne" / "co" / "sw" / "ew" / "gt" / "ge" / "lt" / "le"
 *
 * The parser produces an AST (Abstract Syntax Tree) that can be evaluated
 * against any SCIM resource object.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc7644#section-3.4.2.2
 */

// ─── AST Node Types ──────────────────────────────────────────────────────────

/** All supported SCIM comparison operators (case-insensitive in the grammar) */
export type ScimCompareOp = 'eq' | 'ne' | 'co' | 'sw' | 'ew' | 'gt' | 'ge' | 'lt' | 'le' | 'pr';

/** Logical operators for combining filter expressions */
export type ScimLogicalOp = 'and' | 'or';

/** Comparison expression:  attrPath op compValue  |  attrPath pr */
export interface CompareNode {
  type: 'compare';
  attrPath: string;        // e.g. "userName", "name.givenName", "urn:...:User:department"
  op: ScimCompareOp;
  value?: string | number | boolean | null;  // absent for "pr"
}

/** Logical expression: left AND/OR right */
export interface LogicalNode {
  type: 'logical';
  op: ScimLogicalOp;
  left: FilterNode;
  right: FilterNode;
}

/** NOT expression: not (filter) */
export interface NotNode {
  type: 'not';
  filter: FilterNode;
}

/** Value path expression: attrPath[valFilter] — e.g. emails[type eq "work"] */
export interface ValuePathNode {
  type: 'valuePath';
  attrPath: string;
  filter: FilterNode;
}

/** Union of all possible AST nodes */
export type FilterNode = CompareNode | LogicalNode | NotNode | ValuePathNode;

// ─── Tokenizer ───────────────────────────────────────────────────────────────

/** Token types produced by the lexer */
type TokenType =
  | 'LPAREN' | 'RPAREN' | 'LBRACKET' | 'RBRACKET'
  | 'AND' | 'OR' | 'NOT'
  | 'OP' | 'PR'
  | 'STRING' | 'NUMBER' | 'BOOLEAN' | 'NULL'
  | 'ATTR'
  | 'EOF';

interface Token {
  type: TokenType;
  value: string;
  position: number;
}

const COMPARE_OPS = new Set(['eq', 'ne', 'co', 'sw', 'ew', 'gt', 'ge', 'lt', 'le']);

/**
 * Tokenize a SCIM filter string into a flat list of tokens.
 * Attribute names, operators, and keywords are case-insensitive per RFC.
 */
function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    // Skip whitespace
    if (/\s/.test(input[i])) {
      i++;
      continue;
    }

    const position = i;

    // Parentheses
    if (input[i] === '(') {
      tokens.push({ type: 'LPAREN', value: '(', position });
      i++;
      continue;
    }
    if (input[i] === ')') {
      tokens.push({ type: 'RPAREN', value: ')', position });
      i++;
      continue;
    }

    // Square brackets (value path)
    if (input[i] === '[') {
      tokens.push({ type: 'LBRACKET', value: '[', position });
      i++;
      continue;
    }
    if (input[i] === ']') {
      tokens.push({ type: 'RBRACKET', value: ']', position });
      i++;
      continue;
    }

    // Quoted string
    if (input[i] === '"') {
      i++; // skip opening quote
      let str = '';
      while (i < input.length && input[i] !== '"') {
        if (input[i] === '\\' && i + 1 < input.length) {
          str += input[i + 1];
          i += 2;
        } else {
          str += input[i];
          i++;
        }
      }
      if (i >= input.length) {
        throw new Error(`Unterminated string at position ${position}`);
      }
      i++; // skip closing quote
      tokens.push({ type: 'STRING', value: str, position });
      continue;
    }

    // Number (integer or decimal, possibly negative)
    if (/[-\d]/.test(input[i]) && (input[i] !== '-' || (i + 1 < input.length && /\d/.test(input[i + 1])))) {
      // Only treat as number if it's a digit or a minus followed by a digit
      // But we also need to make sure a '-' isn't part of an attribute name
      const numStart = i;
      if (input[i] === '-') i++;
      while (i < input.length && /[\d.]/.test(input[i])) i++;
      // Verify next char is whitespace, bracket, paren, or EOF (not part of an identifier)
      if (i === numStart + (input[numStart] === '-' ? 1 : 0)) {
        // No digits found — treat as identifier start below
        i = numStart;
      } else if (i < input.length && /[a-zA-Z_:]/.test(input[i])) {
        // Part of an identifier (e.g., attribute name starting with digits — unlikely but safe)
        i = numStart;
      } else {
        tokens.push({ type: 'NUMBER', value: input.slice(numStart, i), position: numStart });
        continue;
      }
    }

    // Identifier (attribute name, operator keyword, boolean, null)
    if (/[a-zA-Z_]/.test(input[i]) || input[i] === ':') {
      let ident = '';
      // Attribute paths can contain dots, colons, and hyphens (URN paths)
      while (i < input.length && /[a-zA-Z0-9_.:\-]/.test(input[i])) {
        ident += input[i];
        i++;
      }

      const lower = ident.toLowerCase();

      // Keywords
      if (lower === 'and') {
        tokens.push({ type: 'AND', value: 'and', position });
      } else if (lower === 'or') {
        tokens.push({ type: 'OR', value: 'or', position });
      } else if (lower === 'not') {
        tokens.push({ type: 'NOT', value: 'not', position });
      } else if (lower === 'pr') {
        tokens.push({ type: 'PR', value: 'pr', position });
      } else if (lower === 'true') {
        tokens.push({ type: 'BOOLEAN', value: 'true', position });
      } else if (lower === 'false') {
        tokens.push({ type: 'BOOLEAN', value: 'false', position });
      } else if (lower === 'null') {
        tokens.push({ type: 'NULL', value: 'null', position });
      } else if (COMPARE_OPS.has(lower)) {
        tokens.push({ type: 'OP', value: lower, position });
      } else {
        tokens.push({ type: 'ATTR', value: ident, position });
      }
      continue;
    }

    throw new Error(`Unexpected character '${input[i]}' at position ${i}`);
  }

  tokens.push({ type: 'EOF', value: '', position: input.length });
  return tokens;
}

// ─── Recursive Descent Parser ────────────────────────────────────────────────

/**
 * Parse a SCIM filter string into an AST.
 *
 * Grammar (simplified, matching RFC 7644 §3.4.2.2 ABNF):
 *   filter     → orExpr
 *   orExpr     → andExpr ("or" andExpr)*
 *   andExpr    → primary ("and" primary)*
 *   primary    → "not" "(" filter ")"
 *              | "(" filter ")"
 *              | attrExpr
 *   attrExpr   → attrPath "[" filter "]"        (value path)
 *              | attrPath "pr"                   (presence)
 *              | attrPath compareOp compValue    (comparison)
 */
class Parser {
  private tokens: Token[];
  private pos: number;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
    this.pos = 0;
  }

  parse(): FilterNode {
    const node = this.parseOrExpr();
    if (this.current().type !== 'EOF') {
      throw new Error(
        `Unexpected token "${this.current().value}" at position ${this.current().position}`
      );
    }
    return node;
  }

  private current(): Token {
    return this.tokens[this.pos];
  }

  private advance(): Token {
    const t = this.tokens[this.pos];
    this.pos++;
    return t;
  }

  private expect(type: TokenType): Token {
    const t = this.current();
    if (t.type !== type) {
      throw new Error(
        `Expected ${type} but got ${t.type} ("${t.value}") at position ${t.position}`
      );
    }
    return this.advance();
  }

  // orExpr → andExpr ("or" andExpr)*
  private parseOrExpr(): FilterNode {
    let left = this.parseAndExpr();
    while (this.current().type === 'OR') {
      this.advance(); // consume 'or'
      const right = this.parseAndExpr();
      left = { type: 'logical', op: 'or', left, right };
    }
    return left;
  }

  // andExpr → primary ("and" primary)*
  private parseAndExpr(): FilterNode {
    let left = this.parsePrimary();
    while (this.current().type === 'AND') {
      this.advance(); // consume 'and'
      const right = this.parsePrimary();
      left = { type: 'logical', op: 'and', left, right };
    }
    return left;
  }

  // primary → "not" "(" filter ")" | "(" filter ")" | attrExpr
  private parsePrimary(): FilterNode {
    const t = this.current();

    // NOT expression
    if (t.type === 'NOT') {
      this.advance();
      this.expect('LPAREN');
      const filter = this.parseOrExpr();
      this.expect('RPAREN');
      return { type: 'not', filter };
    }

    // Grouped expression
    if (t.type === 'LPAREN') {
      this.advance();
      const filter = this.parseOrExpr();
      this.expect('RPAREN');
      return filter;
    }

    // Attribute expression (comparison, presence, or value path)
    return this.parseAttrExpr();
  }

  // attrExpr → attrPath "[" filter "]" | attrPath "pr" | attrPath op value
  private parseAttrExpr(): FilterNode {
    const attrToken = this.expect('ATTR');
    const attrPath = attrToken.value;

    // Value path: attrPath "[" filter "]"
    if (this.current().type === 'LBRACKET') {
      this.advance(); // consume '['
      const filter = this.parseOrExpr();
      this.expect('RBRACKET');
      return { type: 'valuePath', attrPath, filter };
    }

    // Presence: attrPath pr
    if (this.current().type === 'PR') {
      this.advance();
      return { type: 'compare', attrPath, op: 'pr' };
    }

    // Comparison: attrPath op value
    const opToken = this.expect('OP');
    const op = opToken.value as ScimCompareOp;
    const value = this.parseCompValue();
    return { type: 'compare', attrPath, op, value };
  }

  // compValue → string | number | boolean | null
  private parseCompValue(): string | number | boolean | null {
    const t = this.current();
    switch (t.type) {
      case 'STRING':
        this.advance();
        return t.value;
      case 'NUMBER':
        this.advance();
        return t.value.includes('.') ? parseFloat(t.value) : parseInt(t.value, 10);
      case 'BOOLEAN':
        this.advance();
        return t.value === 'true';
      case 'NULL':
        this.advance();
        return null;
      default:
        throw new Error(
          `Expected comparison value but got ${t.type} ("${t.value}") at position ${t.position}`
        );
    }
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Parse a SCIM filter string into an AST.
 *
 * @example
 *   parseScimFilter('userName eq "john"')
 *   parseScimFilter('name.familyName co "doe" and active eq true')
 *   parseScimFilter('emails[type eq "work" and value co "@example.com"]')
 *   parseScimFilter('not (active eq false)')
 *
 * @throws Error with position details for malformed filters
 */
export function parseScimFilter(filterStr: string): FilterNode {
  if (!filterStr || !filterStr.trim()) {
    throw new Error('Filter expression cannot be empty');
  }
  const tokens = tokenize(filterStr.trim());
  const parser = new Parser(tokens);
  return parser.parse();
}

// ─── AST Evaluator ───────────────────────────────────────────────────────────

/**
 * Resolve an attribute path on a SCIM resource object.
 *
 * Supports:
 *   - Simple paths:  "userName" → resource.userName
 *   - Dotted paths:  "name.givenName" → resource.name.givenName
 *   - URN paths:     "urn:...:User:department" → resource["urn:...:User"].department
 *
 * @param resource — The SCIM resource (plain object)
 * @param attrPath — The attribute path string
 * @returns The resolved value, or undefined if not found
 */
export function resolveAttrPath(resource: Record<string, unknown>, attrPath: string): unknown {
  // URN-prefixed path (e.g. urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department)
  const urnMatch = attrPath.match(
    /^(urn:[a-zA-Z0-9:._-]+):([a-zA-Z0-9_.]+)$/
  );
  if (urnMatch) {
    const urnPrefix = urnMatch[1];
    const subPath = urnMatch[2];
    const ext = resource[urnPrefix] as Record<string, unknown> | undefined;
    if (!ext || typeof ext !== 'object') return undefined;
    return resolveSimplePath(ext, subPath);
  }

  return resolveSimplePath(resource, attrPath);
}

function resolveSimplePath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    // Case-insensitive attribute lookup (RFC 7643 §2.1)
    const rec = current as Record<string, unknown>;
    const key = Object.keys(rec).find(k => k.toLowerCase() === part.toLowerCase());
    current = key !== undefined ? rec[key] : undefined;
  }
  return current;
}

/**
 * Compare two values according to SCIM comparison rules.
 * String comparisons are case-insensitive by default (caseExact=false per RFC 7643 §2.2).
 */
function compareValues(op: ScimCompareOp, actual: unknown, expected: unknown): boolean {
  // "pr" (presence) — attribute has a non-null, non-empty value
  if (op === 'pr') {
    if (actual === undefined || actual === null) return false;
    if (typeof actual === 'string' && actual.length === 0) return false;
    if (Array.isArray(actual) && actual.length === 0) return false;
    return true;
  }

  // Normalize strings for case-insensitive comparison (SCIM default)
  const normActual = typeof actual === 'string' ? actual.toLowerCase() : actual;
  const normExpected = typeof expected === 'string' ? expected.toLowerCase() : expected;

  switch (op) {
    case 'eq':
      if (actual === null || actual === undefined) return expected === null;
      return normActual === normExpected;

    case 'ne':
      if (actual === null || actual === undefined) return expected !== null;
      return normActual !== normExpected;

    case 'co': // contains
      if (typeof normActual !== 'string' || typeof normExpected !== 'string') return false;
      return normActual.includes(normExpected);

    case 'sw': // starts with
      if (typeof normActual !== 'string' || typeof normExpected !== 'string') return false;
      return normActual.startsWith(normExpected);

    case 'ew': // ends with
      if (typeof normActual !== 'string' || typeof normExpected !== 'string') return false;
      return normActual.endsWith(normExpected);

    case 'gt':
      if (typeof actual === 'string' && typeof expected === 'string') {
        return (normActual as string) > (normExpected as string);
      }
      if (typeof actual === 'number' && typeof expected === 'number') return actual > expected;
      return false;

    case 'ge':
      if (typeof actual === 'string' && typeof expected === 'string') {
        return (normActual as string) >= (normExpected as string);
      }
      if (typeof actual === 'number' && typeof expected === 'number') return actual >= expected;
      return false;

    case 'lt':
      if (typeof actual === 'string' && typeof expected === 'string') {
        return (normActual as string) < (normExpected as string);
      }
      if (typeof actual === 'number' && typeof expected === 'number') return actual < expected;
      return false;

    case 'le':
      if (typeof actual === 'string' && typeof expected === 'string') {
        return (normActual as string) <= (normExpected as string);
      }
      if (typeof actual === 'number' && typeof expected === 'number') return actual <= expected;
      return false;

    default:
      return false;
  }
}

/**
 * Evaluate a parsed SCIM filter AST against a resource object.
 *
 * @param node — The root AST node from parseScimFilter()
 * @param resource — The SCIM resource to test
 * @returns true if the resource matches the filter
 *
 * @example
 *   const ast = parseScimFilter('userName eq "john" and active eq true');
 *   evaluateFilter(ast, { userName: 'John', active: true }); // → true
 */
export function evaluateFilter(node: FilterNode, resource: Record<string, unknown>): boolean {
  switch (node.type) {
    case 'compare': {
      const actual = resolveAttrPath(resource, node.attrPath);
      // Multi-valued attributes: match if ANY element matches (RFC 7644 §3.4.2.2)
      if (Array.isArray(actual)) {
        return actual.some(item => {
          if (typeof item === 'object' && item !== null) {
            // For complex multi-valued (e.g., emails), compare sub-attribute if path is simple
            // If the comparison is on the array itself (e.g., "emails pr"), check presence
            return compareValues(node.op, item, node.value);
          }
          return compareValues(node.op, item, node.value);
        });
      }
      return compareValues(node.op, actual, node.value);
    }

    case 'logical':
      if (node.op === 'and') {
        return evaluateFilter(node.left, resource) && evaluateFilter(node.right, resource);
      }
      return evaluateFilter(node.left, resource) || evaluateFilter(node.right, resource);

    case 'not':
      return !evaluateFilter(node.filter, resource);

    case 'valuePath': {
      // attrPath[valFilter] — e.g., emails[type eq "work"]
      // Resolve the multi-valued attribute, filter by sub-expression
      const array = resolveAttrPath(resource, node.attrPath);
      if (!Array.isArray(array)) return false;
      return array.some(item => {
        if (typeof item !== 'object' || item === null) return false;
        return evaluateFilter(node.filter, item as Record<string, unknown>);
      });
    }

    default:
      return false;
  }
}
