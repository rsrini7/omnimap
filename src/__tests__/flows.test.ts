import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readFlows, writeFlows, initOmm, writeField } from '../lib/store.js';
import type { FlowDef } from '../types.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omm-flows-test-'));
  initOmm(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('readFlows', () => {
  it('returns empty array when flows.yaml does not exist', () => {
    const flows = readFlows('some-element', tmpDir);
    expect(flows).toEqual([]);
  });

  it('returns empty array when flows.yaml is malformed', () => {
    const elemDir = path.join(tmpDir, '.omm', 'some-element');
    fs.mkdirSync(elemDir, { recursive: true });
    fs.writeFileSync(path.join(elemDir, 'flows.yaml'), 'not valid yaml: [');
    const flows = readFlows('some-element', tmpDir);
    expect(flows).toEqual([]);
  });

  it('returns flows from flows.yaml', () => {
    const flows: FlowDef[] = [
      { name: 'Install', description: 'Install flow', steps: [{ node: 'a' }, { edge: 'a->b' }, { node: 'b' }] },
    ];
    writeFlows('test-elem', flows, tmpDir);
    const result = readFlows('test-elem', tmpDir);
    expect(result).toEqual(flows);
  });

  it('returns empty array when flows.yaml has no flows field', () => {
    const elemDir = path.join(tmpDir, '.omm', 'test-elem');
    fs.mkdirSync(elemDir, { recursive: true });
    fs.writeFileSync(path.join(elemDir, 'flows.yaml'), 'other: data\n');
    const result = readFlows('test-elem', tmpDir);
    expect(result).toEqual([]);
  });
});

describe('writeFlows', () => {
  it('creates flows.yaml with the provided flows', () => {
    const flows: FlowDef[] = [
      { name: 'Flow1', steps: [{ node: 'a' }] },
    ];
    writeFlows('test-elem', flows, tmpDir);
    const filePath = path.join(tmpDir, '.omm', 'test-elem', 'flows.yaml');
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('flows:');
    expect(content).toContain('Flow1');
  });

  it('creates element directory if it does not exist', () => {
    const flows: FlowDef[] = [{ name: 'F', steps: [] }];
    writeFlows('new-elem', flows, tmpDir);
    expect(fs.existsSync(path.join(tmpDir, '.omm', 'new-elem'))).toBe(true);
  });

  it('overwrites existing flows.yaml', () => {
    writeFlows('test-elem', [{ name: 'A', steps: [] }], tmpDir);
    writeFlows('test-elem', [{ name: 'B', steps: [] }], tmpDir);
    const result = readFlows('test-elem', tmpDir);
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('B');
  });

  it('handles empty flows array', () => {
    writeFlows('test-elem', [], tmpDir);
    const result = readFlows('test-elem', tmpDir);
    expect(result).toEqual([]);
  });
});

describe('flows with nested elements', () => {
  it('reads/writes flows for nested element paths', () => {
    const flows: FlowDef[] = [{ name: 'Nested', steps: [{ node: 'x' }] }];
    writeFlows('parent/child', flows, tmpDir);
    const result = readFlows('parent/child', tmpDir);
    expect(result).toEqual(flows);
  });
});

describe('flow step types', () => {
  it('preserves node-only steps', () => {
    const flows: FlowDef[] = [{ name: 'N', steps: [{ node: 'user' }] }];
    writeFlows('e', flows, tmpDir);
    expect(readFlows('e', tmpDir)).toEqual(flows);
  });

  it('preserves edge-only steps', () => {
    const flows: FlowDef[] = [{ name: 'E', steps: [{ edge: 'a->b' }] }];
    writeFlows('e', flows, tmpDir);
    expect(readFlows('e', tmpDir)).toEqual(flows);
  });

  it('preserves mixed node and edge steps in order', () => {
    const flows: FlowDef[] = [
      { name: 'M', steps: [
        { node: 'a' },
        { edge: 'a->b' },
        { node: 'b' },
        { edge: 'b->c' },
        { node: 'c' },
      ]},
    ];
    writeFlows('e', flows, tmpDir);
    const result = readFlows('e', tmpDir);
    expect(result[0].steps.length).toBe(5);
    expect(result[0].steps[0]).toEqual({ node: 'a' });
    expect(result[0].steps[1]).toEqual({ edge: 'a->b' });
  });
});
