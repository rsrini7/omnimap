import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApi } from './api.js';
import { addSSEClient, startWatcher } from './watcher.js';
import { isArchRepo, listProjects, setOmmDirOverride, getOmmDir } from '../lib/store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getViewerHtmlPath(): string {
  const candidates = [
    path.join(__dirname, 'viewer.html'),
    path.join(__dirname, '..', 'server', 'viewer.html'),
    path.join(__dirname, '..', 'src', 'server', 'viewer.html'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return '';
}

function getViewerHtml(): string {
  const p = getViewerHtmlPath();
  return p ? fs.readFileSync(p, 'utf-8') : '<html><body><h1>viewer.html not found</h1></body></html>';
}

function getProjectsHtmlPath(): string {
  const candidates = [
    path.join(__dirname, 'projects.html'),
    path.join(__dirname, '..', 'server', 'projects.html'),
    path.join(__dirname, '..', 'src', 'server', 'projects.html'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return '';
}

function getProjectsHtml(): string {
  const p = getProjectsHtmlPath();
  return p ? fs.readFileSync(p, 'utf-8') : '<html><body><h1>projects.html not found</h1></body></html>';
}

/** Detect at startup whether cwd is an arch repo (no per-request mutation). */
function detectArchRepo(): { isArch: boolean; projects: string[]; ommDir: string } {
  // Only check the LOCAL .omm/config.yaml for arch_repo flag
  // Do NOT check global config — that would make all projects look like arch repos
  const ommDir = getOmmDir();
  return { isArch: isArchRepo(), projects: listProjects(), ommDir };
}

export function startServer(port: number): void {
  startWatcher();

  // Detect once at startup — no per-request global mutation
  const archInfo = detectArchRepo();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const projectParam = url.searchParams.get('project');

    // Per-request project override for arch-repo views.
    // Uses the same mechanism as CLI --project flag.
    if (projectParam && archInfo.isArch) {
      setOmmDirOverride(path.join(archInfo.ommDir, projectParam));
    } else if (!projectParam) {
      setOmmDirOverride(null);
    }

    // SSE endpoint
    if (url.pathname === '/events') {
      addSSEClient(res);
      return;
    }

    // API endpoints — pass project context via query param, no global state
    if (url.pathname.startsWith('/api/')) {
      if (handleApi(req, res)) return;
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }

    // Serve viewer HTML or project picker
    if (url.pathname === '/' || url.pathname === '/index.html') {
      // Show picker when: arch repo with >1 projects and no ?project= specified
      if (archInfo.isArch && archInfo.projects.length > 1 && !projectParam) {
        const html = getProjectsHtml();
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }

      // Otherwise serve viewer.html
      let html = getViewerHtml();
      // For arch repos: use ?project= param. For normal projects: use cwd name.
      const projectName = projectParam || path.basename(process.cwd());
      const projectSource = projectParam ? 'arch' : 'local';
      html = html.replace('</head>', `<script>window.__projectName=${JSON.stringify(projectName)};window.__projectSource="${projectSource}";</script>\n</head>`);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    // Serve static JS files from viewer directory
    if (url.pathname.endsWith('.js') && !url.pathname.includes('..')) {
      const viewerDir = path.dirname(getViewerHtmlPath());
      const filePath = path.join(viewerDir, url.pathname.slice(1));
      if (fs.existsSync(filePath) && filePath.startsWith(viewerDir)) {
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
        res.end(fs.readFileSync(filePath, 'utf-8'));
        return;
      }
    }

    res.writeHead(404);
    res.end('Not Found');
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      process.stderr.write(`Port ${port} in use, trying ${port + 1}...\n`);
      server.close();
      startServer(port + 1);
    } else {
      throw err;
    }
  });

  server.listen(port, () => {
    process.stderr.write(`oh-my-mermaid viewer running at http://localhost:${port}\n`);
    if (archInfo.isArch) {
      process.stderr.write(`  Arch repo: ${archInfo.ommDir} (${archInfo.projects.length} projects)\n`);
    }
  });
}
