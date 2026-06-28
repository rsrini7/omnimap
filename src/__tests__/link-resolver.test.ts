import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initOmm, writeField } from '../lib/store.js';
import {
  buildDiagramRefGraph,
  resolveLinksFrom,
  resolveAllLinks,
  resolveLinksForElement,
  formatResolutions,
  type RefGraph,
} from '../lib/link-resolver.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omm-link-resolver-test-'));
  initOmm(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('buildDiagramRefGraph', () => {
  it('builds graph from diagrams', () => {
    writeField('auth', 'description', 'Auth', tmpDir);
    writeField('auth', 'diagram', 'graph LR\n    @gateway --> @auth', tmpDir);
    writeField('gateway', 'description', 'Gateway', tmpDir);
    writeField('gateway', 'diagram', 'graph LR\n    A --> B', tmpDir);

    const graph = buildDiagramRefGraph(tmpDir);
    expect(graph.nodes.has('auth')).toBe(true);
    expect(graph.nodes.has('gateway')).toBe(true);

    const authEdges = graph.edges.get('auth');
    expect(authEdges?.has('gateway')).toBe(true);
  });

  it('handles nested elements', () => {
    writeField('auth', 'description', 'Auth', tmpDir);
    writeField('auth', 'diagram', 'graph LR\n    @jwt --> @session', tmpDir);
    writeField('auth/jwt', 'description', 'JWT', tmpDir);
    writeField('auth/session', 'description', 'Session', tmpDir);

    const graph = buildDiagramRefGraph(tmpDir);
    expect(graph.nodes.has('auth/jwt')).toBe(true);
    expect(graph.nodes.has('auth/session')).toBe(true);
  });
});

describe('resolveLinksFrom', () => {
  it('resolves simple chain', () => {
    const graph: RefGraph = {
      nodes: new Set(['a', 'b', 'c']),
      edges: new Map([
        ['a', new Set(['b'])],
        ['b', new Set(['c'])],
      ]),
    };

    const resolutions = resolveLinksFrom('a', graph, ['a', 'b', 'c']);
    expect(resolutions).toHaveLength(1);
    expect(resolutions[0].type).toBe('resolved');
    expect(resolutions[0].chain).toEqual(['a', 'b', 'c']);
    expect(resolutions[0].terminal).toBe('c');
  });

  it('detects broken references', () => {
    const graph: RefGraph = {
      nodes: new Set(['a']),
      edges: new Map([
        ['a', new Set(['missing'])],
      ]),
    };

    const resolutions = resolveLinksFrom('a', graph, ['a']);
    expect(resolutions).toHaveLength(1);
    expect(resolutions[0].type).toBe('broken');
    expect(resolutions[0].missing).toBe('missing');
  });

  it('detects cycles', () => {
    const graph: RefGraph = {
      nodes: new Set(['a', 'b']),
      edges: new Map([
        ['a', new Set(['b'])],
        ['b', new Set(['a'])],
      ]),
    };

    const resolutions = resolveLinksFrom('a', graph, ['a', 'b']);
    expect(resolutions.some(r => r.type === 'cycle')).toBe(true);
  });

  it('handles self-reference cycle', () => {
    const graph: RefGraph = {
      nodes: new Set(['a']),
      edges: new Map([
        ['a', new Set(['a'])],
      ]),
    };

    const resolutions = resolveLinksFrom('a', graph, ['a']);
    expect(resolutions.some(r => r.type === 'cycle')).toBe(true);
  });

  it('handles multi-branch diagrams', () => {
    const graph: RefGraph = {
      nodes: new Set(['a', 'b', 'c']),
      edges: new Map([
        ['a', new Set(['b', 'c'])],
      ]),
    };

    const resolutions = resolveLinksFrom('a', graph, ['a', 'b', 'c']);
    expect(resolutions.length).toBeGreaterThanOrEqual(2);
  });
});

describe('resolveAllLinks', () => {
  it('resolves all links in the project', () => {
    writeField('auth', 'description', 'Auth', tmpDir);
    writeField('auth', 'diagram', 'graph LR\n    @gateway --> @auth', tmpDir);
    writeField('gateway', 'description', 'Gateway', tmpDir);

    const results = resolveAllLinks(tmpDir);
    expect(results.has('auth')).toBe(true);
  });
});

describe('resolveLinksForElement', () => {
  it('resolves links for a specific element', () => {
    writeField('auth', 'description', 'Auth', tmpDir);
    writeField('auth', 'diagram', 'graph LR\n    @gateway', tmpDir);
    writeField('gateway', 'description', 'Gateway', tmpDir);

    const resolutions = resolveLinksForElement('auth', tmpDir);
    expect(resolutions.length).toBeGreaterThan(0);
  });
});

describe('formatResolutions', () => {
  it('formats resolved links', () => {
    const resolutions = [{
      type: 'resolved' as const,
      chain: ['a', 'b', 'c'],
      terminal: 'c',
    }];

    const lines = formatResolutions(resolutions);
    expect(lines.some(l => l.includes('a → b → c'))).toBe(true);
    expect(lines.some(l => l.includes('Resolved'))).toBe(true);
  });

  it('formats broken links', () => {
    const resolutions = [{
      type: 'broken' as const,
      chain: ['a', 'missing'],
      missing: 'missing',
    }];

    const lines = formatResolutions(resolutions);
    expect(lines.some(l => l.includes('Broken'))).toBe(true);
    expect(lines.some(l => l.includes('missing'))).toBe(true);
  });

  it('formats cycles', () => {
    const resolutions = [{
      type: 'cycle' as const,
      chain: ['a', 'b', 'a'],
    }];

    const lines = formatResolutions(resolutions);
    expect(lines.some(l => l.includes('Cycle'))).toBe(true);
  });
});
