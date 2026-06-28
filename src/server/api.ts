import type { IncomingMessage, ServerResponse } from 'node:http';
import fs from 'node:fs';
import * as nodePath from 'node:path';
import { listClasses, showClass, readMeta, readField, readNodeField, listNodes, showNode, listProjects, getOmmDir, isArchRepo, readFlows, getLinks } from '../lib/store.js';
import { generateHtmlExport } from '../lib/html-export.js';
import { diffMermaid } from '../lib/diff.js';
import { validateDiagram } from '../lib/validate.js';
import { getIncomingRefs, getOutgoingRefs, buildRefGraph } from '../lib/refs.js';
import { searchOmm } from './search.js';
import { analyzeDirectory } from '../lib/analyzer/index.js';
import { buildCoverageMap, computeCoverageStats } from '../lib/treecode.js';
import { checkSignature, readStoredSignature } from '../lib/signature.js';
import { buildReconcileReport } from '../lib/reconcile.js';
import { resolveLinksForElement, formatResolutions } from '../lib/link-resolver.js';

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function numParam(v: string | null): number | undefined {
  if (v === null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export async function handleApi(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const path = url.pathname;


  // GET /api/classes
  if (path === '/api/classes') {
    json(res, listClasses());
    return true;
  }

  // GET /api/class/:name
  const classMatch = path.match(/^\/api\/class\/([^/]+)$/);
  if (classMatch) {
    const data = showClass(classMatch[1]);
    if (!data) {
      json(res, { error: 'class not found' }, 404);
    } else {
      json(res, data);
    }
    return true;
  }

  // GET /api/class/:name/diff
  const diffMatch = path.match(/^\/api\/class\/([^/]+)\/diff$/);
  if (diffMatch) {
    const className = diffMatch[1];
    const current = readField(className, 'diagram');
    const meta = readMeta(className);
    const prev = meta?.prev_diagram;
    if (!current || !prev) {
      json(res, { error: 'no diff available', has_changes: false });
    } else {
      const diff = diffMermaid(prev, current);
      json(res, { ...diff, prev_diagram: prev, current_diagram: current });
    }
    return true;
  }

  // GET /api/class/:name/refs
  const refsMatch = path.match(/^\/api\/class\/([^/]+)\/refs$/);
  if (refsMatch) {
    const className = refsMatch[1];
    const nodeParam = url.searchParams.get('node');
    let incoming = getIncomingRefs(className);
    let outgoing = getOutgoingRefs(className);

    // For nested elements, also extract refs from parent diagram edges
    if (nodeParam && nodeParam.includes('/')) {
      const parts = nodeParam.split('/');
      const perspective = parts[0];
      const nodeId = parts[parts.length - 1];
      const parentPath = parts.slice(0, -1).join('/');
      const parentDiagram = parentPath === perspective
        ? readField(perspective, 'diagram')
        : readNodeField(perspective, parentPath.split('/').slice(1), 'diagram');

      if (parentDiagram) {
        // Find edges where this node is source or target
        const edgePattern = new RegExp(`(\\S+)\\s*-->.*?(\\S+)`, 'g');
        let match;
        while ((match = edgePattern.exec(parentDiagram)) !== null) {
          const from = match[1].replace(/["'\[\](){}]/g, '').split('\\n')[0].trim();
          const to = match[2].replace(/["'\[\](){}]/g, '').split('\\n')[0].trim();
          if (from === nodeId && !outgoing.some(r => r.target_class === to)) {
            outgoing.push({ source_class: nodeParam, target_class: to, node_id: nodeId });
          }
          if (to === nodeId && !incoming.some(r => r.source_class === from)) {
            incoming.push({ source_class: from, target_class: nodeParam, node_id: nodeId });
          }
        }
      }
    }

    json(res, { incoming, outgoing });
    return true;
  }

  // GET /api/class/:name/flows
  const flowsMatch = path.match(/^\/api\/class\/([^/]+)\/flows$/);
  if (flowsMatch) {
    const className = flowsMatch[1];
    json(res, { element: className, flows: readFlows(className) });
    return true;
  }

  // GET /api/class/:perspective/nodes
  const nodesMatch = path.match(/^\/api\/class\/([^/]+)\/nodes$/);
  if (nodesMatch) {
    const children = listNodes(nodesMatch[1], []);
    json(res, { perspective: nodesMatch[1], children });
    return true;
  }

  // GET /api/search?q=...&limit=&offset=&minScore=
  if (path === '/api/search') {
    const q = url.searchParams.get('q') || '';
    const limit = numParam(url.searchParams.get('limit'));
    const offset = numParam(url.searchParams.get('offset'));
    const minScore = numParam(url.searchParams.get('minScore'));
    json(res, searchOmm(q, { limit, offset, minScore }));
    return true;
  }

  // GET /api/projects
  if (path === '/api/projects') {
    const projects = listProjects().map(name => {
      const projectDir = nodePath.join(getOmmDir(), name);
      let perspectiveCount = 0;
      let elementCount = 0;
      try {
        const entries = fs.readdirSync(projectDir, { withFileTypes: true });
        perspectiveCount = entries.filter(e => e.isDirectory() && !e.name.startsWith('.')).length;
        elementCount = entries.length;
      } catch {}
      return { name, perspectiveCount, elementCount };
    });
    json(res, { isArchRepo: isArchRepo(), projects, orgs: [] });
    return true;
  }

  // GET /api/refs/graph
  if (path === '/api/refs/graph') {
    json(res, buildRefGraph());
    return true;
  }

  // GET /api/stats — language statistics and codebase health
  if (path === '/api/stats') {
    const ommDir = getOmmDir();
    const cwd = ommDir ? nodePath.dirname(ommDir) : process.cwd();
    try {
      const analysis = await analyzeDirectory(cwd);
      json(res, {
        languageStats: analysis.stats.languageStats,
        totalFiles: analysis.stats.totalFiles,
        analyzedFiles: analysis.stats.analyzedFiles,
        errorFiles: analysis.stats.errorFiles,
      });
    } catch (err: any) {
      json(res, { error: err.message });
    }
    return true;
  }

  // GET /api/class/:name/validate
  const validateMatch = path.match(/^\/api\/class\/([^/]+)\/validate$/);
  if (validateMatch) {
    const className = validateMatch[1];
    const diagram = readField(className, 'diagram');
    if (!diagram) {
      json(res, { valid: true, issues: [], element: className });
      return true;
    }
    const allClasses = listClasses();
    const result = validateDiagram(diagram, { className, allClasses });
    json(res, { ...result, element: className });
    return true;
  }

  // GET /api/class/:perspective/node/:path+
  const nodeMatch = path.match(/^\/api\/class\/([^/]+)\/node\/(.+)$/);

  if (nodeMatch) {
    const perspective = nodeMatch[1];
    const nodePath = nodeMatch[2].split('/');
    const lastSegment = nodePath[nodePath.length - 1];

    if (lastSegment === 'nodes') {
      const parentPath = nodePath.slice(0, -1);
      const children = listNodes(perspective, parentPath);
      json(res, { perspective, path: parentPath, children });
      return true;
    }

    const data = showNode(perspective, nodePath);
    if (!data) {
      json(res, { error: 'node not found' }, 404);
    } else {
      const children = listNodes(perspective, nodePath);
      json(res, { ...data, children });
    }
    return true;
  }

  // GET /api/class/:name/export/html
  const exportHtmlMatch = path.match(/^\/api\/class\/([^/]+)\/export\/html$/);
  if (exportHtmlMatch) {
    const className = exportHtmlMatch[1];
    const data = showClass(className);
    if (!data || !data.diagram) {
      json(res, { error: 'element not found or has no diagram' }, 404);
      return true;
    }
    const flows = readFlows(className);
    const children: Record<string, import('../types.js').ClassData> = {};
    const childNames = listNodes(className, []);
    for (const child of childNames) {
      const childData = showClass(className + '/' + child);
      if (childData) children[child] = childData;
    }
    // Get project name from omm dir
    const ommDir = getOmmDir();
    const projectName = nodePath.basename(nodePath.dirname(ommDir));
    const title = `${projectName} — ${className}`;
    const html = generateHtmlExport({ element: className, title, data, flows, children });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(html);
    return true;
  }

  // ── New API endpoints for treecode, signature, reconcile, inspect, links ──

  // GET /api/treecode — Code ↔ docs coverage map
  if (path === '/api/treecode') {
    try {
      const ommDir = getOmmDir();
      const sourceDir = nodePath.dirname(ommDir);
      const entries = buildCoverageMap(sourceDir, ommDir);
      const stats = computeCoverageStats(entries, ommDir);
      json(res, { entries, stats });
    } catch (err: any) {
      json(res, { error: err.message }, 500);
    }
    return true;
  }

  // GET /api/treecode/stats — Coverage statistics only
  if (path === '/api/treecode/stats') {
    try {
      const ommDir = getOmmDir();
      const sourceDir = nodePath.dirname(ommDir);
      const entries = buildCoverageMap(sourceDir, ommDir);
      const stats = computeCoverageStats(entries, ommDir);
      json(res, stats);
    } catch (err: any) {
      json(res, { error: err.message }, 500);
    }
    return true;
  }

  // GET /api/treecode/uncovered — Uncovered source files
  if (path === '/api/treecode/uncovered') {
    try {
      const ommDir = getOmmDir();
      const sourceDir = nodePath.dirname(ommDir);
      const entries = buildCoverageMap(sourceDir, ommDir);
      const uncovered = entries.filter(e => !e.elementPath);
      json(res, { uncovered, total: entries.length, covered: entries.length - uncovered.length });
    } catch (err: any) {
      json(res, { error: err.message }, 500);
    }
    return true;
  }

  // GET /api/signature — Structural signature status
  if (path === '/api/signature') {
    try {
      const ommDir = getOmmDir();
      const result = checkSignature(ommDir);
      json(res, result);
    } catch (err: any) {
      json(res, { error: err.message }, 500);
    }
    return true;
  }

  // GET /api/reconcile — Reconciliation report
  if (path === '/api/reconcile') {
    try {
      const ommDir = getOmmDir();
      const report = buildReconcileReport(ommDir);
      json(res, report);
    } catch (err: any) {
      json(res, { error: err.message }, 500);
    }
    return true;
  }

  // GET /api/class/{name}/inspect — Detailed element inspection
  const inspectMatch = path.match(/^\/api\/class\/([^/]+)\/inspect$/);
  if (inspectMatch) {
    const className = inspectMatch[1];
    const data = showClass(className);
    if (!data) {
      json(res, { error: 'class not found' }, 404);
    } else {
      const meta = readMeta(className);
      const links = getLinks(className);
      const incoming = getIncomingRefs(className);
      const outgoing = getOutgoingRefs(className);

      // Get link resolutions
      let linkResolutions: any[] = [];
      try {
        linkResolutions = resolveLinksForElement(className);
      } catch {
        // ignore
      }

      json(res, {
        ...data,
        meta,
        links,
        incomingRefs: incoming,
        outgoingRefs: outgoing,
        linkResolutions,
      });
    }
    return true;
  }

  // GET /api/class/{name}/links — External links for element
  const linksMatch = path.match(/^\/api\/class\/([^/]+)\/links$/);
  if (linksMatch) {
    const className = linksMatch[1];
    const links = getLinks(className);
    json(res, { element: className, links });
    return true;
  }

  // GET /api/class/{name}/link-resolutions — Link resolution for element
  const linkResMatch = path.match(/^\/api\/class\/([^/]+)\/link-resolutions$/);
  if (linkResMatch) {
    const className = linkResMatch[1];
    try {
      const resolutions = resolveLinksForElement(className);
      const formatted = formatResolutions(resolutions);
      json(res, { element: className, resolutions, formatted });
    } catch (err: any) {
      json(res, { error: err.message }, 500);
    }
    return true;
  }

  return false;
}
