import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const HELP = `
omm hooks [install|uninstall|status]

Manage git hooks for automatic architecture analysis.

Usage:
  omm hooks install       Install post-commit hook that runs omm analyze
  omm hooks uninstall     Remove the omm post-commit hook
  omm hooks status        Show if hooks are installed

The post-commit hook runs \`omm analyze --format md\` after every commit
and appends results to .omm/analyze.log. Lightweight — no LLM calls.
`;

function getGitDir(): string | null {
  try {
    return execSync('git rev-parse --git-dir', { encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
}

const HOOK_START = '# omm-analyze-hook-start';
const HOOK_END = '# omm-analyze-hook-end';
const HOOK_SCRIPT = `${HOOK_START}
# Auto-run omm analyze after commit (added by \`omm hooks install\`)
if command -v omm &>/dev/null; then
  omm analyze --format md > /dev/null 2>&1 &
fi
${HOOK_END}
`;

function installHook(): void {
  const gitDir = getGitDir();
  if (!gitDir) {
    process.stderr.write('error: not a git repository\n');
    process.exit(1);
  }

  const hooksDir = path.join(gitDir, 'hooks');
  if (!fs.existsSync(hooksDir)) fs.mkdirSync(hooksDir, { recursive: true });

  const hookPath = path.join(hooksDir, 'post-commit');

  if (fs.existsSync(hookPath)) {
    const content = fs.readFileSync(hookPath, 'utf-8');
    if (content.includes(HOOK_START)) {
      process.stdout.write('omm hooks already installed.\n');
      return;
    }
    // Append to existing hook
    fs.appendFileSync(hookPath, '\n' + HOOK_SCRIPT, { mode: 0o755 });
    process.stdout.write('omm hooks appended to existing post-commit hook.\n');
  } else {
    fs.writeFileSync(hookPath, '#!/bin/sh\n' + HOOK_SCRIPT, { mode: 0o755 });
    process.stdout.write('omm hooks installed (post-commit hook).\n');
  }
}

function uninstallHook(): void {
  const gitDir = getGitDir();
  if (!gitDir) {
    process.stderr.write('error: not a git repository\n');
    process.exit(1);
  }

  const hookPath = path.join(gitDir, 'hooks', 'post-commit');
  if (!fs.existsSync(hookPath)) {
    process.stdout.write('No post-commit hook found.\n');
    return;
  }

  const content = fs.readFileSync(hookPath, 'utf-8');
  if (!content.includes(HOOK_START)) {
    process.stdout.write('omm hooks not installed in this hook.\n');
    return;
  }

  // Remove the omm section
  const updated = content.replace(/\n?# omm-analyze-hook-start[\s\S]*?# omm-analyze-hook-end/, '').trim();
  if (updated === '#!/bin/sh') {
    fs.unlinkSync(hookPath);
    process.stdout.write('omm hooks removed (hook file deleted).\n');
  } else {
    fs.writeFileSync(hookPath, updated + '\n', { mode: 0o755 });
    process.stdout.write('omm hooks removed from post-commit hook.\n');
  }
}

function showStatus(): void {
  const gitDir = getGitDir();
  if (!gitDir) {
    process.stderr.write('error: not a git repository\n');
    process.exit(1);
  }

  const hookPath = path.join(gitDir, 'hooks', 'post-commit');
  if (!fs.existsSync(hookPath)) {
    process.stdout.write('post-commit hook: not installed\n');
    return;
  }

  const content = fs.readFileSync(hookPath, 'utf-8');
  if (content.includes(HOOK_START)) {
    process.stdout.write('post-commit hook: omm hooks ACTIVE\n');
  } else {
    process.stdout.write('post-commit hook: exists (no omm hook)\n');
  }
}

export function commandHooks(args: string[]): void {
  const sub = args[0];

  if (!sub || sub === '--help' || sub === '-h') {
    process.stdout.write(HELP.trim() + '\n');
    return;
  }

  switch (sub) {
    case 'install':
      installHook();
      break;
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
