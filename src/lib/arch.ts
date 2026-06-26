import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import YAML from 'yaml';
import { ensureOmmForRead, ensureOmmForWrite, getOmmDir } from './store.js';

const GLOBAL_OMM_DIR = path.join(os.homedir(), '.omm');
const GLOBAL_CONFIG_PATH = path.join(GLOBAL_OMM_DIR, 'config.yaml');

const ARCH_CONFIG_KEYS = ['arch_repo', 'arch-repo'];
const REMOTE_CONFIG_KEYS = ['arch_remote', 'arch-remote'];

// ── Global config (~/.omm/config.yaml) ───────────────────

function readGlobalConfig(): Record<string, unknown> {
  if (!fs.existsSync(GLOBAL_CONFIG_PATH)) return {};
  try {
    return (YAML.parse(fs.readFileSync(GLOBAL_CONFIG_PATH, 'utf-8')) as Record<string, unknown>) || {};
  } catch {
    return {};
  }
}

function writeGlobalConfig(config: Record<string, unknown>): void {
  fs.mkdirSync(GLOBAL_OMM_DIR, { recursive: true });
  fs.writeFileSync(GLOBAL_CONFIG_PATH, YAML.stringify(config), 'utf-8');
}

function readProjectConfig(cwd: string = process.cwd()): Record<string, unknown> {
  const configPath = path.join(getOmmDir(cwd), 'config.yaml');
  if (!fs.existsSync(configPath)) return {};
  try {
    return (YAML.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>) || {};
  } catch {
    return {};
  }
}

/** Read a key from config: global first, then project fallback. */
function getConfigValue(keys: string[], cwd?: string): string | null {
  // 1. Check global config
  const global = readGlobalConfig();
  for (const key of keys) {
    if (typeof global[key] === 'string' && global[key]) return global[key] as string;
  }
  // 2. Check project config
  const project = readProjectConfig(cwd);
  for (const key of keys) {
    if (typeof project[key] === 'string' && project[key]) return project[key] as string;
  }
  // 3. Fallback: find any path-like value pointing to a valid arch repo
  for (const config of [global, project]) {
    for (const val of Object.values(config)) {
      if (typeof val === 'string' && val.startsWith('/') && fs.existsSync(val) && fs.existsSync(path.join(val, '.omm'))) {
        return val;
      }
    }
  }
  return null;
}

/** Write a key to global config. */
function setConfigValue(key: string, value: string): void {
  const config = readGlobalConfig();
  // Clean up aliases
  const aliases: Record<string, string[]> = {
    'arch_repo': ['arch-repo'],
    'arch_remote': ['arch-remote'],
  };
  for (const alias of aliases[key] || []) {
    delete config[alias];
  }
  config[key] = value;
  writeGlobalConfig(config);
}

// ── Public API ───────────────────────────────────────────

/**
 * Get the configured architecture repository path.
 * Reads from global (~/.omm/config.yaml) first, then project (.omm/config.yaml).
 */
export function getArchRepo(cwd: string = process.cwd()): string | null {
  return getConfigValue(ARCH_CONFIG_KEYS, cwd);
}

/**
 * Set the architecture repository path (saved to global config).
 */
export function setArchRepo(repoPath: string): void {
  setConfigValue('arch_repo', repoPath);
}

/**
 * Get the configured git remote URL for the architecture repository.
 */
export function getArchRemote(cwd: string = process.cwd()): string | null {
  return getConfigValue(REMOTE_CONFIG_KEYS, cwd);
}

/**
 * Set the git remote URL (saved to global config).
 */
export function setArchRemote(remoteUrl: string): void {
  setConfigValue('arch_remote', remoteUrl);
}

/**
 * List all configured arch repos from global config.
 */
export function listArchRepos(): Array<{ path: string; remote?: string }> {
  const config = readGlobalConfig();
  const repo = config['arch_repo'] as string | undefined;
  const remote = config['arch_remote'] as string | undefined;
  if (!repo) return [];
  return [{ path: repo, remote: remote || undefined }];
}

/**
 * Get the project name (used as subdirectory in the arch repo).
 */
export function getProjectName(cwd: string = process.cwd()): string {
  return path.basename(cwd);
}

/**
 * Resolve the target directory in the arch repo for this project.
 * Structure: {arch_repo}/.omm/{project_name}/
 */
export function getArchTarget(archRepo: string, projectName: string): string {
  return path.join(archRepo, '.omm', projectName);
}

/**
 * Walk a directory and return all files with relative paths.
 */
export function walkDir(dir: string, base: string = dir): Array<{ relPath: string; fullPath: string }> {
  const results: Array<{ relPath: string; fullPath: string }> = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(base, full);
    if (entry.isDirectory()) {
      results.push(...walkDir(full, base));
    } else {
      results.push({ relPath: rel, fullPath: full });
    }
  }
  return results;
}

/**
 * Copy files from source to destination, creating directories as needed.
 */
export function copyFiles(srcDir: string, destDir: string, files: Array<{ relPath: string }>): number {
  let count = 0;
  for (const file of files) {
    const src = path.join(srcDir, file.relPath);
    const dest = path.join(destDir, file.relPath);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    count++;
  }
  return count;
}

/**
 * Compute a simple diff summary between two directories.
 */
export function diffDirs(
  srcDir: string,
  destDir: string,
): { added: string[]; modified: string[]; removed: string[] } {
  const srcFiles = new Set(walkDir(srcDir).map(f => f.relPath));
  const destFiles = new Set(walkDir(destDir).map(f => f.relPath));

  const added: string[] = [];
  const modified: string[] = [];
  const removed: string[] = [];

  for (const f of srcFiles) {
    if (!destFiles.has(f)) {
      added.push(f);
    } else {
      const srcContent = fs.readFileSync(path.join(srcDir, f), 'utf-8');
      const destContent = fs.readFileSync(path.join(destDir, f), 'utf-8');
      if (srcContent !== destContent) modified.push(f);
    }
  }
  for (const f of destFiles) {
    if (!srcFiles.has(f)) removed.push(f);
  }

  return { added, modified, removed };
}

/**
 * Initialize a directory as an architecture repository.
 * Creates .omm/ and config.yaml if they don't exist.
 */
export function initArchRepo(repoPath: string): void {
  const ommDir = path.join(repoPath, '.omm');
  if (!fs.existsSync(ommDir)) {
    fs.mkdirSync(ommDir, { recursive: true });
  }
  const configPath = path.join(ommDir, 'config.yaml');
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, YAML.stringify({ version: '0.1.0', arch_repo: true }), 'utf-8');
  }
}

/**
 * List all projects in an architecture repository.
 */
export function listArchProjects(archRepo: string): string[] {
  const ommDir = path.join(archRepo, '.omm');
  if (!fs.existsSync(ommDir)) return [];
  return fs.readdirSync(ommDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('.'))
    .map(d => d.name)
    .sort();
}
