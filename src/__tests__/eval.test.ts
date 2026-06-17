import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { evaluateProject } from '../lib/eval.js';
import { initOmm, writeField } from '../lib/store.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omm-eval-test-'));
  initOmm(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('evaluateProject', () => {
  it('returns empty report for empty project', () => {
    const report = evaluateProject(tmpDir);
    expect(report.summary.totalElements).toBe(0);
    expect(report.summary.overallScore).toBe(0);
    expect(report.elements).toEqual([]);
    expect(report.issues).toEqual([]);
  });

  it('evaluates a complete perspective', () => {
    writeField('auth', 'description', 'Auth description with more than 50 characters to score well', tmpDir);
    writeField('auth', 'diagram', 'graph LR\n    A --> B', tmpDir);
    writeField('auth', 'context', 'Auth context', tmpDir);
    writeField('auth', 'constraint', 'Auth constraint', tmpDir);
    writeField('auth', 'concern', 'Auth concern', tmpDir);
    writeField('auth', 'todo', '- [ ] Task', tmpDir);
    writeField('auth', 'note', 'Auth note', tmpDir);

    const report = evaluateProject(tmpDir);
    expect(report.summary.totalElements).toBe(1);
    expect(report.summary.perspectives).toBe(1);
    const el = report.elements[0];
    expect(el.path).toBe('auth');
    expect(el.fieldsPresent.length).toBe(7);
    expect(el.fieldCoverage).toBe(1);
    expect(el.hasDiagram).toBe(true);
    expect(el.diagramValid).toBe(true);
    expect(el.hasDescription).toBe(true);
    expect(el.score).toBeGreaterThanOrEqual(80);
  });

  it('reports missing description', () => {
    writeField('auth', 'diagram', 'graph LR\n    A --> B', tmpDir);
    const report = evaluateProject(tmpDir);
    const issue = report.issues.find(i => i.type === 'missing-description');
    expect(issue).toBeTruthy();
    expect(issue!.path).toBe('auth');
  });

  it('reports invalid diagram', () => {
    writeField('auth', 'description', 'Auth', tmpDir);
    writeField('auth', 'diagram', 'this is not valid mermaid syntax', tmpDir);
    const report = evaluateProject(tmpDir);
    const issue = report.issues.find(i => i.type === 'invalid-diagram');
    expect(issue).toBeTruthy();
  });

  it('reports incomplete children', () => {
    writeField('parent', 'description', 'Parent', tmpDir);
    writeField('parent', 'diagram', 'graph LR\n    A --> B\n    B --> C', tmpDir);
    // Create child dirs but don't add diagrams
    fs.mkdirSync(path.join(tmpDir, '.omm', 'parent', 'A'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.omm', 'parent', 'B'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.omm', 'parent', 'C'), { recursive: true });

    const report = evaluateProject(tmpDir);
    const issue = report.issues.find(i => i.type === 'incomplete-children');
    expect(issue).toBeTruthy();
  });

  it('counts nested elements', () => {
    writeField('parent', 'description', 'Parent', tmpDir);
    writeField('parent', 'diagram', 'graph LR\n    A --> B', tmpDir);
    writeField('parent/A', 'description', 'A', tmpDir);
    writeField('parent/B', 'description', 'B', tmpDir);
    fs.mkdirSync(path.join(tmpDir, '.omm', 'parent', 'A'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.omm', 'parent', 'B'), { recursive: true });

    const report = evaluateProject(tmpDir);
    expect(report.summary.totalElements).toBe(3);
    expect(report.summary.perspectives).toBe(1);
    expect(report.summary.leaves).toBe(2);
  });

  it('detects flow coverage', () => {
    writeField('auth', 'description', 'Auth', tmpDir);
    writeField('auth', 'diagram', 'graph LR\n    A --> B', tmpDir);
    // No flows
    const report1 = evaluateProject(tmpDir);
    expect(report1.summary.flowCoverage).toBe(0);

    // Add flows
    fs.writeFileSync(path.join(tmpDir, '.omm', 'auth', 'flows.yaml'),
      'flows:\n  - name: F1\n    steps:\n      - node: A\n');
    const report2 = evaluateProject(tmpDir);
    expect(report2.summary.flowCoverage).toBe(100);
  });

  it('sorts elements by score (worst first)', () => {
    writeField('good', 'description', 'Good with lots of detail to get high score', tmpDir);
    writeField('good', 'diagram', 'graph LR\nA-->B', tmpDir);
    writeField('good', 'context', 'c', tmpDir);
    writeField('good', 'constraint', 'c', tmpDir);
    writeField('good', 'concern', 'c', tmpDir);
    writeField('good', 'todo', 't', tmpDir);
    writeField('good', 'note', 'n', tmpDir);

    writeField('bad', 'diagram', 'graph LR\nA-->B', tmpDir);
    fs.writeFileSync(path.join(tmpDir, '.omm', 'bad', 'meta.yaml'), 'updated: now\n');

    const report = evaluateProject(tmpDir);
    expect(report.elements[0].score).toBeLessThanOrEqual(report.elements[1].score);
  });

  it('calculates field coverage percentage', () => {
    writeField('p1', 'description', 'd', tmpDir);
    writeField('p1', 'diagram', 'graph LR\nA-->B', tmpDir);
    // p1 has 2/7 fields = ~28%
    writeField('p2', 'description', 'd', tmpDir);
    writeField('p2', 'diagram', 'graph LR\nA-->B', tmpDir);
    writeField('p2', 'context', 'c', tmpDir);
    writeField('p2', 'constraint', 'c', tmpDir);
    writeField('p2', 'concern', 'c', tmpDir);
    writeField('p2', 'todo', 't', tmpDir);
    writeField('p2', 'note', 'n', tmpDir);
    // p2 has 7/7 fields = 100%

    const report = evaluateProject(tmpDir);
    // Average = (28 + 100) / 2 = 64
    expect(report.summary.fieldCoverage).toBeGreaterThanOrEqual(60);
    expect(report.summary.fieldCoverage).toBeLessThanOrEqual(70);
  });

  it('reports sparse fields for elements with few fields', () => {
    writeField('sparse', 'description', 'd', tmpDir);
    const report = evaluateProject(tmpDir);
    const issue = report.issues.find(i => i.type === 'sparse-fields');
    expect(issue).toBeTruthy();
  });

  it('reports no-flows for perspectives without flows', () => {
    writeField('p', 'description', 'd', tmpDir);
    const report = evaluateProject(tmpDir);
    const issue = report.issues.find(i => i.type === 'no-flows');
    expect(issue).toBeTruthy();
  });

  it('classifies element types correctly', () => {
    writeField('persp', 'description', 'p', tmpDir);
    writeField('persp', 'diagram', 'graph LR\nA-->B', tmpDir);
    writeField('persp/A', 'description', 'a', tmpDir);
    writeField('persp/A', 'diagram', 'graph LR\nX-->Y', tmpDir);
    writeField('persp/B', 'description', 'b', tmpDir);
    fs.mkdirSync(path.join(tmpDir, '.omm', 'persp', 'A'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.omm', 'persp', 'B'), { recursive: true });

    const report = evaluateProject(tmpDir);
    const persp = report.elements.find(e => e.path === 'persp');
    const childA = report.elements.find(e => e.path === 'persp/A');
    const childB = report.elements.find(e => e.path === 'persp/B');

    expect(persp?.type).toBe('perspective');
    expect(childA?.type).toBe('group'); // has diagram
    expect(childB?.type).toBe('leaf'); // no diagram
  });
});
