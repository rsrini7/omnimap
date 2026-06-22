import type { AnalysisResult, DependencyGraph, DependencyEdge, FileAnalysis, ModuleBoundary } from './types.js';

// ─── #1 Circular Dependency Detection ─────────────────────────────────────────

export interface Cycle {
  files: string[];
  length: number;
}

/**
 * Find all import cycles using DFS with gray/black marking.
 * Returns cycles as arrays of file paths (each starts with the lexicographically smallest file).
 */
export function findCycles(graph: DependencyGraph): Cycle[] {
  const adj = new Map<string, string[]>();
  for (const node of graph.nodes) adj.set(node.file, []);
  for (const edge of graph.edges) {
    adj.get(edge.from)?.push(edge.to);
  }

  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const parent = new Map<string, string | null>();
  const cycles: Cycle[] = [];

  for (const node of adj.keys()) color.set(node, WHITE);

  function dfs(u: string): void {
    color.set(u, GRAY);
    for (const v of adj.get(u) || []) {
      if (color.get(v) === GRAY) {
        // Found a cycle — reconstruct
        const cycle: string[] = [v];
        let cur = u;
        while (cur !== v) {
          cycle.push(cur);
          cur = parent.get(cur) || '';
          if (!cur) break;
        }
        cycle.reverse();
        // Normalize: start with lexicographically smallest
        const minIdx = cycle.indexOf([...cycle].sort()[0]);
        const normalized = [...cycle.slice(minIdx), ...cycle.slice(0, minIdx)];
        cycles.push({ files: normalized, length: normalized.length });
      } else if (color.get(v) === WHITE) {
        parent.set(v, u);
        dfs(v);
      }
    }
    color.set(u, BLACK);
  }

  for (const node of adj.keys()) {
    if (color.get(node) === WHITE) dfs(node);
  }

  // Deduplicate cycles (same set of files)
  const seen = new Set<string>();
  return cycles.filter(c => {
    const key = c.files.slice().sort().join('\0');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => a.length - b.length);
}

// ─── #2 Hotspot Files (Fan-in Analysis) ───────────────────────────────────────

export interface Hotspot {
  file: string;
  fanIn: number;       // how many files import this
  fanOut: number;      // how many files this imports
  importers: string[];
}

/**
 * Rank files by incoming edge count (fan-in).
 * High fan-in = high coupling risk.
 */
export function findHotspots(graph: DependencyGraph, topN: number = 20): Hotspot[] {
  const fanIn = new Map<string, string[]>();
  const fanOut = new Map<string, string[]>();

  for (const node of graph.nodes) {
    fanIn.set(node.file, []);
    fanOut.set(node.file, []);
  }

  for (const edge of graph.edges) {
    fanIn.get(edge.to)?.push(edge.from);
    fanOut.get(edge.from)?.push(edge.to);
  }

  const hotspots: Hotspot[] = [];
  for (const node of graph.nodes) {
    const importers = fanIn.get(node.file) || [];
    if (importers.length > 0) {
      hotspots.push({
        file: node.file,
        fanIn: importers.length,
        fanOut: (fanOut.get(node.file) || []).length,
        importers,
      });
    }
  }

  return hotspots.sort((a, b) => b.fanIn - a.fanIn).slice(0, topN);
}

// ─── #3 Dead Exports ──────────────────────────────────────────────────────────

export interface DeadExport {
  file: string;
  name: string;
  kind: string;
}

/**
 * Find exports that no other file imports.
 */
export function findDeadExports(analyses: FileAnalysis[], graph: DependencyGraph): DeadExport[] {
  // Collect all imported specifiers per target file
  const importedNames = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    if (!importedNames.has(edge.to)) importedNames.set(edge.to, new Set());
    const names = importedNames.get(edge.to)!;
    for (const name of edge.imports) names.add(name);
  }

  const dead: DeadExport[] = [];
  for (const a of analyses) {
    const imported = importedNames.get(a.file);
    for (const exp of a.exports) {
      // If the export has a specific name and it's not imported anywhere
      if (exp.name !== 'default' && (!imported || !imported.has(exp.name))) {
        dead.push({ file: a.file, name: exp.name, kind: exp.kind });
      }
    }
  }

  return dead.sort((a, b) => a.file.localeCompare(b.file));
}

// ─── #4 Layer Violation Detection ─────────────────────────────────────────────

export interface LayerViolation {
  from: string;
  to: string;
  fromLayer: string;
  toLayer: string;
  skippedLayers: string[];
}

const DEFAULT_LAYERS = [
  { name: 'ui', patterns: ['renderer', 'components', 'views', 'pages', 'ui', 'frontend', 'client'] },
  { name: 'api', patterns: ['api', 'routes', 'controllers', 'handlers', 'server'] },
  { name: 'service', patterns: ['services', 'service', 'business', 'logic', 'use-cases'] },
  { name: 'data', patterns: ['data', 'db', 'database', 'repository', 'repos', 'models', 'store', 'dao'] },
  { name: 'infra', patterns: ['infra', 'infrastructure', 'utils', 'helpers', 'lib', 'common', 'shared'] },
];

function detectLayer(filePath: string, layers: typeof DEFAULT_LAYERS): string | null {
  const lower = filePath.toLowerCase();
  for (const layer of layers) {
    for (const pattern of layer.patterns) {
      if (lower.includes(pattern)) return layer.name;
    }
  }
  return null;
}

/**
 * Detect edges that skip architectural layers.
 * E.g., ui → data (skipping service and api).
 */
export function findLayerViolations(
  graph: DependencyGraph,
  layers: typeof DEFAULT_LAYERS = DEFAULT_LAYERS,
): LayerViolation[] {
  const layerOrder = layers.map(l => l.name);
  const violations: LayerViolation[] = [];

  for (const edge of graph.edges) {
    const fromLayer = detectLayer(edge.from, layers);
    const toLayer = detectLayer(edge.to, layers);
    if (!fromLayer || !toLayer || fromLayer === toLayer) continue;

    const fromIdx = layerOrder.indexOf(fromLayer);
    const toIdx = layerOrder.indexOf(toLayer);
    if (fromIdx < 0 || toIdx < 0) continue;

    // Violation: skipping layers downward (e.g., ui→data, ui→infra)
    if (toIdx > fromIdx + 1) {
      const skipped = layerOrder.slice(fromIdx + 1, toIdx);
      violations.push({ from: edge.from, to: edge.to, fromLayer, toLayer, skippedLayers: skipped });
    }
  }

  return violations.sort((a, b) => a.skippedLayers.length - b.skippedLayers.length);
}

// ─── #5 Architectural Fitness Score ────────────────────────────────────────────

export interface FitnessScore {
  overall: number;       // 0-100
  circularDeps: number;  // 0-20
  cohesion: number;      // 0-20
  coupling: number;      // 0-20
  layerViolations: number; // 0-20
  docAccuracy: number;   // 0-20
  breakdown: {
    cyclesFound: number;
    avgCohesion: number;
    maxFanIn: number;
    layerViolationsCount: number;
    undocumentedDeps: number;
  };
}

/**
 * Compute an architectural fitness score (0-100).
 */
export function computeFitness(
  result: AnalysisResult,
  cycles: Cycle[],
  hotspots: Hotspot[],
  violations: LayerViolation[],
  undocumentedDeps: number,
): FitnessScore {
  // Circular deps: 20 if 0 cycles, penalize proportionally
  const circularDeps = Math.max(0, 20 - cycles.length * 2);

  // Cohesion: average module cohesion × 20
  const avgCohesion = result.modules.length > 0
    ? result.modules.reduce((sum, m) => sum + m.cohesion, 0) / result.modules.length
    : 1;
  const cohesion = Math.round(avgCohesion * 20);

  // Coupling: 20 if max fan-in ≤ 5, penalize above
  const maxFanIn = hotspots.length > 0 ? hotspots[0].fanIn : 0;
  const coupling = Math.max(0, 20 - Math.max(0, maxFanIn - 5) * 2);

  // Layer violations: 20 if 0, penalize
  const layerViolations = Math.max(0, 20 - violations.length);

  // Doc accuracy: 20 if 0 undocumented deps, penalize
  const docAccuracy = Math.max(0, 20 - undocumentedDeps);

  const overall = circularDeps + cohesion + coupling + layerViolations + docAccuracy;

  return {
    overall: Math.min(100, Math.max(0, overall)),
    circularDeps,
    cohesion,
    coupling,
    layerViolations,
    docAccuracy,
    breakdown: {
      cyclesFound: cycles.length,
      avgCohesion: Math.round(avgCohesion * 100),
      maxFanIn,
      layerViolationsCount: violations.length,
      undocumentedDeps,
    },
  };
}

// ─── #6 Complexity Hotspots ────────────────────────────────────────────────────

export interface ComplexDefinition {
  file: string;
  name: string;
  kind: string;
  lineSpan: number;
  line: number;
  endLine: number;
}

/**
 * Find definitions that are unusually long (>50 lines).
 */
export function findComplexHotspots(analyses: FileAnalysis[], threshold: number = 50): ComplexDefinition[] {
  const hotspots: ComplexDefinition[] = [];

  for (const a of analyses) {
    for (const def of a.definitions) {
      const span = def.endLine - def.line;
      if (span >= threshold) {
        hotspots.push({
          file: a.file,
          name: def.name,
          kind: def.kind,
          lineSpan: span,
          line: def.line,
          endLine: def.endLine,
        });
      }
    }
  }

  return hotspots.sort((a, b) => b.lineSpan - a.lineSpan);
}

// ─── #7 Change Impact Preview ─────────────────────────────────────────────────

export interface ImpactResult {
  targetFile: string;
  directImpact: string[];   // files that import this directly
  transitiveImpact: string[]; // files affected transitively
  impactDepth: number;
  totalAffected: number;
}

/**
 * Given a file, find all files affected by changes to it
 * (reverse dependency graph traversal).
 */
export function previewChangeImpact(graph: DependencyGraph, targetFile: string): ImpactResult {
  // Build reverse adjacency
  const reverseAdj = new Map<string, string[]>();
  for (const node of graph.nodes) reverseAdj.set(node.file, []);
  for (const edge of graph.edges) {
    reverseAdj.get(edge.to)?.push(edge.from);
  }

  // BFS from target
  const visited = new Set<string>();
  const queue: { file: string; depth: number }[] = [{ file: targetFile, depth: 0 }];
  const depths = new Map<string, number>();
  let maxDepth = 0;

  while (queue.length > 0) {
    const { file, depth } = queue.shift()!;
    if (visited.has(file)) continue;
    visited.add(file);
    depths.set(file, depth);
    maxDepth = Math.max(maxDepth, depth);

    for (const importer of reverseAdj.get(file) || []) {
      if (!visited.has(importer)) {
        queue.push({ file: importer, depth: depth + 1 });
      }
    }
  }

  visited.delete(targetFile);
  const directImpact = (reverseAdj.get(targetFile) || []).filter(f => visited.has(f));
  const transitiveImpact = [...visited].filter(f => !directImpact.includes(f));

  return {
    targetFile,
    directImpact: directImpact.sort(),
    transitiveImpact: transitiveImpact.sort(),
    impactDepth: maxDepth,
    totalAffected: visited.size,
  };
}

// ─── Formatting ───────────────────────────────────────────────────────────────

export function formatCycles(cycles: Cycle[]): string {
  if (cycles.length === 0) return 'No circular dependencies found.\n';
  const lines: string[] = [];
  lines.push(`### Circular Dependencies (${cycles.length} found)\n`);
  for (const cycle of cycles.slice(0, 20)) {
    lines.push(`  ${cycle.files.join(' → ')} → ${cycle.files[0]}`);
  }
  if (cycles.length > 20) lines.push(`  ... and ${cycles.length - 20} more`);
  lines.push('');
  return lines.join('\n');
}

export function formatHotspots(hotspots: Hotspot[]): string {
  if (hotspots.length === 0) return '';
  const lines: string[] = [];
  lines.push(`### Coupling Hotspots (top ${Math.min(hotspots.length, 10)} by fan-in)\n`);
  for (const h of hotspots.slice(0, 10)) {
    lines.push(`  ${h.file}  ← ${h.fanIn} importers  → ${h.fanOut} deps`);
  }
  lines.push('');
  return lines.join('\n');
}

export function formatDeadExports(dead: DeadExport[]): string {
  if (dead.length === 0) return '';
  const lines: string[] = [];
  lines.push(`### Dead Exports (${dead.length} unused)\n`);
  const byFile = new Map<string, DeadExport[]>();
  for (const d of dead) {
    if (!byFile.has(d.file)) byFile.set(d.file, []);
    byFile.get(d.file)!.push(d);
  }
  for (const [file, exports] of byFile) {
    lines.push(`  ${file}: ${exports.map(e => `${e.name} (${e.kind})`).join(', ')}`);
  }
  lines.push('');
  return lines.join('\n');
}

export function formatLayerViolations(violations: LayerViolation[]): string {
  if (violations.length === 0) return '';
  const lines: string[] = [];
  lines.push(`### Layer Violations (${violations.length} found)\n`);
  for (const v of violations.slice(0, 15)) {
    lines.push(`  ${v.from} (${v.fromLayer}) → ${v.to} (${v.toLayer})  skips: ${v.skippedLayers.join(', ')}`);
  }
  if (violations.length > 15) lines.push(`  ... and ${violations.length - 15} more`);
  lines.push('');
  return lines.join('\n');
}

export function formatFitness(score: FitnessScore): string {
  const lines: string[] = [];
  lines.push(`### Architectural Fitness: ${score.overall}/100\n`);
  const bar = (v: number, max: number) => {
    const filled = Math.round((v / max) * 10);
    return '█'.repeat(filled).padEnd(10, '░');
  };
  lines.push(`  Circular deps  ${bar(score.circularDeps, 20)} ${score.circularDeps}/20  (${score.breakdown.cyclesFound} cycles)`);
  lines.push(`  Cohesion       ${bar(score.cohesion, 20)} ${score.cohesion}/20  (avg ${score.breakdown.avgCohesion}%)`);
  lines.push(`  Coupling       ${bar(score.coupling, 20)} ${score.coupling}/20  (max fan-in: ${score.breakdown.maxFanIn})`);
  lines.push(`  Layer purity   ${bar(score.layerViolations, 20)} ${score.layerViolations}/20  (${score.breakdown.layerViolationsCount} violations)`);
  lines.push(`  Doc accuracy   ${bar(score.docAccuracy, 20)} ${score.docAccuracy}/20  (${score.breakdown.undocumentedDeps} undocumented)`);
  lines.push('');
  return lines.join('\n');
}

export function formatComplexHotspots(hotspots: ComplexDefinition[]): string {
  if (hotspots.length === 0) return '';
  const lines: string[] = [];
  lines.push(`### Complexity Hotspots (>50 lines, ${hotspots.length} found)\n`);
  for (const h of hotspots.slice(0, 15)) {
    lines.push(`  ${h.file}:${h.line}  ${h.name} (${h.kind})  ${h.lineSpan} lines`);
  }
  if (hotspots.length > 15) lines.push(`  ... and ${hotspots.length - 15} more`);
  lines.push('');
  return lines.join('\n');
}

export function formatImpactPreview(impact: ImpactResult): string {
  const lines: string[] = [];
  lines.push(`### Change Impact: ${impact.targetFile}\n`);
  lines.push(`  Direct impact:   ${impact.directImpact.length} file(s)`);
  lines.push(`  Transitive:      ${impact.transitiveImpact.length} file(s)`);
  lines.push(`  Total affected:  ${impact.totalAffected}`);
  lines.push(`  Max depth:       ${impact.impactDepth}`);
  lines.push('');
  if (impact.directImpact.length > 0) {
    lines.push('  Direct:');
    for (const f of impact.directImpact) lines.push(`    ← ${f}`);
  }
  if (impact.transitiveImpact.length > 0 && impact.transitiveImpact.length <= 20) {
    lines.push('  Transitive:');
    for (const f of impact.transitiveImpact) lines.push(`    ← ${f}`);
  }
  lines.push('');
  return lines.join('\n');
}

// ─── God Nodes (most-connected files) ────────────────────────────────────────

export interface GodNode {
  file: string;
  totalEdges: number;
  fanIn: number;
  fanOut: number;
  role: 'hub' | 'bridge' | 'normal';
}

/**
 * Find the most-connected files in the graph.
 * Hub: high fan-in (many depend on it).
 * Bridge: high fan-in AND fan-out (connects many modules).
 */
export function findGodNodes(graph: DependencyGraph, topN: number = 10): GodNode[] {
  const fanIn = new Map<string, number>();
  const fanOut = new Map<string, number>();

  for (const node of graph.nodes) {
    fanIn.set(node.file, 0);
    fanOut.set(node.file, 0);
  }
  for (const edge of graph.edges) {
    fanIn.set(edge.to, (fanIn.get(edge.to) || 0) + 1);
    fanOut.set(edge.from, (fanOut.get(edge.from) || 0) + 1);
  }

  const nodes: GodNode[] = [];
  for (const node of graph.nodes) {
    const fi = fanIn.get(node.file) || 0;
    const fo = fanOut.get(node.file) || 0;
    const total = fi + fo;
    if (total === 0) continue;
    const role = fi > 5 && fo > 5 ? 'bridge' : fi > 5 ? 'hub' : 'normal';
    nodes.push({ file: node.file, totalEdges: total, fanIn: fi, fanOut: fo, role });
  }

  return nodes.sort((a, b) => b.totalEdges - a.totalEdges).slice(0, topN);
}

export function formatGodNodes(nodes: GodNode[]): string {
  if (nodes.length === 0) return '';
  const lines: string[] = [];
  lines.push(`### God Nodes (top ${nodes.length} most-connected)\n`);
  for (const n of nodes) {
    const tag = n.role === 'bridge' ? ' [BRIDGE]' : n.role === 'hub' ? ' [HUB]' : '';
    lines.push(`  ${n.file}  ←${n.fanIn} →${n.fanOut} (${n.totalEdges} total)${tag}`);
  }
  lines.push('');
  return lines.join('\n');
}

// ─── Community Detection (Louvain-like) ──────────────────────────────────────

export interface Community {
  id: number;
  files: string[];
  internalEdges: number;
  externalEdges: number;
  density: number;
}

/**
 * Simple Louvain-like community detection.
 * Iteratively moves nodes between communities to maximize modularity.
 */
export function detectCommunities(graph: DependencyGraph, resolution: number = 1.0): Community[] {
  if (graph.nodes.length === 0) return [];

  const adj = new Map<string, Set<string>>();
  for (const node of graph.nodes) adj.set(node.file, new Set());
  for (const edge of graph.edges) {
    adj.get(edge.from)?.add(edge.to);
    adj.get(edge.to)?.add(edge.from);
  }

  const degree = new Map<string, number>();
  for (const node of graph.nodes) degree.set(node.file, 0);
  for (const edge of graph.edges) {
    degree.set(edge.from, (degree.get(edge.from) || 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) || 0) + 1);
  }

  // Initialize: each node in its own community
  const communityOf = new Map<string, number>();
  const files = graph.nodes.map(n => n.file);
  files.forEach((f, i) => communityOf.set(f, i));

  const m = graph.edges.length || 1; // total edges

  // Louvain iterations
  for (let iter = 0; iter < 10; iter++) {
    let improved = false;

    const compSigmaTot = new Map<number, number>();
    for (const node of files) {
      const c = communityOf.get(node)!;
      compSigmaTot.set(c, (compSigmaTot.get(c) || 0) + (degree.get(node) || 0));
    }

    for (const node of files) {
      const neighbors = adj.get(node) || new Set();
      if (neighbors.size === 0) continue;

      // Count edges to each community
      const communityEdges = new Map<number, number>();
      for (const neighbor of neighbors) {
        const c = communityOf.get(neighbor)!;
        communityEdges.set(c, (communityEdges.get(c) || 0) + 1);
      }

      // Find best community
      const currentCommunity = communityOf.get(node)!;
      const k_i = degree.get(node) || 0;
      const k_i_in_old = communityEdges.get(currentCommunity) || 0;
      const sigma_tot_old = compSigmaTot.get(currentCommunity) || 0;

      const currentGain = k_i_in_old - (sigma_tot_old - k_i) * k_i / (2 * m) * resolution;

      let bestCommunity = currentCommunity;
      let bestGain = currentGain;

      for (const [community, edges] of communityEdges) {
        if (community === currentCommunity) continue;
        const sigma_tot_new = compSigmaTot.get(community) || 0;
        const gain = edges - sigma_tot_new * k_i / (2 * m) * resolution;
        if (gain > bestGain) {
          bestGain = gain;
          bestCommunity = community;
        }
      }

      if (bestCommunity !== currentCommunity) {
        communityOf.set(node, bestCommunity);
        compSigmaTot.set(currentCommunity, (compSigmaTot.get(currentCommunity) || 0) - k_i);
        compSigmaTot.set(bestCommunity, (compSigmaTot.get(bestCommunity) || 0) + k_i);
        improved = true;
      }
    }
    if (!improved) break;
  }

  // Build community objects
  const communityFiles = new Map<number, string[]>();
  for (const [file, community] of communityOf) {
    if (!communityFiles.has(community)) communityFiles.set(community, []);
    communityFiles.get(community)!.push(file);
  }

  const communities: Community[] = [];
  for (const [id, files] of communityFiles) {
    if (files.length < 2) continue;
    let internal = 0;
    let external = 0;
    for (const edge of graph.edges) {
      const cFrom = communityOf.get(edge.from);
      const cTo = communityOf.get(edge.to);
      if (cFrom === id && cTo === id) internal++;
      else if (cFrom === id || cTo === id) external++;
    }
    const maxEdges = files.length * (files.length - 1) / 2;
    communities.push({
      id,
      files: files.sort(),
      internalEdges: internal,
      externalEdges: external,
      density: maxEdges > 0 ? Math.round((internal / maxEdges) * 100) / 100 : 0,
    });
  }

  return communities.sort((a, b) => b.files.length - a.files.length);
}

export function formatCommunities(communities: Community[]): string {
  if (communities.length === 0) return 'No communities detected (graph may be too sparse).\n';
  const lines: string[] = [];
  lines.push(`### Communities (${communities.length} found)\n`);
  for (const c of communities.slice(0, 15)) {
    lines.push(`  Community ${c.id}: ${c.files.length} files, density=${c.density}, internal=${c.internalEdges}, external=${c.externalEdges}`);
    for (const f of c.files.slice(0, 5)) lines.push(`    ${f}`);
    if (c.files.length > 5) lines.push(`    ... and ${c.files.length - 5} more`);
  }
  lines.push('');
  return lines.join('\n');
}

// ─── Guided Tour (topological sort) ──────────────────────────────────────────

export interface TourStep {
  file: string;
  depth: number;
  reason: string;
}

/**
 * Generate a guided tour: topological order of the dependency graph.
 * Start from entry points (files with no incoming edges), walk outward.
 */
export function generateTour(graph: DependencyGraph): TourStep[] {
  const adj = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const node of graph.nodes) {
    adj.set(node.file, []);
    inDegree.set(node.file, 0);
  }
  for (const edge of graph.edges) {
    adj.get(edge.from)?.push(edge.to);
    inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1);
  }

  const initialInDegree = new Map(inDegree);

  // Start from entry points (in-degree = 0)
  const queue: string[] = [];
  for (const [file, deg] of inDegree) {
    if (deg === 0) queue.push(file);
  }

  const visited = new Set<string>();
  const steps: TourStep[] = [];
  let depth = 0;

  while (queue.length > 0) {
    const nextQueue: string[] = [];
    for (const file of queue) {
      if (visited.has(file)) continue;
      visited.add(file);
      const reasons: string[] = [];
      if ((initialInDegree.get(file) || 0) === 0) reasons.push('entry point');
      const outEdges = adj.get(file) || [];
      if (outEdges.length > 3) reasons.push(`connects to ${outEdges.length} modules`);
      steps.push({ file, depth, reason: reasons.join(', ') || 'dependency' });
      for (const neighbor of outEdges) {
        const currentDeg = inDegree.get(neighbor) || 0;
        if (currentDeg > 0) {
          const nextDeg = currentDeg - 1;
          inDegree.set(neighbor, nextDeg);
          if (nextDeg === 0 && !visited.has(neighbor)) {
            nextQueue.push(neighbor);
          }
        }
      }
    }
    queue.length = 0;
    queue.push(...nextQueue);
    depth++;
  }

  // Add any unvisited files (cycles)
  for (const node of graph.nodes) {
    if (!visited.has(node.file)) {
      steps.push({ file: node.file, depth, reason: 'in cycle' });
    }
  }

  return steps;
}

export function formatTour(steps: TourStep[]): string {
  if (steps.length === 0) return 'No files to tour.\n';
  const lines: string[] = [];
  lines.push(`### Guided Tour (${steps.length} files)\n`);
  lines.push('Read in this order to understand the codebase:\n');
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const indent = '  '.repeat(Math.min(step.depth, 4));
    const tag = step.reason ? ` (${step.reason})` : '';
    lines.push(`  ${i + 1}. ${indent}${step.file}${tag}`);
  }
  lines.push('');
  return lines.join('\n');
}

// ─── Configurable Layer Rules ────────────────────────────────────────────────

export interface LayerRule {
  name: string;
  patterns: string[];
  color?: string;
}

export const DEFAULT_LAYER_RULES: LayerRule[] = [
  { name: 'ui', patterns: ['renderer', 'components', 'views', 'pages', 'ui', 'frontend', 'client', 'web-ui'], color: '#89b4fa' },
  { name: 'api', patterns: ['api', 'routes', 'controllers', 'handlers', 'server', 'rest-api', 'channel'], color: '#a6e3a1' },
  { name: 'service', patterns: ['services', 'service', 'business', 'logic', 'use-cases', 'pipeline', 'routing'], color: '#f9e2af' },
  { name: 'data', patterns: ['data', 'db', 'database', 'repository', 'repos', 'models', 'store', 'dao', 'adapter', 'persistence'], color: '#f38ba8' },
  { name: 'infra', patterns: ['infra', 'infrastructure', 'utils', 'helpers', 'lib', 'common', 'shared', 'config'], color: '#cba6f7' },
];

export function classifyLayer(filePath: string, rules: LayerRule[] = DEFAULT_LAYER_RULES): string | null {
  const lower = filePath.toLowerCase();
  for (const rule of rules) {
    for (const pattern of rule.patterns) {
      if (lower.includes(pattern)) return rule.name;
    }
  }
  return null;
}

export function classifyAllFiles(graph: DependencyGraph, rules: LayerRule[] = DEFAULT_LAYER_RULES): Map<string, string> {
  const result = new Map<string, string>();
  for (const node of graph.nodes) {
    const layer = classifyLayer(node.file, rules);
    if (layer) result.set(node.file, layer);
  }
  return result;
}

export function formatLayerSummary(graph: DependencyGraph, rules: LayerRule[] = DEFAULT_LAYER_RULES): string {
  const classified = classifyAllFiles(graph, rules);
  const byLayer = new Map<string, string[]>();
  for (const [file, layer] of classified) {
    if (!byLayer.has(layer)) byLayer.set(layer, []);
    byLayer.get(layer)!.push(file);
  }

  const lines: string[] = [];
  lines.push('### Layer Classification\n');
  for (const rule of rules) {
    const files = byLayer.get(rule.name) || [];
    lines.push(`  ${rule.name}: ${files.length} file(s)`);
  }
  const unclassified = graph.nodes.length - classified.size;
  if (unclassified > 0) lines.push(`  unclassified: ${unclassified} file(s)`);
  lines.push('');
  return lines.join('\n');
}

// ─── Wiki Export ─────────────────────────────────────────────────────────────

/**
 * Generate a crawlable markdown wiki from .omm/ data.
 */
export function generateWiki(elements: { path: string; description?: string; diagram?: string; context?: string; children?: string[] }[]): string {
  const pages: { name: string; content: string }[] = [];

  // Index page
  let indexContent = '# Architecture Wiki\n\n';
  indexContent += '## Perspectives\n\n';
  for (const el of elements.filter(e => !e.path.includes('/'))) {
    indexContent += `- [[${el.path}]]\n`;
  }
  indexContent += '\n## All Elements\n\n';
  for (const el of elements) {
    indexContent += `- [[${el.path}]]\n`;
  }
  pages.push({ name: 'index', content: indexContent });

  // Per-element pages
  for (const el of elements) {
    let content = `# ${el.path}\n\n`;
    if (el.description) content += `${el.description}\n\n`;
    if (el.diagram) {
      content += '## Diagram\n\n';
      content += '```mermaid\n' + el.diagram + '\n```\n\n';
    }
    if (el.context) content += `## Context\n\n${el.context}\n\n`;
    if (el.children && el.children.length > 0) {
      content += '## Children\n\n';
      for (const child of el.children) {
        content += `- [[${el.path}/${child}]]\n`;
      }
      content += '\n';
    }
    if (el.path.includes('/')) {
      const parent = el.path.split('/').slice(0, -1).join('/');
      content += `## Parent\n\n[[${parent}]]\n`;
    }
    pages.push({ name: el.path, content });
  }

  return pages.map(p => `---\nname: ${p.name}\n---\n\n${p.content}`).join('\n\n---\n\n');
}

// ─── Fuzzy Search ────────────────────────────────────────────────────────────

export interface SearchResult {
  element: string;
  score: number;
  matchType: 'name' | 'description' | 'path';
  snippet?: string;
}

/**
 * Fuzzy search across element names, descriptions, and paths.
 */
export function fuzzySearch(
  query: string,
  elements: { path: string; description?: string }[],
  limit: number = 20,
): SearchResult[] {
  const q = query.toLowerCase();
  const results: SearchResult[] = [];

  for (const el of elements) {
    const name = el.path.split('/').pop()?.toLowerCase() || '';
    const path = el.path.toLowerCase();
    const desc = (el.description || '').toLowerCase();

    // Exact name match
    if (name === q) {
      results.push({ element: el.path, score: 100, matchType: 'name' });
      continue;
    }
    // Name contains query
    if (name.includes(q)) {
      results.push({ element: el.path, score: 80, matchType: 'name' });
      continue;
    }
    // Path contains query
    if (path.includes(q)) {
      results.push({ element: el.path, score: 60, matchType: 'path' });
      continue;
    }
    // Description contains query
    if (desc.includes(q)) {
      const snippet = el.description?.slice(0, 100);
      results.push({ element: el.path, score: 40, matchType: 'description', snippet });
      continue;
    }

    // Fuzzy: all query chars appear in order in the name
    let qi = 0;
    for (let i = 0; i < name.length && qi < q.length; i++) {
      if (name[i] === q[qi]) qi++;
    }
    if (qi === q.length) {
      results.push({ element: el.path, score: 20, matchType: 'name' });
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}
