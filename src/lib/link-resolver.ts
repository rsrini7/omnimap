/**
 * link-resolver.ts — Graph-based link resolution for @refs in diagrams.
 *
 * Uses Depth-First Search (DFS) with recursion stack for cycle detection.
 * Properly handles:
 * - Multi-branch diagrams (follows ALL refs, not just first)
 * - Cycles (back-edge detection)
 * - Broken references (missing targets)
 * - Nested elements (uses readNodeField for non-perspective paths)
 */

import { extractRefs } from './refs.js';
import { listClasses, listNodes, readField, readNodeField } from './store.js';
import type { Field } from '../types.js';

// ── Types ──────────────────────────────────────────────────────────

export type LinkResolutionType = 'resolved' | 'broken' | 'cycle';

export interface LinkResolution {
  type: LinkResolutionType;
  /** Chain of element paths from start to terminal/broken/cycle point */
  chain: string[];
  /** For 'broken': the missing element path */
  missing?: string;
  /** For 'resolved': the terminal element path */
  terminal?: string;
}

export interface RefGraph {
  nodes: Set<string>;
  edges: Map<string, Set<string>>; // from → Set<to>
}

// ── Graph building ─────────────────────────────────────────────────

/**
 * Read diagram for any element (perspective or nested).
 * Uses readField for perspectives, readNodeField for nested elements.
 */
function readDiagramForElement(elementPath: string, cwd?: string): string | null {
  const parts = elementPath.split('/');
  if (parts.length === 1) {
    return readField(elementPath, 'diagram', cwd);
  } else {
    const perspective = parts[0];
    const nodePath = parts.slice(1);
    return readNodeField(perspective, nodePath, 'diagram' as Field, cwd);
  }
}

/**
 * Collect all element paths (perspectives + nested children).
 */
function collectAllPaths(cwd?: string): string[] {
  const allPaths: string[] = [];
  const perspectives = listClasses(cwd);

  for (const persp of perspectives) {
    allPaths.push(persp);
    collectNestedPaths(persp, [], allPaths, cwd);
  }

  return allPaths;
}

function collectNestedPaths(perspective: string, nodePath: string[], result: string[], cwd?: string): void {
  const children = listNodes(perspective, nodePath, cwd);
  for (const child of children) {
    const childPath = [...nodePath, child];
    const fullPath = [perspective, ...childPath].join('/');
    result.push(fullPath);
    collectNestedPaths(perspective, childPath, result, cwd);
  }
}

/**
 * Build a complete reference graph from all diagrams.
 * Each edge represents a @ref in a diagram.
 */
export function buildDiagramRefGraph(cwd?: string): RefGraph {
  const allPaths = collectAllPaths(cwd);
  const graph: RefGraph = { nodes: new Set(allPaths), edges: new Map() };

  for (const elementPath of allPaths) {
    const diagram = readDiagramForElement(elementPath, cwd);
    if (!diagram) continue;

    const refs = extractRefs(diagram);
    if (refs.length > 0) {
      graph.edges.set(elementPath, new Set(refs));
    }
  }

  return graph;
}

// ── Link resolution ────────────────────────────────────────────────

/**
 * Resolve all links from a starting element using DFS.
 * Detects cycles (back-edges) and broken references (missing targets).
 *
 * @param start - Starting element path
 * @param graph - Reference graph
 * @param allElements - All known element paths
 * @returns Array of link resolutions found from this element
 */
export function resolveLinksFrom(
  start: string,
  graph: RefGraph,
  allElements: string[]
): LinkResolution[] {
  const resolutions: LinkResolution[] = [];
  const visited = new Set<string>();
  const recursionStack = new Set<string>(); // for cycle detection

  function dfs(node: string, chain: string[]): void {
    if (recursionStack.has(node)) {
      // Cycle detected — back-edge
      resolutions.push({ type: 'cycle', chain: [...chain, node] });
      return;
    }

    if (visited.has(node)) return;
    visited.add(node);
    recursionStack.add(node);

    const targets = graph.edges.get(node) ?? new Set();
    let isTerminal = true;

    for (const target of targets) {
      if (!allElements.includes(target)) {
        // Broken reference
        resolutions.push({ type: 'broken', chain: [...chain, target], missing: target });
      } else {
        isTerminal = false;
        dfs(target, [...chain, target]);
      }
    }

    // If no outgoing edges (or all broken), this is a terminal node
    if (isTerminal && chain.length > 1) {
      resolutions.push({ type: 'resolved', chain, terminal: node });
    }

    recursionStack.delete(node);
  }

  dfs(start, [start]);
  return resolutions;
}

/**
 * Resolve all links in the entire .omm/ tree.
 *
 * @param cwd - Working directory override
 * @returns Map of element path → array of link resolutions
 */
export function resolveAllLinks(cwd?: string): Map<string, LinkResolution[]> {
  const graph = buildDiagramRefGraph(cwd);
  const allElements = collectAllPaths(cwd);
  const results = new Map<string, LinkResolution[]>();

  for (const element of allElements) {
    const resolutions = resolveLinksFrom(element, graph, allElements);
    if (resolutions.length > 0) {
      results.set(element, resolutions);
    }
  }

  return results;
}

/**
 * Resolve links for a single element (for use by `omm inspect --links`).
 *
 * @param elementPath - Element to resolve links for
 * @param cwd - Working directory override
 * @returns Array of link resolutions
 */
export function resolveLinksForElement(elementPath: string, cwd?: string): LinkResolution[] {
  const graph = buildDiagramRefGraph(cwd);
  const allElements = collectAllPaths(cwd);
  return resolveLinksFrom(elementPath, graph, allElements);
}

// ── Formatting ─────────────────────────────────────────────────────

/**
 * Format link resolutions for display.
 */
export function formatResolutions(resolutions: LinkResolution[]): string[] {
  const lines: string[] = [];

  for (const res of resolutions) {
    switch (res.type) {
      case 'resolved':
        lines.push(`  ${res.chain.join(' → ')}`);
        lines.push(`    ✓ Resolved (chain length ${res.chain.length})`);
        break;
      case 'broken':
        lines.push(`  ${res.chain.join(' → ')}`);
        lines.push(`    ✗ Broken: @${res.missing} (element not found)`);
        break;
      case 'cycle':
        lines.push(`  ${res.chain.join(' → ')}`);
        lines.push(`    ⚠ Cycle detected`);
        break;
    }
  }

  return lines;
}
