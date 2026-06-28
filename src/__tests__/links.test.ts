import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initOmm, writeField, addLink, removeLink, getLinks } from '../lib/store.js';
import { commandLinks } from '../commands/links.js';
import type { LinkEntry } from '../types.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omm-links-test-'));
  initOmm(tmpDir);
  writeField('auth', 'description', 'Auth service', tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('addLink', () => {
  it('adds an external link to an element', () => {
    const link: LinkEntry = { url: 'https://example.com', type: 'external', label: 'Example' };
    addLink('auth', link, tmpDir);

    const links = getLinks('auth', tmpDir);
    expect(links).toHaveLength(1);
    expect(links[0].url).toBe('https://example.com');
    expect(links[0].type).toBe('external');
    expect(links[0].label).toBe('Example');
    expect(links[0].added).toBeDefined();
  });

  it('adds a local link', () => {
    const link: LinkEntry = { url: 'docs/adr-001.md', type: 'local', label: 'ADR-001' };
    addLink('auth', link, tmpDir);

    const links = getLinks('auth', tmpDir);
    expect(links).toHaveLength(1);
    expect(links[0].type).toBe('local');
  });

  it('adds a source link', () => {
    const link: LinkEntry = { url: 'src/auth/README.md', type: 'source' };
    addLink('auth', link, tmpDir);

    const links = getLinks('auth', tmpDir);
    expect(links).toHaveLength(1);
    expect(links[0].type).toBe('source');
  });

  it('prevents duplicate URLs', () => {
    const link: LinkEntry = { url: 'https://example.com', type: 'external' };
    addLink('auth', link, tmpDir);
    addLink('auth', link, tmpDir); // duplicate

    const links = getLinks('auth', tmpDir);
    expect(links).toHaveLength(1);
  });

  it('allows multiple different links', () => {
    addLink('auth', { url: 'https://example.com', type: 'external' }, tmpDir);
    addLink('auth', { url: 'docs/adr.md', type: 'local' }, tmpDir);
    addLink('auth', { url: 'src/auth.ts', type: 'source' }, tmpDir);

    const links = getLinks('auth', tmpDir);
    expect(links).toHaveLength(3);
  });

  it('adds link to nested element', () => {
    writeField('auth/jwt', 'description', 'JWT handler', tmpDir);
    const link: LinkEntry = { url: 'https://jwt.io', type: 'external' };
    addLink('auth/jwt', link, tmpDir);

    const links = getLinks('auth/jwt', tmpDir);
    expect(links).toHaveLength(1);
    expect(links[0].url).toBe('https://jwt.io');
  });

  it('sets added timestamp', () => {
    const before = new Date().toISOString();
    addLink('auth', { url: 'https://example.com', type: 'external' }, tmpDir);
    const after = new Date().toISOString();

    const links = getLinks('auth', tmpDir);
    expect(links[0].added).toBeDefined();
    expect(links[0].added! >= before).toBe(true);
    expect(links[0].added! <= after).toBe(true);
  });

  it('preserves custom added timestamp', () => {
    const customDate = '2025-01-15T00:00:00.000Z';
    addLink('auth', { url: 'https://example.com', type: 'external', added: customDate }, tmpDir);

    const links = getLinks('auth', tmpDir);
    expect(links[0].added).toBe(customDate);
  });
});

describe('removeLink', () => {
  it('removes an existing link', () => {
    addLink('auth', { url: 'https://example.com', type: 'external' }, tmpDir);
    const removed = removeLink('auth', 'https://example.com', tmpDir);

    expect(removed).toBe(true);
    const links = getLinks('auth', tmpDir);
    expect(links).toHaveLength(0);
  });

  it('returns false for non-existent link', () => {
    const removed = removeLink('auth', 'https://nonexistent.com', tmpDir);
    expect(removed).toBe(false);
  });

  it('returns false when element has no links', () => {
    const removed = removeLink('auth', 'https://example.com', tmpDir);
    expect(removed).toBe(false);
  });

  it('removes only the specified link', () => {
    addLink('auth', { url: 'https://example1.com', type: 'external' }, tmpDir);
    addLink('auth', { url: 'https://example2.com', type: 'external' }, tmpDir);
    removeLink('auth', 'https://example1.com', tmpDir);

    const links = getLinks('auth', tmpDir);
    expect(links).toHaveLength(1);
    expect(links[0].url).toBe('https://example2.com');
  });

  it('removes link from nested element', () => {
    writeField('auth/jwt', 'description', 'JWT handler', tmpDir);
    addLink('auth/jwt', { url: 'https://jwt.io', type: 'external' }, tmpDir);
    const removed = removeLink('auth/jwt', 'https://jwt.io', tmpDir);

    expect(removed).toBe(true);
    const links = getLinks('auth/jwt', tmpDir);
    expect(links).toHaveLength(0);
  });
});

describe('getLinks', () => {
  it('returns empty array when no links exist', () => {
    const links = getLinks('auth', tmpDir);
    expect(links).toEqual([]);
  });

  it('returns empty array for non-existent element', () => {
    const links = getLinks('nonexistent', tmpDir);
    expect(links).toEqual([]);
  });

  it('returns links in order', () => {
    addLink('auth', { url: 'https://first.com', type: 'external' }, tmpDir);
    addLink('auth', { url: 'https://second.com', type: 'external' }, tmpDir);
    addLink('auth', { url: 'https://third.com', type: 'external' }, tmpDir);

    const links = getLinks('auth', tmpDir);
    expect(links[0].url).toBe('https://first.com');
    expect(links[1].url).toBe('https://second.com');
    expect(links[2].url).toBe('https://third.com');
  });
});

describe('commandLinks CLI', () => {
  it('shows message when no links exist', () => {
    const stdout = captureStdout(() => {
      commandLinks(['auth'], tmpDir);
    });
    expect(stdout).toContain('No links');
    expect(stdout).toContain('omm links auth --add');
  });

  it('displays links', () => {
    addLink('auth', { url: 'https://example.com', type: 'external', label: 'Example' }, tmpDir);

    const stdout = captureStdout(() => {
      commandLinks(['auth'], tmpDir);
    });
    expect(stdout).toContain('Links for auth');
    expect(stdout).toContain('[external] https://example.com');
    expect(stdout).toContain('Example');
  });

  it('adds link via --add flag', () => {
    captureStderr(() => {
      commandLinks(['auth', '--add', 'https://new.com', '--label', 'New Link'], tmpDir);
    });

    const links = getLinks('auth', tmpDir);
    expect(links).toHaveLength(1);
    expect(links[0].url).toBe('https://new.com');
    expect(links[0].label).toBe('New Link');
  });

  it('removes link via --remove flag', () => {
    addLink('auth', { url: 'https://example.com', type: 'external' }, tmpDir);

    captureStderr(() => {
      commandLinks(['auth', '--remove', 'https://example.com'], tmpDir);
    });

    const links = getLinks('auth', tmpDir);
    expect(links).toHaveLength(0);
  });

  it('outputs JSON when --json flag used', () => {
    addLink('auth', { url: 'https://example.com', type: 'external', label: 'Test' }, tmpDir);

    const stdout = captureStdout(() => {
      commandLinks(['auth', '--json'], tmpDir);
    });

    const parsed = JSON.parse(stdout);
    expect(parsed.element).toBe('auth');
    expect(parsed.links).toHaveLength(1);
    expect(parsed.links[0].url).toBe('https://example.com');
  });

  it('auto-detects local type for non-URL paths', () => {
    captureStderr(() => {
      commandLinks(['auth', '--add', 'docs/adr-001.md'], tmpDir);
    });

    const links = getLinks('auth', tmpDir);
    expect(links[0].type).toBe('local');
  });

  it('uses explicit type when provided', () => {
    captureStderr(() => {
      commandLinks(['auth', '--add', 'https://example.com', '--type', 'source'], tmpDir);
    });

    const links = getLinks('auth', tmpDir);
    expect(links[0].type).toBe('source');
  });

  it('errors when element not found', () => {
    const exitCode = captureExit(() => {
      commandLinks(['nonexistent', '--add', 'https://example.com'], tmpDir);
    });
    expect(exitCode).toBe(1);
  });

  it('errors when no element specified', () => {
    const exitCode = captureExit(() => {
      commandLinks([], tmpDir);
    });
    expect(exitCode).toBe(1);
  });

  it('shows help with --help flag', () => {
    const stdout = captureStdout(() => {
      commandLinks(['--help'], tmpDir);
    });
    expect(stdout).toContain('omm links');
    expect(stdout).toContain('--add');
    expect(stdout).toContain('--remove');
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
