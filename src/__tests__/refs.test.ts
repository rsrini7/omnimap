import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { extractRefs, getOutgoingRefs, getIncomingRefs, buildRefGraph } from '../lib/refs.js';
import { initOmm, writeField } from '../lib/store.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omm-refs-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('extractRefs', () => {
  it('extracts @ref names from diagram text', () => {
    const text = `graph LR\nA --> @auth-service\nB --> @database`;
    const refs = extractRefs(text);
    expect(refs).toContain('auth-service');
    expect(refs).toContain('database');
  });

  it('returns empty array for no refs', () => {
    const text = `graph LR\nA --> B`;
    expect(extractRefs(text)).toEqual([]);
  });

  it('deduplicates refs', () => {
    const text = `graph LR\nA --> @auth\nB --> @auth`;
    const refs = extractRefs(text);
    expect(refs.filter(r => r === 'auth')).toHaveLength(1);
  });
});

describe('getOutgoingRefs', () => {
  it('returns outgoing refs from a diagram', () => {
    initOmm(tmpDir);
    writeField('api', 'diagram', 'graph LR\nA --> @auth-service', tmpDir);
    const refs = getOutgoingRefs('api', tmpDir);
    expect(refs.length).toBe(1);
    expect(refs[0].target_class).toBe('auth-service');
    expect(refs[0].source_class).toBe('api');
  });

  it('returns empty when no diagram', () => {
    initOmm(tmpDir);
    writeField('api', 'description', 'some text', tmpDir);
    expect(getOutgoingRefs('api', tmpDir)).toEqual([]);
  });
});

describe('getIncomingRefs', () => {
  it('returns classes that reference the target', () => {
    initOmm(tmpDir);
    writeField('api', 'diagram', 'graph LR\nA --> @auth-service', tmpDir);
    writeField('gateway', 'diagram', 'graph LR\nA --> @auth-service', tmpDir);
    writeField('auth-service', 'description', 'auth', tmpDir);
    const refs = getIncomingRefs('auth-service', tmpDir);
    expect(refs.length).toBe(2);
    const sources = refs.map(r => r.source_class);
    expect(sources).toContain('api');
    expect(sources).toContain('gateway');
  });
});

describe('buildRefGraph', () => {
  it('builds graph from all classes', () => {
    initOmm(tmpDir);
    writeField('api', 'diagram', 'graph LR\nA --> @auth', tmpDir);
    writeField('auth', 'diagram', 'graph LR\nA --> @db', tmpDir);
    const graph = buildRefGraph(tmpDir);
    expect(graph.length).toBe(2);
  });
});
