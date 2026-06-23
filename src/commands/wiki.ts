import path from 'node:path';
import fs from 'node:fs';
import { listClasses, listNodes, readField, readNodeField, getOmmDir } from '../lib/store.js';
import { generateWiki } from '../lib/analyzer/insights.js';

const HELP = `
omm wiki [options]

Generate a crawlable markdown wiki from .omm/ documentation.

Usage:
  omm wiki                      Generate wiki in .omm/.wiki/
  omm wiki --out <dir>          Output to custom directory
  omm wiki --stdout             Print to stdout (single file)

The wiki includes:
- Index page with links to all elements
- Per-element pages with description, diagram, context, children
- [[wikilinks]] between related elements
`;

export function commandWiki(args: string[]): void {
  const ommDir = getOmmDir();
  if (!ommDir) {
    process.stderr.write('error: .omm/ not found. Run `omm init` first.\n');
    process.exit(1);
  }

  let outDir = path.join(ommDir, '.wiki');
  let stdout = false;
  let help = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out' && args[i + 1]) outDir = args[++i];
    else if (args[i] === '--stdout') stdout = true;
    else if (args[i] === '--help' || args[i] === '-h') help = true;
  }

  if (help) {
    process.stdout.write(HELP.trim() + '\n');
    return;
  }

  const perspectives = listClasses();
  const elements: { path: string; description?: string; diagram?: string; context?: string; children?: string[] }[] = [];

  function collectAllElements(perspective: string, nodePath: string[] = []): void {
    const children = listNodes(perspective, nodePath);
    for (const child of children) {
      const currentPath = [...nodePath, child];
      const childDesc = readNodeField(perspective, currentPath, 'description') || undefined;
      const childDiagram = readNodeField(perspective, currentPath, 'diagram') || undefined;
      const childContext = readNodeField(perspective, currentPath, 'context') || undefined;
      const grandChildren = listNodes(perspective, currentPath);
      elements.push({
        path: [perspective, ...currentPath].join('/'),
        description: childDesc,
        diagram: childDiagram,
        context: childContext,
        children: grandChildren.length > 0 ? grandChildren : undefined,
      });
      collectAllElements(perspective, currentPath);
    }
  }

  for (const persp of perspectives) {
    const desc = readField(persp, 'description') || undefined;
    const diagram = readField(persp, 'diagram') || undefined;
    const context = readField(persp, 'context') || undefined;
    const children = listNodes(persp, []);
    elements.push({ path: persp, description: desc, diagram, context, children: children.length > 0 ? children : undefined });
    collectAllElements(persp, []);
  }

  const wiki = generateWiki(elements);

  if (stdout) {
    process.stdout.write(wiki + '\n');
    return;
  }

  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  // Split into individual files
  const sections = wiki.split('\n\n---\n\n');
  for (const section of sections) {
    const nameMatch = section.match(/name:\s*(.+)/);
    if (!nameMatch) continue;
    const name = nameMatch[1].trim();
    const fileName = name === 'index' ? 'index.md' : name.replace(/\//g, '_') + '.md';
    fs.writeFileSync(path.join(outDir, fileName), section, 'utf-8');
  }

  process.stdout.write(`Wiki generated in ${outDir}/ (${sections.length} pages)\n`);
}
