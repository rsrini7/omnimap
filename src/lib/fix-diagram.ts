import { MERMAID_RESERVED_WORDS, extractDeclaredNodeIds } from './validate.js';
import type { ValidationIssue } from '../types.js';

export interface FixResult {
  /** Original diagram text */
  original: string;
  /** Fixed diagram text (may equal original if no fixes applied) */
  fixed: string;
  /** List of issues that were auto-fixed */
  fixedIssues: ValidationIssue[];
  /** List of issues that could not be auto-fixed */
  unfixedIssues: ValidationIssue[];
  /** Whether any changes were made */
  changed: boolean;
}

/**
 * Attempt to auto-fix issues in a mermaid diagram.
 *
 * Currently auto-fixes:
 * - `classdef-color` — replaces wrong color values with the canonical palette
 * - `reserved-word` — renames node IDs that match Mermaid reserved keywords
 * - `special-char-label` — replaces @ with → and escapes <> in labels
 *
 * Reports unfixable:
 * - `graph-declaration` — needs explicit graph type decision
 * - `balanced-brackets` — needs human review
 * - `edge-label` — needs content decision
 * - `classdef-name` — needs naming decision
 * - `ref-exists` — needs to add the referenced class
 * - `ref-self` — needs content decision
 * - `node-count` — structural, needs planning
 */
export function fixDiagram(text: string, issues: ValidationIssue[]): FixResult {
  let fixed = text;
  const fixedIssues: ValidationIssue[] = [];
  const unfixedIssues: ValidationIssue[] = [];

  for (const issue of issues) {
    if (issue.rule === 'classdef-color' && issue.line) {
      const before = fixed;
      fixed = fixClassdefColor(fixed, issue.line);
      if (before !== fixed) {
        fixedIssues.push(issue);
        continue;
      }
    }

    if (issue.rule === 'reserved-word' && issue.line) {
      const before = fixed;
      fixed = fixReservedWord(fixed, issue.line);
      if (before !== fixed) {
        fixedIssues.push(issue);
        continue;
      }
    }

    if (issue.rule === 'special-char-label' && issue.line) {
      const before = fixed;
      fixed = fixSpecialCharLabel(fixed, issue.line);
      if (before !== fixed) {
        fixedIssues.push(issue);
        continue;
      }
    }

    unfixedIssues.push(issue);
  }

  return {
    original: text,
    fixed,
    fixedIssues,
    unfixedIssues,
    changed: text !== fixed,
  };
}

const CLASSDEF_LINE_RE = /^(\s*classDef\s+\w+\s+)(.+)$/i;

/**
 * Helper to replace node references in a line while avoiding comments, headers, strings/quotes.
 */
function replaceNodeReferencesInLine(line: string, nodeId: string, newNodeId: string): string {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('%%')) return line;
  if (/^(graph|flowchart)\s+(LR|RL|TD|TB|BT)\s*$/i.test(trimmed)) return line;
  if (/^subgraph\s+/i.test(trimmed)) return line;
  if (trimmed === 'end' || trimmed.startsWith('end ')) return line;
  if (trimmed.startsWith('classDef ')) return line;

  // Split line by '%%' to separate comment
  const commentIndex = line.indexOf('%%');
  let codePart = commentIndex !== -1 ? line.slice(0, commentIndex) : line;
  const commentPart = commentIndex !== -1 ? line.slice(commentIndex) : '';

  // Split codePart by double quotes
  const parts = codePart.split('"');
  const escapedId = nodeId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const refPattern = new RegExp(`\\b${escapedId}\\b`, 'g');

  for (let i = 0; i < parts.length; i += 2) {
    parts[i] = parts[i].replace(refPattern, newNodeId);
  }

  return parts.join('"') + commentPart;
}

const COLOR_ATTR_RE = /(fill|stroke|color)\s*:\s*#([0-9a-fA-F]{3,8})/g;

/** Canonical palette (must match lib/validate.ts) */
const CLASSDEF_PALETTE: Record<string, Record<string, string>> = {
  external: { fill: '#585b70', stroke: '#585b70', color: '#cdd6f4' },
  concern:  { fill: '#f38ba8', stroke: '#f38ba8', color: '#1e1e2e' },
  entry:    { fill: '#89b4fa', stroke: '#89b4fa', color: '#1e1e2e' },
  store:    { fill: '#a6e3a1', stroke: '#a6e3a1', color: '#1e1e2e' },
};

/**
 * Fix a node ID that matches a Mermaid reserved keyword.
 * Appends '-node' to the ID to avoid conflicts.
 */
function fixReservedWord(text: string, lineNum: number): string {
  const lines = text.split('\n');
  const idx = lineNum - 1;
  if (idx < 0 || idx >= lines.length) return text;
  const line = lines[idx];

  // Find which reserved word was declared on this line
  const declaredIds = extractDeclaredNodeIds(line);
  const reservedId = declaredIds.find(id => MERMAID_RESERVED_WORDS.has(id.toLowerCase()));
  if (!reservedId) return text;

  const newNodeId = `${reservedId}-node`;

  // Update all lines in the diagram
  for (let i = 0; i < lines.length; i++) {
    lines[i] = replaceNodeReferencesInLine(lines[i], reservedId, newNodeId);
  }

  return lines.join('\n');
}

/**
 * Fix special characters in labels:
 * - Replace @ with → (cross-reference arrow)
 * - Escape < > with HTML entities (&lt; &gt;)
 */
function fixSpecialCharLabel(text: string, lineNum: number): string {
  const lines = text.split('\n');
  const idx = lineNum - 1;
  if (idx < 0 || idx >= lines.length) return text;

  const line = lines[idx];
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('%%') || trimmed.startsWith('classDef ')) return text;

  const parts = line.split('"');

  // Fix odd parts (inside double quotes)
  for (let i = 1; i < parts.length; i += 2) {
    parts[i] = parts[i]
      .replace(/@/g, '→')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // Fix even parts (outside double quotes, inside bracket shapes)
  for (let i = 0; i < parts.length; i += 2) {
    parts[i] = parts[i].replace(/([\[({])([^\]})]*)([\]})])/g, (_match, open, content, close) => {
      const fixedContent = content
        .replace(/@/g, '→')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      return `${open}${fixedContent}${close}`;
    });
  }

  lines[idx] = parts.join('"');
  return lines.join('\n');
}

function fixClassdefColor(text: string, lineNum: number): string {
  const lines = text.split('\n');
  const idx = lineNum - 1;
  if (idx < 0 || idx >= lines.length) return text;
  const line = lines[idx];
  const m = line.match(CLASSDEF_LINE_RE);
  if (!m) return text;

  // Extract classDef name
  const nameMatch = line.match(/classDef\s+(\w+)/i);
  if (!nameMatch) return text;
  const name = nameMatch[1];
  const expected = CLASSDEF_PALETTE[name];
  if (!expected) return text;

  // Split the attribute section by commas, fix each color attribute individually
  // Pattern: attr:#hex,attr:#hex,...
  let changed = false;
  const newAttrs = line.match(CLASSDEF_LINE_RE)![2]
    .split(',')
    .map((part: string) => {
      const m = part.match(/^\s*(\w+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*$/);
      if (!m) return part;
      const attr = m[1];
      const value = m[2];
      if (attr in expected && value.toLowerCase() !== expected[attr].toLowerCase()) {
        changed = true;
        return ` ${attr}:${expected[attr]}`;
      }
      return part;
    })
    .join(',');

  if (changed) {
    lines[idx] = m[1] + newAttrs;
    return lines.join('\n');
  }
  return text;
}
