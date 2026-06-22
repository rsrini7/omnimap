import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import type { DependencyGraph } from '../lib/analyzer/types.js';

describe('affected command', () => {
  it('correctly traverses BFS with depth limit and resolves visited depth bypass bug', async () => {
    const { commandAffected } = await import('../commands/affected.js');

    const analyzeDirModule = await import('../lib/analyzer/index.js');
    const mockGraph: DependencyGraph = {
      nodes: [
        { id: 'a.ts', file: 'a.ts', exports: [] },
        { id: 'b.ts', file: 'b.ts', exports: [] },
        { id: 'd.ts', file: 'd.ts', exports: [] },
        { id: 'e.ts', file: 'e.ts', exports: [] },
      ],
      edges: [
        { from: 'b.ts', to: 'a.ts', imports: [] }, // b imports a
        { from: 'd.ts', to: 'b.ts', imports: [] }, // d imports b (path: a -> b -> d, depth 2)
        { from: 'd.ts', to: 'a.ts', imports: [] }, // d imports a directly (path: a -> d, depth 1)
        { from: 'e.ts', to: 'd.ts', imports: [] }, // e imports d (path: d -> e, depth 1)
      ],
    };

    const spyAnalyze = vi.spyOn(analyzeDirModule, 'analyzeDirectory').mockResolvedValue({
      files: [],
      graph: mockGraph,
      modules: [],
      errors: [],
      stats: { totalFiles: 4, analyzedFiles: 4, skippedFiles: 0, errorFiles: 0, languages: {} },
    });

    const spyStdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const spyStderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const spyExit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    try {
      await commandAffected(['a.ts', '--depth', '2', '--json']);

      const stdoutCalls = spyStdout.mock.calls.map(c => c[0].toString()).join('');
      const parsed = JSON.parse(stdoutCalls);

      expect(parsed.affected).toContain('e.ts');
      expect(parsed.affected).toContain('d.ts');
      expect(parsed.affected).toContain('b.ts');
      expect(parsed.affected).toContain('a.ts');
    } finally {
      spyAnalyze.mockRestore();
      spyStdout.mockRestore();
      spyStderr.mockRestore();
      spyExit.mockRestore();
    }
  });
});

describe('MCP tool calling promise rejection safety', () => {
  it('does not throw unhandled promise rejection and returns formatted error', async () => {
    const { handleRequest } = await import('../commands/mcp.js');

    const req: any = {
      jsonrpc: '2.0',
      id: 123,
      method: 'tools/call',
      params: {
        name: 'omm_analyze',
        arguments: {
          dir: './non-existent-dir-for-test-xyz',
        },
      },
    };

    const resp = handleRequest(req);
    expect(resp.result).toBeDefined();
    expect(typeof resp.result.then).toBe('function');

    const result = await resp.result;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Error');
  });
});
