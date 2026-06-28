/**
 * omm inspect <element> — detailed element inspection.
 *
 * Shows a focused view of a single element: score, field coverage,
 * source tracking status, links, children summary.
 *
 * Usage:
 *   omm inspect <element>           Full inspection
 *   omm inspect <element> --json    JSON output
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  ensureOmmForRead,
  classExists,
  showClass,
  showNode,
  listClasses,
  listNodes,
  readField,
  readNodeField,
  readMeta,
  readNodeMeta,
  getOmmDir,
  getLinks,
} from '../lib/store.js';
import { evaluateProject } from '../lib/eval.js';
import { planIncrementalUpdate } from '../lib/incremental.js';
import type { ClassData, ClassMeta, Field, LinkEntry } from '../types.js';
import { VALID_FIELDS } from '../types.js';

const HELP = `
omm inspect <element> [options]

Detailed inspection of a single element. Shows score, field coverage,
source tracking status, external links, and children summary.

Usage:
  omm inspect <element>           Full inspection
  omm inspect <element> --json    JSON output
  omm inspect <element> --help    Show this help

Examples:
  omm inspect auth-service
  omm inspect data-flow/ingestion --json
`;

interface FieldInfo {
  present: boolean;
  wordCount: number;
}

interface SourceTracking {
  sourceFiles: string[];
  sourceGlobs: string[];
  lastScanned?: string;
  status: 'fresh' | 'stale' | 'unknown';
  staleReasons?: string[];
  matchedFiles?: string[];
}

interface ChildInfo {
  name: string;
  score: number;
  hasDiagram: boolean;
  type: 'perspective' | 'group' | 'leaf';
}

export interface InspectReport {
  path: string;
  type: 'perspective' | 'group' | 'leaf';
  title?: string;
  fields: Record<string, FieldInfo>;
  fieldCoverage: number;
  score: number;
  scoreBreakdown?: Record<string, { earned: number; max: number }>;
  sourceTracking: SourceTracking;
  links: LinkEntry[];
  children: ChildInfo[];
}

function determineType(data: ClassData, elementPath?: string): 'perspective' | 'group' | 'leaf' {
  const path = elementPath ?? data.name;
  const isPerspective = !path?.includes('/');
  const hasDiagram = !!data.diagram && data.diagram.trim().length > 0;

  if (isPerspective) return 'perspective';
  if (hasDiagram) return 'group';
  return 'leaf';
}

function wordCount(text: string | undefined): number {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(w => w.length > 0).length;
}

function buildInspectReport(elementPath: string, cwd?: string): InspectReport {
  const parts = elementPath.split('/');
  const perspective = parts[0];
  const nodePath = parts.slice(1);
  const isNested = nodePath.length > 0;

  // Read element data
  const data = isNested
    ? showNode(perspective, nodePath, cwd)
    : showClass(elementPath, cwd);

  const meta: ClassMeta | null = isNested
    ? readNodeMeta(perspective, nodePath, cwd)
    : readMeta(elementPath, cwd);

  const type = data ? determineType(data, elementPath) : 'leaf';

  // Field analysis
  const fields: Record<string, FieldInfo> = {};
  let presentCount = 0;
  for (const field of VALID_FIELDS) {
    const content = isNested
      ? readNodeField(perspective, nodePath, field as Field, cwd)
      : readField(elementPath, field as Field, cwd);
    const present = !!content && content.trim().length > 0;
    const wc = wordCount(content ?? undefined);
    fields[field] = { present, wordCount: wc };
    if (present) presentCount++;
  }
  const fieldCoverage = Math.round((presentCount / VALID_FIELDS.length) * 100);

  // Score from eval
  let score = 0;
  let scoreBreakdown: Record<string, { earned: number; max: number }> | undefined;
  try {
    const evalReport = evaluateProject(cwd);
    const elementEval = evalReport.elements.find(e => e.path === elementPath);
    if (elementEval) {
      score = elementEval.score;
      scoreBreakdown = {
        fields: elementEval.scoreBreakdown.fields,
        diagram: elementEval.scoreBreakdown.diagram,
        description: elementEval.scoreBreakdown.description,
        flows: elementEval.scoreBreakdown.flows,
        refs: elementEval.scoreBreakdown.refs,
        children: elementEval.scoreBreakdown.children,
      };
    }
  } catch {
    // eval may fail if no elements have diagrams
  }

  // Source tracking
  const sourceTracking: SourceTracking = {
    sourceFiles: meta?.source_files ?? [],
    sourceGlobs: meta?.source_globs ?? [],
    status: 'unknown',
  };

  try {
    const plan = planIncrementalUpdate(getOmmDir(cwd));
    const staleInfo = plan.stale.find(s => s.elementPath === elementPath);
    const isFresh = plan.fresh.includes(elementPath);

    if (staleInfo) {
      sourceTracking.status = 'stale';
      sourceTracking.staleReasons = staleInfo.reasons;
      sourceTracking.matchedFiles = staleInfo.matchedFiles;
    } else if (isFresh) {
      sourceTracking.status = 'fresh';
    }

    if (meta?.scan_generation?.at) {
      sourceTracking.lastScanned = meta.scan_generation.at;
    }
  } catch {
    // incremental plan may fail
  }

  // Links
  const links = getLinks(elementPath, cwd);

  // Children
  const children: ChildInfo[] = [];
  const childNames = listNodes(perspective, nodePath, cwd);
  for (const child of childNames) {
    const childPath = `${elementPath}/${child}`;
    const childData = showNode(perspective, [...nodePath, child]);
    const childDiagram = readNodeField(perspective, [...nodePath, child], 'diagram', cwd);
    const childType = childData ? determineType(childData, childPath) : 'leaf';

    let childScore = 0;
    try {
      const evalReport = evaluateProject(cwd);
      const childEval = evalReport.elements.find(e => e.path === childPath);
      if (childEval) childScore = childEval.score;
    } catch {
      // ignore
    }

    children.push({
      name: child,
      score: childScore,
      hasDiagram: !!childDiagram && childDiagram.trim().length > 0,
      type: childType,
    });
  }

  return {
    path: elementPath,
    type,
    title: meta?.title,
    fields,
    fieldCoverage,
    score,
    scoreBreakdown,
    sourceTracking,
    links,
    children,
  };
}

function scoreColor(score: number): string {
  if (score >= 80) return `\x1b[32m${score}\x1b[0m`; // green
  if (score >= 60) return `\x1b[33m${score}\x1b[0m`; // yellow
  return `\x1b[31m${score}\x1b[0m`; // red
}

function statusIcon(present: boolean): string {
  return present ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
}

function typeLabel(type: string): string {
  switch (type) {
    case 'perspective': return 'perspective (top-level element)';
    case 'group': return 'group (nested element with diagram)';
    case 'leaf': return 'leaf (nested element without diagram)';
    default: return type;
  }
}

function formatSourceStatus(status: string): string {
  switch (status) {
    case 'fresh': return '\x1b[32mFRESH\x1b[0m';
    case 'stale': return '\x1b[33mSTALE\x1b[0m';
    case 'unknown': return '\x1b[90munknown\x1b[0m';
    default: return status;
  }
}

function printReport(report: InspectReport): void {
  const pad = (s: string, width: number) => s.padEnd(width);

  process.stdout.write('\n');
  process.stdout.write(`Path:         ${report.path}\n`);
  process.stdout.write(`Type:         ${typeLabel(report.type)}\n`);
  if (report.title) process.stdout.write(`Title:        ${report.title}\n`);
  process.stdout.write('\n');

  // Fields
  process.stdout.write('Fields:\n');
  for (const [field, info] of Object.entries(report.fields)) {
    const icon = statusIcon(info.present);
    const wc = info.present ? ` (${info.wordCount} words)` : '';
    process.stdout.write(`  ${pad(field, 14)} ${icon}${wc}\n`);
  }
  process.stdout.write(`  ${pad('coverage', 14)} ${report.fieldCoverage}%\n`);
  process.stdout.write('\n');

  // Score
  process.stdout.write(`Score:        ${scoreColor(report.score)}/100\n`);

  if (report.scoreBreakdown) {
    const parts: string[] = [];
    for (const [key, val] of Object.entries(report.scoreBreakdown)) {
      parts.push(`${key}:${val.earned}/${val.max}`);
    }
    process.stdout.write(`Breakdown:    ${parts.join(' | ')}\n`);
  }
  process.stdout.write('\n');

  // Source tracking
  process.stdout.write('Source tracking:\n');
  const st = report.sourceTracking;
  if (st.sourceFiles.length > 0) {
    process.stdout.write(`  source_files: ${st.sourceFiles.join(', ')}\n`);
  } else {
    process.stdout.write('  source_files: (none)\n');
  }
  if (st.sourceGlobs.length > 0) {
    process.stdout.write(`  source_globs: ${st.sourceGlobs.join(', ')}\n`);
  }
  if (st.lastScanned) {
    const days = Math.floor((Date.now() - new Date(st.lastScanned).getTime()) / (1000 * 60 * 60 * 24));
    process.stdout.write(`  Last scanned: ${st.lastScanned} (${days} days ago)\n`);
  }
  process.stdout.write(`  Status:       ${formatSourceStatus(st.status)}`);
  if (st.staleReasons && st.staleReasons.length > 0) {
    process.stdout.write(` — ${st.staleReasons.join(', ')}`);
    if (st.matchedFiles && st.matchedFiles.length > 0) {
      const shown = st.matchedFiles.slice(0, 3);
      process.stdout.write(` (${shown.join(', ')}${st.matchedFiles.length > 3 ? `, +${st.matchedFiles.length - 3} more` : ''})`);
    }
  }
  process.stdout.write('\n');
  process.stdout.write('\n');

  // Links
  process.stdout.write('Links:\n');
  if (report.links.length === 0) {
    process.stdout.write('  (none)\n');
  } else {
    for (const link of report.links) {
      const label = link.label ? ` — ${link.label}` : '';
      process.stdout.write(`  [${link.type}] ${link.url}${label}\n`);
    }
  }
  process.stdout.write('\n');

  // Children
  if (report.children.length > 0) {
    process.stdout.write(`Children (${report.children.length}):\n`);
    for (const child of report.children) {
      const diag = child.hasDiagram ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
      const score = scoreColor(child.score);
      process.stdout.write(`  ${pad(child.name, 20)} score: ${score}, diagram: ${diag}, type: ${child.type}\n`);
    }
    process.stdout.write('\n');
  }
}

export function commandInspect(args: string[], cwd?: string): void {
  if (!ensureOmmForRead(cwd)) return;

  const element = args.find(a => !a.startsWith('--'));
  const json = args.includes('--json');
  const help = args.includes('--help') || args.includes('-h');

  if (help) {
    process.stdout.write(HELP.trim() + '\n');
    return;
  }

  if (!element) {
    process.stderr.write('error: element path required. Usage: omm inspect <element>\n');
    process.exit(1);
    return;
  }

  if (!classExists(element, cwd)) {
    process.stderr.write(`error: element '${element}' not found\n`);
    process.exit(1);
    return;
  }

  const report = buildInspectReport(element, cwd);

  if (json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    printReport(report);
  }
}
