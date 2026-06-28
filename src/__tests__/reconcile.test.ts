import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import YAML from 'yaml';
import { initOmm, writeField } from '../lib/store.js';
import { buildReconcileReport, fixOrphanedSources, hasIssues } from '../lib/reconcile.js';
import { writeSignature } from '../lib/signature.js';
import { commandReconcile } from '../commands/reconcile.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omm-reconcile-test-'));
  initOmm(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('buildReconcileReport', () => {
  it('reports no issues for valid project', () => {
    writeField('auth', 'description', 'Auth service', tmpDir);
    writeField('auth', 'diagram', 'graph LR\n    A --> B', tmpDir);

    const report = buildReconcileReport(path.join(tmpDir, '.omm'), tmpDir);
    expect(report.orphanedSources).toHaveLength(0);
    expect(report.brokenRefs).toHaveLength(0);
    expect(report.emptyElements).toHaveLength(0);
  });

  it('detects stale signature', () => {
    writeField('auth', 'description', 'Auth', tmpDir);
    writeSignature(path.join(tmpDir, '.omm'), 'sha256:old');

    const report = buildReconcileReport(path.join(tmpDir, '.omm'), tmpDir);
    expect(report.signatureStale).toBe(true);
  });

  it('detects orphaned source files', () => {
    writeField('auth', 'description', 'Auth', tmpDir);
    const metaPath = path.join(tmpDir, '.omm', 'auth', 'meta.yaml');
    const meta = YAML.parse(fs.readFileSync(metaPath, 'utf-8'));
    meta.source_files = ['src/auth/deleted.ts'];
    fs.writeFileSync(metaPath, YAML.stringify(meta));

    const report = buildReconcileReport(path.join(tmpDir, '.omm'), tmpDir);
    expect(report.orphanedSources).toHaveLength(1);
    expect(report.orphanedSources[0].file).toBe('src/auth/deleted.ts');
  });

  it('detects missing descriptions', () => {
    // Create element without description
    fs.mkdirSync(path.join(tmpDir, '.omm', 'no-desc'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.omm', 'no-desc', 'meta.yaml'), YAML.stringify({
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      update_count: 0,
      last_field: 'description',
    }));

    const report = buildReconcileReport(path.join(tmpDir, '.omm'), tmpDir);
    expect(report.missingDescriptions).toContain('no-desc');
  });

  it('detects empty elements', () => {
    fs.mkdirSync(path.join(tmpDir, '.omm', 'empty'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.omm', 'empty', 'meta.yaml'), YAML.stringify({
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      update_count: 0,
      last_field: 'description',
    }));

    const report = buildReconcileReport(path.join(tmpDir, '.omm'), tmpDir);
    expect(report.emptyElements).toContain('empty');
  });
});

describe('fixOrphanedSources', () => {
  it('removes orphaned source files from meta', () => {
    writeField('auth', 'description', 'Auth', tmpDir);
    // Create a real source file so only one is orphaned
    fs.mkdirSync(path.join(tmpDir, 'src', 'auth'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src', 'auth', 'real.ts'), '');
    const metaPath = path.join(tmpDir, '.omm', 'auth', 'meta.yaml');
    const meta = YAML.parse(fs.readFileSync(metaPath, 'utf-8'));
    meta.source_files = ['src/auth/real.ts', 'src/auth/deleted.ts'];
    fs.writeFileSync(metaPath, YAML.stringify(meta));

    const report = buildReconcileReport(path.join(tmpDir, '.omm'), tmpDir);
    const result = fixOrphanedSources(report, tmpDir);

    expect(result.fixedOrphanedSources).toBe(1);
    expect(result.errors).toHaveLength(0);

    const updatedMeta = YAML.parse(fs.readFileSync(metaPath, 'utf-8'));
    expect(updatedMeta.source_files).toContain('src/auth/real.ts');
    expect(updatedMeta.source_files).not.toContain('src/auth/deleted.ts');
  });

  it('handles non-existent elements gracefully', () => {
    const report = {
      signatureStale: false,
      storedSignature: null,
      currentSignature: 'sha256:test',
      orphanedSources: [{ element: 'nonexistent', file: 'src/missing.ts' }],
      missingDescriptions: [],
      missingDiagrams: [],
      brokenRefs: [],
      emptyElements: [],
    };

    const result = fixOrphanedSources(report, path.join(tmpDir, '.omm'));
    expect(result.fixedOrphanedSources).toBe(0);
  });
});

describe('hasIssues', () => {
  it('returns false for clean report', () => {
    const report = {
      signatureStale: false,
      storedSignature: 'sha256:abc',
      currentSignature: 'sha256:abc',
      orphanedSources: [],
      missingDescriptions: [],
      missingDiagrams: [],
      brokenRefs: [],
      emptyElements: [],
    };
    expect(hasIssues(report)).toBe(false);
  });

  it('returns true for stale signature', () => {
    const report = {
      signatureStale: true,
      storedSignature: 'sha256:old',
      currentSignature: 'sha256:new',
      orphanedSources: [],
      missingDescriptions: [],
      missingDiagrams: [],
      brokenRefs: [],
      emptyElements: [],
    };
    expect(hasIssues(report)).toBe(true);
  });

  it('returns true for orphaned sources', () => {
    const report = {
      signatureStale: false,
      storedSignature: null,
      currentSignature: 'sha256:abc',
      orphanedSources: [{ element: 'auth', file: 'src/old.ts' }],
      missingDescriptions: [],
      missingDiagrams: [],
      brokenRefs: [],
      emptyElements: [],
    };
    expect(hasIssues(report)).toBe(true);
  });
});

describe('commandReconcile CLI', () => {
  it('shows reconciliation report', () => {
    writeField('auth', 'description', 'Auth', tmpDir);
    const stdout = captureStdout(() => {
      commandReconcile([], tmpDir);
    });
    expect(stdout).toContain('Reconciliation report');
    expect(stdout).toContain('Structural signature');
  });

  it('fixes orphaned sources with --fix', () => {
    writeField('auth', 'description', 'Auth', tmpDir);
    const metaPath = path.join(tmpDir, '.omm', 'auth', 'meta.yaml');
    const meta = YAML.parse(fs.readFileSync(metaPath, 'utf-8'));
    meta.source_files = ['src/auth/deleted.ts'];
    fs.writeFileSync(metaPath, YAML.stringify(meta));

    const stdout = captureStdout(() => {
      commandReconcile(['--fix'], tmpDir);
    });
    expect(stdout).toContain('Fixed');
  });

  it('outputs JSON with --json', () => {
    writeField('auth', 'description', 'Auth', tmpDir);
    const stdout = captureStdout(() => {
      commandReconcile(['--json'], tmpDir);
    });
    const parsed = JSON.parse(stdout);
    expect(parsed.signatureStale).toBeDefined();
    expect(parsed.orphanedSources).toBeDefined();
  });

  it('shows help with --help', () => {
    const stdout = captureStdout(() => {
      commandReconcile(['--help'], tmpDir);
    });
    expect(stdout).toContain('omm reconcile');
    expect(stdout).toContain('--fix');
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
