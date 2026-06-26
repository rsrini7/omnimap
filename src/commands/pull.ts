/**
 * omm pull — Sync from architecture repository to local .omm/.
 *
 * Usage:
 *   omm pull                          Pull from configured arch repo
 *   omm pull --from ~/arch/team-repo  Pull from specific repo
 *   omm pull --project <name>         Pull specific project (default: current dir name)
 *   omm pull --all                    Pull all projects from arch repo
 *   omm pull --dry-run                Show what would change
 *   omm pull --json                   JSON output
 */

import fs from 'node:fs';
import path from 'node:path';
import { ensureOmmForWrite, getOmmDir } from '../lib/store.js';
import {
  getArchRepo, getProjectName, getArchTarget,
  walkDir, copyFiles, diffDirs, listArchProjects,
} from '../lib/arch.js';

interface PullOptions {
  from?: string;
  project?: string;
  all: boolean;
  dryRun: boolean;
  json: boolean;
}

function parseArgs(args: string[]): PullOptions {
  const opts: PullOptions = { all: false, dryRun: false, json: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--from' && args[i + 1]) opts.from = args[++i];
    else if (a === '--project' && args[i + 1]) opts.project = args[++i];
    else if (a === '--all') opts.all = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--json') opts.json = true;
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
omm pull — Sync architecture docs from the shared repository.

Usage:
  omm pull                              Pull current project from arch repo
  omm pull --from ~/arch/team-repo      Pull from specific repo
  omm pull --project other-project      Pull a different project's docs
  omm pull --all                        Pull all projects from arch repo
  omm pull --dry-run                    Show what would change

Examples:
  omm pull                              Pull this project's docs
  omm pull --project auth-service       Pull another project's docs
  omm pull --all                        Pull everything
`;

export function commandPull(args: string[]): void {
  ensureOmmForWrite();

  const opts = parseArgs(args);
  const cwd = process.cwd();

  let archRepo = opts.from || getArchRepo(cwd);
  if (!archRepo) {
    process.stderr.write('error: no architecture repository configured.\n');
    process.stderr.write('  Run: omm pull --from <path-to-arch-repo>\n');
    process.stderr.write('  Or:  omm config arch-repo <path>\n');
    process.exit(1);
  }

  archRepo = path.resolve(archRepo);

  if (!fs.existsSync(archRepo)) {
    process.stderr.write(`error: arch repo not found: ${archRepo}\n`);
    process.exit(1);
  }

  // Pull all projects
  if (opts.all) {
    const projects = listArchProjects(archRepo);
    if (projects.length === 0) {
      process.stderr.write('No projects found in arch repo.\n');
      return;
    }

    let totalPulled = 0;
    for (const project of projects) {
      const archTarget = getArchTarget(archRepo, project);
      const localOmm = path.join(cwd, '.omm'); // Not nested — flat pull

      if (opts.dryRun) {
        const sourceFiles = walkDir(archTarget);
        process.stderr.write(`  ${project}: ${sourceFiles.length} files\n`);
        continue;
      }

      const sourceFiles = walkDir(archTarget);
      if (sourceFiles.length > 0) {
        // Pull into .omm/ under project subdirectory
        const projectTarget = path.join(localOmm, project);
        fs.mkdirSync(projectTarget, { recursive: true });
        copyFiles(archTarget, projectTarget, sourceFiles);
        totalPulled += sourceFiles.length;
      }
    }

    if (!opts.dryRun) {
      process.stderr.write(`Pulled ${totalPulled} files from ${projects.length} projects.\n`);
    }
    return;
  }

  // Pull single project
  const projectName = opts.project || getProjectName(cwd);
  const archTarget = getArchTarget(archRepo, projectName);

  if (!fs.existsSync(archTarget)) {
    process.stderr.write(`error: project '${projectName}' not found in arch repo.\n`);
    const projects = listArchProjects(archRepo);
    if (projects.length > 0) {
      process.stderr.write(`  Available: ${projects.join(', ')}\n`);
    }
    process.exit(1);
  }

  const ommDir = getOmmDir(cwd);
  const sourceFiles = walkDir(archTarget);
  const diff = diffDirs(archTarget, ommDir);

  if (opts.json) {
    process.stdout.write(JSON.stringify({
      arch_repo: archRepo,
      project: projectName,
      source: archTarget,
      target: ommDir,
      files: sourceFiles.length,
      added: diff.added.length,
      modified: diff.modified.length,
      removed: diff.removed.length,
    }, null, 2) + '\n');
    if (opts.dryRun) return;
  }

  const total = diff.added.length + diff.modified.length + diff.removed.length;
  if (total === 0) {
    process.stderr.write(`Already up to date. (${sourceFiles.length} files, no changes)\n`);
    return;
  }

  if (opts.dryRun) {
    process.stderr.write(`Would pull ${sourceFiles.length} files ← ${archTarget}\n\n`);
    if (diff.added.length) {
      process.stderr.write(`  New (${diff.added.length}):\n`);
      diff.added.slice(0, 15).forEach(f => process.stderr.write(`    + ${f}\n`));
      if (diff.added.length > 15) process.stderr.write(`    ... +${diff.added.length - 15} more\n`);
    }
    if (diff.modified.length) {
      process.stderr.write(`  Updated (${diff.modified.length}):\n`);
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

  // Execute pull
  fs.mkdirSync(ommDir, { recursive: true });

  // Remove files that no longer exist in arch repo
  for (const f of diff.removed) {
    const target = path.join(ommDir, f);
    if (fs.existsSync(target)) fs.unlinkSync(target);
  }

  const copied = copyFiles(archTarget, ommDir, sourceFiles);

  process.stderr.write(`Pulled ${copied} files ← ${archTarget}\n`);
  process.stderr.write(`  ${diff.added.length} new, ${diff.modified.length} updated, ${diff.removed.length} removed\n`);
}
