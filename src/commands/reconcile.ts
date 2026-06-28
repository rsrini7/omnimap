/**
 * omm reconcile — Sync reconciliation for .omm/ drift detection.
 *
 * Detects and optionally fixes:
 * - Orphaned source files
 * - Missing descriptions/diagrams
 * - Broken @refs
 * - Structural drift
 * - Empty elements
 *
 * Usage:
 *   omm reconcile                    Full reconciliation, interactive
 *   omm reconcile --non-interactive  CI mode, report only
 *   omm reconcile --fix              Auto-fix orphaned sources
 *   omm reconcile --json             JSON output
 */

import {
  buildReconcileReport,
  fixOrphanedSources,
  formatReconcileReport,
  hasIssues,
} from '../lib/reconcile.js';
import { getOmmDir, ensureOmmForRead } from '../lib/store.js';

const HELP = `
omm reconcile [options]

Detect and fix drift between .omm/ documentation and source code.
Checks for orphaned sources, missing descriptions, broken @refs,
structural signature drift, and empty elements.

Usage:
  omm reconcile                    Full reconciliation (interactive)
  omm reconcile --non-interactive  CI mode (report only, exit 1 if issues)
  omm reconcile --fix              Auto-fix orphaned source files
  omm reconcile --json             JSON output

Examples:
  omm reconcile                    # Show reconciliation report
  omm reconcile --fix              # Auto-fix orphaned source files
  omm reconcile --non-interactive  # CI mode (exit 1 if issues)
  omm reconcile --json | jq        # JSON for scripting
`;

interface ParsedArgs {
  nonInteractive: boolean;
  fix: boolean;
  json: boolean;
  help: boolean;
}

function parseArgs(args: string[]): ParsedArgs {
  const out: ParsedArgs = { nonInteractive: false, fix: false, json: false, help: false };

  for (const a of args) {
    if (a === '--non-interactive' || a === '-n') out.nonInteractive = true;
    else if (a === '--fix') out.fix = true;
    else if (a === '--json') out.json = true;
    else if (a === '--help' || a === '-h') out.help = true;
  }

  return out;
}

export function commandReconcile(args: string[], cwd?: string): void {
  const parsed = parseArgs(args);

  if (parsed.help) {
    process.stdout.write(HELP.trim() + '\n');
    return;
  }

  if (!ensureOmmForRead(cwd)) return;

  const ommDir = getOmmDir(cwd);
  const report = buildReconcileReport(ommDir, cwd);

  // Auto-fix mode
  if (parsed.fix) {
    if (report.orphanedSources.length === 0) {
      process.stdout.write('No orphaned source files to fix.\n');
    } else {
      process.stderr.write(`Fixing ${report.orphanedSources.length} orphaned source references...\n`);
      const fixResult = fixOrphanedSources(report, ommDir);

      if (parsed.json) {
        process.stdout.write(JSON.stringify({ fixResult }, null, 2) + '\n');
      } else {
        process.stdout.write(`Fixed ${fixResult.fixedOrphanedSources} orphaned source references.\n`);
        if (fixResult.errors.length > 0) {
          process.stdout.write('Errors:\n');
          for (const err of fixResult.errors) {
            process.stdout.write(`  ${err}\n`);
          }
        }
      }
    }

    // Still show remaining issues
    if (!parsed.json) {
      process.stdout.write('\nRemaining issues:\n');
      const remaining = formatReconcileReport(report);
      process.stdout.write(remaining + '\n');
    }
    return;
  }

  // Report mode
  if (parsed.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    process.stdout.write(formatReconcileReport(report) + '\n');
  }

  // Exit 1 if issues found (for CI)
  if (parsed.nonInteractive && hasIssues(report)) {
    process.exit(1);
  }
}
