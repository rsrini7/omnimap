import path from 'node:path';
import fs from 'node:fs';
import YAML from 'yaml';
import { analyzeDirectory, formatAnalysisMarkdown, formatAnalysisJSON } from '../lib/analyzer/index.js';
import {
  findCycles, findHotspots, findDeadExports, findLayerViolations,
  computeFitness, findComplexHotspots, previewChangeImpact, findGodNodes,
  detectCommunities, generateTour, fuzzySearch, formatCycles, formatHotspots,
  formatDeadExports, formatGodNodes, formatCommunities, formatTour, formatImpactPreview,
} from '../lib/analyzer/insights.js';
import {
  getOmmDir, listClasses, listNodes, readField, readNodeField,
  readNodeMeta, readMeta, classExists,
} from '../lib/store.js';
import { validateDiagramFormat } from '../lib/validate.js';
import { detectDiagramFormat } from '../lib/format.js';
import { getIncomingRefs, getOutgoingRefs } from '../lib/refs.js';
import { buildCoverageMap, computeCoverageStats } from '../lib/treecode.js';

import '../lib/analyzer/languages/javascript.js';
import '../lib/analyzer/languages/typescript.js';
import '../lib/analyzer/languages/java.js';
import '../lib/analyzer/languages/kotlin.js';
import '../lib/analyzer/languages/scala.js';
import '../lib/analyzer/languages/python.js';
import '../lib/analyzer/languages/go.js';
import '../lib/analyzer/languages/rust.js';

const HELP = `
omm mcp [--port <port>]

Start an MCP (Model Context Protocol) stdio server for AI agent integration.
Exposes omm analysis tools via JSON-RPC over stdin/stdout.

Usage:
  omm mcp                    Start MCP stdio server
  omm mcp --port 8080        Start MCP HTTP server on port

MCP Tools exposed:
  omm_list        — List all elements
  omm_show        — Show element details
  omm_read        — Read a field from an element
  omm_eval        — Evaluate documentation quality
  omm_validate    — Validate diagram syntax
  omm_refs        — Show cross-references
  omm_inspect     — Detailed element inspection
  omm_tree        — Show element tree
  omm_diff        — Compare diagram versions
  omm_treecode    — Code ↔ docs coverage
  omm_analyze     — Run structural analysis on a directory
  omm_search      — Fuzzy search across elements
  omm_query       — Graph traversal queries
  omm_tour        — Generate guided tour
  omm_impact      — Change impact analysis
`;

interface McpRequest {
  jsonrpc: '2.0';
  id?: number | string;
  method: string;
  params?: any;
}

interface McpResponse {
  jsonrpc: '2.0';
  id?: number | string;
  result?: any;
  error?: { code: number; message: string };
}

const TOOLS = [
  {
    name: 'omm_list',
    description: 'List all perspectives and elements in .omm/',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project name (for arch repos)' },
      },
    },
  },
  {
    name: 'omm_show',
    description: 'Show all fields for an element (description, diagram, context, etc.)',
    inputSchema: {
      type: 'object',
      properties: {
        element: { type: 'string', description: 'Element path (e.g. "auth-service" or "overall-architecture/flow")' },
      },
      required: ['element'],
    },
  },
  {
    name: 'omm_read',
    description: 'Read a specific field from an element',
    inputSchema: {
      type: 'object',
      properties: {
        element: { type: 'string', description: 'Element path' },
        field: { type: 'string', enum: ['description', 'diagram', 'context', 'constraint', 'concern', 'todo', 'note'], description: 'Field name' },
      },
      required: ['element', 'field'],
    },
  },
  {
    name: 'omm_eval',
    description: 'Evaluate documentation quality. Returns score (0-100), field coverage, issues.',
    inputSchema: {
      type: 'object',
      properties: {
        element: { type: 'string', description: 'Element to evaluate (default: all)' },
      },
    },
  },
  {
    name: 'omm_validate',
    description: 'Validate diagram syntax (Mermaid or PlantUML)',
    inputSchema: {
      type: 'object',
      properties: {
        element: { type: 'string', description: 'Element to validate' },
      },
      required: ['element'],
    },
  },
  {
    name: 'omm_refs',
    description: 'Show incoming and outgoing cross-references for an element',
    inputSchema: {
      type: 'object',
      properties: {
        element: { type: 'string', description: 'Element path' },
      },
      required: ['element'],
    },
  },
  {
    name: 'omm_inspect',
    description: 'Detailed element inspection (score, fields, links, source tracking)',
    inputSchema: {
      type: 'object',
      properties: {
        element: { type: 'string', description: 'Element path' },
      },
      required: ['element'],
    },
  },
  {
    name: 'omm_tree',
    description: 'Show element tree structure',
    inputSchema: {
      type: 'object',
      properties: {
        element: { type: 'string', description: 'Root element (default: all)' },
      },
    },
  },
  {
    name: 'omm_diff',
    description: 'Compare current vs previous diagram for an element',
    inputSchema: {
      type: 'object',
      properties: {
        element: { type: 'string', description: 'Element path' },
      },
      required: ['element'],
    },
  },
  {
    name: 'omm_treecode',
    description: 'Show code ↔ docs coverage map',
    inputSchema: {
      type: 'object',
      properties: {
        stats: { type: 'boolean', description: 'Show summary stats only' },
      },
    },
  },
  {
    name: 'omm_analyze',
    description: 'Run structural code analysis. Returns dependency graph, god nodes, communities, fitness score.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Directory to analyze (default: current)' },
        format: { type: 'string', enum: ['md', 'json'], description: 'Output format (default: md)' },
      },
    },
  },
  {
    name: 'omm_search',
    description: 'Fuzzy search across element names, descriptions, and paths.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Max results (default: 20)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'omm_query',
    description: 'Graph traversal queries. Find connections, cycles, hotspots.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Query: "cycles", "hotspots", "what connects X to Y", "who imports X"' },
        dir: { type: 'string', description: 'Directory to analyze' },
      },
      required: ['query'],
    },
  },
  {
    name: 'omm_tour',
    description: 'Generate a guided tour (topological reading order) for the codebase.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Directory to analyze' },
        limit: { type: 'number', description: 'Max files (default: 20)' },
      },
    },
  },
  {
    name: 'omm_impact',
    description: 'Show change impact for a specific file — what would break if this file changes.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'File path to check impact for' },
        dir: { type: 'string', description: 'Directory to analyze' },
      },
      required: ['file'],
    },
  },
];

function resolveElement(element: string): { perspective: string; nodePath: string[] } {
  const parts = element.split('/');
  return { perspective: parts[0], nodePath: parts.slice(1) };
}

function getElementData(element: string): any {
  const { perspective, nodePath } = resolveElement(element);
  const ommDir = getOmmDir();
  const elemDir = nodePath.length === 0
    ? path.join(ommDir, perspective)
    : path.join(ommDir, perspective, ...nodePath);

  if (!fs.existsSync(elemDir)) return null;

  const meta = nodePath.length === 0 ? readMeta(perspective) : readNodeMeta(perspective, nodePath);
  const { format } = detectDiagramFormat(elemDir);

  const fields: Record<string, string | null> = {};
  for (const field of ['description', 'diagram', 'context', 'constraint', 'concern', 'todo', 'note'] as const) {
    fields[field] = nodePath.length === 0 ? readField(perspective, field) : readNodeField(perspective, nodePath, field);
  }

  return {
    element,
    format,
    meta,
    fields,
    children: listNodes(perspective, nodePath),
  };
}

export async function handleTool(name: string, args: any): Promise<string> {
  const dir = path.resolve(args?.dir || '.');

  switch (name) {
    case 'omm_list': {
      const ommDir = getOmmDir();
      if (!ommDir) return 'No .omm/ directory found.';
      const classes = listClasses();
      if (classes.length === 0) return 'No elements found.';

      const result: string[] = [];
      for (const cls of classes) {
        const desc = readField(cls, 'description');
        const children = listNodes(cls, []);
        result.push(`${cls}${children.length > 0 ? ` (${children.length} children)` : ''}${desc ? ` — ${desc.slice(0, 80)}` : ''}`);
      }
      return result.join('\n');
    }

    case 'omm_show': {
      if (!args?.element) return 'Error: element required';
      const data = getElementData(args.element);
      if (!data) return `Error: element '${args.element}' not found`;

      const lines: string[] = [`Element: ${data.element}`];
      lines.push(`Format: ${data.format}`);
      if (data.meta?.kind) lines.push(`Kind: ${data.meta.kind}`);
      if (data.meta?.tags?.length) lines.push(`Tags: ${data.meta.tags.join(', ')}`);
      if (data.children.length > 0) lines.push(`Children: ${data.children.join(', ')}`);
      lines.push('');

      for (const [field, value] of Object.entries(data.fields)) {
        if (value && typeof value === 'string') {
          lines.push(`## ${field}`);
          lines.push(value.slice(0, 500));
          lines.push('');
        }
      }
      return lines.join('\n');
    }

    case 'omm_read': {
      if (!args?.element || !args?.field) return 'Error: element and field required';
      const { perspective, nodePath } = resolveElement(args.element);
      const value = nodePath.length === 0
        ? readField(perspective, args.field)
        : readNodeField(perspective, nodePath, args.field);
      return value || `(no ${args.field})`;
    }

    case 'omm_eval': {
      const ommDir = getOmmDir();
      if (!ommDir) return 'No .omm/ directory found.';

      const classes = listClasses();
      if (classes.length === 0) return 'No elements to evaluate.';

      let totalScore = 0;
      let totalFields = 0;
      let totalDiagrams = 0;
      let totalValid = 0;
      const issues: string[] = [];

      for (const cls of classes) {
        const { perspective, nodePath } = resolveElement(cls);
        const data = getElementData(cls);
        if (!data) continue;

        // Score calculation
        let score = 0;
        const filledFields = Object.values(data.fields).filter(v => v && (v as string).trim()).length;
        totalFields += filledFields;

        score += (filledFields / 7) * 40; // Fields: 40 points

        if (data.fields.diagram) {
          totalDiagrams++;
          const { format } = data;
          const result = validateDiagramFormat(data.fields.diagram, format);
          if (result.valid) {
            score += 20;
            totalValid++;
          } else {
            score += 10;
            issues.push(`${cls}: invalid ${format} diagram`);
          }
        }

        if (data.fields.description && (data.fields.description as string).length > 50) score += 10;
        if (data.fields.context) score += 5;
        if (data.fields.constraint) score += 5;
        if (data.fields.concern) score += 5;
        if (data.fields.todo) score += 2.5;
        if (data.fields.note) score += 2.5;

        totalScore += score;
      }

      const avgScore = Math.round(totalScore / classes.length);
      const fieldCoverage = Math.round((totalFields / (classes.length * 7)) * 100);
      const diagramCoverage = Math.round((totalDiagrams / classes.length) * 100);

      const lines = [
        `Overall Score: ${avgScore}/100`,
        `Elements: ${classes.length}`,
        `Field Coverage: ${fieldCoverage}%`,
        `Diagram Coverage: ${diagramCoverage}% (${totalValid} valid)`,
      ];

      if (issues.length > 0) {
        lines.push('');
        lines.push('Issues:');
        issues.slice(0, 10).forEach(i => lines.push(`  - ${i}`));
      }

      return lines.join('\n');
    }

    case 'omm_validate': {
      if (!args?.element) return 'Error: element required';
      const data = getElementData(args.element);
      if (!data) return `Error: element '${args.element}' not found`;
      if (!data.fields.diagram) return `${args.element}: no diagram`;

      const result = validateDiagramFormat(data.fields.diagram, data.format);
      const lines = [`${args.element}: ${result.valid ? '✓ valid' : '✗ invalid'} (${data.format})`];

      for (const issue of result.issues) {
        lines.push(`  ${issue.level} [${issue.rule}] ${issue.message}`);
      }

      return lines.join('\n');
    }

    case 'omm_refs': {
      if (!args?.element) return 'Error: element required';
      const ommDir = getOmmDir();
      if (!ommDir) return 'No .omm/ directory found.';

      const incoming = getIncomingRefs(args.element);
      const outgoing = getOutgoingRefs(args.element);

      const lines = [`References for ${args.element}:`];
      lines.push('');
      lines.push(`Incoming (${incoming.length}):`);
      incoming.forEach(r => lines.push(`  ← ${r.source_class} → ${r.target_class} (${r.node_id})`));
      lines.push('');
      lines.push(`Outgoing (${outgoing.length}):`);
      outgoing.forEach(r => lines.push(`  → ${r.source_class} → ${r.target_class} (${r.node_id})`));

      return lines.join('\n');
    }

    case 'omm_inspect': {
      if (!args?.element) return 'Error: element required';
      const data = getElementData(args.element);
      if (!data) return `Error: element '${args.element}' not found`;

      const { perspective, nodePath } = resolveElement(args.element);
      const incoming = getIncomingRefs(args.element);
      const outgoing = getOutgoingRefs(args.element);

      const lines = [
        `Element: ${data.element}`,
        `Format: ${data.format}`,
        `Kind: ${data.meta?.kind || 'unknown'}`,
        `Created: ${data.meta?.created || 'unknown'}`,
        `Updated: ${data.meta?.updated || 'unknown'}`,
        `Updates: ${data.meta?.update_count || 0}`,
        '',
        'Fields:',
      ];

      for (const [field, value] of Object.entries(data.fields)) {
        const status = value ? `✓ (${(value as string).length} chars)` : '✗';
        lines.push(`  ${field}: ${status}`);
      }

      lines.push('');
      lines.push(`Children: ${data.children.length}`);
      lines.push(`Incoming refs: ${incoming.length}`);
      lines.push(`Outgoing refs: ${outgoing.length}`);

      if (data.meta?.tags?.length) {
        lines.push(`Tags: ${data.meta.tags.join(', ')}`);
      }

      return lines.join('\n');
    }

    case 'omm_tree': {
      const ommDir = getOmmDir();
      if (!ommDir) return 'No .omm/ directory found.';

      const classes = listClasses();
      const lines: string[] = [];

      const buildTree = (persp: string, nodePath: string[], indent: number) => {
        const prefix = '  '.repeat(indent);
        const fullPath = [persp, ...nodePath].join('/');
        const children = listNodes(persp, nodePath);
        const desc = nodePath.length === 0 ? readField(persp, 'description') : readNodeField(persp, nodePath, 'description');
        const shortDesc = desc ? ` — ${desc.slice(0, 50)}` : '';

        lines.push(`${prefix}${nodePath[nodePath.length - 1] || persp}${shortDesc}`);

        for (const child of children) {
          buildTree(persp, [...nodePath, child], indent + 1);
        }
      };

      for (const cls of classes) {
        buildTree(cls, [], 0);
      }

      return lines.join('\n');
    }

    case 'omm_diff': {
      if (!args?.element) return 'Error: element required';
      const { perspective, nodePath } = resolveElement(args.element);
      const meta = nodePath.length === 0 ? readMeta(perspective) : readNodeMeta(perspective, nodePath);

      if (!meta?.prev_diagram) return `${args.element}: no previous diagram`;

      const current = nodePath.length === 0 ? readField(perspective, 'diagram') : readNodeField(perspective, nodePath, 'diagram');
      if (!current) return `${args.element}: no current diagram`;

      const lines = [
        `Diagram diff for ${args.element}:`,
        '',
        '--- previous',
        '+++ current',
      ];

      const prevLines = meta.prev_diagram.split('\n');
      const currLines = current.split('\n');
      const maxLen = Math.max(prevLines.length, currLines.length);

      for (let i = 0; i < maxLen; i++) {
        const prev = prevLines[i] || '';
        const curr = currLines[i] || '';
        if (prev !== curr) {
          if (prev) lines.push(`- ${prev}`);
          if (curr) lines.push(`+ ${curr}`);
        }
      }

      return lines.join('\n');
    }

    case 'omm_treecode': {
      const ommDir = getOmmDir();
      if (!ommDir) return 'No .omm/ directory found.';

      const coverage = buildCoverageMap('.', ommDir);
      const stats = computeCoverageStats(coverage, ommDir);

      if (args?.stats) {
        return [
          `Total files: ${stats.sourceFiles}`,
          `Covered: ${stats.coveredFiles}`,
          `Coverage: ${stats.coveragePercent}%`,
          `Orphaned .omm: ${stats.orphanedElements}`,
        ].join('\n');
      }

      const lines: string[] = ['Code ↔ Docs Coverage:'];
      for (const item of coverage.slice(0, 50)) {
        const icon = item.elementPath ? '✓' : '✗';
        lines.push(`${icon} ${item.sourcePath}${item.elementPath ? ` → ${item.elementPath}` : ''}`);
      }
      if (coverage.length > 50) lines.push(`... and ${coverage.length - 50} more`);

      return lines.join('\n');
    }

    case 'omm_analyze': {
      const result = await analyzeDirectory(dir);
      if (args?.format === 'json') return formatAnalysisJSON(result);
      return formatAnalysisMarkdown(result);
    }

    case 'omm_search': {
      const ommDir = getOmmDir();
      if (!ommDir) return 'No .omm/ directory found.';
      const elements: { path: string; description?: string }[] = [];
      const walk = (persp: string, nodePath: string[]) => {
        const childPath = nodePath.join('/');
        elements.push({ path: `${persp}/${childPath}`, description: readNodeField(persp, nodePath, 'description') || undefined });
        const children = listNodes(persp, nodePath);
        for (const child of children) {
          walk(persp, [...nodePath, child]);
        }
      };
      for (const persp of listClasses()) {
        elements.push({ path: persp, description: readField(persp, 'description') || undefined });
        const children = listNodes(persp, []);
        for (const child of children) {
          walk(persp, [child]);
        }
      }
      const results = fuzzySearch(args?.query || '', elements, args?.limit || 20);
      return results.map(r => `${r.element} [${r.score}]${r.snippet ? ` — ${r.snippet}` : ''}`).join('\n');
    }

    case 'omm_query': {
      const result = await analyzeDirectory(dir);
      const query = (args?.query || '').toLowerCase();

      if (query.includes('cycle')) {
        const cycles = findCycles(result.graph);
        return formatCycles(cycles);
      }
      if (query.includes('hotspot')) {
        const hotspots = findHotspots(result.graph);
        return formatHotspots(hotspots);
      }
      if (query.includes('dead') || query.includes('unused')) {
        const dead = findDeadExports(result.files, result.graph);
        return formatDeadExports(dead);
      }
      if (query.includes('god') || query.includes('hub')) {
        const gods = findGodNodes(result.graph);
        return formatGodNodes(gods);
      }
      if (query.includes('community') || query.includes('cluster')) {
        const communities = detectCommunities(result.graph);
        return formatCommunities(communities);
      }

      // Default: show graph summary
      return `Graph: ${result.graph.nodes.length} nodes, ${result.graph.edges.length} edges\nCycles: ${findCycles(result.graph).length}\nHotspots: ${findHotspots(result.graph).length}`;
    }

    case 'omm_tour': {
      const result = await analyzeDirectory(dir);
      const tour = generateTour(result.graph).slice(0, args?.limit || 20);
      return formatTour(tour);
    }

    case 'omm_impact': {
      const result = await analyzeDirectory(dir);
      const impact = previewChangeImpact(result.graph, args?.file);
      return formatImpactPreview(impact);
    }

    default:
      return `Unknown tool: ${name}`;
  }
}

export function handleRequest(req: McpRequest): McpResponse {
  switch (req.method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'omm', version: '0.2.0' },
        },
      };
    case 'tools/list':
      return { jsonrpc: '2.0', id: req.id, result: { tools: TOOLS } };
    case 'tools/call': {
      const toolName = req.params?.name;
      const toolArgs = req.params?.arguments || {};

      return {
        jsonrpc: '2.0',
        id: req.id,
        result: handleTool(toolName, toolArgs)
          .then(text => ({
            content: [{ type: 'text', text }],
          }))
          .catch(err => ({
            content: [{ type: 'text', text: `Error: ${err.message || err}` }],
            isError: true,
          })),
      } as any;
    }
    default:
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32601, message: `Method not found: ${req.method}` },
      };
  }
}

export async function commandMcp(args: string[]): Promise<void> {
  let help = false;
  let port = 0;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help' || args[i] === '-h') help = true;
    if (args[i] === '--port' && args[i + 1]) port = parseInt(args[++i], 10);
  }

  if (help) {
    process.stdout.write(HELP.trim() + '\n');
    return;
  }

  if (port > 0) {
    // HTTP mode
    const http = await import('node:http');
    const server = http.createServer(async (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405);
        res.end('Method not allowed');
        return;
      }

      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString('utf-8');

      try {
        const parsed = JSON.parse(body);
        const resp = handleRequest(parsed);
        const result = resp.result && typeof resp.result.then === 'function' ? await resp.result : resp.result;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ...resp, result }));
      } catch (err: any) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: err.message }));
      }
    });

    server.listen(port, () => {
      process.stderr.write(`MCP HTTP server listening on port ${port}\n`);
    });
  } else {
    // stdio mode
    const readline = await import('node:readline');
    const rl = readline.createInterface({ input: process.stdin });

    rl.on('line', async (line) => {
      try {
        const req: McpRequest = JSON.parse(line);
        const resp = handleRequest(req);
        const result = resp.result && typeof resp.result.then === 'function' ? await resp.result : resp.result;
        process.stdout.write(JSON.stringify({ ...resp, result }) + '\n');
      } catch (err: any) {
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: err.message } }) + '\n');
      }
    });

    process.stderr.write('MCP stdio server ready\n');
  }
}
