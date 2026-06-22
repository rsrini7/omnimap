import fs from 'node:fs';
import path from 'node:path';
import { getHandlerForFile, getSupportedExtensions } from './registry.js';
import { extractRoutes } from './routes.js';
import type { FileAnalysis, DependencyGraph, DependencyNode, DependencyEdge, ModuleBoundary, AnalysisResult } from './types.js';

export type { FileAnalysis, DependencyGraph, DependencyNode, DependencyEdge, ModuleBoundary, AnalysisResult } from './types.js';

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.nuxt',
  '__pycache__', '.pytest_cache', '.venv', 'venv', 'env',
  'target', 'bin', 'obj', '.gradle', '.maven',
  '.omm', '.understand-anything', 'graphify-out',
]);

const IGNORED_PATTERNS = [
  /\.min\./,
  /\.bundle\./,
  /\.chunk\./,
  /\.d\.ts$/,
  /\.d\.mts$/,
];

function shouldIgnore(filePath: string): boolean {
  const parts = filePath.split('/');
  for (const part of parts) {
    if (IGNORED_DIRS.has(part)) return true;
  }
  for (const pattern of IGNORED_PATTERNS) {
    if (pattern.test(filePath)) return true;
  }
  return false;
}

function walkFiles(dir: string, rootDir: string, extensions: Set<string>): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(rootDir, fullPath).replace(/\\/g, '/');

    if (entry.isDirectory()) {
      if (!shouldIgnore(relPath)) {
        results.push(...walkFiles(fullPath, rootDir, extensions));
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (extensions.has(ext) && !shouldIgnore(relPath)) {
        results.push(fullPath);
      }
    }
  }

  return results;
}

let parserCache: Map<string, any> = new Map();

const LANG_LOADERS: Record<string, () => Promise<any>> = {
  javascript: () => import('./languages/javascript.js'),
  typescript: () => import('./languages/typescript.js'),
  java: () => import('./languages/java.js'),
  kotlin: () => import('./languages/kotlin.js'),
  scala: () => import('./languages/scala.js'),
  python: () => import('./languages/python.js'),
  go: () => import('./languages/go.js'),
  rust: () => import('./languages/rust.js'),
};

async function getParserForFile(filePath: string): Promise<any> {
  const ext = path.extname(filePath);
  if (parserCache.has(ext)) return parserCache.get(ext);

  const handler = getHandlerForFile(filePath);
  if (!handler) return null;

  const loader = LANG_LOADERS[handler.name];
  if (!loader) return null;

  try {
    const langModule = await loader();
    const parser = await langModule.ensureParser?.();
    if (parser) parserCache.set(ext, parser);
    return parser;
  } catch {
    return null;
  }
}

export async function analyzeFile(filePath: string, rootDir: string): Promise<FileAnalysis | null> {
  const handler = getHandlerForFile(filePath);
  if (!handler) return null;

  const relPath = path.relative(rootDir, filePath).replace(/\\/g, '/');
  const source = fs.readFileSync(filePath, 'utf-8');

  const parser = await getParserForFile(filePath);
  if (!parser) {
    return { file: relPath, language: handler.name, imports: [], exports: [], definitions: [], calls: [], error: 'parser not available' };
  }

  try {
    const tree = parser.parse(source).rootNode;
    return {
      file: relPath,
      language: handler.name,
      imports: handler.extractImports(tree, source, relPath),
      exports: handler.extractExports(tree, source),
      definitions: handler.extractDefinitions(tree, source),
      calls: handler.extractCalls(tree, source),
      routes: extractRoutes(tree, source, relPath),
    };
  } catch (err: any) {
    return { file: relPath, language: handler.name, imports: [], exports: [], definitions: [], calls: [], routes: [], error: err.message };
  }
}

export async function analyzeDirectory(dir: string): Promise<AnalysisResult> {
  const rootDir = path.resolve(dir);
  const extensions = new Set(getSupportedExtensions());
  const files = walkFiles(rootDir, rootDir, extensions);

  const analyses: FileAnalysis[] = [];
  const errors: { file: string; error: string }[] = [];
  const languageCounts: Record<string, number> = {};

  for (const file of files) {
    try {
      const analysis = await analyzeFile(file, rootDir);
      if (analysis) {
        analyses.push(analysis);
        languageCounts[analysis.language] = (languageCounts[analysis.language] || 0) + 1;
        if (analysis.error) errors.push({ file: analysis.file, error: analysis.error });
      }
    } catch (err: any) {
      errors.push({ file: path.relative(rootDir, file).replace(/\\/g, '/'), error: err.message });
    }
  }

  const graph = buildDependencyGraph(analyses);
  const modules = detectModuleBoundaries(graph, analyses);

  return {
    files: analyses,
    graph,
    modules,
    errors,
    stats: {
      totalFiles: files.length,
      analyzedFiles: analyses.filter(a => !a.error).length,
      skippedFiles: files.length - analyses.length,
      errorFiles: errors.length,
      languages: languageCounts,
    },
  };
}

export function buildDependencyGraph(analyses: FileAnalysis[]): DependencyGraph {
  const nodes: DependencyNode[] = [];
  const edges: DependencyEdge[] = [];
  const fileMap = new Map<string, FileAnalysis>();

  for (const a of analyses) {
    fileMap.set(a.file, a);
    nodes.push({
      id: a.file,
      file: a.file,
      exports: a.exports.map(e => e.name),
    });
  }

  const fileByModule = new Map<string, string>();
  for (const a of analyses) {
    const stem = a.file.replace(/\.[^.]+$/, '');
    fileByModule.set(stem, a.file);
    // Only register actual index.* files under the parent directory key
    const fileName = stem.split('/').pop();
    if (fileName === 'index' || fileName === 'main') {
      const parentStem = stem.split('/').slice(0, -1).join('/');
      if (parentStem) fileByModule.set(parentStem, a.file);
    }
  }

  const edgeIndex = new Map<string, DependencyEdge>();

  for (const a of analyses) {
    for (const imp of a.imports) {
      let targetFile: string | undefined;

      if (imp.source.startsWith('.')) {
        const resolved = imp.resolved || imp.source;
        const allExts = getSupportedExtensions();
        let stem = resolved;
        const lastDot = resolved.lastIndexOf('.');
        if (lastDot !== -1 && lastDot > resolved.lastIndexOf('/')) {
          const ext = resolved.slice(lastDot);
          if (['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts', ...allExts].includes(ext)) {
            stem = resolved.slice(0, lastDot);
          }
        }
        const candidates = [stem, `${stem}/index`];
        for (const ext of allExts) {
          candidates.push(`${stem}${ext}`);
        }
        for (const c of candidates) {
          if (fileMap.has(c) || fileByModule.has(c)) {
            targetFile = fileMap.has(c) ? c : fileByModule.get(c);
            break;
          }
        }
      }

      if (targetFile && targetFile !== a.file) {
        const key = `${a.file}\0${targetFile}`;
        const existing = edgeIndex.get(key);
        if (existing) {
          existing.imports.push(...imp.specifiers);
        } else {
          const edge = { from: a.file, to: targetFile, imports: [...imp.specifiers] };
          edgeIndex.set(key, edge);
          edges.push(edge);
        }
      }
    }
  }

  return { nodes, edges };
}

export function detectModuleBoundaries(graph: DependencyGraph, analyses: FileAnalysis[]): ModuleBoundary[] {
  const dirMap = new Map<string, { files: Set<string>; internal: number; external: number }>();

  for (const node of graph.nodes) {
    const dir = node.file.includes('/') ? node.file.slice(0, node.file.lastIndexOf('/')) : '.';
    if (!dirMap.has(dir)) dirMap.set(dir, { files: new Set(), internal: 0, external: 0 });
    dirMap.get(dir)!.files.add(node.file);
  }

  for (const edge of graph.edges) {
    const fromDir = edge.from.includes('/') ? edge.from.slice(0, edge.from.lastIndexOf('/')) : '.';
    const toDir = edge.to.includes('/') ? edge.to.slice(0, edge.to.lastIndexOf('/')) : '.';
    const fromModule = dirMap.get(fromDir);
    if (fromDir === toDir) {
      if (fromModule) fromModule.internal++;
    } else {
      if (fromModule) fromModule.external++;
    }
  }

  const modules: ModuleBoundary[] = [];
  for (const [dir, info] of dirMap) {
    if (info.files.size < 2) continue;
    const total = info.internal + info.external;
    const cohesion = total > 0 ? info.internal / total : 0;
    const name = dir.split('/').pop() || dir;
    const entryPoints = analyses
      .filter(a => info.files.has(a.file) && a.exports.some(e => e.kind === 'function' || e.kind === 'class'))
      .map(a => a.file);
    const dependencies = graph.edges
      .filter(e => info.files.has(e.from) && !info.files.has(e.to))
      .map(e => e.to)
      .filter((v, i, a) => a.indexOf(v) === i);

    modules.push({
      name,
      files: [...info.files],
      entryPoints,
      dependencies,
      internalEdges: info.internal,
      externalEdges: info.external,
      cohesion: Math.round(cohesion * 100) / 100,
    });
  }

  return modules.sort((a, b) => b.files.length - a.files.length);
}

export function formatAnalysisMarkdown(result: AnalysisResult): string {
  const lines: string[] = [];

  lines.push('## Codebase Analysis');
  lines.push('');
  lines.push(`**Files analyzed:** ${result.stats.analyzedFiles} / ${result.stats.totalFiles}`);
  lines.push(`**Languages:** ${Object.entries(result.stats.languages).map(([l, c]) => `${l} (${c})`).join(', ')}`);
  if (result.stats.errorFiles > 0) {
    lines.push(`**Errors:** ${result.stats.errorFiles} files failed to parse`);
  }
  lines.push('');

  if (result.graph.edges.length > 0) {
    lines.push('### Dependency Graph');
    lines.push('');
    const bySource = new Map<string, typeof result.graph.edges>();
    for (const edge of result.graph.edges) {
      if (!bySource.has(edge.from)) bySource.set(edge.from, []);
      bySource.get(edge.from)!.push(edge);
    }
    for (const [from, edges] of bySource) {
      lines.push(`**${from}**`);
      for (const edge of edges) {
        const imports = edge.imports.length > 0 ? ` → ${edge.imports.join(', ')}` : '';
        lines.push(`  → ${edge.to}${imports}`);
      }
    }
    lines.push('');
  }

  if (result.modules.length > 0) {
    lines.push('### Module Boundaries');
    lines.push('');
    for (const mod of result.modules.slice(0, 20)) {
      lines.push(`**${mod.name}** (${mod.files.length} files, cohesion: ${Math.round(mod.cohesion * 100)}%)`);
      if (mod.entryPoints.length > 0) lines.push(`  Entry: ${mod.entryPoints.join(', ')}`);
      if (mod.dependencies.length > 0) lines.push(`  Depends on: ${mod.dependencies.join(', ')}`);
    }
    lines.push('');
  }

  const allDefs = result.files.flatMap(f => f.definitions.filter(d => d.exported).map(d => ({ ...d, file: f.file })));
  if (allDefs.length > 0) {
    lines.push('### Public API Surface');
    lines.push('');
    const byKind = new Map<string, typeof allDefs>();
    for (const d of allDefs) {
      if (!byKind.has(d.kind)) byKind.set(d.kind, []);
      byKind.get(d.kind)!.push(d);
    }
    for (const [kind, defs] of byKind) {
      lines.push(`**${kind}s:** ${defs.map(d => `${d.name} (${d.file})`).join(', ')}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function formatAnalysisJSON(result: AnalysisResult): string {
  return JSON.stringify(result, null, 2);
}

export { getSupportedExtensions } from './registry.js';
