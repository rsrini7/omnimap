import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { updateMeta } from '../lib/meta.js';
import { initOmm, writeField, readMeta } from '../lib/store.js';

let tmpDir: string;
let savedCwd: string;

beforeEach(() => {
  savedCwd = process.cwd();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omm-meta-'));
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(savedCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('updateMeta', () => {
  it('creates meta.yaml on first update', () => {
    initOmm(tmpDir);
    fs.mkdirSync(path.join(tmpDir, '.omm', 'my-class'), { recursive: true });
    updateMeta('my-class', 'description', tmpDir);
    const meta = readMeta('my-class', tmpDir);
    expect(meta).toBeTruthy();
    expect(meta!.update_count).toBe(1);
    expect(meta!.last_field).toBe('description');
    expect(meta!.updated).toBeTruthy();
  });

  it('increments update_count', () => {
    initOmm(tmpDir);
    fs.mkdirSync(path.join(tmpDir, '.omm', 'my-class'), { recursive: true });
    updateMeta('my-class', 'description', tmpDir);
    updateMeta('my-class', 'diagram', tmpDir);
    const meta = readMeta('my-class', tmpDir);
    expect(meta!.update_count).toBe(2);
    expect(meta!.last_field).toBe('diagram');
  });

  it('preserves existing fields', () => {
    initOmm(tmpDir);
    fs.mkdirSync(path.join(tmpDir, '.omm', 'my-class'), { recursive: true });
    updateMeta('my-class', 'description', tmpDir);
    const meta1 = readMeta('my-class', tmpDir);
    const created = meta1!.created;
    updateMeta('my-class', 'diagram', tmpDir);
    const meta2 = readMeta('my-class', tmpDir);
    expect(meta2!.created).toBe(created);
  });
});
