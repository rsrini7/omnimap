/**
 * omm arch — Architecture repository management
 *
 * Usage:
 *   omm arch init                         Initialize current dir as arch repo
 *   omm arch init ~/ws/my-mm-docs         Initialize specific dir as arch repo
 *   omm arch init --remote <url>          Initialize with git remote
 *   omm arch status                       Show arch repo status
 *   omm arch list                         List all projects in arch repo
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { getArchRepo, initArchRepo, listArchProjects, setArchRepo } from '../lib/arch.js';
import { getOmmDir } from '../lib/store.js';

interface GitResult {
  ok: boolean;
  output: string;
}

function git(cmd: string, cwd: string): GitResult {
  try {
    const output = execSync(`git ${cmd}`, { cwd, stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8' }).trim();
    return { ok: true, output };
  } catch {
    return { ok: false, output: '' };
  }
}

const HELP = `
omm arch — Manage the shared architecture repository.

Usage:
  omm arch init [path] [--remote <url>]   Initialize arch repo (with optional git remote)
  omm arch status                         Show arch repo status
  omm arch list                           List projects in arch repo

Examples:
  omm arch init ~/ws/my-mm-docs                    Create arch repo
  omm arch init ~/ws/my-mm-docs --remote git@github.com:team/arch.git
  omm arch status
`;

export function commandArch(args: string[]): void {
  const sub = args[0];

  if (!sub || sub === '--help' || sub === '-h') {
    process.stdout.write(HELP);
    return;
  }

  if (sub === 'init') {
    const repoPath = args[1] && !args[1].startsWith('--') ? args[1] : process.cwd();
    const remoteIdx = args.indexOf('--remote');
    const remoteUrl = remoteIdx >= 0 ? args[remoteIdx + 1] : undefined;

    const absPath = path.resolve(repoPath);
    fs.mkdirSync(absPath, { recursive: true });

    // Initialize as git repo if not already
    if (!fs.existsSync(path.join(absPath, '.git'))) {
      git('init -q', absPath);
      process.stderr.write(`Initialized git repo in ${absPath}\n`);
    }

    // Initialize .omm/ structure
    initArchRepo(absPath);

    // Add remote if specified
    if (remoteUrl) {
      const existing = git('remote get-url origin', absPath);
      if (existing.ok) {
        git(`remote set-url origin ${remoteUrl}`, absPath);
        process.stderr.write(`Updated remote: ${remoteUrl}\n`);
      } else {
        git(`remote add origin ${remoteUrl}`, absPath);
        process.stderr.write(`Added remote: ${remoteUrl}\n`);
      }
    }

    // Create .gitignore for arch repo
    const gitignore = path.join(absPath, '.gitignore');
    if (!fs.existsSync(gitignore)) {
      fs.writeFileSync(gitignore, '# omm architecture repository\n*.tmp\n.DS_Store\n', 'utf-8');
    }

    // Auto-configure current project to point to this arch repo
    const cwd = process.cwd();
    if (cwd !== absPath && fs.existsSync(getOmmDir(cwd))) {
      setArchRepo(absPath);
      process.stderr.write(`Configured current project → ${absPath}\n`);
    }

    // Initial commit
    git('add .omm/ .gitignore', absPath);
    const status = git('status --porcelain', absPath);
    if (status.output) {
      git('commit -q -m "init: architecture repository"', absPath);
      process.stderr.write('Created initial commit.\n');
    }

    process.stderr.write(`\nArchitecture repository ready at: ${absPath}\n`);
    if (remoteUrl) {
      process.stderr.write(`Remote: ${remoteUrl}\n`);
      process.stderr.write(`Run 'omm push --commit' to push docs to this repo.\n`);
    }
    return;
  }

  if (sub === 'status') {
    const archRepo = getArchRepo();
    if (!archRepo) {
      process.stderr.write('No architecture repository configured.\n');
      process.stderr.write('  Run: omm arch init <path>\n');
      return;
    }

    const absPath = path.resolve(archRepo);
    process.stderr.write(`Arch repo: ${absPath}\n`);

    // Git status
    const isGit = fs.existsSync(path.join(absPath, '.git'));
    if (isGit) {
      const branch = git('branch --show-current', absPath);
      const remote = git('remote get-url origin', absPath);
      const lastCommit = git('log --oneline -1', absPath);
      const behind = git('rev-list --count HEAD..@{u}', absPath);
      process.stderr.write(`Git: ${branch.output || 'detached'}${remote.ok ? ` → ${remote.output}` : ''}\n`);
      if (lastCommit.ok && lastCommit.output) process.stderr.write(`Last commit: ${lastCommit.output}\n`);
      if (behind.ok && behind.output && behind.output !== '0') process.stderr.write(`Behind remote by ${behind.output} commits.\n`);
    } else {
      process.stderr.write('Git: not initialized (run `omm arch init` to add version control)\n');
    }

    // Projects
    const projects = listArchProjects(absPath);
    process.stderr.write(`Projects: ${projects.length}\n`);
    for (const p of projects) {
      const projectDir = path.join(absPath, '.omm', p);
      const files = fs.readdirSync(projectDir, { withFileTypes: true });
      const fileCount = files.filter(f => f.isFile()).length;
      const dirCount = files.filter(f => f.isDirectory()).length;
      process.stderr.write(`  ${p} (${dirCount} elements, ${fileCount} files)\n`);
    }
    return;
  }

  if (sub === 'list') {
    const archRepo = getArchRepo();
    if (!archRepo) {
      process.stderr.write('No architecture repository configured.\n');
      return;
    }
    const projects = listArchProjects(path.resolve(archRepo));
    if (projects.length === 0) {
      process.stderr.write('No projects in arch repo.\n');
      return;
    }
    for (const p of projects) {
      process.stdout.write(`${p}\n`);
    }
    return;
  }

  process.stderr.write(`error: unknown subcommand '${sub}'. Run 'omm arch --help'.\n`);
  process.exit(1);
}
