/**
 * omm feedback — Generate a feedback report from the current project state
 *
 * Usage:
 *   omm feedback                       # writes .omm/feedback.md (or .json)
 *   omm feedback --format json         # writes .omm/feedback.json
 *   omm feedback --include "message"   # add a free-form message
 *   omm feedback --out path.md         # write to custom path
 *   omm feedback --print               # print to stdout instead of writing
 *   omm feedback --help                # show help
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { ensureOmmForRead, getOmmDir } from '../lib/store.js';
import { evaluateProject } from '../lib/eval.js';
import { readMeta, readNodeMeta } from '../lib/store.js';
import { createRequire } from 'node:module';

const HELP = `
omm feedback — Generate a feedback report from your project

Usage:
  omm feedback                              Write .omm/feedback.md (default)
  omm feedback --format json                Write .omm/feedback.json
  omm feedback --include "your message"     Add a free-form message
  omm feedback --out path.md                Write to custom path
  omm feedback --print                      Print to stdout instead of writing
  omm feedback --help                       Show this help

The generated file contains:
  - omm version and project info
  - Current eval score and coverage metrics
  - Lowest-scoring elements (top 10)
  - Recent issues encountered
  - Your message (if --include was used)
  - Suggestions from omm eval

The file is written inside .omm/ so it travels with the project. You can
then share it with the maintainer to improve omm itself.
`;

interface ParsedArgs {
  format: 'md' | 'json';
  include?: string;
  out?: string;
  print: boolean;
  help: boolean;
}

function parseArgs(args: string[]): ParsedArgs {
  const out: ParsedArgs = { format: 'md', print: false, help: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--format' && args[i + 1]) {
      const f = args[++i].toLowerCase();
      if (f === 'json' || f === 'md') out.format = f;
    }
    else if (a === '--include' && args[i + 1]) out.include = args[++i];
    else if (a === '--out' && args[i + 1]) out.out = args[++i];
    else if (a === '--print') out.print = true;
  }
  return out;
}

function getOmmVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require('../package.json');
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

function getGitInfo(cwd: string): { commit?: string; branch?: string } {
  try {
    const commit = execSync('git rev-parse --short HEAD', { cwd, encoding: 'utf-8' }).trim();
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd, encoding: 'utf-8' }).trim();
    return { commit, branch };
  } catch {
    return {};
  }
}

function generateReport(include?: string): string {
  const report = evaluateProject();
  const version = getOmmVersion();
  const git = getGitInfo(process.cwd());
  const timestamp = new Date().toISOString();

  const lines: string[] = [];
  lines.push('# omm feedback report');
  lines.push('');
  lines.push(`Generated: ${timestamp}`);
  lines.push(`omm version: ${version}`);
  if (git.commit) lines.push(`git commit: ${git.commit}`);
  if (git.branch) lines.push(`git branch: ${git.branch}`);
  lines.push('');

  // Project state
  lines.push('## Project state');
  lines.push('');
  lines.push(`- Total elements: ${report.summary.totalElements}`);
  lines.push(`- Perspectives: ${report.summary.perspectives}`);
  lines.push(`- Groups: ${report.summary.groups}`);
  lines.push(`- Leaves: ${report.summary.leaves}`);
  lines.push(`- Overall score: ${report.summary.overallScore}/100`);
  lines.push(`- Field coverage: ${report.summary.fieldCoverage}%`);
  lines.push(`- Diagram coverage: ${report.summary.diagramCoverage}%`);
  lines.push(`- Flow coverage: ${report.summary.flowCoverage}%`);
  lines.push(`- Ref integrity: ${report.summary.refIntegrity}%`);
  lines.push('');

  // Lowest scoring elements
  const lowElements = report.elements.filter(e => e.score < 80).slice(0, 10);
  if (lowElements.length > 0) {
    lines.push('## Lowest scoring elements');
    lines.push('');
    lines.push('| Element | Type | Score | Missing fields |');
    lines.push('|---------|------|-------|----------------|');
    for (const el of lowElements) {
      const missing = el.fieldsMissing.length > 0 ? el.fieldsMissing.join(', ') : '—';
      lines.push(`| \`${el.path}\` | ${el.type} | ${el.score} | ${missing} |`);
    }
    lines.push('');
  }

  // Issues
  if (report.issues.length > 0) {
    lines.push('## Issues');
    lines.push('');
    const errors = report.issues.filter(i => i.severity === 'error');
    const warnings = report.issues.filter(i => i.severity === 'warning');
    const info = report.issues.filter(i => i.severity === 'info');
    lines.push(`- ${errors.length} errors`);
    lines.push(`- ${warnings.length} warnings`);
    lines.push(`- ${info.length} info`);
    lines.push('');
    if (errors.length > 0) {
      lines.push('### Errors');
      lines.push('');
      for (const i of errors.slice(0, 5)) {
        lines.push(`- \`${i.path || '(root)'}\`: ${i.message}`);
      }
      if (errors.length > 5) lines.push(`- ... and ${errors.length - 5} more`);
      lines.push('');
    }
  }

  // Suggestions
  if (report.suggestions.length > 0) {
    lines.push('## Suggestions from omm eval');
    lines.push('');
    for (const s of report.suggestions.slice(0, 10)) {
      lines.push(`- ${s}`);
    }
    if (report.suggestions.length > 10) lines.push(`- ... and ${report.suggestions.length - 10} more`);
    lines.push('');
  }

  // User message
  if (include) {
    lines.push('## User message');
    lines.push('');
    lines.push(include);
    lines.push('');
  }

  // Footer
  lines.push('---');
  lines.push('');
  lines.push('To improve omm, share this file with the maintainer.');
  lines.push('Or run `omm feedback --include "your suggestion"` to add context.');

  return lines.join('\n') + '\n';
}

function generateJsonReport(include?: string): string {
  const report = evaluateProject();
  const version = getOmmVersion();
  const git = getGitInfo(process.cwd());
  const lowElements = report.elements.filter(e => e.score < 80).slice(0, 10);

  return JSON.stringify({
    generated: new Date().toISOString(),
    omm: { version, ...git },
    project: {
      cwd: process.cwd(),
      ommDir: getOmmDir(),
    },
    eval: report.summary,
    lowestScoring: lowElements.map(el => ({
      path: el.path,
      type: el.type,
      score: el.score,
      scoreBreakdown: el.scoreBreakdown,
      fieldsMissing: el.fieldsMissing,
    })),
    issues: report.issues,
    suggestions: report.suggestions,
    userMessage: include,
  }, null, 2) + '\n';
}

export function commandFeedback(args: string[]): void {
  if (!ensureOmmForRead()) return;

  const parsed = parseArgs(args);
  if (parsed.help) {
    process.stdout.write(HELP.trim() + '\n');
    return;
  }

  const content = parsed.format === 'json'
    ? generateJsonReport(parsed.include)
    : generateReport(parsed.include);

  if (parsed.print) {
    process.stdout.write(content);
    return;
  }

  const defaultName = parsed.format === 'json' ? 'feedback.json' : 'feedback.md';
  const filePath = parsed.out || path.join(getOmmDir(), defaultName);

  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');

  const relPath = path.relative(process.cwd(), filePath) || filePath;
  process.stderr.write(`wrote ${relPath} (${content.length} bytes)\n`);
  process.stderr.write(`Share this file with the omm maintainer to improve the tool.\n`);
}
