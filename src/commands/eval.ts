import { ensureOmmForRead } from '../lib/store.js';
import { evaluateProject } from '../lib/eval.js';
import type { EvalReport } from '../lib/eval.js';

const HELP = `
omm eval [options]

Evaluate the quality and coverage of your .omm/ architecture documentation.

Usage:
  omm eval                          Show quality report
  omm eval --json                   Output as JSON
  omm eval --threshold <score>      Exit with code 1 if score < threshold (default: 0)
  omm eval --changed                Only evaluate changed elements
  omm eval --no-color               Disable colored output

Report includes:
  - Overall quality score (0-100)
  - Field coverage (% of fields filled)
  - Diagram coverage (% with valid diagrams)
  - Flow coverage (% with flow definitions)
  - Cross-reference integrity
  - Per-element scores (worst first)
  - Issues and suggestions

Examples:
  omm eval                          # Show report
  omm eval --json | jq              # JSON output
  omm eval --threshold 80           # CI/CD: fail if score < 80
`;

interface ParsedArgs {
  json: boolean;
  threshold: number;
  changed: boolean;
  noColor: boolean;
  help: boolean;
}

function parseArgs(args: string[]): ParsedArgs {
  const out: ParsedArgs = { json: false, threshold: 0, changed: false, noColor: false, help: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') out.json = true;
    else if (a === '--threshold' && args[i + 1]) out.threshold = parseInt(args[++i], 10) || 0;
    else if (a === '--changed') out.changed = true;
    else if (a === '--no-color') out.noColor = true;
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function color(s: string, code: number, enabled: boolean): string {
  if (!enabled) return s;
  return `\x1b[${code}m${s}\x1b[0m`;
}

function scoreColor(score: number, noColor: boolean): string {
  if (score >= 80) return color(`${score}`, 32, !noColor); // green
  if (score >= 60) return color(`${score}`, 33, !noColor); // yellow
  return color(`${score}`, 31, !noColor); // red
}

function formatReport(report: EvalReport, noColor: boolean): string {
  const { summary, elements, issues, suggestions } = report;
  const lines: string[] = [];

  // Header
  lines.push('');
  lines.push(color('━━━ omm eval report ━━━', 1, !noColor));
  lines.push('');

  // Summary
  lines.push(`Overall score: ${scoreColor(summary.overallScore, noColor)}/100`);
  lines.push(`Elements:     ${summary.totalElements} (${summary.perspectives} perspectives, ${summary.groups} groups, ${summary.leaves} leaves)`);
  lines.push(`Field cov:    ${summary.fieldCoverage}%`);
  lines.push(`Diagram cov:  ${summary.diagramCoverage}%`);
  lines.push(`Flow cov:     ${summary.flowCoverage}%`);
  lines.push(`Ref integ:    ${summary.refIntegrity}%`);
  lines.push('');

  // Issues
  if (issues.length > 0) {
    lines.push(color('Issues:', 1, !noColor));
    const errorCount = issues.filter(i => i.severity === 'error').length;
    const warnCount = issues.filter(i => i.severity === 'warning').length;
    const infoCount = issues.filter(i => i.severity === 'info').length;
    lines.push(`  ${color(`${errorCount} errors`, 31, !noColor)}, ${color(`${warnCount} warnings`, 33, !noColor)}, ${infoCount} info`);
    lines.push('');
    for (const issue of issues.slice(0, 20)) {
      const sev = issue.severity === 'error' ? color('✗', 31, !noColor)
        : issue.severity === 'warning' ? color('⚠', 33, !noColor)
        : color('ℹ', 36, !noColor);
      lines.push(`  ${sev} ${issue.path || '(root)'}: ${issue.message}`);
    }
    if (issues.length > 20) {
      lines.push(`  ... and ${issues.length - 20} more`);
    }
    lines.push('');
  }

  // Suggestions
  if (suggestions.length > 0) {
    lines.push(color('Suggestions:', 1, !noColor));
    for (const s of suggestions.slice(0, 10)) {
      lines.push(`  → ${s}`);
    }
    if (suggestions.length > 10) {
      lines.push(`  ... and ${suggestions.length - 10} more`);
    }
    lines.push('');
  }

  // Worst elements
  const worstElements = elements.filter(e => e.score < 80).slice(0, 10);
  if (worstElements.length > 0) {
    lines.push(color('Lowest scoring elements:', 1, !noColor));
    for (const el of worstElements) {
      const missing = el.fieldsMissing.length > 0 ? ` (missing: ${el.fieldsMissing.join(', ')})` : '';
      lines.push(`  ${scoreColor(el.score, noColor).padEnd(4)} ${el.path}${missing}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function commandEval(args: string[]): void {
  if (!ensureOmmForRead()) return;

  const parsed = parseArgs(args);
  if (parsed.help) {
    process.stdout.write(HELP.trim() + '\n');
    return;
  }

  const useColor = !parsed.noColor && process.stdout.isTTY;
  const report = evaluateProject();

  if (parsed.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    process.stdout.write(formatReport(report, useColor) + '\n');
  }

  if (parsed.threshold > 0 && report.summary.overallScore < parsed.threshold) {
    process.stderr.write(`\nScore ${report.summary.overallScore} below threshold ${parsed.threshold}\n`);
    process.exit(1);
  }
}
