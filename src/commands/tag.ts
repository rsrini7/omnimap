/**
 * omm tag <element>                   — list tags
 * omm tag <element> add <t1,t2,...>    — add tags
 * omm tag <element> remove <tag>      — remove a tag
 * omm tag <element> set <t1,t2,...>   — replace all tags
 */

import {
  ensureOmmForRead,
  readMeta,
  writeMeta,
  classExists,
  readNodeMeta,
  writeNodeMeta,
} from '../lib/store.js';

function parsePath(targetPath: string): { perspective: string; nodePath: string[] } {
  const parts = targetPath.split('/');
  return { perspective: parts[0], nodePath: parts.slice(1) };
}

function getMeta(perspective: string, nodePath: string[]) {
  return nodePath.length === 0
    ? readMeta(perspective)
    : readNodeMeta(perspective, nodePath);
}

function saveMeta(perspective: string, nodePath: string[], meta: any) {
  if (nodePath.length === 0) {
    writeMeta(perspective, meta);
  } else {
    writeNodeMeta(perspective, nodePath, meta);
  }
}

const HELP = `
omm tag <element> [action] [tags]

Manage tags on elements. Tags are used for categorization and filtering in the viewer.

Usage:
  omm tag <element>                      List current tags
  omm tag <element> add <t1,t2,...>       Add tags (comma-separated)
  omm tag <element> remove <tag>         Remove a tag
  omm tag <element> set <t1,t2,...>      Replace all tags
  omm tag <element> clear                Remove all tags
  omm tag --help | -h                    Show this help

Tags are stored in meta.yaml and can be filtered with 'tag:<name>' in viewer search.

Examples:
  omm tag auth                            # list tags
  omm tag auth add core,api,auth          # add multiple
  omm tag auth remove legacy              # remove one
  omm tag auth set core,api               # replace all
  omm tag auth clear                      # remove all tags
`;

export function commandTag(args: string[]): void {
  if (!ensureOmmForRead()) return;

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    process.stdout.write(HELP.trim() + '\n');
    return;
  }

  const targetPath = args[0];
  if (!targetPath) {
    process.stdout.write(HELP.trim() + '\n');
    return;
  }

  const { perspective, nodePath } = parsePath(targetPath);

  if (!classExists(perspective)) {
    process.stderr.write(`error: perspective '${perspective}' not found\n`);
    process.exit(1);
    return;
  }

  const meta = getMeta(perspective, nodePath);
  if (!meta) {
    process.stderr.write(`error: element '${targetPath}' not found\n`);
    process.exit(1);
    return;
  }

  const action = args[1];
  const tags: string[] = meta.tags ?? [];

  if (!action) {
    // List tags
    if (tags.length === 0) {
      process.stdout.write(`${targetPath}: no tags\n`);
    } else {
      process.stdout.write(`${targetPath}: ${tags.join(', ')}\n`);
    }
    return;
  }

  if (action === 'add') {
    const newTags = args[2]?.split(',').map(t => t.trim()).filter(Boolean) ?? [];
    if (!newTags.length) {
      process.stderr.write('error: omm tag <element> add <tag1,tag2,...>\n');
      process.exit(1);
    }
    const merged = [...new Set([...tags, ...newTags])];
    meta.tags = merged;
    meta.updated = new Date().toISOString();
    saveMeta(perspective, nodePath, meta);
    process.stderr.write(`tags: ${merged.join(', ')}\n`);
    return;
  }

  if (action === 'remove') {
    const removeTag = args[2]?.trim();
    if (!removeTag) {
      process.stderr.write('error: omm tag <element> remove <tag>\n');
      process.exit(1);
    }
    meta.tags = tags.filter(t => t !== removeTag);
    meta.updated = new Date().toISOString();
    saveMeta(perspective, nodePath, meta);
    process.stderr.write(`tags: ${(meta.tags ?? []).join(', ') || '(none)'}\n`);
    return;
  }

  if (action === 'set') {
    const newTags = args[2]?.split(',').map(t => t.trim()).filter(Boolean) ?? [];
    meta.tags = newTags;
    meta.updated = new Date().toISOString();
    saveMeta(perspective, nodePath, meta);
    process.stderr.write(`tags: ${newTags.join(', ') || '(none)'}\n`);
    return;
  }

  if (action === 'clear') {
    meta.tags = [];
    meta.updated = new Date().toISOString();
    saveMeta(perspective, nodePath, meta);
    process.stderr.write(`tags: (none)\n`);
    return;
  }

  process.stderr.write(`error: unknown action '${action}'. Use add, remove, set, or clear.\n`);
  process.exit(1);
}
