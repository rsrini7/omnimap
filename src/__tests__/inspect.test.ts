import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initOmm, writeField, addLink } from '../lib/store.js';
import { commandInspect } from '../commands/inspect.js';
import type { LinkEntry } from '../types.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omm-inspect-test-'));
  initOmm(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('commandInspect', () => {
  it('shows error when element not found', () => {
    const exitCode = captureExit(() => {
      commandInspect(['nonexistent'], tmpDir);
    });
    expect(exitCode).toBe(1);
  });

  it('shows error when no element specified', () => {
    const exitCode = captureExit(() => {
      commandInspect([], tmpDir);
    });
    expect(exitCode).toBe(1);
  });

  it('shows help with --help flag', () => {
    const stdout = captureStdout(() => {
      commandInspect(['--help'], tmpDir);
    });
    expect(stdout).toContain('omm inspect');
    expect(stdout).toContain('--json');
  });

  it('inspects a basic perspective', () => {
    writeField('auth', 'description', 'Authentication service', tmpDir);
    writeField('auth', 'diagram', 'graph LR\n    A --> B', tmpDir);

    const stdout = captureStdout(() => {
      commandInspect(['auth'], tmpDir);
    });
    expect(stdout).toContain('Path:         auth');
    expect(stdout).toContain('perspective');
    expect(stdout).toContain('description');
    expect(stdout).toContain('diagram');
  });

  it('shows field coverage percentage', () => {
    writeField('auth', 'description', 'Auth', tmpDir);
    writeField('auth', 'diagram', 'graph LR\n    A --> B', tmpDir);

    const stdout = captureStdout(() => {
      commandInspect(['auth'], tmpDir);
    });
    // 2/7 fields = ~29%
    expect(stdout).toContain('coverage');
  });

  it('shows score from eval', () => {
    writeField('auth', 'description', 'Authentication service with enough words for good score', tmpDir);
    writeField('auth', 'diagram', 'graph LR\n    A --> B', tmpDir);
    writeField('auth', 'context', 'Auth context', tmpDir);
    writeField('auth', 'constraint', 'Auth constraint', tmpDir);
    writeField('auth', 'concern', 'Auth concern', tmpDir);
    writeField('auth', 'todo', '- [ ] Task', tmpDir);
    writeField('auth', 'note', 'Auth note', tmpDir);

    const stdout = captureStdout(() => {
      commandInspect(['auth'], tmpDir);
    });
    expect(stdout).toContain('Score:');
    expect(stdout).toContain('/100');
  });

  it('shows source tracking status', () => {
    writeField('auth', 'description', 'Auth', tmpDir);

    const stdout = captureStdout(() => {
      commandInspect(['auth'], tmpDir);
    });
    expect(stdout).toContain('Source tracking:');
    expect(stdout).toContain('source_files:');
  });

  it('shows source files when present', () => {
    writeField('auth', 'description', 'Auth', tmpDir);
    // Add source_files to meta
    const metaPath = path.join(tmpDir, '.omm', 'auth', 'meta.yaml');
    const YAML = require('yaml');
    const meta = YAML.parse(fs.readFileSync(metaPath, 'utf-8'));
    meta.source_files = ['src/auth/index.ts', 'src/auth/jwt.ts'];
    fs.writeFileSync(metaPath, YAML.stringify(meta));

    const stdout = captureStdout(() => {
      commandInspect(['auth'], tmpDir);
    });
    expect(stdout).toContain('src/auth/index.ts');
    expect(stdout).toContain('src/auth/jwt.ts');
  });

  it('shows links when present', () => {
    writeField('auth', 'description', 'Auth', tmpDir);
    addLink('auth', { url: 'https://jwt.io', type: 'external', label: 'JWT Docs' }, tmpDir);

    const stdout = captureStdout(() => {
      commandInspect(['auth'], tmpDir);
    });
    expect(stdout).toContain('Links:');
    expect(stdout).toContain('[external] https://jwt.io');
    expect(stdout).toContain('JWT Docs');
  });

  it('shows children when present', () => {
    writeField('auth', 'description', 'Auth', tmpDir);
    writeField('auth', 'diagram', 'graph LR\n    A --> B', tmpDir);
    writeField('auth/jwt', 'description', 'JWT handler', tmpDir);
    writeField('auth/jwt', 'diagram', 'graph LR\n    C --> D', tmpDir);
    writeField('auth/session', 'description', 'Session handler', tmpDir);

    const stdout = captureStdout(() => {
      commandInspect(['auth'], tmpDir);
    });
    expect(stdout).toContain('Children (2):');
    expect(stdout).toContain('jwt');
    expect(stdout).toContain('session');
  });

  it('outputs JSON with --json flag', () => {
    writeField('auth', 'description', 'Auth service', tmpDir);
    writeField('auth', 'diagram', 'graph LR\n    A --> B', tmpDir);

    const stdout = captureStdout(() => {
      commandInspect(['auth', '--json'], tmpDir);
    });

    const parsed = JSON.parse(stdout);
    expect(parsed.path).toBe('auth');
    expect(parsed.type).toBe('perspective');
    expect(parsed.fields.description.present).toBe(true);
    expect(parsed.fields.diagram.present).toBe(true);
    expect(parsed.fieldCoverage).toBeGreaterThan(0);
  });

  it('inspects nested elements', () => {
    writeField('auth', 'description', 'Auth', tmpDir);
    writeField('auth', 'diagram', 'graph LR\n    A --> B', tmpDir);
    writeField('auth/jwt', 'description', 'JWT handler', tmpDir);
    writeField('auth/jwt', 'diagram', 'graph LR\n    C --> D', tmpDir);

    const stdout = captureStdout(() => {
      commandInspect(['auth/jwt'], tmpDir);
    });
    expect(stdout).toContain('Path:         auth/jwt');
    expect(stdout).toContain('group');
  });

  it('shows type correctly for perspective', () => {
    writeField('auth', 'description', 'Auth', tmpDir);

    const stdout = captureStdout(() => {
      commandInspect(['auth'], tmpDir);
    });
    expect(stdout).toContain('perspective (top-level element)');
  });

  it('shows type correctly for group (nested with diagram)', () => {
    writeField('auth', 'description', 'Auth', tmpDir);
    writeField('auth', 'diagram', 'graph LR\n    A --> B', tmpDir);
    writeField('auth/jwt', 'description', 'JWT', tmpDir);
    writeField('auth/jwt', 'diagram', 'graph LR\n    C --> D', tmpDir);

    const stdout = captureStdout(() => {
      commandInspect(['auth/jwt'], tmpDir);
    });
    expect(stdout).toContain('group (nested element with diagram)');
  });

  it('shows type correctly for leaf (nested without diagram)', () => {
    writeField('auth', 'description', 'Auth', tmpDir);
    writeField('auth', 'diagram', 'graph LR\n    A --> B', tmpDir);
    writeField('auth/jwt', 'description', 'JWT', tmpDir);
    // No diagram for jwt

    const stdout = captureStdout(() => {
      commandInspect(['auth/jwt'], tmpDir);
    });
    expect(stdout).toContain('leaf (nested element without diagram)');
  });

  it('shows score breakdown', () => {
    writeField('auth', 'description', 'Auth', tmpDir);
    writeField('auth', 'diagram', 'graph LR\n    A --> B', tmpDir);

    const stdout = captureStdout(() => {
      commandInspect(['auth'], tmpDir);
    });
    expect(stdout).toContain('Breakdown:');
    expect(stdout).toContain('fields:');
    expect(stdout).toContain('diagram:');
  });
});

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

function captureExit(fn: () => void): number | null {
  const originalExit = process.exit;
  let exitCode: number | null = null;
  process.exit = ((code?: number) => {
    exitCode = code ?? 0;
    return undefined as never;
  }) as typeof process.exit;
  try {
    fn();
    return exitCode;
  } finally {
    process.exit = originalExit;
  }
}
