import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { analyzeDirectory } from '../lib/analyzer/index.js';
import { previewChangeImpact, formatImpactPreview } from '../lib/analyzer/insights.js';
import type { ImpactResult } from '../lib/analyzer/insights.js';

// Import language handlers
import '../lib/analyzer/languages/javascript.js';
import '../lib/analyzer/languages/typescript.js';
import '../lib/analyzer/languages/java.js';
import '../lib/analyzer/languages/kotlin.js';
import '../lib/analyzer/languages/scala.js';
import '../lib/analyzer/languages/python.js';
import '../lib/analyzer/languages/go.js';
import '../lib/analyzer/languages/rust.js';

const HELP = `
omm pr [number|branch] [options]

Show which modules a PR or branch changes would impact.

Usage:
  omm pr <number>           Analyze impact of a PR (requires gh CLI)
  omm pr <branch>           Analyze impact of a branch vs main
  omm pr --staged           Analyze impact of staged changes
  omm pr --diff <ref>       Analyze impact of changes since ref

Options:
  --dir <path>     Directory to analyze (default: current)
  --json           Output as JSON
  --help, -h       Show this help

Examples:
  omm pr 42                 PR #42 impact
  omm pr feature/auth       branch vs main
  omm pr --staged           staged changes
  omm pr --diff HEAD~5      last 5 commits
`;

interface ParsedArgs {
  target: string;
  staged: boolean;
  diff: string | undefined;
  dir: string;
  json: boolean;
  help: boolean;
}

function parseArgs(args: string[]): ParsedArgs {
  const out: ParsedArgs = { target: '', staged: false, diff: undefined, dir: '.', json: false, help: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--staged') out.staged = true;
    else if (a === '--diff' && args[i + 1]) out.diff = args[++i];
    else if (a === '--dir' && args[i + 1]) out.dir = args[++i];
    else if (a === '--json') out.json = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (!a.startsWith('--')) out.target = a;
  }
  return out;
}

function run(cmd: string, cwd: string): string {
  try {
    return execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return '';
  }
}

function getGitRoot(cwd: string): string {
  const root = run('git rev-parse --show-toplevel', cwd);
  return root ? path.resolve(root) : cwd;
}

function getChangedFiles(cwd: string, target: string, staged: boolean, diff: string | undefined): string[] {
  if (staged) {
    const out = run('git diff --cached --name-only', cwd);
    return out ? out.split('\n').filter(Boolean) : [];
  }

  if (diff) {
    const out = run(`git diff --name-only ${diff}`, cwd);
    return out ? out.split('\n').filter(Boolean) : [];
  }

  if (target) {
    // Check if it's a PR number
    if (/^\d+$/.test(target)) {
      const out = run(`gh pr diff ${target} --name-only`, cwd);
      if (out) return out.split('\n').filter(Boolean);
    }

    // Treat as branch name — diff against main/master
    const base = run('git rev-parse --abbrev-ref main || git rev-parse --abbrev-ref master', cwd);
    if (base) {
      const out = run(`git diff --name-only ${base}...${target}`, cwd);
      return out ? out.split('\n').filter(Boolean) : [];
    }
  }

  return [];
}

interface PrImpactReport {
  target: string;
  changedFiles: string[];
  deletedFiles: string[];
  impactedModules: Map<string, string[]>;
  impactResults: ImpactResult[];
  totalAffected: number;
}

function analyzePrImpact(cwd: string, target: string, staged: boolean, diff: string | undefined): PrImpactReport {
  const gitRoot = getGitRoot(cwd);
  const rawChangedFiles = getChangedFiles(cwd, target, staged, diff);

  const changedFiles: string[] = [];
  const deletedFiles: string[] = [];

  for (const f of rawChangedFiles) {
    const absPath = path.isAbsolute(f) ? f : path.join(gitRoot, f);
    if (fs.existsSync(absPath)) {
      const relToCwd = path.relative(cwd, absPath);
      // Only include files that are within the current directory scan context
      if (!relToCwd.startsWith('..') && !path.isAbsolute(relToCwd)) {
        changedFiles.push(relToCwd);
      }
    } else {
      deletedFiles.push(f);
    }
  }

  return {
    target: target || (staged ? 'staged' : diff || 'working'),
    changedFiles,
    deletedFiles,
    impactedModules: new Map(),
    impactResults: [],
    totalAffected: 0,
  };
}

function formatPrImpact(report: PrImpactReport): string {
  const lines: string[] = [];

  lines.push(`## PR Impact Analysis\n`);
  lines.push(`**Target:** ${report.target}`);
  lines.push(`**Changed files:** ${report.changedFiles.length}`);
  if (report.deletedFiles.length > 0) {
    lines.push(`**Deleted/non-existent files:** ${report.deletedFiles.length}`);
  }
  lines.push('');

  if (report.changedFiles.length === 0 && report.deletedFiles.length === 0) {
    lines.push('No changed files detected.\n');
    return lines.join('\n');
  }

  if (report.changedFiles.length > 0) {
    lines.push('### Changed files:\n');
    for (const f of report.changedFiles.slice(0, 30)) {
      lines.push(`  ${f}`);
    }
    if (report.changedFiles.length > 30) {
      lines.push(`  ... and ${report.changedFiles.length - 30} more`);
    }
    lines.push('');
  }

  if (report.deletedFiles.length > 0) {
    lines.push('### Deleted / Non-existent files (omitted from AST analysis):\n');
    for (const f of report.deletedFiles.slice(0, 10)) {
      lines.push(`  ${f}`);
    }
    if (report.deletedFiles.length > 10) {
      lines.push(`  ... and ${report.deletedFiles.length - 10} more`);
    }
    lines.push('');
  }

  if (report.impactResults.length > 0) {
    lines.push('### Impact per file:\n');
    for (const impact of report.impactResults) {
      if (impact.totalAffected > 0) {
        lines.push(`  ${impact.targetFile} → ${impact.totalAffected} file(s) affected`);
        for (const f of impact.directImpact.slice(0, 3)) {
          lines.push(`    ← ${f} (direct)`);
        }
        for (const f of impact.transitiveImpact.slice(0, 3)) {
          lines.push(`    ← ${f} (transitive)`);
        }
        const directHidden = impact.directImpact.length - 3;
        const transHidden = impact.transitiveImpact.length - 3;
        if (directHidden > 0 || transHidden > 0) {
          const hidden = (directHidden > 0 ? directHidden : 0) + (transHidden > 0 ? transHidden : 0);
          lines.push(`    ... and ${hidden} more`);
        }
      }
    }
    lines.push('');

    lines.push(`**Total files affected:** ${report.totalAffected}\n`);
  }

  return lines.join('\n');
}

export async function commandPr(args: string[]): Promise<void> {
  const parsed = parseArgs(args);

  if (parsed.help) {
    process.stdout.write(HELP.trim() + '\n');
    return;
  }

  if (!parsed.target && !parsed.staged && !parsed.diff) {
    process.stderr.write('error: specify a PR number, branch name, --staged, or --diff <ref>\n');
    process.exit(1);
  }

  const cwd = path.resolve(parsed.dir);

  process.stderr.write(`Analyzing PR impact...\n`);
  const report = analyzePrImpact(cwd, parsed.target, parsed.staged, parsed.diff);

  // Run full analysis to get the graph
  const result = await analyzeDirectory(cwd);

  // Compute impact for each changed file
  for (const file of report.changedFiles) {
    const impact = previewChangeImpact(result.graph, file);
    report.impactResults.push(impact);
    report.totalAffected += impact.totalAffected;
  }

  // Deduplicate total
  const allAffected = new Set<string>();
  for (const impact of report.impactResults) {
    allAffected.add(impact.targetFile);
    for (const f of impact.directImpact) allAffected.add(f);
    for (const f of impact.transitiveImpact) allAffected.add(f);
  }
  report.totalAffected = allAffected.size - report.changedFiles.length; // exclude the changed files themselves

  if (parsed.json) {
    process.stdout.write(JSON.stringify({
      target: report.target,
      changedFiles: report.changedFiles,
      impactResults: report.impactResults.map(i => ({
        file: i.targetFile,
        directImpact: i.directImpact,
        transitiveImpact: i.transitiveImpact,
        totalAffected: i.totalAffected,
      })),
      totalAffected: report.totalAffected,
    }, null, 2) + '\n');
  } else {
    process.stdout.write(formatPrImpact(report));
  }
}
