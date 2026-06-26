import { describe, it, expect } from 'vitest';
import { parseMermaid, diffMermaid } from '../lib/diff.js';

describe('parseMermaid', () => {
  it('parses nodes and edges from a flowchart', () => {
    const text = `graph LR
    A["Node A"] -->|"label"| B["Node B"]
    B --> C["Node C"]`;
    const result = parseMermaid(text);
    expect(result.nodes.has('A')).toBe(true);
    expect(result.nodes.has('B')).toBe(true);
    expect(result.nodes.has('C')).toBe(true);
    expect(result.edges.size).toBe(2);
  });

  it('skips classDef and comment lines', () => {
    const text = `graph LR
    %% this is a comment
    classDef entry fill:#89b4fa
    A["Node A"] --> B["Node B"]`;
    const result = parseMermaid(text);
    expect(result.nodes.has('A')).toBe(true);
    expect(result.nodes.has('B')).toBe(true);
  });

  it('handles empty input', () => {
    const result = parseMermaid('');
    expect(result.nodes.size).toBe(0);
    expect(result.edges.size).toBe(0);
  });
});

describe('diffMermaid', () => {
  it('detects added nodes', () => {
    const before = `graph LR\nA["A"] --> B["B"]`;
    const after = `graph LR\nA["A"] --> B["B"]\nC["C"]`;
    const diff = diffMermaid(before, after);
    expect(diff.added_nodes).toContain('C');
    expect(diff.removed_nodes).toEqual([]);
    expect(diff.has_changes).toBe(true);
  });

  it('detects removed nodes', () => {
    const before = `graph LR\nA["A"] --> B["B"]\nC["C"]`;
    const after = `graph LR\nA["A"] --> B["B"]`;
    const diff = diffMermaid(before, after);
    expect(diff.removed_nodes).toContain('C');
    expect(diff.has_changes).toBe(true);
  });

  it('detects added edges', () => {
    const before = `graph LR\nA["A"] --> B["B"]`;
    const after = `graph LR\nA["A"] --> B["B"]\nA["A"] --> C["C"]`;
    const diff = diffMermaid(before, after);
    expect(diff.added_edges.length).toBeGreaterThan(0);
    expect(diff.has_changes).toBe(true);
  });

  it('returns no changes for identical diagrams', () => {
    const text = `graph LR\nA["A"] --> B["B"]`;
    const diff = diffMermaid(text, text);
    expect(diff.has_changes).toBe(false);
    expect(diff.added_nodes).toEqual([]);
    expect(diff.removed_nodes).toEqual([]);
  });
});
