import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import YAML from 'yaml';
import { initOmm, writeField } from '../lib/store.js';
import {
  computeSignature,
  readStoredSignature,
  writeSignature,
  checkSignature,
} from '../lib/signature.js';
import { commandSignature } from '../commands/signature.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omm-sig-test-'));
  initOmm(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('computeSignature', () => {
  it('returns a sha256 signature', () => {
    writeField('auth', 'description', 'Auth', tmpDir);
    const result = computeSignature(path.join(tmpDir, '.omm'));
    expect(result.signature).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('includes element count', () => {
    writeField('auth', 'description', 'Auth', tmpDir);
    writeField('data', 'description', 'Data', tmpDir);
    const result = computeSignature(path.join(tmpDir, '.omm'));
    expect(result.elementCount).toBe(2);
    expect(result.perspectives).toBe(2);
  });

  it('changes when elements are added', () => {
    writeField('auth', 'description', 'Auth', tmpDir);
    const sig1 = computeSignature(path.join(tmpDir, '.omm'));

    writeField('data', 'description', 'Data', tmpDir);
    const sig2 = computeSignature(path.join(tmpDir, '.omm'));

    expect(sig1.signature).not.toBe(sig2.signature);
  });

  it('does NOT change when description content changes', () => {
    writeField('auth', 'description', 'Auth v1', tmpDir);
    const sig1 = computeSignature(path.join(tmpDir, '.omm'));

    writeField('auth', 'description', 'Auth v2 updated', tmpDir);
    const sig2 = computeSignature(path.join(tmpDir, '.omm'));

    expect(sig1.signature).toBe(sig2.signature);
  });

  it('counts nested elements', () => {
    writeField('auth', 'description', 'Auth', tmpDir);
    writeField('auth/jwt', 'description', 'JWT', tmpDir);
    const result = computeSignature(path.join(tmpDir, '.omm'));
    expect(result.elementCount).toBe(2);
    expect(result.perspectives).toBe(1);
  });
});

describe('readStoredSignature', () => {
  it('returns null when no signature stored', () => {
    const stored = readStoredSignature(path.join(tmpDir, '.omm'));
    expect(stored).toBeNull();
  });

  it('returns stored signature', () => {
    const configPath = path.join(tmpDir, '.omm', 'config.yaml');
    const config = YAML.parse(fs.readFileSync(configPath, 'utf-8'));
    config.signature = 'sha256:test123';
    fs.writeFileSync(configPath, YAML.stringify(config));

    const stored = readStoredSignature(path.join(tmpDir, '.omm'));
    expect(stored).toBe('sha256:test123');
  });
});

describe('writeSignature', () => {
  it('writes signature to config.yaml', () => {
    writeSignature(path.join(tmpDir, '.omm'), 'sha256:abc123');
    const stored = readStoredSignature(path.join(tmpDir, '.omm'));
    expect(stored).toBe('sha256:abc123');
  });

  it('adds signature_updated timestamp', () => {
    writeSignature(path.join(tmpDir, '.omm'), 'sha256:abc123');
    const configPath = path.join(tmpDir, '.omm', 'config.yaml');
    const config = YAML.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(config.signature_updated).toBeDefined();
  });

  it('preserves other config values', () => {
    const configPath = path.join(tmpDir, '.omm', 'config.yaml');
    const config = YAML.parse(fs.readFileSync(configPath, 'utf-8'));
    config.theme = 'dark';
    fs.writeFileSync(configPath, YAML.stringify(config));

    writeSignature(path.join(tmpDir, '.omm'), 'sha256:abc123');
    const updated = YAML.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(updated.theme).toBe('dark');
    expect(updated.signature).toBe('sha256:abc123');
  });
});

describe('checkSignature', () => {
  it('reports match when signatures match', () => {
    writeField('auth', 'description', 'Auth', tmpDir);
    const result = computeSignature(path.join(tmpDir, '.omm'));
    writeSignature(path.join(tmpDir, '.omm'), result.signature);

    const check = checkSignature(path.join(tmpDir, '.omm'));
    expect(check.match).toBe(true);
  });

  it('reports mismatch when signatures differ', () => {
    writeField('auth', 'description', 'Auth', tmpDir);
    writeSignature(path.join(tmpDir, '.omm'), 'sha256:old');

    const check = checkSignature(path.join(tmpDir, '.omm'));
    expect(check.match).toBe(false);
    expect(check.stored).toBe('sha256:old');
  });

  it('reports mismatch when no stored signature', () => {
    writeField('auth', 'description', 'Auth', tmpDir);
    const check = checkSignature(path.join(tmpDir, '.omm'));
    expect(check.match).toBe(false);
    expect(check.stored).toBeNull();
  });
});

describe('commandSignature CLI', () => {
  it('shows current signature', () => {
    writeField('auth', 'description', 'Auth', tmpDir);
    const stdout = captureStdout(() => {
      commandSignature([], tmpDir);
    });
    expect(stdout).toContain('Signature:');
    expect(stdout).toContain('sha256:');
    expect(stdout).toContain('Elements:');
  });

  it('updates signature with --update', () => {
    writeField('auth', 'description', 'Auth', tmpDir);
    const stdout = captureStdout(() => {
      commandSignature(['--update'], tmpDir);
    });
    expect(stdout).toContain('Signature updated');

    const stored = readStoredSignature(path.join(tmpDir, '.omm'));
    expect(stored).toMatch(/^sha256:/);
  });

  it('checks signature with --check', () => {
    writeField('auth', 'description', 'Auth', tmpDir);
    const result = computeSignature(path.join(tmpDir, '.omm'));
    writeSignature(path.join(tmpDir, '.omm'), result.signature);

    const stdout = captureStdout(() => {
      commandSignature(['--check'], tmpDir);
    });
    expect(stdout).toContain('Signature OK');
  });

  it('exits 1 on stale signature with --check', () => {
    writeField('auth', 'description', 'Auth', tmpDir);
    writeSignature(path.join(tmpDir, '.omm'), 'sha256:old');

    const exitCode = captureExit(() => {
      commandSignature(['--check'], tmpDir);
    });
    expect(exitCode).toBe(1);
  });

  it('outputs JSON with --json', () => {
    writeField('auth', 'description', 'Auth', tmpDir);
    const stdout = captureStdout(() => {
      commandSignature(['--json'], tmpDir);
    });
    const parsed = JSON.parse(stdout);
    expect(parsed.signature).toMatch(/^sha256:/);
    expect(parsed.elementCount).toBe(1);
  });

  it('shows help with --help', () => {
    const stdout = captureStdout(() => {
      commandSignature(['--help'], tmpDir);
    });
    expect(stdout).toContain('omm signature');
    expect(stdout).toContain('--check');
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
