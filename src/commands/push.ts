/**
 * omm push — Sync local .omm/ to the architecture repository.
 *
 * Usage:
 *   omm push                          Push to configured arch repo
 *   omm push --to ~/arch/team-repo    Push to specific repo (also saves config)
 *   omm push --dry-run                Show what would change
 *   omm push --json                   JSON output
 *   omm push --commit                 Auto-commit to git after push
 *   omm push --commit -m "message"    Auto-commit with custom message
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { ensureOmmForRead, getOmmDir } from '../lib/store.js';
import {
  getArchRepo, setArchRepo, getArchRemote, getProjectName, getArchTarget,
  walkDir, copyFiles, diffDirs, initArchRepo,
} from '../lib/arch.js';

interface PushOptions {
  to?: string;
  dryRun: boolean;
  json: boolean;
  commit: boolean;
  push: boolean;
  message?: string;
}

function parseArgs(args: string[]): PushOptions {
  const opts: PushOptions = { dryRun: false, json: false, commit: false, push: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--to' && args[i + 1]) opts.to = args[++i];
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--commit-push') { opts.commit = true; opts.push = true; }
    else if (a === '--commit') opts.commit = true;
    else if ((a === '-m' || a === '--message') && args[i + 1]) opts.message = args[++i];
    else if (a === '--help' || a === '-h') {
      process.stdout.write(HELP);
      process.exit(0);
    } else {
      process.stderr.write(`error: unknown arg '${a}'\n`);
      process.exit(1);
    }
  }
  return opts;
}

const HELP = `
omm push — Sync local architecture docs to the shared repository.

Usage:
  omm push                              Copy .omm/ to arch repo
  omm push --to ~/arch/team-repo        Copy to specific repo (saves config)
  omm push --dry-run                    Show what would change
  omm push --json                       JSON output
  omm push --commit                     Copy + git commit
  omm push --commit-push                Copy + git commit + push to remote
  omm push --commit-push -m "update"    With custom message

Examples:
  omm push                              Just copy files
  omm push --commit                     Copy + commit locally
  omm push --commit-push                Copy + commit + push to GitHub
`;

interface GitResult {
  ok: boolean;
  output: string;
}

function gitExec(cmd: string, cwd: string, silent = false): GitResult {
  try {
    const output = execSync(cmd, { cwd, stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8' }).trim();
    return { ok: true, output };
  } catch (e: unknown) {
    if (!silent && e instanceof Error && 'stderr' in e) {
      const stderr = (e as { stderr?: string }).stderr?.toString().trim();
      if (stderr) process.stderr.write(`git: ${stderr}\n`);
    }
    return { ok: false, output: '' };
  }
}

export async function commandPush(args: string[]): Promise<void> {
  if (!ensureOmmForRead()) return;

  const opts = parseArgs(args);
  const cwd = process.cwd();
  const ommDir = getOmmDir(cwd);

  // Resolve arch repo
  let archRepo = opts.to || getArchRepo(cwd);
  if (!archRepo) {
    process.stderr.write('error: no architecture repository configured.\n');
    process.stderr.write('  Run: omm push --to <path-to-arch-repo>\n');
    process.stderr.write('  Or:  omm config arch-repo <path>\n');
    process.exit(1);
  }

  // Resolve to absolute path
  archRepo = path.resolve(archRepo);

  // Validate arch repo parent exists and is writable
  const archParent = path.dirname(archRepo);
  if (!fs.existsSync(archParent)) {
    process.stderr.write(`error: parent directory does not exist: ${archParent}\n`);
    process.exit(1);
  }

  // Check git is installed (only for commit/push)
  if (opts.commit) {
    try {
      execSync('git --version', { stdio: 'ignore' });
    } catch {
      process.stderr.write('error: git is not installed. Install git first.\n');
      process.exit(1);
    }

    // Validate remote URL format
    const remote = getArchRemote(cwd);
    if (opts.push && !remote) {
      process.stderr.write('error: no remote configured for push.\n');
      process.stderr.write('  Run: omm config arch-remote <url>\n');
      process.stderr.write('  Example: omm config arch-remote git@github.com:user/repo.git\n');
      process.exit(1);
    }
    if (remote && !remote.match(/^(git@|https?:\/\/|ssh:\/\/)/)) {
      process.stderr.write(`warning: remote URL '${remote}' doesn't look like a git URL.\n`);
      process.stderr.write('  Expected: git@github.com:user/repo.git or https://...\n');
    }
  }

  // Save if --to was specified
  if (opts.to) {
    setArchRepo(opts.to);
  }

  // Initialize arch repo if needed
  if (!opts.dryRun) {
    initArchRepo(archRepo);
  }

  const projectName = getProjectName(cwd);
  const archTarget = getArchTarget(archRepo, projectName);
  const sourceFiles = walkDir(ommDir);

  // Compute diff
  const diff = diffDirs(ommDir, archTarget);

  if (opts.json) {
    process.stdout.write(JSON.stringify({
      arch_repo: archRepo,
      project: projectName,
      target: archTarget,
      source_files: sourceFiles.length,
      added: diff.added.length,
      modified: diff.modified.length,
      removed: diff.removed.length,
    }, null, 2) + '\n');
    if (opts.dryRun) return;
  }

  // Report
  const total = diff.added.length + diff.modified.length + diff.removed.length;
  if (total === 0 && !opts.dryRun && !opts.commit) {
    process.stderr.write(`Already up to date. (${sourceFiles.length} files, no changes)\n`);
    return;
  }

  if (total === 0 && opts.commit) {
    // No file changes, but still try to commit (arch repo may have uncommitted changes)
    process.stderr.write(`Files already in sync (${sourceFiles.length} files). Checking git status...\n`);
  }

  if (opts.dryRun) {
    process.stderr.write(`Would push ${sourceFiles.length} files → ${archTarget}\n\n`);
    if (diff.added.length) {
      process.stderr.write(`  Added (${diff.added.length}):\n`);
      diff.added.slice(0, 15).forEach(f => process.stderr.write(`    + ${f}\n`));
      if (diff.added.length > 15) process.stderr.write(`    ... +${diff.added.length - 15} more\n`);
    }
    if (diff.modified.length) {
      process.stderr.write(`  Modified (${diff.modified.length}):\n`);
      diff.modified.slice(0, 15).forEach(f => process.stderr.write(`    ~ ${f}\n`));
      if (diff.modified.length > 15) process.stderr.write(`    ... +${diff.modified.length - 15} more\n`);
    }
    if (diff.removed.length) {
      process.stderr.write(`  Removed (${diff.removed.length}):\n`);
      diff.removed.slice(0, 15).forEach(f => process.stderr.write(`    - ${f}\n`));
      if (diff.removed.length > 15) process.stderr.write(`    ... +${diff.removed.length - 15} more\n`);
    }
    return;
  }

  if (total > 0) {
    // Execute push: copy files from .omm/ to arch repo
    fs.mkdirSync(archTarget, { recursive: true });

    // Remove files that no longer exist in source
    for (const f of diff.removed) {
      const target = path.join(archTarget, f);
      if (fs.existsSync(target)) fs.unlinkSync(target);
    }

    // Copy all source files
    const copied = copyFiles(ommDir, archTarget, sourceFiles);

    // Clean empty directories
    cleanEmptyDirs(archTarget);

    process.stderr.write(`Pushed ${copied} files → ${archTarget}\n`);
    process.stderr.write(`  ${diff.added.length} added, ${diff.modified.length} modified, ${diff.removed.length} removed\n`);
  }

  // Auto-commit if requested (even if no file changes — arch repo may have uncommitted changes)
  if (opts.commit) {
    // Ensure arch repo is a git repo
    if (!fs.existsSync(path.join(archRepo, '.git'))) {
      const initResult = gitExec('git init -q', archRepo);
      if (!initResult.ok) {
        process.stderr.write('Failed to initialize git repo.\n');
        return;
      }
      const remote = getArchRemote(cwd);
      if (remote) gitExec(`git remote add origin ${remote}`, archRepo);
      process.stderr.write('Initialized git repo.\n');
    }

    // Stage all .omm/ changes first, then check if there's anything to commit
    gitExec(`git add .omm/`, archRepo);
    const statusResult = gitExec('git diff --cached --name-only .omm/', archRepo);
    if (!statusResult.output) {
      process.stderr.write('No git changes to commit.\n');
      return;
    }

    const commitMsg = opts.message || buildCommitMessage(projectName, diff);
    const commitResult = gitExec(`git commit -m "${commitMsg}"`, archRepo);
    if (!commitResult.ok) {
      process.stderr.write('Git commit failed.\n');
      return;
    }
    process.stderr.write(`Committed: ${commitMsg}\n`);

    // Push to remote only with --commit-push
    if (opts.push) {
      // Auto-configure remote from config if not set in git
      const configuredRemote = getArchRemote(cwd);
      if (configuredRemote) {
        const existingRemote = gitExec('git remote get-url origin', archRepo, true);
        if (!existingRemote.ok) {
          gitExec(`git remote add origin ${configuredRemote}`, archRepo);
          process.stderr.write(`Added remote: ${configuredRemote}\n`);
        } else if (existingRemote.output !== configuredRemote) {
          gitExec(`git remote set-url origin ${configuredRemote}`, archRepo);
          process.stderr.write(`Updated remote: ${configuredRemote}\n`);
        }
      }

      const remoteResult = gitExec('git remote get-url origin', archRepo, true);
      if (!remoteResult.ok || !remoteResult.output) {
        process.stderr.write('No remote configured. Use `omm config arch-remote <url>` to set one.\n');
        return;
      }

      // Pull with rebase to handle concurrent updates from other devs
      const branchResult = gitExec('git branch --show-current', archRepo, true);
      const currentBranch = branchResult.output || 'main';
      const pullResult = gitExec(`git pull --rebase origin ${currentBranch}`, archRepo);
      if (!pullResult.ok) {
        process.stderr.write('error: git pull failed.\n');
        process.stderr.write('  Possible causes:\n');
        process.stderr.write('  - Remote has conflicting changes. Resolve manually in the arch repo.\n');
        process.stderr.write('  - SSH key not configured. Run: ssh -T git@github.com\n');
        process.stderr.write('  - Network issue. Check your connection.\n');
        return;
      }

      const pushResult = gitExec(`git push -u origin ${currentBranch}`, archRepo);
      if (pushResult.ok) {
        process.stderr.write(`Pushed to ${remoteResult.output}\n`);
      } else {
        process.stderr.write('error: git push failed.\n');
        process.stderr.write('  Possible causes:\n');
        process.stderr.write('  - Remote repo does not exist. Create it on GitHub/GitLab first.\n');
        process.stderr.write('  - No write access. Check your SSH key or token.\n');
        process.stderr.write('  - Branch protection rules. Check repo settings.\n');
      }
    }
  }
}

function buildCommitMessage(projectName: string, diff: { added: string[]; modified: string[]; removed: string[] }): string {
  const parts: string[] = [];
  if (diff.added.length) parts.push(`${diff.added.length} added`);
  if (diff.modified.length) parts.push(`${diff.modified.length} modified`);
  if (diff.removed.length) parts.push(`${diff.removed.length} removed`);
  return `omm(${projectName}): ${parts.join(', ')}`;
}

function cleanEmptyDirs(dir: string): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      cleanEmptyDirs(path.join(dir, entry.name));
    }
  }
  // Remove if empty
  try {
    const remaining = fs.readdirSync(dir);
    if (remaining.length === 0 && dir !== path.dirname(dir)) {
      fs.rmdirSync(dir);
    }
  } catch {}
}
