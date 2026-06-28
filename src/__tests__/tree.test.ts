import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initOmm, writeField } from '../lib/store.js';
import { commandTree } from '../commands/tree.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omm-tree-test-'));
  initOmm(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('omm tree', () => {
  it('prints empty message when no perspectives exist', () => {
    const stderr = captureStderr(() => {
      commandTree(undefined, [], tmpDir);
    });
    expect(stderr).toContain('No perspectives found');
  });

  it('prints unicode tree for perspectives', () => {
    writeField('auth', 'description', 'Authentication', tmpDir);
    writeField('auth', 'diagram', 'graph LR\n    A --> B', tmpDir);
    writeField('data', 'description', 'Data flow', tmpDir);

    const stdout = captureStdout(() => {
      commandTree(undefined, [], tmpDir);
    });
    expect(stdout).toContain('auth');
    expect(stdout).toContain('data');
  });

  it('prints subtree for specific perspective', () => {
    writeField('auth', 'description', 'Authentication', tmpDir);
    writeField('auth', 'diagram', 'graph LR\n    A --> B', tmpDir);
    writeField('auth/jwt', 'description', 'JWT handling', tmpDir);

    const stdout = captureStdout(() => {
      commandTree('auth', [], tmpDir);
    });
    expect(stdout).toContain('auth');
    expect(stdout).toContain('jwt');
  });
});

describe('omm tree --yaml', () => {
  it('outputs YAML header with date', () => {
    writeField('auth', 'description', 'Authentication', tmpDir);

    const stdout = captureStdout(() => {
      commandTree(undefined, ['--yaml'], tmpDir);
    });
    expect(stdout).toMatch(/^# omm tree — \d{4}-\d{2}-\d{2}/);
  });

  it('outputs valid YAML structure', () => {
    writeField('auth', 'description', 'Authentication service', tmpDir);
    writeField('auth', 'diagram', 'graph LR\n    A --> B', tmpDir);

    const stdout = captureStdout(() => {
      commandTree(undefined, ['--yaml'], tmpDir);
    });
    expect(stdout).toContain('auth:');
    expect(stdout).toContain('description:');
    expect(stdout).toContain('Authentication service');
    expect(stdout).toContain('diagram: true');
  });

  it('truncates long descriptions', () => {
    const longDesc = 'A'.repeat(100);
    writeField('auth', 'description', longDesc, tmpDir);

    const stdout = captureStdout(() => {
      commandTree(undefined, ['--yaml'], tmpDir);
    });
    expect(stdout).toContain('...');
    expect(stdout).not.toContain('A'.repeat(100));
  });

  it('shows diagram as boolean', () => {
    writeField('auth', 'description', 'Auth', tmpDir);
    writeField('auth', 'diagram', 'graph LR\n    A --> B', tmpDir);

    const stdout = captureStdout(() => {
      commandTree(undefined, ['--yaml'], tmpDir);
    });
    expect(stdout).toContain('diagram: true');
  });

  it('shows diagram as false when missing', () => {
    writeField('auth', 'description', 'Auth', tmpDir);

    const stdout = captureStdout(() => {
      commandTree(undefined, ['--yaml'], tmpDir);
    });
    expect(stdout).toContain('diagram: false');
  });

  it('includes children in YAML output', () => {
    writeField('auth', 'description', 'Auth', tmpDir);
    writeField('auth', 'diagram', 'graph LR\n    A --> B', tmpDir);
    writeField('auth/jwt', 'description', 'JWT', tmpDir);
    writeField('auth/jwt', 'diagram', 'graph LR\n    C --> D', tmpDir);

    const stdout = captureStdout(() => {
      commandTree(undefined, ['--yaml'], tmpDir);
    });
    expect(stdout).toContain('children:');
    expect(stdout).toContain('jwt:');
  });

  it('handles --compact flag for JSON-like inline output', () => {
    writeField('auth', 'description', 'Auth', tmpDir);
    writeField('auth', 'diagram', 'graph LR\n    A --> B', tmpDir);

    const stdout = captureStdout(() => {
      commandTree(undefined, ['--yaml', '--compact'], tmpDir);
    });
    // Compact mode uses JSON.stringify (single line per object)
    expect(stdout).toContain('"description"');
    expect(stdout).toContain('"diagram"');
    // Should NOT have YAML indentation
    expect(stdout).not.toMatch(/^  description:/m);
  });

  it('outputs subtree YAML when path given', () => {
    writeField('auth', 'description', 'Auth', tmpDir);
    writeField('auth', 'diagram', 'graph LR\n    A --> B', tmpDir);
    writeField('auth/jwt', 'description', 'JWT', tmpDir);

    const stdout = captureStdout(() => {
      commandTree('auth', ['--yaml'], tmpDir);
    });
    expect(stdout).toContain('auth:');
    expect(stdout).toContain('jwt:');
  });

  it('excludes internal files from YAML output', () => {
    writeField('auth', 'description', 'Auth', tmpDir);
    writeField('auth', 'diagram', 'graph LR\n    A --> B', tmpDir);

    const stdout = captureStdout(() => {
      commandTree(undefined, ['--yaml'], tmpDir);
    });
    // Should NOT contain meta.yaml, flows.yaml, etc.
    expect(stdout).not.toContain('meta.yaml');
    expect(stdout).not.toContain('flows.yaml');
    expect(stdout).not.toContain('config.yaml');
  });
});

// Helper functions to capture stdout/stderr
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

function captureStderr(fn: () => void): string {
  const chunks: string[] = [];
  const originalWrite = process.stderr.write;
  process.stderr.write = (chunk: any) => {
    chunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  };
  try {
    fn();
    return chunks.join('');
  } finally {
    process.stderr.write = originalWrite;
  }
}
