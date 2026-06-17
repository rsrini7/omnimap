import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initOmm, writeField } from '../lib/store.js';

let tmpDir: string;
let savedCwd: string;

beforeEach(() => {
  savedCwd = process.cwd();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omm-export-'));
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(savedCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Note: commandExport uses fetch (mermaid.ink) which is hard to test in unit tests.
// These tests verify the CLI argument parsing and element resolution logic.

describe('export command', () => {
  it('exports to file when -o is specified', async () => {
    initOmm(tmpDir);
    writeField('auth', 'diagram', 'graph LR\nA["Node A"] --> B["Node B"]', tmpDir);

    // Dynamically import to avoid issues with module loading
    const { commandExport } = await import('../commands/export.js');

    // Mock process.stderr.write to capture output
    let stderr = '';
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((msg: string | Uint8Array) => {
      stderr += String(msg);
      return true;
    });

    // Mock fetch to return a valid SVG
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('<svg viewBox="0 0 100 100"><rect/></svg>'),
    }) as any;

    const outFile = path.join(tmpDir, 'out.svg');
    await commandExport(['auth', '-o', outFile]);

    // Check that the file was created (or at least attempted)
    // The fetch mock handles the mermaid.ink call
    expect(stderr).toContain('Exporting');

    global.fetch = originalFetch;
    spy.mockRestore();
  });
});

describe('export --format html', () => {
  it('exports HTML to file when --format html and -o are specified', async () => {
    initOmm(tmpDir);
    writeField('auth', 'diagram', 'graph LR\nA["Node A"] --> B["Node B"]', tmpDir);
    writeField('auth', 'description', 'Auth description', tmpDir);

    const { commandExport } = await import('../commands/export.js');

    let stderr = '';
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((msg: string | Uint8Array) => {
      stderr += String(msg);
      return true;
    });

    const outFile = path.join(tmpDir, 'out.html');
    await commandExport(['auth', '--format', 'html', '-o', outFile]);

    expect(fs.existsSync(outFile)).toBe(true);
    expect(stderr).toContain('Exporting');
    expect(stderr).toContain('html');
    expect(stderr).toContain(outFile);

    const content = fs.readFileSync(outFile, 'utf-8');
    expect(content).toContain('<!DOCTYPE html>');
    expect(content).toContain('Auth description');

    spy.mockRestore();
  });

  it('exports HTML to stdout when --format html and no -o', async () => {
    initOmm(tmpDir);
    writeField('auth', 'diagram', 'graph LR\nA --> B', tmpDir);

    const { commandExport } = await import('../commands/export.js');

    let stdout = '';
    let stderr = '';
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation((msg: string | Uint8Array) => {
      stdout += String(msg);
      return true;
    });
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation((msg: string | Uint8Array) => {
      stderr += String(msg);
      return true;
    });

    await commandExport(['auth', '--format', 'html']);

    expect(stdout).toContain('<!DOCTYPE html>');
    expect(stderr).toContain('Exporting');

    outSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('infers html format from .html extension', async () => {
    initOmm(tmpDir);
    writeField('auth', 'diagram', 'graph LR\nA --> B', tmpDir);

    const { commandExport } = await import('../commands/export.js');

    let stderr = '';
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((msg: string | Uint8Array) => {
      stderr += String(msg);
      return true;
    });

    const outFile = path.join(tmpDir, 'output.html');
    await commandExport(['auth', '-o', outFile]);

    expect(fs.existsSync(outFile)).toBe(true);
    const content = fs.readFileSync(outFile, 'utf-8');
    expect(content).toContain('<!DOCTYPE html>');

    spy.mockRestore();
  });

  it('exports HTML with flows when defined', async () => {
    initOmm(tmpDir);
    writeField('auth', 'diagram', 'graph LR\nA --> B', tmpDir);
    const elemDir = path.join(tmpDir, '.omm', 'auth');
    fs.writeFileSync(path.join(elemDir, 'flows.yaml'),
      'flows:\n  - name: TestFlow\n    steps:\n      - node: A\n      - edge: A->B\n      - node: B\n');

    const { commandExport } = await import('../commands/export.js');

    let stderr = '';
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((msg: string | Uint8Array) => {
      stderr += String(msg);
      return true;
    });

    const outFile = path.join(tmpDir, 'out.html');
    await commandExport(['auth', '--format', 'html', '-o', outFile]);

    const content = fs.readFileSync(outFile, 'utf-8');
    expect(content).toContain('TestFlow');
    expect(content).toContain('flow-chip');

    spy.mockRestore();
  });

  it('errors when element has no diagram', async () => {
    initOmm(tmpDir);
    writeField('auth', 'description', 'no diagram', tmpDir);

    const { commandExport } = await import('../commands/export.js');

    let stderr = '';
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((msg: string | Uint8Array) => {
      stderr += String(msg);
      return true;
    });

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
      throw new Error('exit:' + code);
    });

    await expect(commandExport(['auth', '--format', 'html'])).rejects.toThrow('exit:1');
    expect(stderr).toContain('empty');

    spy.mockRestore();
    exitSpy.mockRestore();
  });

  it('rejects unsupported format', async () => {
    initOmm(tmpDir);
    writeField('auth', 'diagram', 'graph LR\nA --> B', tmpDir);

    const { commandExport } = await import('../commands/export.js');

    let stderr = '';
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((msg: string | Uint8Array) => {
      stderr += String(msg);
      return true;
    });

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
      throw new Error('exit:' + code);
    });

    await expect(commandExport(['auth', '--format', 'pdf'])).rejects.toThrow('exit:1');
    expect(stderr).toContain('unsupported format');

    spy.mockRestore();
    exitSpy.mockRestore();
  });
});
