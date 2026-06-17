import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { commandTag } from '../commands/tag.js';
import { initOmm, writeField, readMeta } from '../lib/store.js';

let tmpDir: string;
let savedCwd: string;
let stderr: string;
let stdout: string;

beforeEach(() => {
  savedCwd = process.cwd();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omm-tag-'));
  process.chdir(tmpDir);
  stderr = '';
  stdout = '';
  vi.spyOn(process.stderr, 'write').mockImplementation((msg: string | Uint8Array) => {
    stderr += String(msg);
    return true;
  });
  vi.spyOn(process.stdout, 'write').mockImplementation((msg: string | Uint8Array) => {
    stdout += String(msg);
    return true;
  });
});

afterEach(() => {
  process.chdir(savedCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('commandTag', () => {
  it('lists tags when no action specified', () => {
    initOmm(tmpDir);
    writeField('auth', 'description', 'auth service', tmpDir);
    commandTag(['auth']);
    expect(stdout).toContain('no tags');
  });

  it('adds tags', () => {
    initOmm(tmpDir);
    writeField('auth', 'description', 'auth service', tmpDir);
    commandTag(['auth', 'add', 'microservice,core']);
    expect(stderr).toContain('microservice');
    expect(stderr).toContain('core');
    const meta = readMeta('auth', tmpDir);
    expect(meta?.tags).toContain('microservice');
    expect(meta?.tags).toContain('core');
  });

  it('removes a tag', () => {
    initOmm(tmpDir);
    writeField('auth', 'description', 'auth service', tmpDir);
    commandTag(['auth', 'add', 'microservice,core']);
    commandTag(['auth', 'remove', 'core']);
    const meta = readMeta('auth', tmpDir);
    expect(meta?.tags).toContain('microservice');
    expect(meta?.tags).not.toContain('core');
  });

  it('replaces all tags', () => {
    initOmm(tmpDir);
    writeField('auth', 'description', 'auth service', tmpDir);
    commandTag(['auth', 'add', 'microservice,core']);
    commandTag(['auth', 'set', 'api,external']);
    const meta = readMeta('auth', tmpDir);
    expect(meta?.tags).toEqual(['api', 'external']);
  });

  it('lists added tags', () => {
    initOmm(tmpDir);
    writeField('auth', 'description', 'auth service', tmpDir);
    commandTag(['auth', 'set', 'microservice,core']);
    stdout = ''; // clear previous output
    commandTag(['auth']);
    expect(stdout).toContain('microservice');
    expect(stdout).toContain('core');
  });

  it('errors on missing perspective', () => {
    initOmm(tmpDir);
    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    commandTag(['nonexistent', 'add', 'tag']);
    expect(stderr).toContain('not found');
    mockExit.mockRestore();
  });
});
