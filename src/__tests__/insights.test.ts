import { describe, it, expect } from 'vitest';
import {
  findCycles,
  findHotspots,
  findDeadExports,
  findLayerViolations,
  previewChangeImpact,
  detectCommunities,
  generateTour
} from '../lib/analyzer/insights.js';
import type { DependencyGraph, FileAnalysis } from '../lib/analyzer/types.js';

describe('insights - findCycles', () => {
  it('detects simple 2-node cycles', () => {
    const graph: DependencyGraph = {
      nodes: [
        { id: 'src/a.ts', file: 'src/a.ts', exports: [] },
        { id: 'src/b.ts', file: 'src/b.ts', exports: [] }
      ],
      edges: [
        { from: 'src/a.ts', to: 'src/b.ts', imports: [] },
        { from: 'src/b.ts', to: 'src/a.ts', imports: [] }
      ]
    };
    const cycles = findCycles(graph);
    expect(cycles.length).toBe(1);
    expect(cycles[0].files).toContain('src/a.ts');
    expect(cycles[0].files).toContain('src/b.ts');
  });

  it('detects 3-node cycles', () => {
    const graph: DependencyGraph = {
      nodes: [
        { id: 'src/a.ts', file: 'src/a.ts', exports: [] },
        { id: 'src/b.ts', file: 'src/b.ts', exports: [] },
        { id: 'src/c.ts', file: 'src/c.ts', exports: [] }
      ],
      edges: [
        { from: 'src/a.ts', to: 'src/b.ts', imports: [] },
        { from: 'src/b.ts', to: 'src/c.ts', imports: [] },
        { from: 'src/c.ts', to: 'src/a.ts', imports: [] }
      ]
    };
    const cycles = findCycles(graph);
    expect(cycles.length).toBe(1);
    expect(cycles[0].files.length).toBe(3);
  });

  it('reports no cycles when graph is acyclic', () => {
    const graph: DependencyGraph = {
      nodes: [
        { id: 'src/a.ts', file: 'src/a.ts', exports: [] },
        { id: 'src/b.ts', file: 'src/b.ts', exports: [] }
      ],
      edges: [{ from: 'src/a.ts', to: 'src/b.ts', imports: [] }]
    };
    const cycles = findCycles(graph);
    expect(cycles.length).toBe(0);
  });
});

describe('insights - findHotspots', () => {
  it('identifies nodes with highest fan-in', () => {
    const graph: DependencyGraph = {
      nodes: [
        { id: 'src/a.ts', file: 'src/a.ts', exports: [] },
        { id: 'src/b.ts', file: 'src/b.ts', exports: [] },
        { id: 'src/c.ts', file: 'src/c.ts', exports: [] }
      ],
      edges: [
        { from: 'src/a.ts', to: 'src/c.ts', imports: [] },
        { from: 'src/b.ts', to: 'src/c.ts', imports: [] }
      ]
    };
    const hotspots = findHotspots(graph);
    expect(hotspots.length).toBe(1);
    expect(hotspots[0].file).toBe('src/c.ts');
    expect(hotspots[0].fanIn).toBe(2);
    expect(hotspots[0].fanOut).toBe(0);
  });
});

describe('insights - findDeadExports', () => {
  it('detects unused exports', () => {
    const analyses: FileAnalysis[] = [
      {
        file: 'src/a.ts',
        language: 'typescript',
        imports: [],
        exports: [
          { name: 'used', kind: 'function', line: 1 },
          { name: 'unused', kind: 'function', line: 5 }
        ],
        definitions: [],
        calls: []
      },
      {
        file: 'src/b.ts',
        language: 'typescript',
        imports: [],
        exports: [],
        definitions: [],
        calls: []
      }
    ];
    const graph: DependencyGraph = {
      nodes: [
        { id: 'src/a.ts', file: 'src/a.ts', exports: ['used', 'unused'] },
        { id: 'src/b.ts', file: 'src/b.ts', exports: [] }
      ],
      edges: [
        { from: 'src/b.ts', to: 'src/a.ts', imports: ['used'] }
      ]
    };

    const dead = findDeadExports(analyses, graph);
    expect(dead.length).toBe(1);
    expect(dead[0].name).toBe('unused');
    expect(dead[0].file).toBe('src/a.ts');
  });
});

describe('insights - findLayerViolations', () => {
  it('detects violations skipping layers downward', () => {
    const graph: DependencyGraph = {
      nodes: [
        { id: 'src/ui/Component.ts', file: 'src/ui/Component.ts', exports: [] },
        { id: 'src/data/Database.ts', file: 'src/data/Database.ts', exports: [] }
      ],
      edges: [
        { from: 'src/ui/Component.ts', to: 'src/data/Database.ts', imports: [] }
      ]
    };
    const violations = findLayerViolations(graph);
    expect(violations.length).toBe(1);
    expect(violations[0].fromLayer).toBe('ui');
    expect(violations[0].toLayer).toBe('data');
    expect(violations[0].skippedLayers).toContain('api');
    expect(violations[0].skippedLayers).toContain('service');
  });
});

describe('insights - previewChangeImpact', () => {
  it('traces transitive dependents using BFS', () => {
    const graph: DependencyGraph = {
      nodes: [
        { id: 'src/a.ts', file: 'src/a.ts', exports: [] },
        { id: 'src/b.ts', file: 'src/b.ts', exports: [] },
        { id: 'src/c.ts', file: 'src/c.ts', exports: [] }
      ],
      edges: [
        { from: 'src/b.ts', to: 'src/a.ts', imports: [] },
        { from: 'src/c.ts', to: 'src/b.ts', imports: [] }
      ]
    };

    const impact = previewChangeImpact(graph, 'src/a.ts');
    expect(impact.targetFile).toBe('src/a.ts');
    expect(impact.directImpact).toContain('src/b.ts');
    expect(impact.transitiveImpact).toContain('src/c.ts');
    expect(impact.totalAffected).toBe(2);
  });
});

describe('insights - detectCommunities', () => {
  it('groups strongly connected nodes into communities', () => {
    const graph: DependencyGraph = {
      nodes: [
        { id: 'src/a1.ts', file: 'src/a1.ts', exports: [] },
        { id: 'src/a2.ts', file: 'src/a2.ts', exports: [] },
        { id: 'src/b1.ts', file: 'src/b1.ts', exports: [] },
        { id: 'src/b2.ts', file: 'src/b2.ts', exports: [] }
      ],
      edges: [
        // Community A
        { from: 'src/a1.ts', to: 'src/a2.ts', imports: [] },
        // Community B
        { from: 'src/b1.ts', to: 'src/b2.ts', imports: [] },
        // Weak cross-connection
        { from: 'src/a1.ts', to: 'src/b1.ts', imports: [] }
      ]
    };

    const communities = detectCommunities(graph);
    // Should successfully detect 2 distinct communities of size 2
    expect(communities.length).toBeGreaterThanOrEqual(2);
    expect(communities.some(c => c.files.includes('src/a1.ts') && c.files.includes('src/a2.ts'))).toBe(true);
    expect(communities.some(c => c.files.includes('src/b1.ts') && c.files.includes('src/b2.ts'))).toBe(true);
  });
});

describe('insights - generateTour', () => {
  it('returns topological tour order respecting dependencies', () => {
    const graph: DependencyGraph = {
      nodes: [
        { id: 'src/a.ts', file: 'src/a.ts', exports: [] },
        { id: 'src/b.ts', file: 'src/b.ts', exports: [] },
        { id: 'src/c.ts', file: 'src/c.ts', exports: [] }
      ],
      edges: [
        { from: 'src/a.ts', to: 'src/b.ts', imports: [] },
        { from: 'src/b.ts', to: 'src/c.ts', imports: [] }
      ]
    };

    const tour = generateTour(graph);
    expect(tour.length).toBe(3);
    
    // a has no dependencies (entry point)
    expect(tour[0].file).toBe('src/a.ts');
    
    // b depends on a, c depends on b
    const idxA = tour.findIndex(t => t.file === 'src/a.ts');
    const idxB = tour.findIndex(t => t.file === 'src/b.ts');
    const idxC = tour.findIndex(t => t.file === 'src/c.ts');
    
    expect(idxA).toBeLessThan(idxB);
    expect(idxB).toBeLessThan(idxC);
  });
});

