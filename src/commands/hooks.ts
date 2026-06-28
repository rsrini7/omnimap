/**
 * omm hooks — Manage git hooks for automatic architecture analysis.
 *
 * Supports two hooks:
 *   - post-commit: Runs omm analyze after every commit
 *   - pre-commit:  Runs omm signature --check before commit (blocks if stale)
 *
 * Usage:
 *   omm hooks install              Install post-commit hook (analyze)
 *   omm hooks install --pre-commit Install pre-commit hook (signature check)
 *   omm hooks uninstall            Remove omm hooks
 *   omm hooks status               Show installed hooks
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const HELP = `
omm hooks [install|uninstall|status] [options]

Manage git hooks for automatic architecture analysis.

Usage:
  omm hooks install              Install post-commit hook (runs omm analyze)
  omm hooks install --pre-commit Install pre-commit hook (runs omm signature --check)
  omm hooks install --all        Install both hooks
  omm hooks uninstall            Remove all omm hooks
  omm hooks status               Show installed hooks

Hook Types:
  post-commit   Runs \`omm analyze --format md\` after every commit (background)
  pre-commit    Runs \`omm signature --check\` before commit (blocks if stale)

Examples:
  omm hooks install              # Install post-commit analyze hook
  omm hooks install --pre-commit # Install pre-commit signature check
  omm hooks install --all        # Install both hooks
  omm hooks status               # Show what's installed
`;

function getGitDir(): string | null {
  try {
    return execSync('git rev-parse --git-dir', { encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
}

// ── Hook markers ───────────────────────────────────────────────────

const ANALYZE_START = '# omm-analyze-hook-start';
const ANALYZE_END = '# omm-analyze-hook-end';
const ANALYZE_SCRIPT = `${ANALYZE_START}
# Auto-run omm analyze after commit (added by \`omm hooks install\`)
if command -v omm &>/dev/null; then
  omm analyze --format md > /dev/null 2>&1 &
fi
${ANALYZE_END}
`;

const SIGNATURE_START = '# omm-signature-hook-start';
const SIGNATURE_END = '# omm-signature-hook-end';
const SIGNATURE_SCRIPT = `${SIGNATURE_START}
# Check .omm/ structural signature before commit (added by \`omm hooks install --pre-commit\`)
if command -v omm &>/dev/null; then
  omm signature --check
fi
${SIGNATURE_END}
`;

// ── Install hooks ──────────────────────────────────────────────────

function installAnalyzeHook(hooksDir: string): void {
  const hookPath = path.join(hooksDir, 'post-commit');

  if (fs.existsSync(hookPath)) {
    const content = fs.readFileSync(hookPath, 'utf-8');
    if (content.includes(ANALYZE_START)) {
      process.stdout.write('post-commit hook: omm analyze already installed.\n');
      return;
    }
    fs.appendFileSync(hookPath, '\n' + ANALYZE_SCRIPT, { mode: 0o755 });
    process.stdout.write('post-commit hook: omm analyze appended.\n');
  } else {
    fs.writeFileSync(hookPath, '#!/bin/sh\n' + ANALYZE_SCRIPT, { mode: 0o755 });
    process.stdout.write('post-commit hook: omm analyze installed.\n');
  }
}

function installSignatureHook(hooksDir: string): void {
  const hookPath = path.join(hooksDir, 'pre-commit');

  if (fs.existsSync(hookPath)) {
    const content = fs.readFileSync(hookPath, 'utf-8');
    if (content.includes(SIGNATURE_START)) {
      process.stdout.write('pre-commit hook: omm signature already installed.\n');
      return;
    }
    fs.appendFileSync(hookPath, '\n' + SIGNATURE_SCRIPT, { mode: 0o755 });
    process.stdout.write('pre-commit hook: omm signature appended.\n');
  } else {
    fs.writeFileSync(hookPath, '#!/bin/sh\n' + SIGNATURE_SCRIPT, { mode: 0o755 });
    process.stdout.write('pre-commit hook: omm signature installed.\n');
  }
}

function installHook(installPreCommit: boolean, installAll: boolean): void {
  const gitDir = getGitDir();
  if (!gitDir) {
    process.stderr.write('error: not a git repository\n');
    process.exit(1);
    return;
  }

  const hooksDir = path.join(gitDir, 'hooks');
  if (!fs.existsSync(hooksDir)) fs.mkdirSync(hooksDir, { recursive: true });

  if (installAll || !installPreCommit) {
    installAnalyzeHook(hooksDir);
  }
  if (installAll || installPreCommit) {
    installSignatureHook(hooksDir);
  }
}

// ── Uninstall hooks ────────────────────────────────────────────────

function removeHookBlock(content: string, start: string, end: string): string {
  const regex = new RegExp(`\\n?${start}[\\s\\S]*?${end}`, 'g');
  return content.replace(regex, '').trim();
}

function uninstallHook(): void {
  const gitDir = getGitDir();
  if (!gitDir) {
    process.stderr.write('error: not a git repository\n');
    process.exit(1);
    return;
  }

  const hooksDir = path.join(gitDir, 'hooks');
  let removed = false;

  // Remove from post-commit
  const postCommitPath = path.join(hooksDir, 'post-commit');
  if (fs.existsSync(postCommitPath)) {
    const content = fs.readFileSync(postCommitPath, 'utf-8');
    if (content.includes(ANALYZE_START)) {
      const updated = removeHookBlock(content, ANALYZE_START, ANALYZE_END);
      if (updated === '#!/bin/sh' || updated === '') {
        fs.unlinkSync(postCommitPath);
      } else {
        fs.writeFileSync(postCommitPath, updated + '\n', { mode: 0o755 });
      }
      process.stdout.write('post-commit hook: omm analyze removed.\n');
      removed = true;
    }
  }

  // Remove from pre-commit
  const preCommitPath = path.join(hooksDir, 'pre-commit');
  if (fs.existsSync(preCommitPath)) {
    const content = fs.readFileSync(preCommitPath, 'utf-8');
    if (content.includes(SIGNATURE_START)) {
      const updated = removeHookBlock(content, SIGNATURE_START, SIGNATURE_END);
      if (updated === '#!/bin/sh' || updated === '') {
        fs.unlinkSync(preCommitPath);
      } else {
        fs.writeFileSync(preCommitPath, updated + '\n', { mode: 0o755 });
      }
      process.stdout.write('pre-commit hook: omm signature removed.\n');
      removed = true;
    }
  }

  if (!removed) {
    process.stdout.write('No omm hooks found.\n');
  }
}

// ── Show status ────────────────────────────────────────────────────

function showStatus(): void {
  const gitDir = getGitDir();
  if (!gitDir) {
    process.stderr.write('error: not a git repository\n');
    process.exit(1);
    return;
  }

  const hooksDir = path.join(gitDir, 'hooks');

  // Check post-commit
  const postCommitPath = path.join(hooksDir, 'post-commit');
  let postCommitStatus = 'not installed';
  if (fs.existsSync(postCommitPath)) {
    const content = fs.readFileSync(postCommitPath, 'utf-8');
    postCommitStatus = content.includes(ANALYZE_START) ? 'ACTIVE' : 'exists (no omm hook)';
  }
  process.stdout.write(`post-commit hook (analyze):   ${postCommitStatus}\n`);

  // Check pre-commit
  const preCommitPath = path.join(hooksDir, 'pre-commit');
  let preCommitStatus = 'not installed';
  if (fs.existsSync(preCommitPath)) {
    const content = fs.readFileSync(preCommitPath, 'utf-8');
    preCommitStatus = content.includes(SIGNATURE_START) ? 'ACTIVE' : 'exists (no omm hook)';
  }
  process.stdout.write(`pre-commit hook (signature):  ${preCommitStatus}\n`);
}

// ── CLI entry point ────────────────────────────────────────────────

export function commandHooks(args: string[]): void {
  const sub = args[0];

  if (!sub || sub === '--help' || sub === '-h') {
    process.stdout.write(HELP.trim() + '\n');
    return;
  }

  switch (sub) {
    case 'install': {
      const installPreCommit = args.includes('--pre-commit');
      const installAll = args.includes('--all');
      installHook(installPreCommit, installAll);
      break;
    }
    case 'uninstall':
      uninstallHook();
      break;
    case 'status':
      showStatus();
      break;
    default:
      process.stderr.write(`error: unknown hooks subcommand '${sub}'. Use: install, uninstall, status\n`);
      process.exit(1);
  }
}
