import { describe, it, expect } from 'vitest';
import {
  findCycles,
  findHotspots,
  findDeadExports,
  findLayerViolations,
  previewChangeImpact
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
