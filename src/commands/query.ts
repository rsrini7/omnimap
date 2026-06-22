import path from 'node:path';
import fs from 'node:fs';
import { analyzeDirectory, getSupportedExtensions } from '../lib/analyzer/index.js';
import type { DependencyGraph } from '../lib/analyzer/types.js';
import { findCycles, findHotspots, findDeadExports, formatCycles, formatHotspots, formatDeadExports } from '../lib/analyzer/insights.js';

// Import language handlers to trigger self-registration
import '../lib/analyzer/languages/javascript.js';
import '../lib/analyzer/languages/typescript.js';
import '../lib/analyzer/languages/java.js';
import '../lib/analyzer/languages/kotlin.js';
import '../lib/analyzer/languages/scala.js';
import '../lib/analyzer/languages/python.js';
import '../lib/analyzer/languages/go.js';
import '../lib/analyzer/languages/rust.js';

const HELP = `
omm query <question> [options]

Query the dependency graph using natural language patterns.
No LLM required — deterministic graph traversal.

Usage:
  omm query "what connects X to Y"         Find path between two nodes
  omm query "who imports X"                Find all files that import X
  omm query "what does X import"           Find all imports from X
  omm query "what depends on X"            Find transitive dependents
  omm query "what does X depend on"        Find transitive dependencies
  omm query "cycles"                       Find all import cycles
  omm query "hotspots"                     Show coupling hotspots
  omm query "dead"                         Show dead exports

Options:
  --dir <path>     Directory to analyze (default: current)
  --json           Output as JSON
  --help, -h       Show this help

Examples:
  omm query "what connects auth to db"
  omm query "who imports UserService"
  omm query "cycles"
  omm query "hotspots" --json
`;

interface ParsedArgs {
  query: string;
  dir: string;
  json: boolean;
  help: boolean;
}

function parseArgs(args: string[]): ParsedArgs {
  const out: ParsedArgs = { query: '', dir: '.', json: false, help: false };
  const queryParts: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--dir' && args[i + 1]) out.dir = args[++i];
    else if (a === '--json') out.json = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (!a.startsWith('--')) queryParts.push(a);
  }
  out.query = queryParts.join(' ').toLowerCase();
  return out;
}

// ─── Query matching ──────────────────────────────────────────────────────────

function fuzzyMatch(haystack: string, needle: string): boolean {
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  return h.includes(n) || h.split('/').pop()?.includes(n) || h.replace(/\.[^.]+$/, '').includes(n);
}

function findFile(graph: DependencyGraph, name: string): string | null {
  const target = name.toLowerCase();
  // Exact match (case-insensitive)
  for (const node of graph.nodes) {
    if (node.file.toLowerCase() === target) return node.file;
  }
  // Stem match (without extension, case-insensitive)
  for (const node of graph.nodes) {
    if (node.file.replace(/\.[^.]+$/, '').toLowerCase() === target) return node.file;
  }
  // Basename match (case-insensitive)
  for (const node of graph.nodes) {
    const base = node.file.split('/').pop()?.replace(/\.[^.]+$/, '') || '';
    if (base.toLowerCase() === target) return node.file;
  }
  // Fuzzy
  for (const node of graph.nodes) {
    if (fuzzyMatch(node.file, target)) return node.file;
  }
  return null;
}

function extractTerms(query: string): { from?: string; to?: string } {
  // "what connects X to Y"
  const connectsMatch = query.match(/connects?\s+(.+?)\s+to\s+(.+)/);
  if (connectsMatch) return { from: connectsMatch[1].trim(), to: connectsMatch[2].trim() };

  // "what connects X and Y"
  const andMatch = query.match(/connects?\s+(.+?)\s+and\s+(.+)/);
  if (andMatch) return { from: andMatch[1].trim(), to: andMatch[2].trim() };

  // "path X Y"
  const pathMatch = query.match(/path\s+(.+?)\s+(.+)/);
  if (pathMatch) return { from: pathMatch[1].trim(), to: pathMatch[2].trim() };

  return {};
}

// ─── Graph algorithms ────────────────────────────────────────────────────────

function shortestPath(graph: DependencyGraph, fromFile: string, toFile: string): string[] | null {
  const adj = new Map<string, string[]>();
  for (const node of graph.nodes) adj.set(node.file, []);
  for (const edge of graph.edges) adj.get(edge.from)?.push(edge.to);

  const visited = new Set<string>();
  const queue: { file: string; path: string[] }[] = [{ file: fromFile, path: [fromFile] }];
  visited.add(fromFile);

  while (queue.length > 0) {
    const { file, path: currentPath } = queue.shift()!;
    if (file === toFile) return currentPath;

    for (const neighbor of adj.get(file) || []) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push({ file: neighbor, path: [...currentPath, neighbor] });
      }
    }
  }

  return null; // no path
}

function findAllPaths(graph: DependencyGraph, fromFile: string, toFile: string, maxDepth: number = 5): string[][] {
  const adj = new Map<string, string[]>();
  for (const node of graph.nodes) adj.set(node.file, []);
  for (const edge of graph.edges) adj.get(edge.from)?.push(edge.to);

  const paths: string[][] = [];

  function dfs(current: string, target: string, path: string[], visited: Set<string>, depth: number): void {
    if (depth > maxDepth) return;
    if (current === target) {
      paths.push([...path]);
      return;
    }
    for (const neighbor of adj.get(current) || []) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        path.push(neighbor);
        dfs(neighbor, target, path, visited, depth + 1);
        path.pop();
        visited.delete(neighbor);
      }
    }
  }

  const visited = new Set([fromFile]);
  dfs(fromFile, toFile, [fromFile], visited, 0);
  return paths;
}

function findImporters(graph: DependencyGraph, targetFile: string): string[] {
  return graph.edges.filter(e => e.to === targetFile).map(e => e.from);
}

function findImports(graph: DependencyGraph, sourceFile: string): { file: string; imports: string[] }[] {
  return graph.edges.filter(e => e.from === sourceFile).map(e => ({ file: e.to, imports: e.imports }));
}

function findTransitiveDependents(graph: DependencyGraph, targetFile: string): string[] {
  const adj = new Map<string, string[]>();
  for (const node of graph.nodes) adj.set(node.file, []);
  for (const edge of graph.edges) adj.get(edge.to)?.push(edge.from); // reverse

  const visited = new Set<string>();
  const queue = [targetFile];
  while (queue.length > 0) {
    const file = queue.shift()!;
    for (const importer of adj.get(file) || []) {
      if (!visited.has(importer)) {
        visited.add(importer);
        queue.push(importer);
      }
    }
  }
  return [...visited].sort();
}

function findTransitiveDependencies(graph: DependencyGraph, sourceFile: string): string[] {
  const adj = new Map<string, string[]>();
  for (const node of graph.nodes) adj.set(node.file, []);
  for (const edge of graph.edges) adj.get(edge.from)?.push(edge.to);

  const visited = new Set<string>();
  const queue = [sourceFile];
  while (queue.length > 0) {
    const file = queue.shift()!;
    for (const dep of adj.get(file) || []) {
      if (!visited.has(dep)) {
        visited.add(dep);
        queue.push(dep);
      }
    }
  }
  return [...visited].sort();
}

// ─── Query router ────────────────────────────────────────────────────────────

interface QueryResult {
  query: string;
  type: string;
  data: any;
  text: string;
}

function executeQuery(graph: DependencyGraph, query: string, analyses: import('../lib/analyzer/types.js').FileAnalysis[] = []): QueryResult {
  // Cycles
  if (query.includes('cycle') || query.includes('circular')) {
    const cycles = findCycles(graph);
    return { query, type: 'cycles', data: cycles, text: formatCycles(cycles) };
  }

  // Hotspots
  if (query.includes('hotspot') || query.includes('coupling') || query.includes('fan-in')) {
    const hotspots = findHotspots(graph);
    return { query, type: 'hotspots', data: hotspots, text: formatHotspots(hotspots) };
  }

  // Dead exports
  if (query.includes('dead') || query.includes('unused')) {
    const dead = findDeadExports(analyses, graph);
    return { query, type: 'dead', data: dead, text: formatDeadExports(dead) };
  }

  // What connects X to Y
  const { from, to } = extractTerms(query);
  if (from && to) {
    const fromFile = findFile(graph, from);
    const toFile = findFile(graph, to);
    if (!fromFile) return { query, type: 'error', data: null, text: `Could not find file matching "${from}"\n` };
    if (!toFile) return { query, type: 'error', data: null, text: `Could not find file matching "${to}"\n` };

    const paths = findAllPaths(graph, fromFile, toFile);
    if (paths.length === 0) {
      // Try reverse
      const reversePaths = findAllPaths(graph, toFile, fromFile);
      if (reversePaths.length === 0) {
        return { query, type: 'path', data: { from: fromFile, to: toFile, paths: [] }, text: `No path found between ${fromFile} and ${toFile}\n` };
      }
      const lines = [`Path (reverse): ${fromFile} ← ${toFile}\n`];
      for (const p of reversePaths.slice(0, 5)) {
        lines.push(`  ${p.join(' → ')}`);
      }
      return { query, type: 'path', data: { from: fromFile, to: toFile, paths: reversePaths }, text: lines.join('\n') + '\n' };
    }

    const lines = [`Path: ${fromFile} → ${toFile} (${paths.length} route(s))\n`];
    for (const p of paths.slice(0, 5)) {
      lines.push(`  ${p.join(' → ')}`);
    }
    if (paths.length > 5) lines.push(`  ... and ${paths.length - 5} more`);
    return { query, type: 'path', data: { from: fromFile, to: toFile, paths }, text: lines.join('\n') + '\n' };
  }

  // Who imports X
  if (query.includes('who imports') || query.includes('importers')) {
    const term = query.replace(/who\s+imports?\s*/i, '').replace(/importers?\s*/i, '').trim();
    const file = findFile(graph, term);
    if (!file) return { query, type: 'error', data: null, text: `Could not find file matching "${term}"\n` };
    const importers = findImporters(graph, file);
    const lines = [`Files that import ${file} (${importers.length}):\n`];
    for (const f of importers) lines.push(`  ← ${f}`);
    return { query, type: 'importers', data: { file, importers }, text: lines.join('\n') + '\n' };
  }

  // What does X import
  if (query.includes('what does') && query.includes('import')) {
    const term = query.replace(/what\s+does\s+/i, '').replace(/\s+imports?/i, '').trim();
    const file = findFile(graph, term);
    if (!file) return { query, type: 'error', data: null, text: `Could not find file matching "${term}"\n` };
    const deps = findImports(graph, file);
    const lines = [`${file} imports (${deps.length}):\n`];
    for (const d of deps) lines.push(`  → ${d.file}  (${d.imports.join(', ')})`);
    return { query, type: 'imports', data: { file, deps }, text: lines.join('\n') + '\n' };
  }

  // What depends on X (transitive)
  if (query.includes('depends on') || query.includes('dependents')) {
    const term = query.replace(/what\s+depends\s+on\s+/i, '').replace(/dependents?\s*/i, '').trim();
    const file = findFile(graph, term);
    if (!file) return { query, type: 'error', data: null, text: `Could not find file matching "${term}"\n` };
    const dependents = findTransitiveDependents(graph, file);
    const lines = [`Transitive dependents of ${file} (${dependents.length}):\n`];
    for (const f of dependents) lines.push(`  ← ${f}`);
    return { query, type: 'dependents', data: { file, dependents }, text: lines.join('\n') + '\n' };
  }

  // What does X depend on (transitive)
  if (query.includes('depend on') || query.includes('dependencies')) {
    const term = query.replace(/what\s+does\s+/i, '').replace(/\s+depend\s+on/i, '').replace(/dependencies?\s*/i, '').trim();
    const file = findFile(graph, term);
    if (!file) return { query, type: 'error', data: null, text: `Could not find file matching "${term}"\n` };
    const deps = findTransitiveDependencies(graph, file);
    const lines = [`Transitive dependencies of ${file} (${deps.length}):\n`];
    for (const f of deps) lines.push(`  → ${f}`);
    return { query, type: 'dependencies', data: { file, deps }, text: lines.join('\n') + '\n' };
  }

  return {
    query,
    type: 'unknown',
    data: null,
    text: `Could not parse query: "${query}"\n\nTry:\n  omm query "what connects X to Y"\n  omm query "who imports X"\n  omm query "cycles"\n  omm query "hotspots"\n`,
  };
}

// ─── Command entry ───────────────────────────────────────────────────────────

export async function commandQuery(args: string[]): Promise<void> {
  const parsed = parseArgs(args);

  if (parsed.help || !parsed.query) {
    process.stdout.write(HELP.trim() + '\n');
    return;
  }

  const dir = path.resolve(parsed.dir);
  if (!fs.existsSync(dir)) {
    process.stderr.write(`error: directory not found: ${dir}\n`);
    process.exit(1);
  }

  process.stderr.write(`Analyzing ${dir}...\n`);
  const result = await analyzeDirectory(dir);

  const queryResult = executeQuery(result.graph, parsed.query, result.files);

  if (parsed.json) {
    process.stdout.write(JSON.stringify({ query: queryResult.query, type: queryResult.type, data: queryResult.data }, null, 2) + '\n');
  } else {
    process.stdout.write(queryResult.text);
  }
}
