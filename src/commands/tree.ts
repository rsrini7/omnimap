/**
 * omm tree <path> — show element hierarchy as indented tree.
 *
 * Supports two modes:
 *   - Default: Unicode box-drawing tree (docs-rooted)
 *   - --yaml:  YAML output for configs, CI reports, treedocs-style docs
 */

import YAML from 'yaml';
import { ensureOmmForRead, listNodes, listClasses, showNode } from '../lib/store.js';

function printTree(perspective: string, nodePath: string[], prefix: string, isLast: boolean, isRoot: boolean, cwd?: string): void {
  const name = nodePath.length === 0 ? perspective : nodePath[nodePath.length - 1];

  if (isRoot) {
    process.stdout.write(name + '\n');
  } else {
    process.stdout.write(prefix + (isLast ? '└── ' : '├── ') + name + '\n');
  }

  const children = listNodes(perspective, nodePath, cwd);
  const childPrefix = isRoot ? '' : prefix + (isLast ? '    ' : '│   ');

  for (let i = 0; i < children.length; i++) {
    const childPath = [...nodePath, children[i]];
    printTree(perspective, childPath, childPrefix, i === children.length - 1, false, cwd);
  }
}

interface TreeNode {
  [key: string]: string | boolean | TreeNode;
}

/**
 * Build a nested YAML-friendly object for an element and its children.
 * Only includes user-authored fields: description (truncated), diagram (boolean), children.
 * Excludes internal files (meta.yaml, flows.yaml, etc.) automatically since
 * listNodes() only returns element directories.
 */
function buildTreeNode(perspective: string, nodePath: string[], cwd?: string): TreeNode {
  const data = showNode(perspective, nodePath, cwd);
  const children = listNodes(perspective, nodePath, cwd);

  const node: TreeNode = {};

  if (data?.description) {
    const desc = data.description.replace(/\n/g, ' ').trim();
    node.description = desc.length > 60 ? desc.slice(0, 57) + '...' : desc;
  }

  node.diagram = !!(data?.diagram?.trim());

  if (children.length > 0) {
    const childrenObj: TreeNode = {};
    for (const child of children) {
      childrenObj[child] = buildTreeNode(perspective, [...nodePath, child], cwd);
    }
    node.children = childrenObj;
  }

  return node;
}

/**
 * Print the .omm/ tree as YAML.
 *
 * @param targetPath - Optional perspective or subtree path to render
 * @param compact - If true, use YAML Flow Style (inline JSON-like objects)
 * @param cwd - Working directory override (for testing)
 */
function printYamlTree(targetPath?: string, compact?: boolean, cwd?: string): void {
  const perspectives = targetPath
    ? [targetPath.split('/')[0]]
    : listClasses(cwd);

  if (perspectives.length === 0) {
    process.stderr.write('No perspectives found. Run /omm-scan to generate.\n');
    return;
  }

  const root: TreeNode = {};
  for (const persp of perspectives) {
    root[persp] = buildTreeNode(persp, [], cwd);
  }

  const yaml = compact
    ? JSON.stringify(root, null, 0)
    : YAML.stringify(root, { indent: 2 });

  const date = new Date().toISOString().slice(0, 10);
  process.stdout.write(`# omm tree — ${date}\n${yaml}`);
}

/**
 * omm tree [path] [--yaml] [--compact]
 *
 * @param targetPath - Optional element path to show subtree
 * @param args - CLI arguments (may include --yaml, --compact)
 * @param cwd - Working directory override (for testing)
 */
export function commandTree(targetPath?: string, args?: string[], cwd?: string): void {
  if (!ensureOmmForRead(cwd)) return;

  const flags = args ?? [];
  const useYaml = flags.includes('--yaml');
  const compact = flags.includes('--compact');

  if (useYaml) {
    printYamlTree(targetPath, compact, cwd);
    return;
  }

  // Default: Unicode box-drawing tree
  if (!targetPath) {
    const perspectives = listClasses(cwd);
    if (perspectives.length === 0) {
      process.stderr.write('No perspectives found. Run /omm-scan to generate.\n');
      return;
    }
    for (const persp of perspectives) {
      printTree(persp, [], '', true, true, cwd);
      process.stdout.write('\n');
    }
    return;
  }

  const parts = targetPath.split('/');
  const perspective = parts[0];
  const nodePath = parts.slice(1);
  printTree(perspective, nodePath, '', true, true, cwd);
}
