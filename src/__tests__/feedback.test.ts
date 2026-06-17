import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { commandFeedback } from '../commands/feedback.js';
import { initOmm, writeField } from '../lib/store.js';

let tmpDir: string;
let savedCwd: string;

beforeEach(() => {
  savedCwd = process.cwd();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omm-feedback-test-'));
  process.chdir(tmpDir);
  initOmm(tmpDir);
});

afterEach(() => {
  process.chdir(savedCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('omm feedback', () => {
  it('writes markdown feedback by default', () => {
    writeField('auth', 'description', 'Auth description longer than fifty characters to get full points', tmpDir);
    writeField('auth', 'diagram', 'graph LR\nA-->B', tmpDir);
    writeField('auth', 'context', 'c', tmpDir);
    writeField('auth', 'constraint', 'c', tmpDir);
    writeField('auth', 'concern', 'c', tmpDir);
    writeField('auth', 'todo', 't', tmpDir);
    writeField('auth', 'note', 'n', tmpDir);

    let stderr = '';
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((msg: string | Uint8Array) => {
      stderr += String(msg);
      return true;
    });

    commandFeedback([]);
    expect(stderr).toContain('feedback.md');

    const filePath = path.join(tmpDir, '.omm', 'feedback.md');
    expect(fs.existsSync(filePath)).toBe(true);

    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('# omm feedback report');
    expect(content).toContain('Overall score:');
    expect(content).toMatch(/Overall score: \d+\/100/);
    spy.mockRestore();
  });

  it('writes JSON feedback with --format json', () => {
    writeField('auth', 'description', 'Auth', tmpDir);
    writeField('auth', 'diagram', 'graph LR\nA-->B', tmpDir);

    let stderr = '';
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((msg: string | Uint8Array) => {
      stderr += String(msg);
      return true;
    });

    commandFeedback(['--format', 'json']);
    expect(stderr).toContain('feedback.json');

    const filePath = path.join(tmpDir, '.omm', 'feedback.json');
    expect(fs.existsSync(filePath)).toBe(true);

    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content);
    expect(parsed.omm).toBeDefined();
    expect(parsed.eval).toBeDefined();
    expect(parsed.eval.overallScore).toBeDefined();
    spy.mockRestore();
  });

  it('includes user message with --include', () => {
    let stderr = '';
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((msg: string | Uint8Array) => {
      stderr += String(msg);
      return true;
    });

    commandFeedback(['--include', 'my test message here']);
    const filePath = path.join(tmpDir, '.omm', 'feedback.md');
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('## User message');
    expect(content).toContain('my test message here');
    spy.mockRestore();
  });

  it('prints to stdout with --print', () => {
    let stdout = '';
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((msg: string | Uint8Array) => {
      stdout += String(msg);
      return true;
    });

    commandFeedback(['--print']);
    expect(stdout).toContain('# omm feedback report');
    // Should NOT write to file
    const filePath = path.join(tmpDir, '.omm', 'feedback.md');
    expect(fs.existsSync(filePath)).toBe(false);
    spy.mockRestore();
  });

  it('writes to custom path with --out', () => {
    let stderr = '';
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((msg: string | Uint8Array) => {
      stderr += String(msg);
      return true;
    });

    const customPath = path.join(tmpDir, 'my-report.md');
    commandFeedback(['--out', customPath]);
    expect(fs.existsSync(customPath)).toBe(true);
    const content = fs.readFileSync(customPath, 'utf-8');
    expect(content).toContain('# omm feedback report');
    spy.mockRestore();
  });

  it('includes omm version in report', () => {
    let stdout = '';
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((msg: string | Uint8Array) => {
      stdout += String(msg);
      return true;
    });

    commandFeedback(['--print']);
    // Version may be 'unknown' if package.json can't be read in the test environment
    expect(stdout).toMatch(/omm version: /);
    spy.mockRestore();
  });

  it('includes eval metrics in report', () => {
    writeField('p1', 'description', 'P1', tmpDir);
    writeField('p1', 'diagram', 'graph LR\nA-->B', tmpDir);

    let stdout = '';
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((msg: string | Uint8Array) => {
      stdout += String(msg);
      return true;
    });

    commandFeedback(['--print']);
    expect(stdout).toContain('Total elements:');
    expect(stdout).toContain('Field coverage:');
    expect(stdout).toContain('Diagram coverage:');
    expect(stdout).toContain('Flow coverage:');
    spy.mockRestore();
  });

  it('shows --help', () => {
    let stdout = '';
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((msg: string | Uint8Array) => {
      stdout += String(msg);
      return true;
    });

    commandFeedback(['--help']);
    expect(stdout).toContain('omm feedback');
    expect(stdout).toContain('--format json');
    expect(stdout).toContain('--include');
    spy.mockRestore();
  });
});
