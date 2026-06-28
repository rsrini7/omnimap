/**
 * omm treecode — Code ↔ docs coverage map.
 *
 * Shows the source code tree annotated with which .omm/ element covers
 * each file. Helps identify undocumented code and orphaned elements.
 *
 * Usage:
 *   omm treecode                    Full code tree with .omm/ annotations
 *   omm treecode --uncovered        Show only uncovered source files
 *   omm treecode --orphans          Show only orphaned .omm/ elements
 *   omm treecode --stats            Coverage statistics summary
 *   omm treecode src/lib            Scan specific directory only
 *   omm treecode --json             JSON output
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  buildCoverageMap,
  computeCoverageStats,
  findOrphanedElements,
  walkSourceTree,
  type CoverageEntry,
} from '../lib/treecode.js';
import { getOmmDir, ensureOmmForRead } from '../lib/store.js';

const HELP = `
omm treecode [dir] [options]

Show source code tree annotated with .omm/ element coverage.
Helps identify undocumented code and orphaned elements.

Usage:
  omm treecode                    Full code tree with .omm/ annotations
  omm treecode --uncovered        Show only uncovered source files
  omm treecode --orphans          Show only orphaned .omm/ elements
  omm treecode --stats            Coverage statistics summary
  omm treecode <dir>              Scan specific directory
  omm treecode --json             JSON output

Examples:
  omm treecode                    # Show full tree with coverage
  omm treecode --uncovered        # Find undocumented files
  omm treecode --orphans          # Find orphaned elements
  omm treecode --stats            # Coverage statistics
  omm treecode src/lib            # Scan specific directory
  omm treecode --json | jq        # JSON for scripting
`;

interface ParsedArgs {
  dir: string;
  uncovered: boolean;
  orphans: boolean;
  stats: boolean;
  json: boolean;
  help: boolean;
}

function parseArgs(args: string[]): ParsedArgs {
  const out: ParsedArgs = {
    dir: '.',
    uncovered: false,
    orphans: false,
    stats: false,
    json: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--uncovered') out.uncovered = true;
    else if (a === '--orphans') out.orphans = true;
    else if (a === '--stats') out.stats = true;
    else if (a === '--json') out.json = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (!a.startsWith('--')) out.dir = a;
  }

  return out;
}

// ── Renderers ──────────────────────────────────────────────────────

/**
 * Build a tree structure from flat file paths and render with coverage annotations.
 */
function renderTreeWithCoverage(entries: CoverageEntry[], rootDir: string): string {
  // Group files by directory
  const dirMap = new Map<string, Map<string, CoverageEntry>>();

  for (const entry of entries) {
    const parts = entry.sourcePath.split('/');
    const fileName = parts[parts.length - 1];
    const dirPath = parts.length > 1 ? parts.slice(0, -1).join('/') : '.';

    if (!dirMap.has(dirPath)) dirMap.set(dirPath, new Map());
    dirMap.get(dirPath)!.set(fileName, entry);
  }

  const lines: string[] = [];
  const sortedDirs = [...dirMap.keys()].sort();

  for (const dir of sortedDirs) {
    const files = dirMap.get(dir)!;
    const sortedFiles = [...files.entries()].sort((a, b) => a[0].localeCompare(b[0]));

    // Find the best element for this directory (most common match)
    const dirElement = findDirectoryElement(dir, entries);

    // Print directory header
    if (dir === '.') {
      lines.push(`${path.basename(rootDir)}/`);
    } else {
      const annotation = dirElement ? ` → ${dirElement}` : '';
      lines.push(`${dir}/${annotation}`);
    }

    // Print files
    for (let i = 0; i < sortedFiles.length; i++) {
      const [fileName, entry] = sortedFiles[i];
      const isLast = i === sortedFiles.length - 1;
      const prefix = isLast ? '└── ' : '├── ';
      const annotation = entry.elementPath ? ` → ${entry.elementPath}` : ' → (uncovered)';
      lines.push(`  ${prefix}${fileName}${annotation}`);
    }
  }

  return lines.join('\n');
}

function findDirectoryElement(dirPath: string, entries: CoverageEntry[]): string | null {
  const dirEntries = entries.filter(e => {
    const dir = e.sourcePath.includes('/')
      ? e.sourcePath.slice(0, e.sourcePath.lastIndexOf('/'))
      : '.';
    return dir === dirPath && e.elementPath;
  });

  if (dirEntries.length === 0) return null;

  // Return the most common element
  const counts = new Map<string, number>();
  for (const e of dirEntries) {
    counts.set(e.elementPath!, (counts.get(e.elementPath!) ?? 0) + 1);
  }

  let best = '';
  let bestCount = 0;
  for (const [el, count] of counts) {
    if (count > bestCount) {
      best = el;
      bestCount = count;
    }
  }

  return best;
}

function renderUncovered(entries: CoverageEntry[]): string {
  const uncovered = entries.filter(e => !e.elementPath);
  const lines: string[] = ['Uncovered source files (no .omm/ element):', ''];

  for (const entry of uncovered) {
    lines.push(`  ${entry.sourcePath}`);
  }

  const pct = entries.length > 0
    ? Math.round(((entries.length - uncovered.length) / entries.length) * 100)
    : 0;
  lines.push('');
  lines.push(`Coverage: ${entries.length - uncovered.length}/${entries.length} files (${pct}%)`);

  return lines.join('\n');
}

function renderOrphans(orphans: Array<{ elementPath: string; reason: string }>): string {
  const lines: string[] = ['Orphaned .omm/ elements (no matching source files):', ''];

  for (const orphan of orphans) {
    lines.push(`  ${orphan.elementPath.padEnd(40)} — ${orphan.reason}`);
  }

  lines.push('');
  lines.push('Tip: Run /omm-scan to re-sync, or delete with: omm delete <element>');

  return lines.join('\n');
}

function renderStats(stats: ReturnType<typeof computeCoverageStats>): string {
  const lines: string[] = ['Code ↔ Docs Coverage Map', ''];

  lines.push(`  Source files:     ${stats.sourceFiles}`);
  lines.push(`  Covered files:    ${stats.coveredFiles} (${stats.coveragePercent}%)`);
  lines.push(`  Uncovered files:  ${stats.uncoveredFiles} (${100 - stats.coveragePercent}%)`);
  lines.push('');
  lines.push(`  .omm elements:    ${stats.elements}`);
  lines.push(`  Matched:          ${stats.matchedElements}`);
  lines.push(`  Orphaned:         ${stats.orphanedElements}`);
  lines.push('');
  lines.push('  Tracking method:');
  lines.push(`    source_files:   ${stats.trackingMethod.sourceFiles} elements`);
  lines.push(`    source_globs:   ${stats.trackingMethod.sourceGlobs} elements`);
  lines.push(`    Name heuristic: ${stats.trackingMethod.heuristic} elements (fallback)`);

  if (stats.topUncoveredDirs.length > 0) {
    lines.push('');
    lines.push('  Top uncovered directories:');
    for (const { dir, fileCount } of stats.topUncoveredDirs) {
      lines.push(`    ${dir.padEnd(25)} (${fileCount} files)`);
    }
  }

  return lines.join('\n');
}

// ── CLI entry point ────────────────────────────────────────────────

export function commandTreecode(args: string[], cwd?: string): void {
  const parsed = parseArgs(args);

  if (parsed.help) {
    process.stdout.write(HELP.trim() + '\n');
    return;
  }

  if (!ensureOmmForRead(cwd)) return;

  const ommDir = getOmmDir(cwd);
  const sourceDir = path.resolve(cwd ?? process.cwd(), parsed.dir);

  if (!fs.existsSync(sourceDir)) {
    process.stderr.write(`error: directory not found: ${sourceDir}\n`);
    process.exit(1);
    return;
  }

  const entries = buildCoverageMap(sourceDir, ommDir);

  if (parsed.json) {
    const output: Record<string, unknown> = { entries };
    if (parsed.stats) output.stats = computeCoverageStats(entries, ommDir);
    if (parsed.orphans) output.orphans = findOrphanedElements(entries, ommDir);
    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
    return;
  }

  if (parsed.uncovered) {
    process.stdout.write(renderUncovered(entries) + '\n');
    return;
  }

  if (parsed.orphans) {
    const orphans = findOrphanedElements(entries, ommDir);
    process.stdout.write(renderOrphans(orphans) + '\n');
    return;
  }

  if (parsed.stats) {
    const stats = computeCoverageStats(entries, ommDir);
    process.stdout.write(renderStats(stats) + '\n');
    return;
  }

  // Default: full tree with coverage annotations
  process.stdout.write(renderTreeWithCoverage(entries, sourceDir) + '\n');
}
