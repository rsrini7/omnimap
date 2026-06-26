import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import {
  getChangedFiles,
  loadElementIndex,
  planIncrementalUpdate,
  markElementSources,
  recordScanGeneration,
  globToRegex,
} from '../lib/incremental.js';
import { writeField, initOmm } from '../lib/store.js';

let tmpDir: string;
let savedCwd: string;

function sh(cmd: string): string {
  return execSync(cmd, { cwd: tmpDir, stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8' }).trim();
}

function git(cwd: string, ...args: string[]): string {
  return execSync(`git ${args.join(' ')}`, { cwd, stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8' }).trim();
}

function setupRepo(): void {
  git(tmpDir, 'init', '-q');
  git(tmpDir, 'config', 'user.email', 'test@test.com');
  git(tmpDir, 'config', 'user.name', 'Test');
  git(tmpDir, 'config', 'commit.gpgsign', 'false');
}

function touch(relPath: string, content = ''): void {
  const abs = path.join(tmpDir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

beforeEach(() => {
  savedCwd = process.cwd();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omm-incr-'));
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(savedCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('globToRegex', () => {
  it('matches * (any non-slash chars)', () => {
    const re = globToRegex('src/*.ts');
    expect(re.test('src/foo.ts')).toBe(true);
    expect(re.test('src/foo/bar.ts')).toBe(false);
  });

  it('matches ** across path segments', () => {
    const re = globToRegex('src/**/*.ts');
    expect(re.test('src/foo.ts')).toBe(true);
    expect(re.test('src/foo/bar.ts')).toBe(true);
    expect(re.test('src/foo/bar/baz.ts')).toBe(true);
    expect(re.test('lib/foo.ts')).toBe(false);
  });

  it('handles ? for single char', () => {
    const re = globToRegex('src/?.ts');
    expect(re.test('src/a.ts')).toBe(true);
    expect(re.test('src/ab.ts')).toBe(false);
  });

  it('handles {a,b} alternation', () => {
    const re = globToRegex('src/{foo,bar}.ts');
    expect(re.test('src/foo.ts')).toBe(true);
    expect(re.test('src/bar.ts')).toBe(true);
    expect(re.test('src/baz.ts')).toBe(false);
  });

  it('escapes regex metachars in literal segments', () => {
    const re = globToRegex('src/file.name.ts');
    expect(re.test('src/file.name.ts')).toBe(true);
    expect(re.test('src/fileXnameXts')).toBe(false);
  });
});

describe('getChangedFiles', () => {
  it('returns empty list when not in a git repo', () => {
    expect(getChangedFiles(tmpDir)).toEqual([]);
  });

  it('returns uncommitted modifications', () => {
    setupRepo();
    touch('a.ts', 'a');
    git(tmpDir, 'add', '.');
    git(tmpDir, 'commit', '-q', '-m', 'initial');
    touch('a.ts', 'a modified');
    const files = getChangedFiles(tmpDir);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('a.ts');
    expect(files[0].status).toBe('modified');
  });

  it('returns untracked files', () => {
    setupRepo();
    touch('a.ts', 'a');
    git(tmpDir, 'add', '.');
    git(tmpDir, 'commit', '-q', '-m', 'initial');
    touch('new.ts', 'new');
    const files = getChangedFiles(tmpDir);
    expect(files.some(f => f.path === 'new.ts' && f.status === 'untracked')).toBe(true);
  });

  it('returns committed changes since a given ref', () => {
    setupRepo();
    touch('a.ts', 'a');
    git(tmpDir, 'add', '.');
    git(tmpDir, 'commit', '-q', '-m', 'c1');
    const baseline = sh('git rev-parse HEAD');
    touch('a.ts', 'a2');
    touch('b.ts', 'b');
    git(tmpDir, 'add', '.');
    git(tmpDir, 'commit', '-q', '-m', 'c2');
    const files = getChangedFiles(tmpDir, baseline);
    const paths = files.map(f => f.path);
    expect(paths).toContain('a.ts');
    expect(paths).toContain('b.ts');
  });
});

describe('loadElementIndex', () => {
  it('returns empty when .omm/ is missing', () => {
    expect(loadElementIndex(path.join(tmpDir, '.omm'))).toEqual([]);
  });

  it('walks nested elements', () => {
    initOmm(tmpDir);
    writeField('persp1', 'description', 'top level', tmpDir);
    writeField('persp1/child', 'description', 'nested', tmpDir);
    writeField('persp1/child/leaf', 'description', 'deep', tmpDir);
    const index = loadElementIndex(path.join(tmpDir, '.omm'));
    const paths = index.map(e => e.elementPath).sort();
    expect(paths).toEqual(['persp1', 'persp1/child', 'persp1/child/leaf']);
  });
});

describe('markElementSources', () => {
  it('marks source files and globs', () => {
    initOmm(tmpDir);
    writeField('persp1', 'description', 'top level', tmpDir);
    markElementSources('persp1', { files: ['src/foo.ts'], globs: ['src/**/*.ts'] }, path.join(tmpDir, '.omm'));
    const el = loadElementIndex(path.join(tmpDir, '.omm')).find(e => e.elementPath === 'persp1')!;
    expect(el.meta.source_files).toEqual(['src/foo.ts']);
    expect(el.meta.source_globs).toEqual(['src/**/*.ts']);
  });

  it('appends by default; replaces with replaceFiles/replaceGlobs', () => {
    initOmm(tmpDir);
    writeField('persp1', 'description', 'top level', tmpDir);
    markElementSources('persp1', { files: ['src/a.ts'] }, path.join(tmpDir, '.omm'));
    markElementSources('persp1', { files: ['src/b.ts'] }, path.join(tmpDir, '.omm'));
    let el = loadElementIndex(path.join(tmpDir, '.omm')).find(e => e.elementPath === 'persp1')!;
    expect(el.meta.source_files).toEqual(['src/a.ts', 'src/b.ts']);
    markElementSources('persp1', { files: ['src/c.ts'], replaceFiles: true }, path.join(tmpDir, '.omm'));
    el = loadElementIndex(path.join(tmpDir, '.omm')).find(e => e.elementPath === 'persp1')!;
    expect(el.meta.source_files).toEqual(['src/c.ts']);
  });

  it('throws when element does not exist', () => {
    initOmm(tmpDir);
    expect(() =>
      markElementSources('nope', { files: ['x.ts'] }, path.join(tmpDir, '.omm'))
    ).toThrow(/not found/);
  });
});

describe('planIncrementalUpdate', () => {
  it('classifies elements with no source tracking as unknown when there are no changes', () => {
    initOmm(tmpDir);
    writeField('persp1', 'description', 'top level', tmpDir);
    writeField('persp1/child', 'description', 'nested', tmpDir);
    const plan = planIncrementalUpdate(path.join(tmpDir, '.omm'), tmpDir);
    expect(plan.unknown.sort()).toEqual(['persp1', 'persp1/child']);
    expect(plan.stale).toEqual([]);
    expect(plan.fresh).toEqual([]);
  });

  it('marks elements as stale when a tracked source file is modified', () => {
    setupRepo();
    initOmm(tmpDir);
    writeField('persp1', 'description', 'top', tmpDir);
    touch('src/foo.ts', 'foo');
    git(tmpDir, 'add', '.');
    git(tmpDir, 'commit', '-q', '-m', 'baseline');
    markElementSources('persp1', { files: ['src/foo.ts'] }, path.join(tmpDir, '.omm'));
    touch('src/foo.ts', 'foo modified');

    const plan = planIncrementalUpdate(path.join(tmpDir, '.omm'), tmpDir);
    expect(plan.stale).toHaveLength(1);
    expect(plan.stale[0].elementPath).toBe('persp1');
    expect(plan.stale[0].reasons).toContain('source_file');
    expect(plan.stale[0].matchedFiles).toContain('src/foo.ts');
  });

  it('marks elements as stale when a file matching a glob is modified', () => {
    setupRepo();
    initOmm(tmpDir);
    writeField('persp1', 'description', 'top', tmpDir);
    touch('src/deep/nested/file.ts', '//');
    git(tmpDir, 'add', '.');
    git(tmpDir, 'commit', '-q', '-m', 'baseline');
    markElementSources('persp1', { globs: ['src/**/*.ts'] }, path.join(tmpDir, '.omm'));
    touch('src/deep/nested/file.ts', '// changed');

    const plan = planIncrementalUpdate(path.join(tmpDir, '.omm'), tmpDir);
    expect(plan.stale).toHaveLength(1);
    expect(plan.stale[0].elementPath).toBe('persp1');
    expect(plan.stale[0].reasons).toContain('source_glob');
  });

  it('leaves elements fresh when only unrelated files change', () => {
    setupRepo();
    initOmm(tmpDir);
    writeField('persp1', 'description', 'top', tmpDir);
    touch('src/foo.ts', 'foo');
    touch('lib/unrelated.ts', '//');
    git(tmpDir, 'add', '.');
    git(tmpDir, 'commit', '-q', '-m', 'baseline');
    markElementSources('persp1', { files: ['src/foo.ts'] }, path.join(tmpDir, '.omm'));
    touch('lib/unrelated.ts', '// changed');

    const plan = planIncrementalUpdate(path.join(tmpDir, '.omm'), tmpDir);
    expect(plan.stale).toEqual([]);
    expect(plan.fresh).toEqual(['persp1']);
  });

  it('uses per-element scan_generation baseline', () => {
    setupRepo();
    initOmm(tmpDir);
    writeField('persp1', 'description', 'top', tmpDir);
    touch('src/foo.ts', 'foo');
    markElementSources('persp1', { files: ['src/foo.ts'] }, path.join(tmpDir, '.omm'));

    git(tmpDir, 'add', '.');
    git(tmpDir, 'commit', '-q', '-m', 'baseline');
    recordScanGeneration('persp1', 'full', path.join(tmpDir, '.omm'));

    touch('src/foo.ts', 'foo after');
    git(tmpDir, 'add', '.');
    git(tmpDir, 'commit', '-q', '-m', 'change');

    const plan = planIncrementalUpdate(path.join(tmpDir, '.omm'), tmpDir);
    expect(plan.stale).toHaveLength(1);
    expect(plan.stale[0].elementPath).toBe('persp1');
    expect(plan.stale[0].matchedFiles).toContain('src/foo.ts');
    expect(plan.since).toBeUndefined();
  });

  it('honors --since override', () => {
    setupRepo();
    initOmm(tmpDir);
    writeField('persp1', 'description', 'top', tmpDir);
    touch('src/foo.ts', 'foo');
    markElementSources('persp1', { files: ['src/foo.ts'] }, path.join(tmpDir, '.omm'));
    git(tmpDir, 'add', '.');
    git(tmpDir, 'commit', '-q', '-m', 'baseline');
    touch('src/foo.ts', 'changed');
    git(tmpDir, 'add', '.');
    git(tmpDir, 'commit', '-q', '-m', 'change');
    const initialCommit = sh('git rev-list --max-parents=0 HEAD');

    const plan = planIncrementalUpdate(path.join(tmpDir, '.omm'), tmpDir, { since: initialCommit });
    expect(plan.stale).toHaveLength(1);
    expect(plan.since).toBe(initialCommit);
  });

  it('detects mtime-only changes when a gitignored tracked file is modified', () => {
    setupRepo();
    initOmm(tmpDir);
    writeField('persp1', 'description', 'top', tmpDir);
    // Commit a .gitignore that hides the tracked file from git, so the only
    // signal we have is mtime.
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'src/\n');
    git(tmpDir, 'add', '.gitignore');
    git(tmpDir, 'commit', '-q', '-m', 'ignore');
    touch('src/foo.ts', 'foo');
    markElementSources('persp1', { files: ['src/foo.ts'] }, path.join(tmpDir, '.omm'));
    const future = new Date(Date.now() + 60_000);
    fs.utimesSync(path.join(tmpDir, 'src/foo.ts'), future, future);

    const plan = planIncrementalUpdate(path.join(tmpDir, '.omm'), tmpDir);
    expect(plan.stale).toHaveLength(1);
    expect(plan.stale[0].reasons).toContain('source_file_mtime');
  });

  it('handles a non-git directory', () => {
    initOmm(tmpDir);
    writeField('persp1', 'description', 'top', tmpDir);
    const plan = planIncrementalUpdate(path.join(tmpDir, '.omm'), tmpDir);
    expect(plan.noGit).toBe(true);
    expect(plan.unknown).toEqual(['persp1']);
  });

  it('marks nested element stale independently from parent', () => {
    setupRepo();
    initOmm(tmpDir);
    writeField('persp1', 'description', 'top', tmpDir);
    writeField('persp1/child', 'description', 'nested', tmpDir);
    touch('src/foo.ts', 'foo');
    touch('src/bar.ts', 'bar');
    git(tmpDir, 'add', '.');
    git(tmpDir, 'commit', '-q', '-m', 'baseline');
    markElementSources('persp1', { files: ['src/foo.ts'] }, path.join(tmpDir, '.omm'));
    markElementSources('persp1/child', { files: ['src/bar.ts'] }, path.join(tmpDir, '.omm'));
    touch('src/bar.ts', 'changed');

    const plan = planIncrementalUpdate(path.join(tmpDir, '.omm'), tmpDir);
    expect(plan.stale.map(s => s.elementPath)).toEqual(['persp1/child']);
    expect(plan.fresh).toEqual(['persp1']);
  });
});
