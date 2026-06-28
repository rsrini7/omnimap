import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initOmm, writeField } from '../lib/store.js';
import {
  buildCoverageMap,
  computeCoverageStats,
  findOrphanedElements,
  walkSourceTree,
  globToRegex,
} from '../lib/treecode.js';
import { commandTreecode } from '../commands/treecode.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omm-treecode-test-'));
  initOmm(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('globToRegex', () => {
  it('matches literal strings', () => {
    const regex = globToRegex('src/auth/index.ts');
    expect(regex.test('src/auth/index.ts')).toBe(true);
    expect(regex.test('src/auth/other.ts')).toBe(false);
  });

  it('matches * wildcard', () => {
    const regex = globToRegex('src/*.ts');
    expect(regex.test('src/index.ts')).toBe(true);
    expect(regex.test('src/auth/index.ts')).toBe(false);
  });

  it('matches ** wildcard', () => {
    const regex = globToRegex('src/**/*.ts');
    expect(regex.test('src/index.ts')).toBe(true);
    expect(regex.test('src/auth/index.ts')).toBe(true);
    expect(regex.test('src/auth/deep/file.ts')).toBe(true);
  });

  it('matches ? wildcard', () => {
    const regex = globToRegex('file?.ts');
    expect(regex.test('file1.ts')).toBe(true);
    expect(regex.test('fileA.ts')).toBe(true);
    expect(regex.test('file12.ts')).toBe(false);
  });
});

describe('walkSourceTree', () => {
  it('finds all files', () => {
    fs.writeFileSync(path.join(tmpDir, 'file1.ts'), '');
    fs.writeFileSync(path.join(tmpDir, 'file2.js'), '');
    fs.mkdirSync(path.join(tmpDir, 'sub'));
    fs.writeFileSync(path.join(tmpDir, 'sub', 'file3.ts'), '');

    const files = walkSourceTree(tmpDir, tmpDir);
    expect(files).toContain('file1.ts');
    expect(files).toContain('file2.js');
    expect(files).toContain('sub/file3.ts');
  });

  it('ignores node_modules', () => {
    fs.mkdirSync(path.join(tmpDir, 'node_modules'));
    fs.writeFileSync(path.join(tmpDir, 'node_modules', 'pkg.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'index.ts'), '');

    const files = walkSourceTree(tmpDir, tmpDir);
    expect(files).toContain('index.ts');
    expect(files.some(f => f.includes('node_modules'))).toBe(false);
  });

  it('ignores dot directories', () => {
    fs.mkdirSync(path.join(tmpDir, '.git'));
    fs.writeFileSync(path.join(tmpDir, '.git', 'config'), '');
    fs.writeFileSync(path.join(tmpDir, 'index.ts'), '');

    const files = walkSourceTree(tmpDir, tmpDir);
    expect(files).toContain('index.ts');
    expect(files.some(f => f.includes('.git'))).toBe(false);
  });
});

describe('buildCoverageMap', () => {
  it('maps files to elements via heuristic', () => {
    // Create source files
    fs.mkdirSync(path.join(tmpDir, 'src', 'auth'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src', 'auth', 'index.ts'), '');
    fs.writeFileSync(path.join(tmpDir, 'src', 'auth', 'jwt.ts'), '');

    // Create .omm/ element with matching name
    writeField('auth', 'description', 'Auth', tmpDir);

    const entries = buildCoverageMap(path.join(tmpDir, 'src'), path.join(tmpDir, '.omm'));
    expect(entries.length).toBe(2);
    expect(entries[0].elementPath).toBe('auth');
    expect(entries[0].matchMethod).toBe('heuristic');
  });

  it('maps files via source_files', () => {
    fs.writeFileSync(path.join(tmpDir, 'index.ts'), '');
    writeField('main', 'description', 'Main', tmpDir);

    // Add source_files to meta
    const metaPath = path.join(tmpDir, '.omm', 'main', 'meta.yaml');
    const meta = YAML.parse(fs.readFileSync(metaPath, 'utf-8'));
    meta.source_files = ['index.ts'];
    fs.writeFileSync(metaPath, YAML.stringify(meta));

    const entries = buildCoverageMap(tmpDir, path.join(tmpDir, '.omm'));
    const entry = entries.find(e => e.sourcePath === 'index.ts');
    expect(entry?.elementPath).toBe('main');
    expect(entry?.matchMethod).toBe('source_files');
  });

  it('returns null elementPath for uncovered files', () => {
    fs.writeFileSync(path.join(tmpDir, 'orphan.ts'), '');

    const entries = buildCoverageMap(tmpDir, path.join(tmpDir, '.omm'));
    const entry = entries.find(e => e.sourcePath === 'orphan.ts');
    expect(entry?.elementPath).toBeNull();
    expect(entry?.matchMethod).toBeNull();
  });
});

describe('computeCoverageStats', () => {
  it('computes coverage percentage', () => {
    fs.writeFileSync(path.join(tmpDir, 'covered.ts'), '');
    fs.writeFileSync(path.join(tmpDir, 'uncovered.ts'), '');
    writeField('covered', 'description', 'Covered', tmpDir);

    const entries = buildCoverageMap(tmpDir, path.join(tmpDir, '.omm'));
    const stats = computeCoverageStats(entries, path.join(tmpDir, '.omm'));

    expect(stats.sourceFiles).toBe(2);
    expect(stats.coveredFiles).toBe(1);
    expect(stats.uncoveredFiles).toBe(1);
    expect(stats.coveragePercent).toBe(50);
  });

  it('counts tracking methods', () => {
    writeField('auth', 'description', 'Auth', tmpDir);

    const entries = buildCoverageMap(tmpDir, path.join(tmpDir, '.omm'));
    const stats = computeCoverageStats(entries, path.join(tmpDir, '.omm'));

    expect(stats.trackingMethod.heuristic).toBeGreaterThan(0);
  });
});

describe('findOrphanedElements', () => {
  it('finds elements with no matching source', () => {
    writeField('orphan', 'description', 'Orphaned', tmpDir);

    // No source files matching 'orphan'
    const entries = buildCoverageMap(tmpDir, path.join(tmpDir, '.omm'));
    const orphans = findOrphanedElements(entries, path.join(tmpDir, '.omm'));

    expect(orphans.some(o => o.elementPath === 'orphan')).toBe(true);
  });

  it('does not flag elements with matching source', () => {
    fs.writeFileSync(path.join(tmpDir, 'auth.ts'), '');
    writeField('auth', 'description', 'Auth', tmpDir);

    const entries = buildCoverageMap(tmpDir, path.join(tmpDir, '.omm'));
    const orphans = findOrphanedElements(entries, path.join(tmpDir, '.omm'));

    expect(orphans.some(o => o.elementPath === 'auth')).toBe(false);
  });
});

describe('commandTreecode CLI', () => {
  it('shows coverage stats with --stats', () => {
    writeField('auth', 'description', 'Auth', tmpDir);
    const stdout = captureStdout(() => {
      commandTreecode(['--stats'], tmpDir);
    });
    expect(stdout).toContain('Code ↔ Docs Coverage Map');
    expect(stdout).toContain('Source files:');
    expect(stdout).toContain('Covered files:');
  });

  it('shows uncovered files with --uncovered', () => {
    fs.writeFileSync(path.join(tmpDir, 'orphan.ts'), '');
    writeField('auth', 'description', 'Auth', tmpDir);

    const stdout = captureStdout(() => {
      commandTreecode(['--uncovered'], tmpDir);
    });
    expect(stdout).toContain('Uncovered source files');
    expect(stdout).toContain('orphan.ts');
  });

  it('outputs JSON with --json', () => {
    writeField('auth', 'description', 'Auth', tmpDir);
    const stdout = captureStdout(() => {
      commandTreecode(['--json'], tmpDir);
    });
    const parsed = JSON.parse(stdout);
    expect(parsed.entries).toBeDefined();
    expect(Array.isArray(parsed.entries)).toBe(true);
  });

  it('shows help with --help', () => {
    const stdout = captureStdout(() => {
      commandTreecode(['--help'], tmpDir);
    });
    expect(stdout).toContain('omm treecode');
    expect(stdout).toContain('--uncovered');
  });
});

import YAML from 'yaml';

// Helper functions
function captureStdout(fn: () => void): string {
  const chunks: string[] = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk: any) => {
    chunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  };
  try {
    fn();
    return chunks.join('');
  } finally {
    process.stdout.write = originalWrite;
  }
}
