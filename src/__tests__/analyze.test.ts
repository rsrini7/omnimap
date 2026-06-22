import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { buildDependencyGraph, detectModuleBoundaries, formatAnalysisMarkdown, formatAnalysisJSON } from '../lib/analyzer/index.js';
import { fingerprintFile, hashDefinition, diffFingerprints, computeFingerprintDeltas } from '../lib/analyzer/fingerprint.js';
import { registerLanguage, getHandlerForFile, getSupportedExtensions, getRegisteredLanguages } from '../lib/analyzer/registry.js';
import type { FileAnalysis, DefinitionInfo, ImportInfo } from '../lib/analyzer/types.js';
import type { LanguageHandler } from '../lib/analyzer/registry.js';

// Import language handlers to trigger self-registration
import '../lib/analyzer/languages/javascript.js';
import '../lib/analyzer/languages/typescript.js';
import '../lib/analyzer/languages/java.js';
import '../lib/analyzer/languages/kotlin.js';
import '../lib/analyzer/languages/scala.js';
import '../lib/analyzer/languages/python.js';
import '../lib/analyzer/languages/go.js';
import '../lib/analyzer/languages/rust.js';

describe('registry', () => {
  it('returns handler for known extensions', () => {
    const handler = getHandlerForFile('test.ts');
    expect(handler).not.toBeNull();
    expect(handler!.name).toBe('typescript');
  });

  it('returns handler for .js files', () => {
    const handler = getHandlerForFile('test.js');
    expect(handler).not.toBeNull();
    expect(handler!.name).toBe('javascript');
  });

  it('returns null for unknown extensions', () => {
    const handler = getHandlerForFile('test.xyz');
    expect(handler).toBeNull();
  });

  it('returns supported extensions', () => {
    const exts = getSupportedExtensions();
    expect(exts).toContain('.ts');
    expect(exts).toContain('.js');
    expect(exts).toContain('.java');
    expect(exts).toContain('.kt');
    expect(exts).toContain('.scala');
    expect(exts).toContain('.py');
    expect(exts).toContain('.go');
    expect(exts).toContain('.rs');
  });

  it('returns registered languages', () => {
    const langs = getRegisteredLanguages();
    expect(langs).toContain('typescript');
    expect(langs).toContain('javascript');
    expect(langs).toContain('java');
    expect(langs).toContain('kotlin');
    expect(langs).toContain('scala');
    expect(langs).toContain('python');
    expect(langs).toContain('go');
    expect(langs).toContain('rust');
  });

  it('allows registering custom handlers', () => {
    const customHandler: LanguageHandler = {
      name: 'test-lang',
      extensions: ['.test'],
      extractImports: () => [],
      extractExports: () => [],
      extractDefinitions: () => [],
      extractCalls: () => [],
    };
    registerLanguage(customHandler);
    const handler = getHandlerForFile('foo.test');
    expect(handler).not.toBeNull();
    expect(handler!.name).toBe('test-lang');
  });
});

describe('buildDependencyGraph', () => {
  it('creates nodes for each file', () => {
    const analyses: FileAnalysis[] = [
      { file: 'src/a.ts', language: 'typescript', imports: [], exports: [{ name: 'foo', kind: 'function', line: 1 }], definitions: [], calls: [] },
      { file: 'src/b.ts', language: 'typescript', imports: [], exports: [{ name: 'bar', kind: 'function', line: 1 }], definitions: [], calls: [] },
    ];
    const graph = buildDependencyGraph(analyses);
    expect(graph.nodes.length).toBe(2);
    expect(graph.nodes[0].file).toBe('src/a.ts');
    expect(graph.nodes[1].file).toBe('src/b.ts');
  });

  it('creates edges for relative imports', () => {
    const analyses: FileAnalysis[] = [
      {
        file: 'src/a.ts', language: 'typescript',
        imports: [{ source: './b', specifiers: ['bar'], resolved: 'b', line: 1 }],
        exports: [], definitions: [], calls: [],
      },
      { file: 'src/b.ts', language: 'typescript', imports: [], exports: [], definitions: [], calls: [] },
    ];
    const graph = buildDependencyGraph(analyses);
    expect(graph.edges.length).toBe(1);
    expect(graph.edges[0].from).toBe('src/a.ts');
    expect(graph.edges[0].to).toBe('src/b.ts');
  });

  it('does not create self-referencing edges', () => {
    const analyses: FileAnalysis[] = [
      {
        file: 'src/a.ts', language: 'typescript',
        imports: [{ source: '.', specifiers: [], resolved: '.', line: 1 }],
        exports: [], definitions: [], calls: [],
      },
    ];
    const graph = buildDependencyGraph(analyses);
    expect(graph.edges.length).toBe(0);
  });

  it('merges duplicate edges', () => {
    const analyses: FileAnalysis[] = [
      {
        file: 'src/a.ts', language: 'typescript',
        imports: [
          { source: './b', specifiers: ['foo'], resolved: 'b', line: 1 },
          { source: './b', specifiers: ['bar'], resolved: 'b', line: 2 },
        ],
        exports: [], definitions: [], calls: [],
      },
      { file: 'src/b.ts', language: 'typescript', imports: [], exports: [], definitions: [], calls: [] },
    ];
    const graph = buildDependencyGraph(analyses);
    expect(graph.edges.length).toBe(1);
    expect(graph.edges[0].imports).toContain('foo');
    expect(graph.edges[0].imports).toContain('bar');
  });

  it('handles empty input', () => {
    const graph = buildDependencyGraph([]);
    expect(graph.nodes.length).toBe(0);
    expect(graph.edges.length).toBe(0);
  });
});

describe('detectModuleBoundaries', () => {
  it('groups files by directory', () => {
    const analyses: FileAnalysis[] = [
      { file: 'src/auth/login.ts', language: 'typescript', imports: [], exports: [], definitions: [], calls: [] },
      { file: 'src/auth/logout.ts', language: 'typescript', imports: [], exports: [], definitions: [], calls: [] },
      { file: 'src/api/handler.ts', language: 'typescript', imports: [], exports: [], definitions: [], calls: [] },
    ];
    const graph = buildDependencyGraph(analyses);
    const modules = detectModuleBoundaries(graph, analyses);
    const authModule = modules.find(m => m.name === 'auth');
    expect(authModule).toBeDefined();
    expect(authModule!.files.length).toBe(2);
  });

  it('skips directories with single files', () => {
    const analyses: FileAnalysis[] = [
      { file: 'src/single.ts', language: 'typescript', imports: [], exports: [], definitions: [], calls: [] },
    ];
    const graph = buildDependencyGraph(analyses);
    const modules = detectModuleBoundaries(graph, analyses);
    expect(modules.length).toBe(0);
  });

  it('computes cohesion score', () => {
    const analyses: FileAnalysis[] = [
      { file: 'src/mod/a.ts', language: 'typescript', imports: [{ source: './b', specifiers: ['x'], resolved: 'b', line: 1 }], exports: [], definitions: [], calls: [] },
      { file: 'src/mod/b.ts', language: 'typescript', imports: [{ source: './a', specifiers: ['y'], resolved: 'a', line: 1 }], exports: [], definitions: [], calls: [] },
      { file: 'src/mod/c.ts', language: 'typescript', imports: [{ source: '../other', specifiers: ['z'], resolved: 'other', line: 1 }], exports: [], definitions: [], calls: [] },
    ];
    const graph = buildDependencyGraph(analyses);
    const modules = detectModuleBoundaries(graph, analyses);
    const mod = modules.find(m => m.name === 'mod');
    expect(mod).toBeDefined();
    expect(mod!.cohesion).toBeGreaterThan(0);
    expect(mod!.cohesion).toBeLessThanOrEqual(1);
  });
});

describe('fingerprint', () => {
  it('creates consistent hashes for same definition', () => {
    const def: DefinitionInfo = { name: 'foo', kind: 'function', line: 1, endLine: 10, exported: true };
    const hash1 = hashDefinition(def);
    const hash2 = hashDefinition(def);
    expect(hash1).toBe(hash2);
  });

  it('creates different hashes for different definitions', () => {
    const def1: DefinitionInfo = { name: 'foo', kind: 'function', line: 1, endLine: 10, exported: true };
    const def2: DefinitionInfo = { name: 'bar', kind: 'function', line: 1, endLine: 10, exported: true };
    expect(hashDefinition(def1)).not.toBe(hashDefinition(def2));
  });

  it('fingerprints file with definitions', () => {
    const defs: DefinitionInfo[] = [
      { name: 'foo', kind: 'function', line: 1, endLine: 10, exported: true },
      { name: 'Bar', kind: 'class', line: 12, endLine: 20, exported: false },
    ];
    const fp = fingerprintFile('src/test.ts', defs);
    expect(fp.file).toBe('src/test.ts');
    expect(fp.hash).toBeTruthy();
    expect(fp.definitions.length).toBe(2);
    expect(fp.definitionHashes.size).toBe(2);
  });

  it('detects no changes for identical fingerprints', () => {
    const defs: DefinitionInfo[] = [
      { name: 'foo', kind: 'function', line: 1, endLine: 10, exported: true },
    ];
    const fp1 = fingerprintFile('test.ts', defs);
    const fp2 = fingerprintFile('test.ts', defs);
    const delta = diffFingerprints(fp1, fp2);
    expect(delta.hasChanges).toBe(false);
    expect(delta.added.length).toBe(0);
    expect(delta.removed.length).toBe(0);
  });

  it('detects added definitions', () => {
    const defs1: DefinitionInfo[] = [];
    const defs2: DefinitionInfo[] = [
      { name: 'foo', kind: 'function', line: 1, endLine: 10, exported: true },
    ];
    const fp1 = fingerprintFile('test.ts', defs1);
    const fp2 = fingerprintFile('test.ts', defs2);
    const delta = diffFingerprints(fp1, fp2);
    expect(delta.hasChanges).toBe(true);
    expect(delta.added.length).toBe(1);
    expect(delta.added[0].name).toBe('foo');
  });

  it('detects removed definitions', () => {
    const defs1: DefinitionInfo[] = [
      { name: 'foo', kind: 'function', line: 1, endLine: 10, exported: true },
    ];
    const defs2: DefinitionInfo[] = [];
    const fp1 = fingerprintFile('test.ts', defs1);
    const fp2 = fingerprintFile('test.ts', defs2);
    const delta = diffFingerprints(fp1, fp2);
    expect(delta.hasChanges).toBe(true);
    expect(delta.removed.length).toBe(1);
    expect(delta.removed[0].name).toBe('foo');
  });

  it('computeFingerprintDeltas detects new files', () => {
    const cache = new Map();
    const current = new Map([
      ['new.ts', [{ name: 'foo', kind: 'function' as const, line: 1, endLine: 10, exported: true }]],
    ]);
    const deltas = computeFingerprintDeltas(cache, current);
    expect(deltas.length).toBe(1);
    expect(deltas[0].hasChanges).toBe(true);
    expect(deltas[0].added.length).toBe(1);
  });

  it('computeFingerprintDeltas detects deleted files', () => {
    const cache = new Map([
      ['old.ts', fingerprintFile('old.ts', [{ name: 'bar', kind: 'function', line: 1, endLine: 5, exported: false }])],
    ]);
    const current = new Map();
    const deltas = computeFingerprintDeltas(cache, current);
    expect(deltas.length).toBe(1);
    expect(deltas[0].removed.length).toBe(1);
  });
});

describe('formatAnalysisMarkdown', () => {
  it('produces valid markdown', () => {
    const analyses: FileAnalysis[] = [
      {
        file: 'src/a.ts', language: 'typescript',
        imports: [{ source: './b', specifiers: ['foo'], resolved: 'b', line: 1 }],
        exports: [{ name: 'foo', kind: 'function', line: 1 }],
        definitions: [{ name: 'foo', kind: 'function', line: 1, endLine: 10, exported: true }],
        calls: [],
      },
      { file: 'src/b.ts', language: 'typescript', imports: [], exports: [], definitions: [], calls: [] },
    ];
    const graph = buildDependencyGraph(analyses);
    const modules = detectModuleBoundaries(graph, analyses);
    const result = { files: analyses, graph, modules, errors: [], stats: { totalFiles: 2, analyzedFiles: 2, skippedFiles: 0, errorFiles: 0, languages: { typescript: 2 } } };
    const md = formatAnalysisMarkdown(result);
    expect(md).toContain('Codebase Analysis');
    expect(md).toContain('Dependency Graph');
    expect(md).toContain('src/a.ts');
    expect(md).toContain('Public API Surface');
  });
});

describe('formatAnalysisJSON', () => {
  it('produces valid JSON', () => {
    const analyses: FileAnalysis[] = [
      { file: 'src/a.ts', language: 'typescript', imports: [], exports: [], definitions: [], calls: [] },
    ];
    const graph = buildDependencyGraph(analyses);
    const result = { files: analyses, graph, modules: [], errors: [], stats: { totalFiles: 1, analyzedFiles: 1, skippedFiles: 0, errorFiles: 0, languages: { typescript: 1 } } };
    const json = formatAnalysisJSON(result);
    const parsed = JSON.parse(json);
    expect(parsed.files.length).toBe(1);
    expect(parsed.stats.analyzedFiles).toBe(1);
  });
});
