import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { ensureOmmForRead, showClass, showNode, getOmmDir, readFlows, listNodes, readNodeMeta } from '../lib/store.js';
import { generateHtmlExport } from '../lib/html-export.js';
import { detectDiagramFormat, renderPlantUML } from '../lib/format.js';
import type { ClassData, DiagramFormat } from '../types.js';

const HELP = `
omm export <element> [options]

Export a perspective or nested element's diagram as SVG, PNG, or HTML.

Usage:
  omm export <element>                   Export as SVG to stdout
  omm export <element> --format svg      Export as SVG to stdout
  omm export <element> --format png      Export as PNG to stdout (binary)
  omm export <element> --format html     Export as self-contained HTML
  omm export <element> -o <file>         Write to file (format inferred from extension)

Options:
  --format <svg|png|html>  Output format (default: svg)
  -o, --output <file>      Write to file instead of stdout
  -h, --help               Show this help

Examples:
  omm export auth-service                            # SVG to stdout
  omm export auth-service -o auth.svg                # SVG to file
  omm export auth-service --format png -o auth.png   # PNG to file
  omm export auth-service --format html -o auth.html # Self-contained HTML
`;

type ExportFormat = 'svg' | 'png' | 'html';

interface ParsedArgs {
  element: string;
  format: ExportFormat;
  output?: string;
}

function parseArgs(args: string[]): ParsedArgs {
  const out: ParsedArgs = { element: '', format: 'svg' };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--format' && args[i + 1]) {
      const f = args[++i].toLowerCase();
      if (f !== 'svg' && f !== 'png' && f !== 'html') {
        process.stderr.write(`error: unsupported format '${f}'. Use svg, png, or html.\n`);
        process.exit(1);
      }
      out.format = f;
    } else if ((a === '-o' || a === '--output') && args[i + 1]) {
      out.output = args[++i];
    } else if (a === '--help' || a === '-h') {
      process.stdout.write(HELP);
      process.exit(0);
    } else if (!a.startsWith('-')) {
      out.element = a;
    } else {
      process.stderr.write(`error: unknown arg '${a}'\n`);
      process.exit(1);
    }
  }
  // Infer format from output extension
  if (out.output) {
    const ext = path.extname(out.output).toLowerCase();
    if (ext === '.png') out.format = 'png';
    else if (ext === '.svg') out.format = 'svg';
    else if (ext === '.html') out.format = 'html';
  }
  return out;
}

function resolveElement(element: string, cwd: string): ClassData | null {
  const parts = element.split('/');
  if (parts.length === 1) {
    return showClass(element, cwd);
  }
  const perspective = parts[0];
  const nodePath = parts.slice(1);
  return showNode(perspective, nodePath, cwd);
}

/**
 * Render mermaid text to SVG using mermaid.ink service.
 * Falls back to a simple text-wrapped SVG if the service is unreachable.
 */
/**
 * Add a "projectName — elementName" title bar above an SVG.
 * Inserts 44px of header space, shifts existing content down.
 */
function addTitleToSvg(svg: string, title: string): string {
  // Parse viewBox
  const vbMatch = svg.match(/viewBox="([^"]+)"/);
  let vx = 0, vy = 0, vw = 800, vh = 600;
  if (vbMatch) {
    const p = vbMatch[1].split(/\s+/);
    if (p.length === 4) { vx = +p[0]; vy = +p[1]; vw = +p[2]; vh = +p[3]; }
  }

  const escXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const headerH = 44;
  const newVb = `${vx} ${vy} ${vw} ${vh + headerH}`;

  const titleBlock = `
    <rect x="${vx}" y="${vy}" width="${vw}" height="${headerH}" fill="#111"/>
    <text x="${vx + 16}" y="${vy + 28}" font-family="Inter,system-ui,sans-serif" font-size="16" font-weight="600" fill="#ccc">${escXml(title)}</text>
    <line x1="${vx}" y1="${vy + headerH}" x2="${vx + vw}" y2="${vy + headerH}" stroke="#333" stroke-width="1"/>
  `;

  // Replace viewBox, wrap inner content
  let out = svg.replace(/viewBox="[^"]*"/, `viewBox="${newVb}"`);
  const svgOpenEnd = out.indexOf('>') + 1;
  // Insert </g> BEFORE </svg>, not after
  const svgClose = out.lastIndexOf('</svg>');
  if (svgClose >= 0) {
    out = out.slice(0, svgOpenEnd) + titleBlock + `<g transform="translate(0,${headerH})">`
      + out.slice(svgOpenEnd, svgClose) + '</g>' + out.slice(svgClose);
  } else {
    out = out.slice(0, svgOpenEnd) + titleBlock + `<g transform="translate(0,${headerH})">` + out.slice(svgOpenEnd) + '</g>';
  }
  return out;
}

async function renderToSvg(mermaidText: string, title?: string): Promise<string> {
  const encoded = Buffer.from(mermaidText).toString('base64url');
  const url = `https://mermaid.ink/svg/${encoded}`;

  try {
    const res = await fetch(url, {
      headers: { 'Accept': 'image/svg+xml' },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) {
      const svg = await res.text();
      if (svg.includes('<svg')) return title ? addTitleToSvg(svg, title) : svg;
    }
  } catch {
    // fall through to local fallback
  }

  // Fallback: render a minimal SVG with the raw mermaid text
  const fallback = fallbackSvg(mermaidText);
  return title ? addTitleToSvg(fallback, title) : fallback;
}

/**
 * Render mermaid text to PNG using mermaid.ink service.
 */
async function renderToPng(mermaidText: string, title?: string): Promise<Buffer> {
  const encoded = Buffer.from(mermaidText).toString('base64url');
  const url = `https://mermaid.ink/img/${encoded}`;

  try {
    const res = await fetch(url, {
      headers: { 'Accept': 'image/png' },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 100) return buf;
    }
  } catch {
    // fall through
  }

  // Fallback: render the SVG fallback and convert to PNG buffer
  // (Users without network get SVG only)
  process.stderr.write('warning: mermaid.ink unreachable. Falling back to SVG.\n');
  const svg = fallbackSvg(mermaidText);
  return Buffer.from(title ? addTitleToSvg(svg, title) : svg, 'utf-8');
}

/** Render PlantUML to SVG via Kroki or local jar */
async function renderPlantUMLToSvg(plantumlText: string, title?: string): Promise<string> {
  try {
    const svg = await renderPlantUML(plantumlText);
    if (svg.includes('<svg')) return title ? addTitleToSvg(svg, title) : svg;
  } catch (err) {
    process.stderr.write(`warning: PlantUML render failed: ${err}\n`);
  }
  
  // Fallback to raw text SVG
  const fallback = fallbackSvg(plantumlText);
  return title ? addTitleToSvg(fallback, title) : fallback;
}

/** Render PlantUML to PNG via Kroki or local jar */
async function renderPlantUMLToPng(plantumlText: string, title?: string): Promise<Buffer> {
  try {
    // Try local jar first for PNG (better quality)
    const plantumlJar = getPlantumlJarPath();
    if (plantumlJar) {
      const { execSync } = await import('node:child_process');
      const os = await import('node:os');
      const tmpDir = os.tmpdir();
      const tmpFile = path.join(tmpDir, `plantuml-${Date.now()}.puml`);
      const tmpPng = tmpFile.replace('.puml', '.png');
      
      try {
        fs.writeFileSync(tmpFile, plantumlText, 'utf-8');
        execSync(`java -jar "${plantumlJar}" -tpng -o "${tmpDir}" "${tmpFile}"`, {
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        const buf = fs.readFileSync(tmpPng);
        if (buf.length > 100) return buf;
      } finally {
        try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
        try { fs.unlinkSync(tmpPng); } catch { /* ignore */ }
      }
    }
    
    // Fallback: render SVG and convert
    const svg = await renderPlantUMLToSvg(plantumlText, title);
    return Buffer.from(svg, 'utf-8');
  } catch (err) {
    process.stderr.write(`warning: PlantUML PNG render failed: ${err}\n`);
    const svg = fallbackSvg(plantumlText);
    return Buffer.from(title ? addTitleToSvg(svg, title) : svg, 'utf-8');
  }
}

/** Get configured plantuml.jar path from config */
function getPlantumlJarPath(): string | null {
  try {
    const ommDir = getOmmDir();
    const configPath = path.join(ommDir, 'config.yaml');
    if (!fs.existsSync(configPath)) return null;
    const config = YAML.parse(fs.readFileSync(configPath, 'utf-8'));
    return config?.plantuml_jar || null;
  } catch {
    return null;
  }
}

/** Minimal SVG with the raw text, for offline use. */
function fallbackSvg(text: string): string {
  const lines = text.split('\n');
  const width = 600;
  const lineHeight = 18;
  const height = Math.max(100, lines.length * lineHeight + 60);

  const textLines = lines.map((line, i) => {
    const escaped = line
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
    return `<text x="20" y="${40 + i * lineHeight}" font-family="monospace" font-size="12" fill="#ccc">${escaped}</text>`;
  }).join('\n  ');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#1a1a1a" rx="8"/>
  <text x="20" y="22" font-family="Inter,system-ui" font-size="11" fill="#666">mermaid (rendered offline — raw source shown)</text>
  ${textLines}
</svg>`;
}

export async function commandExport(args: string[]): Promise<void> {
  if (!ensureOmmForRead()) return;
  const parsed = parseArgs(args);

  if (!parsed.element) {
    process.stderr.write('error: omm export <element> [--format svg|png] [-o file]\n');
    process.exit(1);
  }

  const cwd = process.cwd();
  const data = resolveElement(parsed.element, cwd);
  if (!data) {
    process.stderr.write(`error: element '${parsed.element}' not found\n`);
    process.exit(1);
  }

  if (!data.diagram) {
    process.stderr.write(`error: ${parsed.element}/diagram file is empty\n`);
    process.exit(1);
  }

  // Detect diagram format
  const parts = parsed.element.split('/');
  const ommDir = getOmmDir(cwd);
  const elemDir = parts.length === 1
    ? path.join(ommDir, parsed.element)
    : path.join(ommDir, parts[0], ...parts.slice(1));
  const { format: diagramFormat } = fs.existsSync(elemDir) ? detectDiagramFormat(elemDir) : { format: 'mermaid' as const };

  process.stderr.write(`Exporting ${parsed.element} as ${parsed.format} (${diagramFormat})...\n`);

  // Build title: projectName — elementShortName
  const projectName = path.basename(cwd);
  const shortName = parsed.element.includes('/') ? parsed.element.split('/').pop()! : parsed.element;
  const title = `${projectName} — ${shortName}`;

  if (parsed.format === 'html') {
    const flows = readFlows(parsed.element);
    const children: Record<string, ClassData> = {};
    const elemParts = parsed.element.split('/');
    const perspective = elemParts[0];
    const nodePath = elemParts.slice(1);
    const childNames = listNodes(perspective, nodePath);
    for (const child of childNames) {
      const childPath = parsed.element + '/' + child;
      const childData = showClass(childPath);
      if (childData) children[child] = childData;
    }
    const html = generateHtmlExport({
      element: parsed.element,
      title,
      data,
      flows,
      children,
    });
    if (parsed.output) {
      fs.mkdirSync(path.dirname(path.resolve(parsed.output)), { recursive: true });
      fs.writeFileSync(parsed.output, html, 'utf-8');
      process.stderr.write(`Wrote ${html.length} bytes → ${parsed.output}\n`);
    } else {
      process.stdout.write(html + '\n');
    }
    return;
  }

  if (parsed.format === 'svg') {
    const svg = diagramFormat === 'plantuml'
      ? await renderPlantUMLToSvg(data.diagram!, title)
      : await renderToSvg(data.diagram!, title);
    if (parsed.output) {
      fs.mkdirSync(path.dirname(path.resolve(parsed.output)), { recursive: true });
      fs.writeFileSync(parsed.output, svg, 'utf-8');
      process.stderr.write(`Wrote ${svg.length} bytes → ${parsed.output}\n`);
    } else {
      process.stdout.write(svg + '\n');
    }
  } else {
    const png = diagramFormat === 'plantuml'
      ? await renderPlantUMLToPng(data.diagram!, title)
      : await renderToPng(data.diagram!, title);
    if (parsed.output) {
      fs.mkdirSync(path.dirname(path.resolve(parsed.output)), { recursive: true });
      fs.writeFileSync(parsed.output, png);
      process.stderr.write(`Wrote ${png.length} bytes → ${parsed.output}\n`);
    } else {
      process.stdout.write(png);
    }
  }
}
