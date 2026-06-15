import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import YAML from 'yaml';
import type { Field, ClassMeta } from '../types.js';

const META_FILE = 'meta.yaml';

function getGitInfo(cwd: string): { commit?: string; branch?: string } {
  try {
    const commit = execSync('git rev-parse --short HEAD', { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
      .toString().trim();
    const branch = execSync('git branch --show-current', { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
      .toString().trim();
    return { commit: commit || undefined, branch: branch || undefined };
  } catch {
    return {};
  }
}

export function updateMeta(className: string, field: Field, cwd: string = process.cwd()): void {
  const ommDir = path.join(cwd, '.omm');
  const metaPath = path.join(ommDir, className, META_FILE);

  let meta: ClassMeta;
  if (fs.existsSync(metaPath)) {
    meta = YAML.parse(fs.readFileSync(metaPath, 'utf-8')) as ClassMeta;
    meta.updated = new Date().toISOString();
    meta.update_count = (meta.update_count || 0) + 1;
    meta.last_field = field;
  } else {
    const now = new Date().toISOString();
    meta = {
      created: now,
      updated: now,
      update_count: 1,
      last_field: field,
    };
  }

  const git = getGitInfo(cwd);
  if (git.commit) meta.git_commit = git.commit;
  if (git.branch) meta.git_branch = git.branch;

  // Record change in log (keep last 50 entries)
  if (!meta.change_log) meta.change_log = [];
  meta.change_log.push({ field, at: new Date().toISOString(), commit: git.commit });
  if (meta.change_log.length > 50) meta.change_log = meta.change_log.slice(-50);

  fs.writeFileSync(metaPath, YAML.stringify(meta), 'utf-8');
}
