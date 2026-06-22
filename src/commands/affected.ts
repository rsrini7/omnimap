import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { analyzeDirectory } from '../lib/analyzer/index.js';
import type { DependencyGraph } from '../lib/analyzer/types.js';

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
omm affected [files...] [options]

Find test files affected by source file changes.
Traces import dependencies transitively to find impacted tests.

Usage:
  omm affected src/utils.ts src/api.ts      Pass files as arguments
  omm affected --staged                     Use staged files (git diff --cached)
  omm affected --diff HEAD~5                Use files changed since ref
  omm affected --stdin                      Read file list from stdin

Options:
  --dir <path>     Directory to analyze (default: current)
  --depth <n>      Max dependency traversal depth (default: 5)
  --filter <glob>  Custom glob to identify test files (default: auto-detect)
  --json           Output as JSON
  --quiet          Output file paths only
`;

function run(cmd: string, cwd: string): string {
  try {
    return execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return '';
  }
}

function getGitRoot(cwd: string): string {
  const out = run('git rev-parse --show-toplevel', cwd);
  return out ? path.resolve(out) : cwd;
}

function isTestFile(filePath: string, customFilter?: string): boolean {
  if (customFilter) {
    const pattern = new RegExp(customFilter.replace(/\*/g, '.*'));
    return pattern.test(filePath);
  }
  const lower = filePath.toLowerCase();
  return lower.includes('test') || lower.includes('spec') || lower.includes('__tests__')
    || lower.endsWith('.test.ts') || lower.endsWith('.test.js')
    || lower.endsWith('.spec.ts') || lower.endsWith('.spec.js')
    || lower.endsWith('.test.py') || lower.endsWith('_test.go')
    || lower.endsWith('Test.java') || lower.endsWith('Spec.scala');
}

function findAffectedFiles(
  changedFiles: string[],
  graph: DependencyGraph,
  depth: number,
): Set<string> {
  // Build reverse adjacency (who imports whom)
  const reverseAdj = new Map<string, string[]>();
  for (const node of graph.nodes) reverseAdj.set(node.file, []);
  for (const edge of graph.edges) {
    reverseAdj.get(edge.to)?.push(edge.from);
  }

  // BFS from changed files
  const visitedDepths = new Map<string, number>();
  const queue: { file: string; depth: number }[] = changedFiles.map(f => ({ file: f, depth: 0 }));

  while (queue.length > 0) {
    const { file, depth: d } = queue.shift()!;
    const prevDepth = visitedDepths.get(file) ?? Infinity;
    if (d >= prevDepth || d > depth) continue;
    visitedDepths.set(file, d);

    for (const importer of reverseAdj.get(file) || []) {
      const nextDepth = d + 1;
      const importerPrev = visitedDepths.get(importer) ?? Infinity;
      if (nextDepth < importerPrev && nextDepth <= depth) {
        queue.push({ file: importer, depth: nextDepth });
      }
    }
  }

  return new Set(visitedDepths.keys());
}

export async function commandAffected(args: string[]): Promise<void> {
  let dir = '.';
  let depth = 5;
  let filter: string | undefined;
  let json = false;
  let quiet = false;
  let help = false;
  let staged = false;
  let diffRef = '';
  let stdin = false;
  const explicitFiles: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--dir' && args[i + 1]) dir = args[++i];
    else if (a === '--depth' && args[i + 1]) depth = parseInt(args[++i], 10) || 5;
    else if (a === '--filter' && args[i + 1]) filter = args[++i];
    else if (a === '--json') json = true;
    else if (a === '--quiet') quiet = true;
    else if (a === '--staged') staged = true;
    else if (a === '--diff' && args[i + 1]) diffRef = args[++i];
    else if (a === '--stdin') stdin = true;
    else if (a === '--help' || a === '-h') help = true;
    else if (!a.startsWith('--')) explicitFiles.push(a);
  }

  if (help) {
    process.stdout.write(HELP.trim() + '\n');
    return;
  }

  const cwd = path.resolve(dir);
  const gitRoot = getGitRoot(cwd);

  // Determine changed files
  let changedFiles: string[] = [];

  if (staged) {
    const out = run('git diff --cached --name-only', cwd);
    const files = out ? out.split('\n').filter(Boolean) : [];
    changedFiles = files.map(f => {
      const abs = path.resolve(gitRoot, f);
      return path.relative(cwd, abs).replace(/\\/g, '/');
    }).filter(f => !f.startsWith('..'));
  } else if (diffRef) {
    const out = run(`git diff --name-only ${diffRef}`, cwd);
    const files = out ? out.split('\n').filter(Boolean) : [];
    changedFiles = files.map(f => {
      const abs = path.resolve(gitRoot, f);
      return path.relative(cwd, abs).replace(/\\/g, '/');
    }).filter(f => !f.startsWith('..'));
  } else if (stdin) {
    const chunks: Buffer[] = [];
    if (process.stdin.isTTY) {
      process.stderr.write('error: --stdin requires piped input\n');
      process.exit(1);
    }
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    const files = Buffer.concat(chunks).toString('utf-8').split('\n').filter(Boolean);
    changedFiles = files.map(f => {
      const abs = path.resolve(cwd, f);
      return path.relative(cwd, abs).replace(/\\/g, '/');
    }).filter(f => !f.startsWith('..'));
  } else if (explicitFiles.length > 0) {
    changedFiles = explicitFiles.map(f => {
      const abs = path.resolve(cwd, f);
      return path.relative(cwd, abs).replace(/\\/g, '/');
    }).filter(f => !f.startsWith('..'));
  } else {
    process.stderr.write('error: specify files, --staged, --diff <ref>, or --stdin\n');
    process.exit(1);
  }

  if (changedFiles.length === 0) {
    process.stdout.write('No changed files.\n');
    return;
  }

  process.stderr.write(`Analyzing ${cwd}...\n`);
  const result = await analyzeDirectory(cwd);

  // Find affected files via transitive dependency walk
  const affected = findAffectedFiles(changedFiles, result.graph, depth);

  // Filter to test files only
  const affectedTests = [...affected].filter(f => isTestFile(f, filter)).sort();

  if (json) {
    process.stdout.write(JSON.stringify({ changedFiles, affected: [...affected].sort(), affectedTests, depth }, null, 2) + '\n');
  } else if (quiet) {
    for (const f of affectedTests) process.stdout.write(f + '\n');
  } else {
    process.stdout.write(`Changed files: ${changedFiles.length}\n`);
    process.stdout.write(`Affected files: ${affected.size}\n`);
    process.stdout.write(`Affected tests: ${affectedTests.length}\n\n`);
    if (affectedTests.length > 0) {
      process.stdout.write('Affected test files:\n');
      for (const f of affectedTests) process.stdout.write(`  ${f}\n`);
    } else {
      process.stdout.write('No test files affected.\n');
    }
  }
}
