import path from 'node:path';
import fs from 'node:fs';
import { analyzeDirectory, formatAnalysisMarkdown, formatAnalysisJSON } from '../lib/analyzer/index.js';
import {
  findCycles, findHotspots, findDeadExports, findLayerViolations,
  computeFitness, findComplexHotspots, previewChangeImpact, findGodNodes,
  detectCommunities, generateTour, fuzzySearch, formatCycles, formatHotspots,
  formatDeadExports, formatGodNodes, formatCommunities, formatTour, formatImpactPreview,
} from '../lib/analyzer/insights.js';
import { getOmmDir, listClasses, listNodes, readField, readNodeField } from '../lib/store.js';

// Import language handlers
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
    name: 'omm_analyze',
    description: 'Run structural code analysis. Returns dependency graph, god nodes, communities, layer classification, fitness score.',
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

export async function handleTool(name: string, args: any): Promise<string> {
  const dir = path.resolve(args?.dir || '.');

  switch (name) {
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
          serverInfo: { name: 'omm', version: '0.3.0' },
        },
      };
    case 'tools/list':
      return { jsonrpc: '2.0', id: req.id, result: { tools: TOOLS } };
    case 'tools/call': {
      const toolName = req.params?.name;
      const toolArgs = req.params?.arguments || {};
      // Return a promise wrapper
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
      return { jsonrpc: '2.0', id: req.id, error: { code: -32601, message: `Method not found: ${req.method}` } };
  }
}

export async function commandMcp(args: string[]): Promise<void> {
  let help = false;
  let port = 0;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) port = parseInt(args[++i], 10) || 0;
    else if (args[i] === '--help' || args[i] === '-h') help = true;
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
        res.end('Method Not Allowed');
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = Buffer.concat(chunks).toString('utf-8');
      try {
        const parsed = JSON.parse(body);
        const resp = handleRequest(parsed);
        // Handle async results
        if (resp.result && typeof resp.result.then === 'function') {
          resp.result = await resp.result;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(resp));
      } catch (err: any) {
        res.writeHead(400);
        res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' } }));
      }
    });
    server.listen(port, () => {
      process.stderr.write(`omm MCP server running on http://localhost:${port}\n`);
    });
    return;
  }

  // Stdio mode
  process.stderr.write('omm MCP server started (stdio)\n');

  const readline = await import('node:readline');
  const rl = readline.createInterface({
    input: process.stdin,
    terminal: false,
  });

  rl.on('line', async (line) => {
    if (!line.trim()) return;
    try {
      const req: McpRequest = JSON.parse(line);
      const resp = handleRequest(req);

      // Handle async results
      if (resp.result && typeof resp.result.then === 'function') {
        resp.result = await resp.result;
      }

      process.stdout.write(JSON.stringify(resp) + '\n');
    } catch {
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32700, message: 'Parse error' },
      }) + '\n');
    }
  });
}
