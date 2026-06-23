import { parseMermaid } from './diff.js';
import { extractRefs } from './refs.js';
import type { ValidationIssue, ValidationResult } from '../types.js';

// --- Source-of-truth constants ---

export const VALID_CLASSDEF_NAMES = ['external', 'concern', 'entry', 'store'] as const;

export const CLASSDEF_PALETTE: Record<string, Record<string, string>> = {
  external: { fill: '#585b70', stroke: '#585b70', color: '#cdd6f4' },
  concern:  { fill: '#f38ba8', stroke: '#f38ba8', color: '#1e1e2e' },
  entry:    { fill: '#89b4fa', stroke: '#89b4fa', color: '#1e1e2e' },
  store:    { fill: '#a6e3a1', stroke: '#a6e3a1', color: '#1e1e2e' },
};

// --- Helpers ---

const GRAPH_DECL = /^(graph|flowchart)\s+(LR|RL|TD|TB|BT)\s*$/i;
const DIRECTIVE_LINE = /^(graph|flowchart|classDef|class |click |style |linkStyle|subgraph|end$|%%)/i;

// --- Mermaid reserved words (cannot be used as node IDs) ---
export const MERMAID_RESERVED_WORDS = new Set([
  'graph', 'flowchart', 'subgraph', 'end', 'class', 'click', 'style',
  'linkStyle', 'classDef', 'direction', 'interpolate',
]);

/**
 * Extract all declared node IDs from a line, ignoring content inside double quotes.
 */
export function extractDeclaredNodeIds(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('%%') || trimmed.startsWith('classDef ')) return [];

  const parts = trimmed.split('"');
  const ids: string[] = [];
  const pattern = /\b(\w+)\s*[\[\({]/g;

  for (let i = 0; i < parts.length; i += 2) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(parts[i])) !== null) {
      ids.push(match[1]);
    }
  }
  return ids;
}

/**
 * Extract all label contents from a line, handling double quotes and brackets.
 */
export function extractLabels(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('%%') || trimmed.startsWith('classDef ')) return [];

  const parts = trimmed.split('"');
  const labels: string[] = [];

  // Odd parts are text inside double quotes
  for (let i = 1; i < parts.length; i += 2) {
    labels.push(parts[i]);
  }

  // Even parts are text outside double quotes (check bracket shapes)
  const bracketPattern = /[\[({]([^\]})]*)[\]})]/g;
  for (let i = 0; i < parts.length; i += 2) {
    let match: RegExpExecArray | null;
    bracketPattern.lastIndex = 0;
    while ((match = bracketPattern.exec(parts[i])) !== null) {
      labels.push(match[1]);
    }
  }

  return labels;
}

// Edges we check for labels in v1: -->, ==>, -.->
const EDGE_WITH_LABEL = /(-->|==>|-\.->)\s*$/;
const EDGE_LINE = /(-->|==>|-.->)/;
const EDGE_HAS_LABEL = /\|.*?\|/;

const CLASSDEF_LINE = /^classDef\s+(\S+)\s+(.+)$/i;
const CLASSDEF_ATTR = /(\w+)\s*:\s*(#[0-9a-fA-F]{3,8})/g;

/**
 * Quote-aware bracket balance check on a single line.
 * Ignores characters inside double-quoted strings.
 */
function checkBracketBalance(line: string): boolean {
  const counts: Record<string, number> = { '[': 0, ']': 0, '(': 0, ')': 0, '{': 0, '}': 0 };
  let inQuote = false;

  for (const ch of line) {
    if (ch === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (inQuote) continue;
    if (ch in counts) counts[ch]++;
  }

  return counts['['] === counts[']'] &&
         counts['('] === counts[')'] &&
         counts['{'] === counts['}'];
}

// --- Main validation function ---

export interface ValidateContext {
  className: string;
  allClasses: string[];
}

export function validateDiagram(text: string, context?: ValidateContext): ValidationResult {
  const issues: ValidationIssue[] = [];
  const lines = text.split('\n');
  const contentLines = lines.map(l => l.trim()).filter(l => l && !l.startsWith('%%'));

  // Rule: graph-declaration
  if (contentLines.length === 0 || !GRAPH_DECL.test(contentLines[0])) {
    issues.push({
      level: 'error',
      rule: 'graph-declaration',
      message: 'Diagram must start with a graph/flowchart direction declaration (e.g., "graph LR")',
      line: 1,
    });
  }

  // Line-based checks
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith('%%')) continue;

    // Rule: balanced-brackets (quote-aware)
    if (!checkBracketBalance(trimmed)) {
      issues.push({
        level: 'error',
        rule: 'balanced-brackets',
        message: `Unbalanced brackets on line: ${trimmed}`,
        line: i + 1,
      });
    }

    // Rule: reserved-word — node IDs must not match Mermaid reserved keywords
    const declaredIds = extractDeclaredNodeIds(trimmed);
    for (const nodeId of declaredIds) {
      if (MERMAID_RESERVED_WORDS.has(nodeId.toLowerCase())) {
        issues.push({
          level: 'error',
          rule: 'reserved-word',
          message: `Node ID "${nodeId}" is a Mermaid reserved keyword and will cause parse errors`,
          line: i + 1,
        });
      }
    }

    // Rule: special-char-label — @ and <> in labels cause Mermaid parse errors
    const labels = extractLabels(trimmed);
    let hasAt = false;
    let hasAngle = false;
    for (const label of labels) {
      if (label.includes('@')) {
        hasAt = true;
      }
      if (label.includes('<') && label.includes('>')) {
        hasAngle = true;
      }
    }
    if (hasAt) {
      issues.push({
        level: 'warning',
        rule: 'special-char-label',
        message: `Label contains @ which conflicts with Mermaid directives: ${trimmed}`,
        line: i + 1,
      });
    }
    if (hasAngle) {
      issues.push({
        level: 'warning',
        rule: 'special-char-label',
        message: `Label contains <> which conflicts with Mermaid HTML parsing: ${trimmed}`,
        line: i + 1,
      });
    }

    // Rule: edge-label (v1: -->, ==>, -.->)
    if (EDGE_LINE.test(trimmed) && !DIRECTIVE_LINE.test(trimmed)) {
      if (!EDGE_HAS_LABEL.test(trimmed)) {
        issues.push({
          level: 'warning',
          rule: 'edge-label',
          message: `Edge without label: ${trimmed}`,
          line: i + 1,
        });
      }
    }

    // Rule: classdef-name and classdef-color
    const classDefMatch = trimmed.match(CLASSDEF_LINE);
    if (classDefMatch) {
      const name = classDefMatch[1];
      const attrStr = classDefMatch[2];

      if (!(VALID_CLASSDEF_NAMES as readonly string[]).includes(name)) {
        issues.push({
          level: 'warning',
          rule: 'classdef-name',
          message: `Unknown classDef name "${name}". Valid: ${VALID_CLASSDEF_NAMES.join(', ')}`,
          line: i + 1,
        });
      } else {
        // Check declared attributes only — order/whitespace agnostic
        const expected = CLASSDEF_PALETTE[name];
        let match: RegExpExecArray | null;
        const attrPattern = new RegExp(CLASSDEF_ATTR.source, 'g');
        while ((match = attrPattern.exec(attrStr)) !== null) {
          const [, attr, value] = match;
          if (attr in expected && value.toLowerCase() !== expected[attr].toLowerCase()) {
            issues.push({
              level: 'warning',
              rule: 'classdef-color',
              message: `classDef "${name}" has ${attr}:${value}, expected ${attr}:${expected[attr]}`,
              line: i + 1,
            });
          }
        }
      }
    }
  }

  // Rule: ref-exists and ref-self (only when context provided)
  if (context) {
    const refs = extractRefs(text);
    for (const ref of refs) {
      if (ref === context.className) {
        issues.push({
          level: 'error',
          rule: 'ref-self',
          message: `Diagram references its own class: @${ref}`,
        });
      } else if (!context.allClasses.includes(ref)) {
        issues.push({
          level: 'error',
          rule: 'ref-exists',
          message: `@${ref} does not exist. Available: ${context.allClasses.join(', ')}`,
        });
      }
    }
  }

  // Rule: node-count (uses parseMermaid for counting only)
  const parsed = parseMermaid(text);
  const nodeCount = parsed.nodes.size;
  if (nodeCount > 0 && nodeCount < 3) {
    issues.push({
      level: 'warning',
      rule: 'node-count',
      message: `${nodeCount} nodes (recommended: 5-15). Diagram may be too simple.`,
    });
  } else if (nodeCount > 15) {
    issues.push({
      level: 'warning',
      rule: 'node-count',
      message: `${nodeCount} nodes (recommended: 5-15). Consider splitting into sub-diagrams.`,
    });
  }

  return {
    valid: issues.filter(i => i.level === 'error').length === 0,
    issues,
  };
}
