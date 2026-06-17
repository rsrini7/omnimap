import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  initArchRepo,
  listArchProjects,
  walkDir,
  copyFiles,
  diffDirs,
  getArchTarget,
  getProjectName,
} from '../lib/arch.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omm-arch-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('initArchRepo', () => {
  it('creates .omm/ and config.yaml', () => {
    const repoPath = path.join(tmpDir, 'my-repo');
    initArchRepo(repoPath);
    expect(fs.existsSync(path.join(repoPath, '.omm'))).toBe(true);
    expect(fs.existsSync(path.join(repoPath, '.omm', 'config.yaml'))).toBe(true);
  });

  it('does not overwrite existing config.yaml', () => {
    const repoPath = path.join(tmpDir, 'my-repo');
    fs.mkdirSync(path.join(repoPath, '.omm'), { recursive: true });
    fs.writeFileSync(path.join(repoPath, '.omm', 'config.yaml'), 'custom: true');
    initArchRepo(repoPath);
    expect(fs.readFileSync(path.join(repoPath, '.omm', 'config.yaml'), 'utf-8')).toBe('custom: true');
  });
});

describe('listArchProjects', () => {
  it('returns empty for non-existent repo', () => {
    expect(listArchProjects(path.join(tmpDir, 'nope'))).toEqual([]);
  });

  it('lists project directories', () => {
    const repoPath = path.join(tmpDir, 'repo');
    fs.mkdirSync(path.join(repoPath, '.omm', 'project-a'), { recursive: true });
    fs.mkdirSync(path.join(repoPath, '.omm', 'project-b'), { recursive: true });
    fs.writeFileSync(path.join(repoPath, '.omm', 'config.yaml'), 'version: 0.1.0');
    expect(listArchProjects(repoPath)).toEqual(['project-a', 'project-b']);
  });

  it('ignores config.yaml and dotfiles', () => {
    const repoPath = path.join(tmpDir, 'repo');
    fs.mkdirSync(path.join(repoPath, '.omm', 'project-a'), { recursive: true });
    fs.writeFileSync(path.join(repoPath, '.omm', 'config.yaml'), '');
    fs.mkdirSync(path.join(repoPath, '.omm', '.hidden'), { recursive: true });
    expect(listArchProjects(repoPath)).toEqual(['project-a']);
  });
});

describe('walkDir', () => {
  it('returns empty for non-existent dir', () => {
    expect(walkDir(path.join(tmpDir, 'nope'))).toEqual([]);
  });

  it('walks files recursively', () => {
    fs.mkdirSync(path.join(tmpDir, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'a');
    fs.writeFileSync(path.join(tmpDir, 'sub', 'b.txt'), 'b');
    const files = walkDir(tmpDir);
    const relPaths = files.map(f => f.relPath).sort();
    expect(relPaths).toEqual(['a.txt', 'sub/b.txt']);
  });
});

describe('copyFiles', () => {
  it('copies files to destination', () => {
    const src = path.join(tmpDir, 'src');
    const dest = path.join(tmpDir, 'dest');
    fs.mkdirSync(path.join(src, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(src, 'a.txt'), 'hello');
    fs.writeFileSync(path.join(src, 'sub', 'b.txt'), 'world');
    const files = walkDir(src);
    const count = copyFiles(src, dest, files);
    expect(count).toBe(2);
    expect(fs.readFileSync(path.join(dest, 'a.txt'), 'utf-8')).toBe('hello');
    expect(fs.readFileSync(path.join(dest, 'sub', 'b.txt'), 'utf-8')).toBe('world');
  });
});

describe('diffDirs', () => {
  it('detects added, modified, and removed files', () => {
    const dirA = path.join(tmpDir, 'a');
    const dirB = path.join(tmpDir, 'b');
    fs.mkdirSync(dirA); fs.mkdirSync(dirB);
    // Shared file
    fs.writeFileSync(path.join(dirA, 'shared.md'), 'v1');
    fs.writeFileSync(path.join(dirB, 'shared.md'), 'v2');
    // Only in A (added)
    fs.writeFileSync(path.join(dirA, 'new.md'), 'new');
    // Only in B (removed)
    fs.writeFileSync(path.join(dirB, 'old.md'), 'old');

    const diff = diffDirs(dirA, dirB);
    expect(diff.added).toContain('new.md');
    expect(diff.modified).toContain('shared.md');
    expect(diff.removed).toContain('old.md');
  });
});

describe('getArchTarget', () => {
  it('returns correct path', () => {
    expect(getArchTarget('/repo', 'my-project')).toBe('/repo/.omm/my-project');
  });
});

describe('getProjectName', () => {
  it('returns basename of cwd', () => {
    expect(getProjectName('/home/user/my-project')).toBe('my-project');
  });
});
