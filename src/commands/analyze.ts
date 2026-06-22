import path from 'node:path';
import fs from 'node:fs';
import { analyzeDirectory, formatAnalysisMarkdown, formatAnalysisJSON, getSupportedExtensions } from '../lib/analyzer/index.js';
import { parseMermaid } from '../lib/diff.js';
import { getOmmDir } from '../lib/store.js';

// Import language handlers to trigger self-registration in the registry
import '../lib/analyzer/languages/javascript.js';
import '../lib/analyzer/languages/typescript.js';
import '../lib/analyzer/languages/java.js';
import '../lib/analyzer/languages/kotlin.js';
import '../lib/analyzer/languages/scala.js';
import '../lib/analyzer/languages/python.js';
import '../lib/analyzer/languages/go.js';
import '../lib/analyzer/languages/rust.js';

import {
  findCycles, findHotspots, findDeadExports, findLayerViolations,
  computeFitness, findComplexHotspots, previewChangeImpact,
  formatCycles, formatHotspots, formatDeadExports, formatLayerViolations,
  formatFitness, formatComplexHotspots, formatImpactPreview,
  findGodNodes, formatGodNodes, detectCommunities, formatCommunities,
  generateTour, formatTour, formatLayerSummary,
} from '../lib/analyzer/insights.js';
import { extractRoutes, formatRoutes } from '../lib/analyzer/routes.js';


const HELP = `
omm analyze [dir] [options]

Analyze codebase structure using tree-sitter AST parsing.
Deterministic, fast, and free (no API calls for code analysis).

Usage:
  omm analyze                        Analyze current directory
  omm analyze src/                   Analyze specific directory
  omm analyze --format md            Output as markdown (default)
  omm analyze --format json          Output as JSON
  omm analyze --diagram              Auto-generate Mermaid dependency diagram
  omm analyze --validate             Compare .omm/ docs vs actual structure
  omm analyze --impact <file>             Show change impact for a file
  omm analyze --routes                    Extract framework routes (Express, Django, Spring, etc.)
  omm analyze --extensions                Show supported file extensions

Insights (included in --format md):
  - Circular dependency detection
  - Coupling hotspots (fan-in analysis)
  - Dead export detection
  - Layer violation detection
  - Architectural fitness score (0-100)
  - Complexity hotspots (>50 line definitions)

Supported languages:
  JavaScript (.js, .jsx, .mjs, .cjs)
  TypeScript (.ts, .tsx, .mts, .cts)
  Java (.java)
  Kotlin (.kt, .kts)
  Scala (.scala, .sc)
  Python (.py, .pyw, .pyi)
  Go (.go)
  Rust (.rs)

Examples:
  omm analyze --format md            # Markdown summary with insights
  omm analyze --format json | jq     # JSON for programmatic use
  omm analyze --diagram              # Generate Mermaid from import graph
  omm analyze --validate             # Check docs match reality
  omm analyze --impact src/auth.ts   # Show change impact for a file
`;

interface ParsedArgs {
  dir: string;
  format: 'md' | 'json';
  diagram: boolean;
  validate: boolean;
  extensions: boolean;
  help: boolean;
  impact: string | undefined;
  routes: boolean;
}

function parseArgs(args: string[]): ParsedArgs {
  const out: ParsedArgs = { dir: '.', format: 'md', diagram: false, validate: false, extensions: false, help: false, impact: undefined, routes: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--format' && args[i + 1]) {
      const fmt = args[++i];
      if (fmt === 'json' || fmt === 'md') out.format = fmt;
    }
    else if (a === '--diagram') out.diagram = true;
    else if (a === '--validate') out.validate = true;
    else if (a === '--extensions') out.extensions = true;
    else if (a === '--impact' && args[i + 1]) out.impact = args[++i];
    else if (a === '--routes') out.routes = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (!a.startsWith('--')) out.dir = a;
  }
  return out;
}

function generateMermaidDiagram(result: Awaited<ReturnType<typeof analyzeDirectory>>): string {
  const lines: string[] = [];
  lines.push('```mermaid');
  lines.push('graph LR');

  const nodeIds = new Map<string, string>();
  let nodeIdx = 0;

  for (const node of result.graph.nodes) {
    if (result.graph.edges.some(e => e.from === node.file || e.to === node.file)) {
      const id = `n${nodeIdx++}`;
      const label = node.file.split('/').pop()?.replace(/\.[^.]+$/, '') || node.file;
      nodeIds.set(node.file, id);
      lines.push(`    ${id}["${label}\\n${node.file}"]`);
    }
  }

  for (const edge of result.graph.edges) {
    const fromId = nodeIds.get(edge.from);
    const toId = nodeIds.get(edge.to);
    if (fromId && toId) {
      const label = edge.imports.length > 0 ? edge.imports.slice(0, 3).join(', ') : 'imports';
      lines.push(`    ${fromId} -->|"${label}"| ${toId}`);
    }
  }

  lines.push('```');
  return lines.join('\n');
}

function validateAgainstDocs(result: Awaited<ReturnType<typeof analyzeDirectory>>): string {
  const ommDir = getOmmDir();
  if (!ommDir) {
    return 'No .omm/ directory found. Run `omm init` first.';
  }

  const lines: string[] = [];
  lines.push('## Architecture Validation');
  lines.push('');
  lines.push('Comparing documented architecture (.omm/) vs actual code structure.');
  lines.push('');

  const diagramFiles: { element: string; file: string; content: string }[] = [];

  function walkOmm(dir: string, rel: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'diagram.mmd') {
        const fullPath = path.join(dir, entry.name);
        diagramFiles.push({ element: rel, file: fullPath, content: fs.readFileSync(fullPath, 'utf-8') });
      } else if (entry.isDirectory()) {
        walkOmm(path.join(dir, entry.name), rel ? `${rel}/${entry.name}` : entry.name);
      }
    }
  }

  walkOmm(ommDir, '');

  const documentedDeps = new Set<string>();
  for (const df of diagramFiles) {
    const parsed = parseMermaid(df.content);
    if (parsed?.edges) {
      for (const edge of parsed.edges) {
        documentedDeps.add(edge);
      }
    }
  }

  const actualDeps = new Set<string>();
  for (const edge of result.graph.edges) {
    const from = edge.from.split('/').pop()?.replace(/\.[^.]+$/, '') || edge.from;
    const to = edge.to.split('/').pop()?.replace(/\.[^.]+$/, '') || edge.to;
    actualDeps.add(`${from} --> ${to}`);
  }

  const missingDocs: string[] = [];

  for (const dep of actualDeps) {
    const [depFrom, depTo] = dep.split(' --> ');
    let found = false;
    for (const docDep of documentedDeps) {
      const docParts = docDep.split(/[\s]*-->[\s]*/);
      const docFrom = docParts[0]?.replace(/["'\[\](){}]/g, '').split('\\n')[0].trim();
      const docTo = docParts[1]?.replace(/["'\[\](){}]/g, '').split('\\n')[0].trim();
      if (docFrom === depFrom && docTo === depTo) {
        found = true;
        break;
      }
    }
    if (!found) missingDocs.push(dep);
  }

  lines.push(`Documented edges: ${documentedDeps.size}`);
  lines.push(`Actual edges: ${actualDeps.size}`);
  lines.push(`Missing from docs: ${missingDocs.length}`);
  lines.push('');

  if (missingDocs.length > 0) {
    lines.push('### Undocumented Dependencies');
    lines.push('');
    for (const dep of missingDocs.slice(0, 20)) {
      lines.push(`  - ${dep}`);
    }
    if (missingDocs.length > 20) {
      lines.push(`  ... and ${missingDocs.length - 20} more`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export async function commandAnalyze(args: string[]): Promise<void> {
  const parsed = parseArgs(args);

  if (parsed.help) {
    process.stdout.write(HELP.trim() + '\n');
    return;
  }

  if (parsed.extensions) {
    const exts = getSupportedExtensions();
    process.stdout.write(`Supported extensions (${exts.length}):\n  ${exts.join(', ')}\n`);
    return;
  }

  const dir = path.resolve(parsed.dir);
  if (!fs.existsSync(dir)) {
    process.stderr.write(`error: directory not found: ${dir}\n`);
    process.exit(1);
  }

  process.stderr.write(`Analyzing ${dir}...\n`);
  const result = await analyzeDirectory(dir);

  // Log the run to .omm/analyze.log
  try {
    const ommDir = getOmmDir();
    if (ommDir) {
      const logPath = path.join(ommDir, 'analyze.log');
      const ts = new Date().toISOString();
      const langs = Object.entries(result.stats.languages).map(([l, c]) => `${l}:${c}`).join(' ');
      const line = `${ts}  files=${result.stats.analyzedFiles}/${result.stats.totalFiles}  errors=${result.stats.errorFiles}  edges=${result.graph.edges.length}  modules=${result.modules.length}  langs=[${langs}]\n`;
      fs.appendFileSync(logPath, line, 'utf-8');
    }
  } catch {
    // non-critical, ignore
  }

  if (parsed.diagram) {
    const mermaid = generateMermaidDiagram(result);
    process.stdout.write(mermaid + '\n');
    return;
  }

  if (parsed.validate) {
    const report = validateAgainstDocs(result);
    process.stdout.write(report + '\n');
    return;
  }

  if (parsed.impact) {
    const impact = previewChangeImpact(result.graph, parsed.impact);
    process.stdout.write(formatImpactPreview(impact));
    return;
  }

  if (parsed.format === 'json') {
    process.stdout.write(formatAnalysisJSON(result) + '\n');
  } else {
    process.stdout.write(formatAnalysisMarkdown(result));

    if (parsed.routes) {
      const allRoutes = result.files.flatMap(f => f.routes || []);
      process.stdout.write(formatRoutes(allRoutes));
    }

    // Append insights
    const cycles = findCycles(result.graph);
    const hotspots = findHotspots(result.graph);
    const deadExports = findDeadExports(result.files, result.graph);
    const violations = findLayerViolations(result.graph);
    const complexHotspots = findComplexHotspots(result.files);

    // Compute undocumented deps for fitness
    const ommDir = getOmmDir();
    let undocumentedDeps = 0;
    if (ommDir) {
      const valReport = validateAgainstDocs(result);
      const match = valReport.match(/Missing from docs: (\d+)/);
      if (match) undocumentedDeps = parseInt(match[1], 10);
    }

    const fitness = computeFitness(result, cycles, hotspots, violations, undocumentedDeps);

    process.stdout.write('---\n\n## Architecture Insights\n\n');
    process.stdout.write(formatFitness(fitness));
    process.stdout.write(formatCycles(cycles));
    process.stdout.write(formatGodNodes(findGodNodes(result.graph)));
    process.stdout.write(formatCommunities(detectCommunities(result.graph)));
    process.stdout.write(formatLayerSummary(result.graph));
    process.stdout.write(formatHotspots(hotspots));
    process.stdout.write(formatDeadExports(deadExports));
    process.stdout.write(formatLayerViolations(violations));
    process.stdout.write(formatComplexHotspots(complexHotspots));
    process.stdout.write(formatTour(generateTour(result.graph)));
  }
}
