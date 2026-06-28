/**
 * reconcile.ts — Reconciliation logic for .omm/ drift detection.
 *
 * Detects and optionally fixes:
 * - Orphaned source files (source_files pointing to deleted files)
 * - Missing descriptions
 * - Missing diagrams
 * - Broken @refs (via validateDiagram)
 * - Structural drift (via signature check)
 * - Empty elements
 */

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { getOmmDir, readNodeMeta, writeNodeMeta, readMeta, writeMeta, listClasses, listNodes, readField, readNodeField } from './store.js';
import { checkSignature } from './signature.js';
import { validateDiagram } from './validate.js';
import { loadElementIndex, type ElementInfo } from './incremental.js';
import type { Field, ClassMeta } from '../types.js';
import { VALID_FIELDS } from '../types.js';

// ── Types ──────────────────────────────────────────────────────────

export interface ReconcileReport {
  signatureStale: boolean;
  storedSignature: string | null;
  currentSignature: string;
  orphanedSources: Array<{ element: string; file: string }>;
  missingDescriptions: string[];
  missingDiagrams: string[];
  brokenRefs: Array<{ element: string; line: number; ref: string }>;
  emptyElements: string[];
}

export interface ReconcileFixResult {
  fixedOrphanedSources: number;
  errors: string[];
}

// ── Report building ────────────────────────────────────────────────

/**
 * Build a reconciliation report for the .omm/ directory.
 *
 * @param ommDir - Path to .omm/ directory (optional, defaults to getOmmDir())
 * @param cwd - Working directory for reading source files
 * @returns Reconciliation report
 */
export function buildReconcileReport(ommDir?: string, cwd?: string): ReconcileReport {
  const omm = ommDir ?? getOmmDir(cwd);
  const root = cwd ?? process.cwd();

  const report: ReconcileReport = {
    signatureStale: false,
    storedSignature: null,
    currentSignature: '',
    orphanedSources: [],
    missingDescriptions: [],
    missingDiagrams: [],
    brokenRefs: [],
    emptyElements: [],
  };

  // 1. Signature check
  const sig = checkSignature(omm);
  report.signatureStale = !sig.match;
  report.storedSignature = sig.stored;
  report.currentSignature = sig.current;

  // 2. Load all elements
  const elements = loadElementIndex(omm);

  for (const el of elements) {
    const meta = el.meta;

    // 3. Check orphaned source files
    const sourceFiles = meta.source_files ?? [];
    for (const sf of sourceFiles) {
      const abs = path.isAbsolute(sf) ? sf : path.resolve(root, sf);
      if (!fs.existsSync(abs)) {
        report.orphanedSources.push({ element: el.elementPath, file: sf });
      }
    }

    // 4. Check missing descriptions
    const descPath = path.join(omm, el.elementPath, 'description.md');
    if (!fs.existsSync(descPath)) {
      report.missingDescriptions.push(el.elementPath);
    }

    // 5. Check missing diagrams
    const diagPath = path.join(omm, el.elementPath, 'diagram.mmd');
    if (!fs.existsSync(diagPath)) {
      report.missingDiagrams.push(el.elementPath);
    }

    // 6. Check broken @refs
    const diagram = readDiagramAtPath(omm, el.elementPath);
    if (diagram) {
      const allClasses = elements.map(e => e.elementPath);
      const result = validateDiagram(diagram, { className: el.elementPath, allClasses });
      for (const issue of result.issues) {
        if (issue.rule === 'ref-exists') {
          report.brokenRefs.push({
            element: el.elementPath,
            line: issue.line ?? 0,
            ref: issue.message,
          });
        }
      }
    }

    // 7. Check empty elements
    let hasAnyField = false;
    for (const field of VALID_FIELDS) {
      const fp = path.join(omm, el.elementPath, field === 'diagram' ? 'diagram.mmd' : `${field}.md`);
      if (fs.existsSync(fp)) {
        const content = fs.readFileSync(fp, 'utf-8');
        if (content.trim().length > 0) {
          hasAnyField = true;
          break;
        }
      }
    }
    if (!hasAnyField) {
      report.emptyElements.push(el.elementPath);
    }
  }

  return report;
}

/**
 * Read diagram for an element, handling nested paths.
 */
function readDiagramAtPath(ommDir: string, elementPath: string): string | null {
  const diagPath = path.join(ommDir, elementPath, 'diagram.mmd');
  if (!fs.existsSync(diagPath)) return null;
  return fs.readFileSync(diagPath, 'utf-8');
}

// ── Auto-fix ───────────────────────────────────────────────────────

/**
 * Auto-fix orphaned source files by removing them from meta.yaml.
 *
 * @param report - Reconciliation report
 * @param cwd - Working directory (project root)
 * @returns Fix result with count of fixed items and any errors
 */
export function fixOrphanedSources(report: ReconcileReport, cwd?: string): ReconcileFixResult {
  const root = cwd ?? process.cwd();
  const result: ReconcileFixResult = { fixedOrphanedSources: 0, errors: [] };

  // Group by element
  const byElement = new Map<string, string[]>();
  for (const orphan of report.orphanedSources) {
    if (!byElement.has(orphan.element)) byElement.set(orphan.element, []);
    byElement.get(orphan.element)!.push(orphan.file);
  }

  for (const [elementPath, filesToRemove] of byElement) {
    try {
      const parts = elementPath.split('/');
      const perspective = parts[0];
      const nodePath = parts.slice(1);

      const readMetaFn = nodePath.length > 0
        ? () => readNodeMeta(perspective, nodePath, root)
        : () => readMeta(perspective, root);
      const writeMetaFn = nodePath.length > 0
        ? (meta: ClassMeta) => writeNodeMeta(perspective, nodePath, meta, root)
        : (meta: ClassMeta) => writeMeta(perspective, meta, root);

      const meta = readMetaFn();
      if (!meta?.source_files) continue;

      const before = meta.source_files.length;
      meta.source_files = meta.source_files.filter(sf => !filesToRemove.includes(sf));
      const removed = before - meta.source_files.length;

      if (removed > 0) {
        meta.updated = new Date().toISOString();
        writeMetaFn(meta);
        result.fixedOrphanedSources += removed;
      }
    } catch (err) {
      result.errors.push(`Failed to fix ${elementPath}: ${err}`);
    }
  }

  return result;
}

// ── Formatting ─────────────────────────────────────────────────────

/**
 * Format a reconciliation report for display.
 */
export function formatReconcileReport(report: ReconcileReport): string {
  const lines: string[] = ['Reconciliation report', ''];

  // Signature
  if (report.signatureStale) {
    lines.push(`  Structural signature: STALE`);
    lines.push(`    Stored:  ${report.storedSignature ?? '(none)'}`);
    lines.push(`    Current: ${report.currentSignature}`);
  } else {
    lines.push(`  Structural signature: OK (${report.currentSignature})`);
  }
  lines.push('');

  // Orphaned sources
  if (report.orphanedSources.length > 0) {
    lines.push(`  Orphaned source files (${report.orphanedSources.length}):`);
    for (const orphan of report.orphanedSources) {
      lines.push(`    ${orphan.element} → ${orphan.file} (deleted)`);
    }
    lines.push('');
  }

  // Missing descriptions
  if (report.missingDescriptions.length > 0) {
    lines.push(`  Missing descriptions (${report.missingDescriptions.length}):`);
    for (const el of report.missingDescriptions) {
      lines.push(`    ${el}`);
    }
    lines.push('');
  }

  // Missing diagrams
  if (report.missingDiagrams.length > 0) {
    lines.push(`  Missing diagrams (${report.missingDiagrams.length}):`);
    for (const el of report.missingDiagrams.slice(0, 10)) {
      lines.push(`    ${el}`);
    }
    if (report.missingDiagrams.length > 10) {
      lines.push(`    ... and ${report.missingDiagrams.length - 10} more`);
    }
    lines.push('');
  }

  // Broken @refs
  if (report.brokenRefs.length > 0) {
    lines.push(`  Broken @refs (${report.brokenRefs.length}):`);
    for (const ref of report.brokenRefs) {
      lines.push(`    ${ref.element} line ${ref.line}: ${ref.ref}`);
    }
    lines.push('');
  }

  // Empty elements
  if (report.emptyElements.length > 0) {
    lines.push(`  Empty elements (${report.emptyElements.length}):`);
    for (const el of report.emptyElements) {
      lines.push(`    ${el}`);
    }
    lines.push('');
  }

  // Summary
  const issues = report.orphanedSources.length + report.brokenRefs.length + report.emptyElements.length;
  if (issues === 0 && !report.signatureStale) {
    lines.push('  ✓ No issues found. Tree is up to date.');
  } else {
    lines.push('  Suggested fixes:');
    if (report.orphanedSources.length > 0) {
      lines.push('    omm reconcile --fix          # auto-fix orphaned sources');
    }
    if (report.signatureStale) {
      lines.push('    omm signature --update        # store new signature');
    }
    if (report.brokenRefs.length > 0 || report.missingDescriptions.length > 0) {
      lines.push('    /omm-scan                    # re-scan to fix content issues');
    }
  }

  return lines.join('\n');
}

/**
 * Check if a reconcile report has any issues.
 */
export function hasIssues(report: ReconcileReport): boolean {
  return (
    report.signatureStale ||
    report.orphanedSources.length > 0 ||
    report.brokenRefs.length > 0 ||
    report.emptyElements.length > 0
  );
}
