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
const COLOR_ATTR_RE = /(fill|stroke|color)\s*:\s*#([0-9a-fA-F]{3,8})/g;

/** Canonical palette (must match lib/validate.ts) */
const CLASSDEF_PALETTE: Record<string, Record<string, string>> = {
  external: { fill: '#585b70', stroke: '#585b70', color: '#cdd6f4' },
  concern:  { fill: '#f38ba8', stroke: '#f38ba8', color: '#1e1e2e' },
  entry:    { fill: '#89b4fa', stroke: '#89b4fa', color: '#1e1e2e' },
  store:    { fill: '#a6e3a1', stroke: '#a6e3a1', color: '#1e1e2e' },
};

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
