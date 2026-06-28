/**
 * gitignore.ts — Shared .gitignore parsing and matching.
 *
 * Used by treecode, analyzer, and other modules to exclude
 * git-ignored files from processing.
 */

import fs from 'node:fs';
import path from 'node:path';

// ── Default ignored directories (always excluded) ──────────────────

export const ALWAYS_IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.nuxt',
  '__pycache__', '.pytest_cache', '.venv', 'venv', 'env',
  'target', 'bin', 'obj', '.gradle', '.maven',
  '.omm', '.understand-anything', 'graphify-out',
  '.wiki', '.fingerprint-cache',
]);

// ── Gitignore parsing ──────────────────────────────────────────────

export interface GitignoreRules {
  patterns: string[];
  negations: string[];
}

/**
 * Parse .gitignore file and return patterns.
 */
export function parseGitignore(gitignorePath: string): GitignoreRules {
  if (!fs.existsSync(gitignorePath)) return { patterns: [], negations: [] };

  const content = fs.readFileSync(gitignorePath, 'utf-8');
  const patterns: string[] = [];
  const negations: string[] = [];

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (trimmed.startsWith('!')) {
      negations.push(trimmed.slice(1));
    } else {
      patterns.push(trimmed);
    }
  }

  return { patterns, negations };
}

/**
 * Convert a gitignore pattern to a regex.
 */
function patternToRegex(pattern: string): RegExp {
  let re = '^';
  let i = 0;
  const n = pattern.length;

  while (i < n) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        re += '.*';
        i += 2;
        if (pattern[i] === '/') i++;
      } else {
        re += '[^/]*';
        i++;
      }
    } else if (c === '?') {
      re += '[^/]';
      i++;
    } else if (c === '[') {
      const end = pattern.indexOf(']', i);
      if (end !== -1) {
        re += pattern.slice(i, end + 1);
        i = end + 1;
      } else {
        re += '\\[';
        i++;
      }
    } else if (/[.+^$|\\(){}]/.test(c)) {
      re += '\\' + c;
      i++;
    } else {
      re += c;
      i++;
    }
  }

  re += '$';
  return new RegExp(re);
}

/**
 * Check if a path matches gitignore patterns.
 *
 * @param relativePath - Path relative to the gitignore root
 * @param isDirectory - Whether the path is a directory
 * @param rules - Parsed gitignore rules
 * @returns true if the path should be ignored
 */
export function isGitignored(relativePath: string, isDirectory: boolean, rules: GitignoreRules): boolean {
  // Normalize path separators
  const normalized = relativePath.replace(/\\/g, '/');

  // Check negations first (they override patterns)
  for (const negation of rules.negations) {
    const regex = patternToRegex(negation);
    if (regex.test(normalized)) return false;
  }

  // Check patterns
  for (const pattern of rules.patterns) {
    const isDirPattern = pattern.endsWith('/');
    const cleanPattern = pattern.replace(/^\/+/, '').replace(/\/+$/, '');

    // If pattern starts with /, it only matches from root
    if (pattern.startsWith('/')) {
      const regex = patternToRegex(cleanPattern);
      if (regex.test(normalized)) return true;
      if (isDirPattern && isDirectory && regex.test(normalized + '/')) return true;
      continue;
    }

    // Pattern can match anywhere in the path
    const parts = normalized.split('/');

    // Try matching against the full path
    const regex = patternToRegex(cleanPattern);
    if (regex.test(normalized)) return true;
    if (isDirPattern && isDirectory && regex.test(normalized + '/')) return true;

    // Try matching against each part of the path
    for (const part of parts) {
      if (regex.test(part)) return true;
    }

    // Try matching against the basename
    const basename = parts[parts.length - 1];
    if (regex.test(basename)) return true;
  }

  return false;
}

/**
 * Check if a file/directory should be ignored.
 *
 * @param relativePath - Path relative to project root
 * @param isDirectory - Whether the path is a directory
 * @param dirName - The directory name (for quick ALWAYS_IGNORED_DIRS check)
 * @param rules - Parsed gitignore rules
 * @returns true if the path should be ignored
 */
export function shouldIgnore(
  relativePath: string,
  isDirectory: boolean,
  dirName: string,
  rules: GitignoreRules
): boolean {
  // Always ignored directories
  if (isDirectory && ALWAYS_IGNORED_DIRS.has(dirName)) return true;

  // Dot directories (but not . itself)
  if (dirName.startsWith('.') && dirName !== '.') return true;

  // Gitignore patterns
  if (isGitignored(relativePath, isDirectory, rules)) return true;

  return false;
}
