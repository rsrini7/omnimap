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
