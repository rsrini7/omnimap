/**
 * omm signature — Structural signature for .omm/ drift detection.
 *
 * Computes a SHA-256 hash of element paths (structure only, not content).
 * Used to detect when elements are added, removed, or renamed.
 *
 * Usage:
 *   omm signature                  Show current signature
 *   omm signature --check          Compare against stored signature (exit 1 if stale)
 *   omm signature --update         Compute and store signature
 *   omm signature --json           JSON output
 */

import {
  computeSignature,
  readStoredSignature,
  writeSignature,
  checkSignature,
} from '../lib/signature.js';
import { getOmmDir, ensureOmmForRead } from '../lib/store.js';

const HELP = `
omm signature [options]

Compute and manage structural signatures for .omm/ drift detection.
A signature is a SHA-256 hash of element paths (structure only, not content).

Usage:
  omm signature                  Show current signature
  omm signature --check          Compare against stored signature (CI mode)
  omm signature --update         Compute and store signature
  omm signature --json           JSON output

Examples:
  omm signature                  # Show current signature
  omm signature --check          # Check for drift (exit 1 if stale)
  omm signature --update         # Store current signature
  omm signature --check && echo "Tree is up to date"
`;

interface ParsedArgs {
  check: boolean;
  update: boolean;
  json: boolean;
  help: boolean;
}

function parseArgs(args: string[]): ParsedArgs {
  const out: ParsedArgs = { check: false, update: false, json: false, help: false };

  for (const a of args) {
    if (a === '--check') out.check = true;
    else if (a === '--update') out.update = true;
    else if (a === '--json') out.json = true;
    else if (a === '--help' || a === '-h') out.help = true;
  }

  return out;
}

export function commandSignature(args: string[], cwd?: string): void {
  const parsed = parseArgs(args);

  if (parsed.help) {
    process.stdout.write(HELP.trim() + '\n');
    return;
  }

  if (!ensureOmmForRead(cwd)) return;

  const ommDir = getOmmDir(cwd);

  // --check: compare and exit
  if (parsed.check) {
    const result = checkSignature(ommDir);

    if (parsed.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } else {
      if (result.match) {
        process.stdout.write(`Signature OK: ${result.current}\n`);
      } else {
        process.stdout.write(`Signature STALE\n`);
        process.stdout.write(`  Stored:  ${result.stored ?? '(none)'}\n`);
        process.stdout.write(`  Current: ${result.current}\n`);
        process.stdout.write(`\nRun 'omm signature --update' to store the new signature.\n`);
      }
    }

    if (!result.match) {
      process.exit(1);
    }
    return;
  }

  // --update: compute and store
  if (parsed.update) {
    const result = computeSignature(ommDir);
    writeSignature(ommDir, result.signature);

    if (parsed.json) {
      process.stdout.write(JSON.stringify({ updated: true, ...result }, null, 2) + '\n');
    } else {
      process.stdout.write(`Signature updated: ${result.signature}\n`);
      process.stdout.write(`  Elements: ${result.elementCount} (${result.perspectives} perspectives)\n`);
    }
    return;
  }

  // Default: show current signature
  const result = computeSignature(ommDir);
  const stored = readStoredSignature(ommDir);

  if (parsed.json) {
    process.stdout.write(JSON.stringify({ ...result, stored }, null, 2) + '\n');
  } else {
    process.stdout.write(`Signature:  ${result.signature}\n`);
    process.stdout.write(`Elements:   ${result.elementCount} (${result.perspectives} perspectives)\n`);
    if (stored) {
      const match = stored === result.signature;
      process.stdout.write(`Stored:     ${stored} (${match ? 'MATCH' : 'STALE'})\n`);
    } else {
      process.stdout.write(`Stored:     (none — run 'omm signature --update' to store)\n`);
    }
  }
}
