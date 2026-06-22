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
  omm eval --explain auth           # Score breakdown for one element
  omm eval --suggest                # Top 10 elements to improve, ranked by ROI
`;

interface ParsedArgs {
  json: boolean;
  threshold: number;
  changed: boolean;
  noColor: boolean;
  help: boolean;
  suggest: boolean;
  explain: string | undefined;
  explainJson: boolean;
}

function parseArgs(args: string[]): ParsedArgs {
  const out: ParsedArgs = { json: false, threshold: 0, changed: false, noColor: false, help: false, suggest: false, explain: undefined, explainJson: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') {
      out.json = true;
      if (out.explain) out.explainJson = true;
    }
    else if (a === '--threshold' && args[i + 1]) out.threshold = parseInt(args[++i], 10) || 0;
    else if (a === '--changed') out.changed = true;
    else if (a === '--no-color') out.noColor = true;
    else if (a === '--suggest') out.suggest = true;
    else if (a === '--explain' && args[i + 1]) {
      out.explain = args[++i];
      if (out.json) out.explainJson = true;
    }
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
  if (summary.undocumentedDiagramNodes > 0) {
    lines.push(`Diagram gaps: ${color(`${summary.undocumentedDiagramNodes} node(s) without .omm element`, 33, !noColor)}`);
  }
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

  if (parsed.explain) {
    const el = report.elements.find(e => e.path === parsed.explain || e.name === parsed.explain);
    if (!el) {
      process.stderr.write(`Element not found: ${parsed.explain}\n`);
      process.exit(1);
    }
    if (parsed.explainJson) {
      process.stdout.write(JSON.stringify(el, null, 2) + '\n');
    } else {
      printExplain(el, useColor);
    }
    return;
  }

  if (parsed.suggest) {
    printSuggestions(report, useColor);
    return;
  }

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

function printExplain(el: import('../lib/eval.js').ElementEval, noColor: boolean): void {
  const b = el.scoreBreakdown;
  const c = (s: string, code: number) => color(s, code, !noColor);
  process.stdout.write(`\n${c('━━━ Score breakdown for ' + el.path + ' ━━━', 1)}\n\n`);
  process.stdout.write(`Overall: ${scoreColor(el.score, noColor)}/100\n\n`);

  const rows: [string, number, number, string][] = [
    ['Fields', b.fields.earned, b.fields.max, `${b.fields.present}/${b.fields.total} fields filled`],
    ['Diagram', b.diagram.earned, b.diagram.max, b.diagram.valid ? 'valid mermaid' : (b.diagram.has ? 'invalid' : 'missing')],
    ['Description', b.description.earned, b.description.max, b.description.length > 0 ? `${b.description.length} chars` : 'missing'],
    ['Flows', b.flows.earned, b.flows.max, `${b.flows.count} flow(s)`],
    ['Refs', b.refs.earned, b.refs.max, `${b.refs.incoming} in, ${b.refs.outgoing} out`],
    ['Children', b.children.earned, b.children.max, b.children.total === 0 ? 'no children' : `${b.children.covered}/${b.children.total} covered`],
  ];

  for (const [name, earned, max, detail] of rows) {
    const bar = '█'.repeat(Math.round((earned / max) * 10)).padEnd(10, '░');
    process.stdout.write(`  ${name.padEnd(12)} ${bar} ${earned.toFixed(0).padStart(2)}/${max}  ${detail}\n`);
  }

  // Suggestions
  process.stdout.write(`\n${c('To improve:', 1)}\n`);
  if (b.fields.earned < b.fields.max) {
    process.stdout.write(`  → Add missing fields: ${el.fieldsMissing.join(', ')}\n`);
  }
  if (!b.diagram.has) {
    process.stdout.write(`  → Add a mermaid diagram (+20 pts for valid)\n`);
  } else if (!b.diagram.valid) {
    process.stdout.write(`  → Fix diagram syntax errors\n`);
  }
  if (b.description.earned < 10 && b.description.length > 0 && b.description.length <= 50) {
    process.stdout.write(`  → Expand description beyond 50 chars (+${10 - b.description.earned} pts)\n`);
  }
  if (b.flows.count === 0) {
    process.stdout.write(`  → Add flow definitions (+10 pts)\n`);
  }
  if (b.refs.earned === 0) {
    process.stdout.write(`  → Add @cross-references in diagram (+10 pts)\n`);
  }
  if (b.children.earned < b.children.max && b.children.total > 0) {
    process.stdout.write(`  → Document ${b.children.total - b.children.covered} child(ren) (+${b.children.max - b.children.earned} pts)\n`);
  }
  process.stdout.write('\n');
}

function printSuggestions(report: import('../lib/eval.js').EvalReport, noColor: boolean): void {
  // Sort by ROI: gap = (max - earned) of fields + diagram + flows
  const c = (s: string, code: number) => color(s, code, !noColor);
  const ranked = report.elements.map(el => {
    const b = el.scoreBreakdown;
    const gap = (b.fields.max - b.fields.earned) +
                (b.diagram.max - b.diagram.earned) +
                (b.flows.max - b.flows.earned) +
                (b.refs.max - b.refs.earned) +
                (b.children.max - b.children.earned) +
                (b.description.max - b.description.earned);
    return { el, gap };
  }).filter(r => r.gap > 0)
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 10);

  process.stdout.write(`\n${c('━━━ Top improvement opportunities ━━━', 1)}\n\n`);
  if (ranked.length === 0) {
    process.stdout.write(`${c('✓', 32)} All elements at max score!\n\n`);
    return;
  }
  for (const { el, gap } of ranked) {
    const b = el.scoreBreakdown;
    const actions: string[] = [];
    if (b.fields.earned < b.fields.max) actions.push(`+${(b.fields.max - b.fields.earned).toFixed(0)} fields`);
    if (b.diagram.earned < b.diagram.max) actions.push(`+${(b.diagram.max - b.diagram.earned).toFixed(0)} diagram`);
    if (b.flows.earned < b.flows.max) actions.push(`+${b.flows.max - b.flows.earned} flows`);
    if (b.refs.earned < b.refs.max) actions.push(`+${b.refs.max - b.refs.earned} refs`);
    if (b.description.earned < b.description.max) actions.push(`+${b.description.max - b.description.earned} desc`);
    if (b.children.earned < b.children.max) actions.push(`+${(b.children.max - b.children.earned).toFixed(0)} children`);
    const typeTag = el.type === 'leaf' && b.diagram.earned < b.diagram.max ? ' [leaf → +20 if diagram]' : '';
    process.stdout.write(`  ${el.path}  ${c('+' + gap.toFixed(0) + ' pts', 33)}  ${actions.join(', ')}${typeTag}\n`);
  }
  process.stdout.write('\n');
  process.stdout.write('Tip: leaves get +20 pts for adding a small "input → this → output" diagram.\n');
  process.stdout.write('     Use `omm show <element> --type` to see the type of any element.\n\n');
}
