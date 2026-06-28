/**
 * treecode.ts — Code ↔ docs coverage map logic.
 *
 * Maps source code files to .omm/ elements using three signals:
 * 1. source_files (exact) — from meta.yaml
 * 2. source_globs (pattern) — from meta.yaml
 * 3. Name heuristic (fallback) — element name matches directory name
 */

import fs from 'node:fs';
import path from 'node:path';
import { loadElementIndex, type ElementInfo } from './incremental.js';
import { getOmmDir } from './store.js';
import { parseGitignore, shouldIgnore, type GitignoreRules } from './gitignore.js';

// ── Types ──────────────────────────────────────────────────────────

export interface CoverageEntry {
  sourcePath: string;
  elementPath: string | null;
  matchMethod: 'source_files' | 'source_globs' | 'heuristic' | null;
  exports?: string[];
}

export interface CoverageStats {
  sourceFiles: number;
  coveredFiles: number;
  uncoveredFiles: number;
  coveragePercent: number;
  elements: number;
  matchedElements: number;
  orphanedElements: number;
  trackingMethod: {
    sourceFiles: number;
    sourceGlobs: number;
    heuristic: number;
  };
  topUncoveredDirs: Array<{ dir: string; fileCount: number }>;
}

export interface OrphanedElement {
  elementPath: string;
  reason: string;
}

// ── Constants ──────────────────────────────────────────────────────

// ── Source tree walker ─────────────────────────────────────────────

/**
 * Walk source tree and return all file paths relative to rootDir.
 * Respects .gitignore, ALWAYS_IGNORED_DIRS, and dot-directories.
 */
export function walkSourceTree(dir: string, rootDir: string): string[] {
  const results: string[] = [];
  const gitignorePath = path.join(rootDir, '.gitignore');
  const gitignoreRules = parseGitignore(gitignorePath);

  function walk(currentDir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return; // permission error or similar
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relPath = path.relative(rootDir, fullPath).replace(/\\/g, '/');

      if (entry.isDirectory()) {
        if (!shouldIgnore(relPath, true, entry.name, gitignoreRules)) {
          walk(fullPath);
        }
      } else if (entry.isFile()) {
        if (!shouldIgnore(relPath, false, entry.name, gitignoreRules)) {
          results.push(relPath);
        }
      }
    }
  }

  walk(dir);
  return results;
}

// ── Glob matching ──────────────────────────────────────────────────

/**
 * Convert a simple glob pattern to a RegExp.
 * Supports: *, **, ?, {a,b}, [abc]
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
        if (glob[i] === '/') i++; // skip trailing slash after **
      } else {
        re += '[^/]*';
        i++;
      }
    } else if (c === '?') {
      re += '[^/]';
      i++;
    } else if (c === '{') {
      const end = glob.indexOf('}', i);
      if (end !== -1) {
        const alts = glob.slice(i + 1, end).split(',').map(s =>
          s.replace(/[.+^$|\\()[\]]/g, '\\$&')
        );
        re += `(?:${alts.join('|')})`;
        i = end + 1;
      } else {
        re += '\\{';
        i++;
      }
    } else if (c === '[') {
      const end = glob.indexOf(']', i);
      if (end !== -1) {
        re += glob.slice(i, end + 1);
        i = end + 1;
      } else {
        re += '\\[';
        i++;
      }
    } else if (/[.+^$|\\()]/.test(c)) {
      re += '\\' + c;
      i++;
    } else {
      re += c;
      i++;
    }
  }

  return new RegExp(`^${re}$`);
}

// ── Coverage map builder ───────────────────────────────────────────

/**
 * Build a coverage map showing which .omm/ element covers each source file.
 *
 * @param sourceDir - Root directory to scan for source files
 * @param ommDir - Path to .omm/ directory
 * @returns Array of coverage entries
 */
export function buildCoverageMap(sourceDir: string, ommDir: string): CoverageEntry[] {
  const sourceFiles = walkSourceTree(sourceDir, sourceDir);

  // Load element tracking data from .omm/
  const elements = loadElementIndex(ommDir).map(el => ({
    path: el.elementPath,
    sourceFiles: el.meta.source_files ?? [],
    sourceGlobs: el.meta.source_globs ?? [],
  }));

  const fileToElement = new Map<string, { element: string; method: string }>();

  // Pass 1: exact source_files matches
  for (const el of elements) {
    for (const sf of el.sourceFiles) {
      // Normalize path separators
      const normalized = sf.replace(/\\/g, '/');
      fileToElement.set(normalized, { element: el.path, method: 'source_files' });
    }
  }

  // Pass 2: glob matches (only for files not yet matched)
  for (const el of elements) {
    for (const glob of el.sourceGlobs) {
      try {
        const regex = globToRegex(glob);
        for (const file of sourceFiles) {
          if (!fileToElement.has(file) && regex.test(file)) {
            fileToElement.set(file, { element: el.path, method: 'source_globs' });
          }
        }
      } catch {
        // invalid glob pattern, skip
      }
    }
  }

  // Pass 3: heuristic matching (element name ≈ directory/file name)
  const heuristicWarnings = new Set<string>();
  for (const file of sourceFiles) {
    if (!fileToElement.has(file)) {
      const { match, warnings } = findHeuristicMatch(file, elements);
      if (match) {
        fileToElement.set(file, { element: match, method: 'heuristic' });
      }
      for (const w of warnings) {
        heuristicWarnings.add(w);
      }
    }
  }

  // Build entries
  return sourceFiles.map(file => {
    const match = fileToElement.get(file);
    return {
      sourcePath: file,
      elementPath: match?.element ?? null,
      matchMethod: (match?.method as CoverageEntry['matchMethod']) ?? null,
    };
  });
}

/**
 * Find a heuristic match for a source file based on element names.
 * Returns the best match and any collision warnings.
 */
function findHeuristicMatch(
  filePath: string,
  elements: Array<{ path: string }>
): { match: string | null; warnings: string[] } {
  const parts = filePath.split('/');
  const warnings: string[] = [];

  // Try matching element name to any directory component in the path
  // Priority: deeper match wins (scan from leaf to root)
  for (let depth = parts.length - 1; depth >= 0; depth--) {
    const dirName = parts[depth].replace(/\.[^.]+$/, ''); // strip extension for files
    const candidates = elements.filter(el => {
      const elName = el.path.split('/').pop()!;
      return elName === dirName;
    });

    if (candidates.length > 0) {
      if (candidates.length > 1) {
        warnings.push(
          `Element name '${dirName}' matches ${candidates.length} elements: ` +
          candidates.map(c => `\n  - ${c.path}`).join('') +
          `\n  Using: ${candidates[0].path} (first match)` +
          `\n  Tip: Populate source_files in meta.yaml to disambiguate (run /omm-scan --incremental)`
        );
      }
      return { match: candidates[0].path, warnings };
    }
  }

  return { match: null, warnings };
}

// ── Statistics ─────────────────────────────────────────────────────

/**
 * Compute coverage statistics from a coverage map.
 */
export function computeCoverageStats(
  entries: CoverageEntry[],
  ommDir: string
): CoverageStats {
  // Use consistent element counting: only count directories with meta.yaml
  // that are actual elements (not .wiki, .fingerprint-cache, etc.)
  const elements = loadElementIndex(ommDir).filter(el => {
    // Filter out generated directories
    const parts = el.elementPath.split('/');
    return !parts.some(p => p.startsWith('.'));
  });
  const coveredPaths = new Set(entries.filter(e => e.elementPath).map(e => e.elementPath));

  const trackingMethod = { sourceFiles: 0, sourceGlobs: 0, heuristic: 0 };
  for (const el of elements) {
    if ((el.meta.source_files ?? []).length > 0) trackingMethod.sourceFiles++;
    else if ((el.meta.source_globs ?? []).length > 0) trackingMethod.sourceGlobs++;
    else trackingMethod.heuristic++;
  }

  // Find top uncovered directories
  const uncoveredDirs = new Map<string, number>();
  for (const entry of entries) {
    if (!entry.elementPath) {
      const dir = entry.sourcePath.includes('/')
        ? entry.sourcePath.slice(0, entry.sourcePath.lastIndexOf('/'))
        : '.';
      uncoveredDirs.set(dir, (uncoveredDirs.get(dir) ?? 0) + 1);
    }
  }

  const topUncoveredDirs = [...uncoveredDirs.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([dir, fileCount]) => ({ dir, fileCount }));

  return {
    sourceFiles: entries.length,
    coveredFiles: entries.filter(e => e.elementPath).length,
    uncoveredFiles: entries.filter(e => !e.elementPath).length,
    coveragePercent: entries.length > 0
      ? Math.round((entries.filter(e => e.elementPath).length / entries.length) * 100)
      : 0,
    elements: elements.length,
    matchedElements: coveredPaths.size,
    orphanedElements: elements.filter(el => !coveredPaths.has(el.elementPath)).length,
    trackingMethod,
    topUncoveredDirs,
  };
}

// ── Orphaned elements ──────────────────────────────────────────────

/**
 * Find .omm/ elements that have no matching source files.
 */
export function findOrphanedElements(
  entries: CoverageEntry[],
  ommDir: string
): OrphanedElement[] {
  const elements = loadElementIndex(ommDir);
  const coveredPaths = new Set(entries.filter(e => e.elementPath).map(e => e.elementPath));

  return elements
    .filter(el => !coveredPaths.has(el.elementPath))
    .map(el => ({
      elementPath: el.elementPath,
      reason: (el.meta.source_files ?? []).length > 0
        ? 'source_files point to deleted/moved files'
        : (el.meta.source_globs ?? []).length > 0
          ? 'source_globs match no current files'
          : 'no source_files, no directory match',
    }));
}
