import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import YAML from 'yaml';
import type { ClassMeta } from '../types.js';
import type { FingerprintDelta } from './analyzer/types.js';
import { getOmmDir } from './store.js';

const META_FILE = 'meta.yaml';

export type ChangedStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked';

export interface ChangedFile {
  /** Path relative to the repo root, with forward slashes. */
  path: string;
  status: ChangedStatus;
}

export interface ElementInfo {
  /** Element path relative to .omm/. Top-level: "persp". Nested: "persp/child/leaf". */
  elementPath: string;
  meta: ClassMeta;
  /** Absolute filesystem path to the element's directory. */
  elementDir: string;
}

export type StaleReason = 'source_file' | 'source_glob' | 'no_source_tracking' | 'source_file_mtime' | 'uncommitted' | 'orphaned_source' | 'glob_coverage_changed';

export interface StaleElement {
  elementPath: string;
  matchedFiles: string[];
  reasons: StaleReason[];
}

export interface IncrementalPlan {
  /** Git ref used as the baseline (HEAD if none provided). */
  since?: string;
  /** HEAD commit at the time the plan was generated. */
  currentCommit?: string;
  /** True when cwd is not a git repo. */
  noGit: boolean;
  changedFiles: ChangedFile[];
  stale: StaleElement[];
  fresh: string[];
  /** Elements with no source_files / source_globs — caller decides what to do. */
  unknown: string[];
}

export interface MarkOptions {
  replaceFiles?: boolean;
  replaceGlobs?: boolean;
}

// ---------- Git helpers ----------

/**
 * Run a git command and return stdout. Strips trailing newlines (but not leading
 * whitespace — porcelain output starts with a space for unstaged changes and we
 * must preserve it).
 */
function run(cmd: string, cwd: string): string {
  try {
    return execSync(cmd, { cwd, stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8' }).replace(/[\r\n]+$/, '');
  } catch {
    return '';
  }
}

function isGitRepo(cwd: string): boolean {
  return run('git rev-parse --is-inside-work-tree', cwd) === 'true';
}

function headCommit(cwd: string): string | undefined {
  const v = run('git rev-parse --short HEAD', cwd);
  return v || undefined;
}

function commitExists(cwd: string, ref: string): boolean {
  try {
    execSync(`git cat-file -t ${ref}`, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

/**
 * Return files that changed since `sinceRef` (committed), plus any uncommitted
 * changes (staged, unstaged, untracked). Paths are relative to the repo root.
 *
 * When `sinceRef` is provided the result is a **union**: committed changes
 * between `sinceRef` and HEAD, plus any uncommitted working-tree changes.
 * Callers should treat the return value as the full set of files that may
 * need re-analysis, not just the committed diff.
 *
 * When `sinceRef` is omitted (or the repo has no commits yet), only
 * working-tree changes are returned.
 */
export function getChangedFiles(cwd: string, sinceRef?: string): ChangedFile[] {
  if (!isGitRepo(cwd)) return [];

  const files: ChangedFile[] = [];
  const seen = new Set<string>();

  const add = (raw: string, status: ChangedStatus): void => {
    if (!raw) return;
    const p = raw.replace(/\\/g, '/').replace(/^\.\//, '');
    if (seen.has(p)) return;
    seen.add(p);
    files.push({ path: p, status });
  };

  // Committed changes since the recorded commit.
  if (sinceRef && commitExists(cwd, sinceRef)) {
    const out = run(`git diff --name-status ${sinceRef}..HEAD`, cwd);
    for (const line of out.split('\n')) {
      if (!line) continue;
      const parts = line.split('\t');
      if (parts.length < 2) continue;
      const code = parts[0];
      if (code.startsWith('R')) {
        if (parts[2]) add(parts[2], 'renamed');
      } else if (code === 'A') {
        add(parts[1], 'added');
      } else if (code === 'D') {
        add(parts[1], 'deleted');
      } else if (code === 'M') {
        add(parts[1], 'modified');
      } else {
        add(parts[1], 'modified');
      }
    }
  }

  // Working-tree changes — porcelain v1, format: "XY<space>path" (rename: "R<space>old -> new").
  // `--untracked-files=all` forces individual file paths instead of directory names
  // (the default `normal` collapses directories that contain only untracked files).
  const porcelain = run('git status --porcelain --untracked-files=all --ignored=no', cwd);
  for (const line of porcelain.split('\n')) {
    if (!line) continue;
    // Match: 2-char XY, single space, then the rest. Robust to leading-space edge cases
    // (e.g. callers that trim the output) since we anchor on the only guaranteed space
    // between status and path.
    const m = line.match(/^(.{2}) (.+)$/);
    if (!m) continue;
    const xy = m[1];
    let rawPath = m[2];
    if (xy.includes('R') && rawPath.includes('->')) {
      rawPath = rawPath.split('->').pop()!.trim();
    }
    let status: ChangedStatus;
    if (xy === '??') status = 'untracked';
    else if (xy[1] === 'M' || xy[0] === 'M') status = 'modified';
    else if (xy[1] === 'A' || xy[0] === 'A') status = 'added';
    else if (xy[1] === 'D' || xy[0] === 'D') status = 'deleted';
    else status = 'modified';
    add(rawPath, status);
  }

  return files;
}

// ---------- Glob matching ----------

/**
 * Convert a glob to a RegExp. Supports `*` (non-slash), `**` (any),
 * `?` (single char), `{a,b}` alternation, and `[abc]` char classes.
 */
export function globToRegex(glob: string): RegExp {
  let re = '';
  let i = 0;
  const n = glob.length;
  while (i < n) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i += 2;
        if (glob[i] === '/') i++;
      } else {
        re += '[^/]*';
        i++;
      }
    } else if (c === '?') {
      re += '[^/]';
      i++;
    } else if (c === '{') {
      const end = glob.indexOf('}', i);
      if (end < 0) {
        re += '\\{';
        i++;
      } else {
        const alts = glob.slice(i + 1, end).split(',').map(s => s.replace(/[.+^$|\\()[\]]/g, '\\$&'));
        re += '(?:' + alts.join('|') + ')';
        i = end + 1;
      }
    } else if (c === '[') {
      const end = glob.indexOf(']', i);
      if (end < 0) {
        re += '\\[';
        i++;
      } else {
        re += glob.slice(i, end + 1);
        i = end + 1;
      }
    } else {
      re += c.replace(/[.+^$|\\()]/g, '\\$&');
      i++;
    }
  }
  return new RegExp('^' + re + '$');
}

function fileMatchesPath(changedPath: string, sourceFile: string): boolean {
  const a = changedPath.replace(/^\.\//, '').replace(/\/+$/, '');
  const b = sourceFile.replace(/^\.\//, '').replace(/\/+$/, '');
  return a === b;
}

function fileMatchesAnyGlob(changedPath: string, globs: string[]): boolean {
  for (const g of globs) {
    if (globToRegex(g).test(changedPath)) return true;
  }
  return false;
}

// ---------- Element index ----------

function readMetaFile(metaPath: string): ClassMeta | null {
  if (!fs.existsSync(metaPath)) return null;
  try {
    const parsed = YAML.parse(fs.readFileSync(metaPath, 'utf-8')) as ClassMeta | null;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    process.stderr.write(`  warning: could not parse ${metaPath} — skipping\n`);
    return null;
  }
}

function writeMetaFile(metaPath: string, meta: ClassMeta): void {
  fs.writeFileSync(metaPath, YAML.stringify(meta), 'utf-8');
}

/** Walk .omm/ and return every element with a meta.yaml. */
export function loadElementIndex(ommDir: string): ElementInfo[] {
  if (!fs.existsSync(ommDir)) return [];
  const out: ElementInfo[] = [];
  const walk = (dir: string, relPath: string): void => {
    if (!fs.existsSync(dir)) return;
    const metaPath = path.join(dir, META_FILE);
    if (fs.existsSync(metaPath)) {
      const meta = readMetaFile(metaPath);
      if (meta) out.push({ elementPath: relPath, meta, elementDir: dir });
    }
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        walk(path.join(dir, e.name), relPath ? `${relPath}/${e.name}` : e.name);
      }
    }
  };
  walk(ommDir, '');
  return out;
}

// ---------- Plan generation ----------

export interface PlanOptions {
  /** Git ref to diff against. Default: each element's own meta.scan_generation.git_commit, or HEAD. */
  since?: string;
  /** Fall back to mtime when no git baseline is available. */
  mtimeFallback?: boolean;
}

function fileMtimeMs(filePath: string): number {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

function resolveTrackedFiles(cwd: string, element: ElementInfo): string[] {
  const list: string[] = [];
  for (const f of element.meta.source_files ?? []) {
    list.push(path.isAbsolute(f) ? f : path.join(cwd, f));
  }
  return list;
}

/**
 * Compute the incremental update plan.
 * - stale: elements with matching changes (source file, source glob, mtime, or uncommitted w/ no tracking)
 * - fresh: elements with sources and no matching changes
 * - unknown: elements with no source tracking at all
 */
export function planIncrementalUpdate(ommDir: string, cwd: string = process.cwd(), opts: PlanOptions = {}): IncrementalPlan {
  const elements = loadElementIndex(ommDir);
  const noGit = !isGitRepo(cwd);
  const currentCommit = headCommit(cwd);
  const globalSince = opts.since;
  const useMtime = opts.mtimeFallback ?? true;

  // Per-element baseline: per-element meta, or global override, or HEAD.
  const changedByRef = new Map<string, ChangedFile[]>();
  for (const el of elements) {
    const ref = globalSince ?? el.meta.scan_generation?.git_commit;
    if (ref && !changedByRef.has(ref)) {
      changedByRef.set(ref, getChangedFiles(cwd, ref));
    }
  }
  // Working-tree changes apply to every element.
  const workingChanges = isGitRepo(cwd) ? getChangedFiles(cwd, undefined) : [];

  const staleMap = new Map<string, StaleElement>();
  const fresh: string[] = [];

  const ensureStale = (el: ElementInfo): StaleElement => {
    let s = staleMap.get(el.elementPath);
    if (!s) {
      s = { elementPath: el.elementPath, matchedFiles: [], reasons: [] };
      staleMap.set(el.elementPath, s);
    }
    return s;
  };

  for (const el of elements) {
    const meta = el.meta;
    const sourceFiles = meta.source_files ?? [];
    const sourceGlobs = meta.source_globs ?? [];
    const tracked = sourceFiles.length + sourceGlobs.length;

    const ref = globalSince ?? meta.scan_generation?.git_commit;
    const refChanges = (ref && changedByRef.get(ref)) || [];
    const allChanges = [...refChanges];
    for (const wc of workingChanges) {
      if (!allChanges.some(c => c.path === wc.path)) allChanges.push(wc);
    }

    if (tracked === 0) {
      // No source tracking. If anything changed at all, conservatively mark stale.
      if (allChanges.length > 0) {
        const s = ensureStale(el);
        s.reasons.push('no_source_tracking');
        for (const c of allChanges) s.matchedFiles.push(c.path);
      }
      continue;
    }

    // ── Check 1: Orphaned source_files ──────────────────────
    // If a tracked source_file no longer exists on disk, the element is stale.
    // This catches renames, deletions, and refactors that moved code elsewhere.
    const orphaned: string[] = [];
    for (const sf of sourceFiles) {
      const abs = path.isAbsolute(sf) ? sf : path.join(cwd, sf);
      if (!fs.existsSync(abs)) {
        orphaned.push(sf);
      }
    }
    if (orphaned.length > 0) {
      const s = ensureStale(el);
      s.matchedFiles.push(...orphaned);
      s.reasons.push('orphaned_source');
      // Don't continue — also check for other changes below
    }

    const matched: string[] = [];
    const reasons = new Set<StaleReason>();
    for (const change of allChanges) {
      if (sourceFiles.some(sf => fileMatchesPath(change.path, sf))) {
        matched.push(change.path);
        reasons.add('source_file');
      } else if (fileMatchesAnyGlob(change.path, sourceGlobs)) {
        matched.push(change.path);
        reasons.add('source_glob');
      }
    }
    for (const r of reasons) orphaned.push(...[]); // merge reasons

    if (matched.length > 0) {
      const s = ensureStale(el);
      s.matchedFiles.push(...matched.filter(f => !s.matchedFiles.includes(f)));
      for (const r of reasons) s.reasons.push(r);
      continue;
    }
    if (orphaned.length > 0) {
      // Already marked stale from orphan check above
      continue;
    }

    // ── Check 2: Glob coverage change ───────────────────────
    // If globs are tracked, check if the set of matching files has changed
    // since the last scan_generation. This catches new files added to a glob
    // (e.g., new module in src/lib/*.ts) that the element should know about.
    if (sourceGlobs.length > 0 && meta.scan_generation?.git_commit) {
      // Get files that changed near the element's source surface
      const globChanges = allChanges.filter(c => fileMatchesAnyGlob(c.path, sourceGlobs));
      // Any added or deleted files matching the glob indicate surface change
      const surfaceChanges = globChanges.filter(c => c.status === 'added' || c.status === 'deleted');
      if (surfaceChanges.length > 0) {
        const s = ensureStale(el);
        s.matchedFiles.push(...surfaceChanges.map(c => c.path));
        s.reasons.push('glob_coverage_changed');
        continue;
      }
    }

    // mtime fallback — only meaningful when we have no git baseline (noGit or no
    // scan_generation recorded). With git, workingChanges already covers any
    // modifications, and mtime would produce false positives (any file touched
    // after the element was last updated would look stale).
    if (useMtime && (noGit || !meta.scan_generation?.git_commit)) {
      const updatedMs = Date.parse(meta.updated) || 0;
      const trackedAbs = resolveTrackedFiles(cwd, el);
      const staleByMtime = trackedAbs.filter(f => fileMtimeMs(f) > updatedMs);
      if (staleByMtime.length > 0) {
        const s = ensureStale(el);
        s.matchedFiles.push(...staleByMtime.map(f => path.relative(cwd, f)));
        s.reasons.push('source_file_mtime');
        continue;
      }
    }

    fresh.push(el.elementPath);
  }

  // ── Propagate staleness: parent stale → children with no tracking ──
  // Children that have no source_files/globs inherit staleness from their
  // nearest ancestor that does. This catches nested elements whose parent
  // perspective is stale but the child has no independent tracking.
  const staleSet = new Set(staleMap.keys());
  for (const el of elements) {
    if (staleSet.has(el.elementPath)) continue;
    if (fresh.includes(el.elementPath)) continue;
    // Walk up the path to find a stale ancestor
    const parts = el.elementPath.split('/');
    for (let i = parts.length - 1; i > 0; i--) {
      const ancestor = parts.slice(0, i).join('/');
      if (staleSet.has(ancestor)) {
        const s = ensureStale(el);
        s.reasons.push('no_source_tracking');
        s.matchedFiles.push(`(inherited from ${ancestor})`);
        staleSet.add(el.elementPath);
        break;
      }
    }
  }

  // Unknown bucket: elements with no source tracking and no triggers.
  const unknown: string[] = [];
  for (const el of elements) {
    if (staleMap.has(el.elementPath)) continue;
    if (fresh.includes(el.elementPath)) continue;
    const meta = el.meta;
    if ((meta.source_files?.length ?? 0) + (meta.source_globs?.length ?? 0) === 0) {
      unknown.push(el.elementPath);
    }
  }
  if (noGit) {
    // Without git we can't diff; everything with tracking but no mtime trigger is unknown.
    for (const el of elements) {
      if (staleMap.has(el.elementPath) || fresh.includes(el.elementPath) || unknown.includes(el.elementPath)) continue;
      unknown.push(el.elementPath);
    }
  }

  return {
    since: globalSince,
    currentCommit,
    noGit,
    changedFiles: workingChanges,
    stale: [...staleMap.values()].sort((a, b) => a.elementPath.localeCompare(b.elementPath)),
    fresh: fresh.sort(),
    unknown: [...new Set(unknown)].sort(),
  };
}

// ---------- Mark sources ----------

/**
 * Update an element's meta.yaml with the given source files / globs.
 * Used by the scan agent to record what an element covers.
 */
export function markElementSources(
  elementPath: string,
  opts: MarkOptions & { files?: string[]; globs?: string[] },
  ommDir: string = getOmmDir(),
): void {
  if (!fs.existsSync(ommDir)) throw new Error(`.omm/ not found at ${ommDir}`);
  const elementDir = path.join(ommDir, elementPath);
  if (!fs.existsSync(elementDir)) throw new Error(`element '${elementPath}' not found`);
  const metaPath = path.join(elementDir, META_FILE);
  const meta = readMetaFile(metaPath) ?? {
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    update_count: 0,
    last_field: 'description' as const,
  };

  if (opts.files && opts.files.length) {
    const existing = meta.source_files ?? [];
    meta.source_files = opts.replaceFiles
      ? Array.from(new Set(opts.files))
      : Array.from(new Set([...existing, ...opts.files]));
  }
  if (opts.globs && opts.globs.length) {
    const existing = meta.source_globs ?? [];
    meta.source_globs = opts.replaceGlobs
      ? Array.from(new Set(opts.globs))
      : Array.from(new Set([...existing, ...opts.globs]));
  }

  meta.updated = new Date().toISOString();
  writeMetaFile(metaPath, meta);
}

/**
 * Update the scan_generation baseline for an element. Called after a successful
 * (re-)scan so the next incremental run knows what to diff against.
 */
export function recordScanGeneration(
  elementPath: string,
  mode: 'full' | 'incremental',
  ommDir: string = getOmmDir(),
): void {
  if (!fs.existsSync(ommDir)) throw new Error(`.omm/ not found at ${ommDir}`);
  const cwd = path.dirname(ommDir);
  const elementDir = path.join(ommDir, elementPath);
  if (!fs.existsSync(elementDir)) throw new Error(`element '${elementPath}' not found`);
  const metaPath = path.join(elementDir, META_FILE);
  const meta = readMetaFile(metaPath);
  if (!meta) throw new Error(`element '${elementPath}' has no meta.yaml`);
  const commit = headCommit(cwd);
  meta.scan_generation = { mode, git_commit: commit, at: new Date().toISOString() };
  meta.updated = new Date().toISOString();
  writeMetaFile(metaPath, meta);
}

// ---------- AST Fingerprint integration ----------

const FINGERPRINT_CACHE_FILE = '.fingerprint-cache.json';

/**
 * Get the path to the fingerprint cache file inside .omm/.
 */
export function getFingerprintCachePath(ommDir: string = getOmmDir()): string {
  return path.join(ommDir, FINGERPRINT_CACHE_FILE);
}

/**
 * Map fingerprint deltas to stale elements. More precise than file-level matching.
 * A delta with added/removed definitions triggers re-analysis of the element
 * that owns that file.
 */
export function mapFingerprintsToElements(
  deltas: FingerprintDelta[],
  ommDir: string = getOmmDir(),
): StaleElement[] {
  const elements = loadElementIndex(ommDir);
  const staleMap = new Map<string, StaleElement>();

  for (const delta of deltas) {
    if (!delta.hasChanges) continue;

    for (const el of elements) {
      const sourceFiles = el.meta.source_files ?? [];
      const sourceGlobs = el.meta.source_globs ?? [];

      const matchesFile = sourceFiles.some(sf => fileMatchesPath(delta.file, sf));
      const matchesGlob = fileMatchesAnyGlob(delta.file, sourceGlobs);

      if (matchesFile || matchesGlob) {
        let s = staleMap.get(el.elementPath);
        if (!s) {
          s = { elementPath: el.elementPath, matchedFiles: [], reasons: [] };
          staleMap.set(el.elementPath, s);
        }
        s.matchedFiles.push(delta.file);
        s.reasons.push('source_file');
      }
    }
  }

  return [...staleMap.values()].sort((a, b) => a.elementPath.localeCompare(b.elementPath));
}

/**
 * Format a fingerprint delta summary for display.
 */
export function formatFingerprintDelta(delta: FingerprintDelta): string {
  if (!delta.hasChanges) return `${delta.file}: no structural changes`;

  const parts: string[] = [];
  if (delta.added.length > 0) parts.push(`+${delta.added.length} added`);
  if (delta.removed.length > 0) parts.push(`-${delta.removed.length} removed`);
  if (delta.modified.length > 0) parts.push(`~${delta.modified.length} modified`);
  return `${delta.file}: ${parts.join(', ')}`;
}
