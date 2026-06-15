/**
 * omm share — Print the shareable URL for the architecture repository
 *
 * Usage:
 *   omm share                  Print the GitHub/GitLab URL for the arch repo
 *   omm share --open           Open in browser
 */

import { getArchRepo, getArchRemote } from '../lib/arch.js';
import { listProjects } from '../lib/store.js';
import { execSync } from 'node:child_process';

function git(cmd: string, cwd: string): string {
  try {
    return execSync(`git ${cmd}`, { cwd, stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8' }).trim();
  } catch {
    return '';
  }
}

/** Convert git SSH URL to HTTPS for browser viewing. */
function toHttps(url: string): string {
  // git@github.com:user/repo.git → https://github.com/user/repo
  const sshMatch = url.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
  if (sshMatch) return `https://${sshMatch[1]}/${sshMatch[2]}`;
  // https://github.com/user/repo.git → https://github.com/user/repo
  return url.replace(/\.git$/, '');
}

export function commandShare(): void {
  const archRepo = getArchRepo();
  if (!archRepo) {
    process.stderr.write('error: no architecture repository configured.\n');
    process.stderr.write('  Run: omm config arch-repo <path>\n');
    process.exit(1);
  }

  const remote = getArchRemote();
  const isRepo = !!remote || !!git('remote get-url origin', archRepo);

  if (!isRepo) {
    process.stderr.write('Architecture repository has no remote configured.\n');
    process.stderr.write(`  Local path: ${archRepo}\n`);
    process.stderr.write('  Run: omm config arch-remote <git-url>\n');
    return;
  }

  const remoteUrl = remote || git('remote get-url origin', archRepo);
  const httpsUrl = toHttps(remoteUrl);
  const branch = git('branch --show-current', archRepo) || 'main';
  const projects = listProjects(archRepo);

  process.stdout.write(`Architecture Repository\n`);
  process.stdout.write(`  Remote:   ${remoteUrl}\n`);
  process.stdout.write(`  Branch:   ${branch}\n`);
  process.stdout.write(`  Projects: ${projects.length} (${projects.join(', ')})\n`);
  process.stdout.write(`\n`);
  process.stdout.write(`  View online: ${httpsUrl}\n`);
  process.stdout.write(`  Tree:        ${httpsUrl}/tree/${branch}\n`);
}
