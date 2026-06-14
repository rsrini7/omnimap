import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { searchOmm, invalidateSearchIndex, type SearchResult } from '../server/search.js';
import { writeField, initOmm } from '../lib/store.js';

let tmpDir: string;
let savedCwd: string;

beforeEach(() => {
  savedCwd = process.cwd();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omm-search-'));
  process.chdir(tmpDir);
  invalidateSearchIndex();
});

afterEach(() => {
  process.chdir(savedCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  invalidateSearchIndex();
});

function seed(): void {
  initOmm(tmpDir);
  // Persp-level description
  writeField('persp1', 'description', 'Authentication is the entry point for all requests in this service.', tmpDir);
  // Nested element (auth module) under persp1
  writeField('persp1/auth', 'description', 'The auth module validates JWT tokens on every protected route.', tmpDir);
  // Note in a sibling
  writeField('persp1/auth', 'note', 'Edge case: tokens may be expired; refresh flow lives here.', tmpDir);
  // A diagram (mermaid) somewhere
  writeField('persp1/auth', 'diagram', 'graph LR; A[Client] --> B[Auth]\nB --> C[API]', tmpDir);
  // A constraint
  writeField('persp1/payments', 'constraint', 'PCI compliance required for any payment flow.', tmpDir);
}

describe('searchOmm', () => {
  it('returns featured top-level perspectives for empty query', () => {
    seed();
    const res = searchOmm('');
    expect(res.featured).toBe(true);
    expect(res.results.length).toBeGreaterThan(0);
    expect(res.results[0].elementPath).toBe('persp1');
  });

  it('preserves full element path for nested hits', () => {
    seed();
    const res = searchOmm('JWT');
    expect(res.results.length).toBeGreaterThan(0);
    // Nested path must be preserved (not collapsed to perspective)
    const authHit = res.results.find(r => r.elementPath === 'persp1/auth');
    expect(authHit).toBeDefined();
    expect(authHit?.field).toBe('description');
  });

  it('returns empty results when no match', () => {
    seed();
    const res = searchOmm('nonexistentterm');
    expect(res.results).toEqual([]);
    expect(res.total).toBe(0);
  });

  it('highlights matched term in snippet with <mark>', () => {
    seed();
    const res = searchOmm('authentication');
    expect(res.results.length).toBeGreaterThan(0);
    const snippet = res.results[0].snippet;
    expect(snippet).toContain('<mark>');
    expect(snippet).toContain('</mark>');
  });
  it('escapes HTML in snippet text', () => {
    initOmm(tmpDir);
    writeField('xss-test', 'description', 'This has <script>alert(1)</script> in it.', tmpDir);
    const res = searchOmm('script');
    expect(res.results.length).toBeGreaterThan(0);
    const snippet = res.results[0].snippet;
    // Raw <script> and </script> tags must never appear; <mark> is the only allowed tag
    expect(snippet).not.toContain('<script>');
    expect(snippet).not.toContain('</script>');
    expect(snippet).toMatch(/&lt;[^&]*<mark>script<\/mark>[^&]*&gt;/);
  });

  it('ranks description matches above note matches', () => {
    seed();
    const res = searchOmm('tokens');
    const descHit = res.results.find(r => r.elementPath === 'persp1/auth' && r.field === 'description');
    const noteHit = res.results.find(r => r.elementPath === 'persp1/auth' && r.field === 'note');
    expect(descHit).toBeDefined();
    expect(noteHit).toBeDefined();
    expect(descHit!.score).toBeGreaterThan(noteHit!.score);
  });

  it('gives phrase boost when the literal query appears as substring', () => {
    initOmm(tmpDir);
    writeField('a', 'description', 'auth handler does auth handler auth handler things', tmpDir);
    writeField('b', 'description', 'handler auth and other handler auth tokens', tmpDir);
    const res = searchOmm('auth handler');
    const aHit = res.results.find(r => r.elementPath === 'a')!;
    const bHit = res.results.find(r => r.elementPath === 'b')!;
    expect(aHit).toBeDefined();
    expect(bHit).toBeDefined();
    expect(aHit.score).toBeGreaterThan(bHit.score);
  });
  it('ignores single-character tokens (falls back to featured when all tokens are 1 char)', () => {
    initOmm(tmpDir);
    writeField('a', 'description', 'a single character appears here', tmpDir);
    const res = searchOmm('a');
    // "a" is a single char → tokenize yields []. No real search runs; we surface featured perspectives.
    expect(res.featured).toBe(true);
    expect(res.results.every(r => r.score === 0)).toBe(true);
  });

  it('keeps multi-char tokens from a mixed query, dropping 1-char ones', () => {
    initOmm(tmpDir);
    writeField('a', 'description', 'authentication flow lives here', tmpDir);
    const res = searchOmm('a authentication');
    expect(res.featured).toBe(false);
    expect(res.results.length).toBe(1);
    expect(res.results[0].elementPath).toBe('a');
  });


  it('respects limit and offset pagination', () => {
    initOmm(tmpDir);
    for (let i = 0; i < 5; i++) {
      writeField(`persp${i}`, 'description', 'common keyword here for testing', tmpDir);
    }
    invalidateSearchIndex();
    const page1 = searchOmm('common', { limit: 2, offset: 0 });
    const page2 = searchOmm('common', { limit: 2, offset: 2 });
    expect(page1.results).toHaveLength(2);
    expect(page2.results).toHaveLength(2);
    expect(page1.total).toBe(5);
    const ids1 = new Set(page1.results.map(r => r.elementPath));
    for (const r of page2.results) {
      expect(ids1.has(r.elementPath)).toBe(false);
    }
  });

  it('clamps limit to max', () => {
    initOmm(tmpDir);
    writeField('a', 'description', 'match', tmpDir);
    const res = searchOmm('match', { limit: 1000 });
    // Should not throw; results are still bounded internally
    expect(res.results.length).toBeLessThanOrEqual(50);
  });

  it('returns no results when .omm/ does not exist', () => {
    // Don't initOmm — .omm/ is missing
    const res = searchOmm('anything');
    expect(res.results).toEqual([]);
    expect(res.total).toBe(0);
  });

  it('splits camelCase identifiers into tokens', () => {
    initOmm(tmpDir);
    writeField('persp1', 'description', 'we have authService that handles tokens', tmpDir);
    invalidateSearchIndex();
    const res = searchOmm('authService');
    expect(res.results.length).toBeGreaterThan(0);
  });

  it('does not index meta.yaml or config.yaml', () => {
    initOmm(tmpDir);
    writeField('persp1', 'description', 'real content about a keyword', tmpDir);
    invalidateSearchIndex();
    // meta.yaml is written by writeField — make sure it isn't indexed
    const res = searchOmm('created');
    // "created" is a meta.yaml key; if indexed we'd get a hit from meta.yaml
    expect(res.results).toEqual([]);
  });

  it('invalidates cache when invalidateSearchIndex is called', () => {
    initOmm(tmpDir);
    writeField('persp1', 'description', 'original content about ducks', tmpDir);
    invalidateSearchIndex();
    const before = searchOmm('ducks');
    expect(before.results.length).toBe(1);

    writeField('persp2', 'description', 'new content about ducks', tmpDir);
    // Cache still holds; same result count
    const stillCached = searchOmm('ducks');
    expect(stillCached.results.length).toBe(1);

    invalidateSearchIndex();
    const after = searchOmm('ducks');
    expect(after.results.length).toBe(2);
  });
});
