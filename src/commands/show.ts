import YAML from 'yaml';
import path from 'node:path';
import fs from 'node:fs';
import { ensureOmmForRead, isArchRepo, listProjects, getOmmDir } from '../lib/store.js';
import type { ClassData } from '../types.js';

/**
 * Show class data directly from a specific .omm directory path.
 * Bypasses getOmmDir() resolution.
 */
function showClassFromDir(className: string, ommDir: string): ClassData | null {
  const dir = path.join(ommDir, className);
  if (!fs.existsSync(dir)) return null;
  const metaPath = path.join(dir, 'meta.yaml');
  const meta = fs.existsSync(metaPath) ? YAML.parse(fs.readFileSync(metaPath, 'utf-8')) : undefined;
  const fields = ['description', 'diagram', 'constraint', 'concern', 'context', 'todo', 'note'] as const;
  const data: Record<string, unknown> = { name: className, meta };
  for (const f of fields) {
    const fp = path.join(dir, `${f === 'diagram' ? 'diagram.mmd' : f + '.md'}`);
    if (fs.existsSync(fp)) data[f] = fs.readFileSync(fp, 'utf-8');
  }
  return data as unknown as ClassData;
}

export async function commandShow(className: string, args: string[]): Promise<void> {
  if (!ensureOmmForRead()) return;

  const projectFlag = args.indexOf('--project');
  const project = projectFlag >= 0 ? args[projectFlag + 1] : undefined;
  const ommDir = getOmmDir();

  // --type: show element type classification
  if (args.includes('--type')) {
    const store = await import('../lib/store.js');
    const data = store.showClass(className);
    if (!data) {
      process.stderr.write(`error: element '${className}' not found\n`);
      process.exit(1);
    }
    printType(data);
    return;
  }

  if (isArchRepo()) {
    let projectName = project;
    if (!projectName) {
      const projects = listProjects();
      if (projects.length === 1) {
        projectName = projects[0];
      } else if (projects.length > 1) {
        process.stderr.write('error: multiple projects found. Use --project <name>.\n');
        process.stderr.write(`  Available: ${projects.join(', ')}\n`);
        process.exit(1);
      } else {
        process.stderr.write('error: no projects found.\n');
        process.exit(1);
      }
    }
    const projectOmmDir = path.join(ommDir, projectName);
    const data = showClassFromDir(className, projectOmmDir);
    if (!data) {
      process.stderr.write(`error: element '${className}' not found in project '${projectName}'\n`);
      process.exit(1);
    }
    printClassData(data);
    return;
  }

  // Regular project
  const store = await import('../lib/store.js');
  const data = store.showClass(className);
  if (!data) {
    process.stderr.write(`error: element '${className}' not found\n`);
    process.exit(1);
  }
  printClassData(data);
}

function printType(data: any): void {
  const isPerspective = !data.name?.includes('/');
  const hasDiagram = !!data.diagram && data.diagram.trim().length > 0;
  const childNames = data.meta?.children ?? [];

  let type: string;
  let why: string;
  if (isPerspective) {
    type = 'perspective';
    why = 'top-level element (no "/" in path)';
  } else if (hasDiagram) {
    type = 'group';
    why = 'nested element with a diagram';
  } else {
    type = 'leaf';
    why = 'nested element without a diagram';
  }

  process.stdout.write(`${data.name}\n`);
  process.stdout.write(`  type:  ${type}\n`);
  process.stdout.write(`  why:   ${why}\n`);
  if (hasDiagram) {
    const lines = data.diagram.split('\n').filter((l: string) => l.trim()).length;
    process.stdout.write(`  diagram: ${lines} lines\n`);
  }
  if (childNames.length > 0) {
    process.stdout.write(`  children: ${childNames.length} (${childNames.join(', ')})\n`);
  }
  process.stdout.write(`  score: ${data.meta?.update_count ?? 0} updates\n`);
  printLeafDiagramTip(type);
}

export function printLeafDiagramTip(type: string): void {
  process.stdout.write(`\nTip: For best eval scores, every element benefits from a diagram.\n`);
  process.stdout.write(`     Even leaves get +20 pts for adding a small "input → this → output" diagram.\n`);
  if (type === 'leaf') {
    process.stdout.write(`     This is a leaf — consider adding a tiny 2-3 node diagram to score higher.\n`);
  }
}

function printClassData(data: any): void {
  const fields = ['description', 'diagram', 'constraint', 'concern', 'context', 'todo', 'note'] as const;
  for (const field of fields) {
    if (data[field]) {
      process.stdout.write(`--- field: ${field} ---\n${data[field]}\n`);
    }
  }
  if (data.meta) {
    process.stdout.write(`--- field: meta ---\n${YAML.stringify(data.meta)}`);
  }

  // Show type + leaf-diagram tip
  const isPerspective = !data.name?.includes('/');
  const hasDiagram = !!data.diagram && data.diagram.trim().length > 0;
  let type: string;
  if (isPerspective) type = 'perspective';
  else if (hasDiagram) type = 'group';
  else type = 'leaf';
  process.stdout.write(`\ntype: ${type}\n`);
  printLeafDiagramTip(type);
}
