import { describe, it, expect } from 'vitest';
import { generateHtmlExport } from '../lib/html-export.js';
import type { ClassData, FlowDef } from '../types.js';

const baseData: ClassData = {
  name: 'test-elem',
  description: 'Test description',
  diagram: 'graph LR\n    A["Node A"] --> B["Node B"]\n    B --> C["Node C"]',
  context: 'Test context',
  constraint: 'Test constraint',
  concern: 'Test concern',
  todo: '- [ ] Test todo',
  note: 'Test note',
  meta: {
    created: '2026-01-01T00:00:00Z',
    updated: '2026-01-01T00:00:00Z',
    update_count: 1,
    last_field: 'diagram',
    children: ['child1', 'child2'],
  },
};

const baseFlows: FlowDef[] = [
  {
    name: 'Install',
    description: 'Install flow',
    steps: [
      { node: 'A' },
      { edge: 'A->B' },
      { node: 'B' },
    ],
  },
  {
    name: 'Run',
    description: 'Run flow',
    steps: [
      { node: 'B' },
      { edge: 'B->C' },
      { node: 'C' },
    ],
  },
];

const baseChildren: Record<string, ClassData> = {
  child1: {
    name: 'test-elem/child1',
    description: 'Child 1 description',
  },
  child2: {
    name: 'test-elem/child2',
    description: 'Child 2 description',
    diagram: 'graph LR\n    X --> Y',
  },
};

describe('generateHtmlExport', () => {
  it('generates a valid HTML document', () => {
    const html = generateHtmlExport({
      element: 'test-elem',
      title: 'Test Title',
      data: baseData,
      flows: [],
      children: {},
    });
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('</html>');
  });

  it('includes the title in the header', () => {
    const html = generateHtmlExport({
      element: 'test-elem',
      title: 'My Architecture',
      data: baseData,
      flows: [],
      children: {},
    });
    expect(html).toContain('My Architecture');
  });

  it('encodes the diagram as base64', () => {
    const html = generateHtmlExport({
      element: 'test-elem',
      title: 'Test',
      data: baseData,
      flows: [],
      children: {},
    });
    expect(html).toContain('var DIAGRAM_B64');
    expect(html).toContain('var DIAGRAM = atob(DIAGRAM_B64)');
  });

  it('decodes diagram correctly via base64', () => {
    const html = generateHtmlExport({
      element: 'test-elem',
      title: 'Test',
      data: baseData,
      flows: [],
      children: {},
    });
    // Extract base64 and decode
    const match = html.match(/var DIAGRAM_B64 = "([^"]+)"/);
    expect(match).toBeTruthy();
    const decoded = Buffer.from(match![1], 'base64').toString('utf-8');
    expect(decoded).toBe(baseData.diagram);
  });

  it('escapes HTML in the title', () => {
    const html = generateHtmlExport({
      element: 'test-elem',
      title: '<script>alert("xss")</script>',
      data: baseData,
      flows: [],
      children: {},
    });
    expect(html).not.toContain('<script>alert("xss")</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes HTML in element name', () => {
    const html = generateHtmlExport({
      element: '<bad>',
      title: 'Test',
      data: baseData,
      flows: [],
      children: {},
    });
    expect(html).toContain('&lt;bad&gt;');
  });

  it('includes flow chips when flows are provided', () => {
    const html = generateHtmlExport({
      element: 'test-elem',
      title: 'Test',
      data: baseData,
      flows: baseFlows,
      children: {},
    });
    expect(html).toContain('flow-bar');
    expect(html).toContain('Install');
    expect(html).toContain('Run');
  });

  it('omits flow bar when no flows', () => {
    const html = generateHtmlExport({
      element: 'test-elem',
      title: 'Test',
      data: baseData,
      flows: [],
      children: {},
    });
    // Flow bar exists in CSS but flow chips shouldn't render
    expect(html).not.toContain('data-flow="0"');
  });

  it('serializes flows as JSON', () => {
    const html = generateHtmlExport({
      element: 'test-elem',
      title: 'Test',
      data: baseData,
      flows: baseFlows,
      children: {},
    });
    expect(html).toContain('var FLOWS =');
    expect(html).toContain('"name":"Install"');
    expect(html).toContain('"node":"A"');
    expect(html).toContain('"edge":"A->B"');
  });

  it('serializes node details as JSON', () => {
    const html = generateHtmlExport({
      element: 'test-elem',
      title: 'Test',
      data: baseData,
      flows: [],
      children: baseChildren,
    });
    expect(html).toContain('var NODE_DETAILS');
    expect(html).toContain('Child 1 description');
  });

  it('includes description in node details', () => {
    const html = generateHtmlExport({
      element: 'test-elem',
      title: 'Test',
      data: baseData,
      flows: [],
      children: baseChildren,
    });
    expect(html).toContain('description');
  });

  it('includes context in node details when present', () => {
    const html = generateHtmlExport({
      element: 'test-elem',
      title: 'Test',
      data: { ...baseData, context: 'My context' },
      flows: [],
      children: {},
    });
    expect(html).toContain('My context');
  });

  it('omits empty fields from node details', () => {
    const data: ClassData = {
      name: 'test',
      description: 'only description',
    };
    const html = generateHtmlExport({
      element: 'test',
      title: 'Test',
      data,
      flows: [],
      children: {},
    });
    const detailsMatch = html.match(/var NODE_DETAILS = (\{.*?\});/s);
    expect(detailsMatch).toBeTruthy();
    const details = JSON.parse(detailsMatch![1]);
    expect(details.test.description).toBe('only description');
    expect(details.test.context).toBeUndefined();
    expect(details.test.concern).toBeUndefined();
    expect(details.test.constraint).toBeUndefined();
  });

  it('includes dagre CDN', () => {
    const html = generateHtmlExport({
      element: 'test',
      title: 'Test',
      data: baseData,
      flows: [],
      children: {},
    });
    expect(html).toContain('dagre');
  });

  it('includes theme toggle script', () => {
    const html = generateHtmlExport({
      element: 'test',
      title: 'Test',
      data: baseData,
      flows: [],
      children: {},
    });
    expect(html).toContain('toggleTheme');
    expect(html).toContain('prefers-color-scheme');
  });

  it('includes CSS variables for dark theme', () => {
    const html = generateHtmlExport({
      element: 'test',
      title: 'Test',
      data: baseData,
      flows: [],
      children: {},
    });
    expect(html).toContain('--bg:');
    expect(html).toContain('--accent:');
  });

  it('includes CSS variables for light theme', () => {
    const html = generateHtmlExport({
      element: 'test',
      title: 'Test',
      data: baseData,
      flows: [],
      children: {},
    });
    expect(html).toContain('html.light');
  });

  it('includes esc function for HTML escaping', () => {
    const html = generateHtmlExport({
      element: 'test',
      title: 'Test',
      data: baseData,
      flows: [],
      children: {},
    });
    expect(html).toContain('function esc');
  });

  it('includes parseFlowchart function', () => {
    const html = generateHtmlExport({
      element: 'test',
      title: 'Test',
      data: baseData,
      flows: [],
      children: {},
    });
    expect(html).toContain('function parseFlowchart');
  });

  it('includes renderDiagram function', () => {
    const html = generateHtmlExport({
      element: 'test',
      title: 'Test',
      data: baseData,
      flows: [],
      children: {},
    });
    expect(html).toContain('function renderDiagram');
  });

  it('includes flow toggle function', () => {
    const html = generateHtmlExport({
      element: 'test',
      title: 'Test',
      data: baseData,
      flows: baseFlows,
      children: {},
    });
    expect(html).toContain('toggleFlow');
  });

  it('includes showCard function for node details', () => {
    const html = generateHtmlExport({
      element: 'test',
      title: 'Test',
      data: baseData,
      flows: [],
      children: baseChildren,
    });
    expect(html).toContain('function showCard');
  });

  it('handles empty diagram', () => {
    const html = generateHtmlExport({
      element: 'test',
      title: 'Test',
      data: { name: 'test' },
      flows: [],
      children: {},
    });
    expect(html).toContain('<!DOCTYPE html>');
  });

  it('preserves literal backslash-n in diagram labels', () => {
    const diagramWithBackslashN = 'graph LR\n    A["Line1\\nLine2"] --> B';
    const data: ClassData = { name: 'test', diagram: diagramWithBackslashN };
    const html = generateHtmlExport({
      element: 'test', title: 'Test', data, flows: [], children: {},
    });
    // Base64 should preserve the literal \n
    const match = html.match(/var DIAGRAM_B64 = "([^"]+)"/);
    const decoded = Buffer.from(match![1], 'base64').toString('utf-8');
    expect(decoded).toBe(diagramWithBackslashN);
  });

  it('includes children with diagrams in CHILDREN_DIAGRAMS', () => {
    const html = generateHtmlExport({
      element: 'test',
      title: 'Test',
      data: baseData,
      flows: [],
      children: baseChildren,
    });
    expect(html).toContain('var CHILDREN_DIAGRAMS');
    expect(html).toContain('child2');
  });

  it('omits children without diagrams from CHILDREN_DIAGRAMS', () => {
    const html = generateHtmlExport({
      element: 'test',
      title: 'Test',
      data: baseData,
      flows: [],
      children: baseChildren,
    });
    const match = html.match(/var CHILDREN_DIAGRAMS = (\{.*?\});/s);
    const diagrams = JSON.parse(match![1]);
    expect(diagrams.child1).toBeUndefined();
    expect(diagrams.child2).toBeDefined();
  });

  it('includes children count in header subtitle', () => {
    const html = generateHtmlExport({
      element: 'test',
      title: 'Test',
      data: baseData,
      flows: [],
      children: baseChildren,
    });
    expect(html).toContain('2 children');
  });

  it('applies-before-paint to prevent theme flash', () => {
    const html = generateHtmlExport({
      element: 'test',
      title: 'Test',
      data: baseData,
      flows: [],
      children: {},
    });
    // Script should be in <head> before paint
    expect(html).toContain('localStorage.getItem(\'omm-theme\')');
    expect(html).toContain('prefers-color-scheme');
  });

  it('escapes flow descriptions via JSON serialization', () => {
    const flows: FlowDef[] = [
      { name: 'Test', description: '<img onerror=alert(1)>', steps: [{ node: 'a' }] },
    ];
    const html = generateHtmlExport({
      element: 'test',
      title: 'Test',
      data: baseData,
      flows,
      children: {},
    });
    // The raw <img tag should not appear as executable HTML
    const imgMatches = html.match(/<img onerror=alert\(1\)>/g) || [];
    expect(imgMatches.length).toBe(0);
  });

  it('escapes XSS in node details (description)', () => {
    const xssData: ClassData = {
      name: 'test',
      description: '<script>alert("xss")</script>',
    };
    const html = generateHtmlExport({
      element: 'test',
      title: 'Test',
      data: xssData,
      flows: [],
      children: {},
    });
    // The raw <script> tag should not appear in the HTML
    expect(html).not.toContain('<script>alert("xss")</script>');
    // It should be JSON-escaped or HTML-escaped
    expect(html).toMatch(/script.*alert.*xss/); // appears in escaped form
  });

  it('escapes XSS in children description', () => {
    const children: Record<string, ClassData> = {
      'evil-child': {
        name: 'test/evil-child',
        description: '<img src=x onerror=alert(1)>',
      },
    };
    const html = generateHtmlExport({
      element: 'test',
      title: 'Test',
      data: baseData,
      flows: [],
      children,
    });
    // The raw <img onerror> should not appear in the HTML
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
  });

  it('escapes XSS in context, concern, constraint fields', () => {
    const xssData: ClassData = {
      name: 'test',
      description: 'normal',
      context: '<script>alert(1)</script>',
      concern: '<iframe src=javascript:alert(1)></iframe>',
      constraint: '<svg onload=alert(1)>',
    };
    const html = generateHtmlExport({
      element: 'test',
      title: 'Test',
      data: xssData,
      flows: [],
      children: {},
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<iframe src=javascript:alert(1)></iframe>');
    expect(html).not.toContain('<svg onload=alert(1)>');
  });
});
