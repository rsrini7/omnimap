import { describe, it, expect } from 'vitest';
import { listTemplates, getTemplate, TEMPLATES } from '../templates/index.js';

describe('templates', () => {
  it('lists all template names', () => {
    const names = listTemplates();
    expect(names).toContain('microservices');
    expect(names).toContain('monolith');
    expect(names).toContain('web-app');
    expect(names).toContain('api-service');
    expect(names).toContain('data-pipeline');
    expect(names.length).toBe(5);
  });

  it('getTemplate returns template by name', () => {
    const t = getTemplate('microservices');
    expect(t).toBeDefined();
    expect(t!.name).toBe('Microservices');
    expect(t!.perspectives.length).toBeGreaterThan(0);
  });

  it('getTemplate returns undefined for unknown name', () => {
    expect(getTemplate('nonexistent')).toBeUndefined();
  });

  it('every template has required fields', () => {
    for (const name of listTemplates()) {
      const t = getTemplate(name)!;
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.perspectives.length).toBeGreaterThan(0);
      for (const p of t.perspectives) {
        expect(p.name).toBeTruthy();
        expect(p.description).toBeTruthy();
        expect(p.diagram).toBeTruthy();
        expect(p.diagram).toContain('graph');
      }
    }
  });

  it('every template diagram is valid mermaid', () => {
    for (const name of listTemplates()) {
      const t = getTemplate(name)!;
      for (const p of t.perspectives) {
        // Basic validation: starts with graph/flowchart
        expect(p.diagram).toMatch(/^(graph|flowchart)\s+/);
      }
    }
  });
});
