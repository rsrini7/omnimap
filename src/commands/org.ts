/**
 * omm org — Manage architecture repositories (teams)
 *
 * Usage:
 *   omm org list                 List all configured arch repos
 *   omm org switch <name>        Switch to a different arch repo
 *   omm org add <name> <path> [--remote <url>]   Add a new arch repo
 *   omm org remove <name>        Remove an arch repo
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import YAML from 'yaml';
import { getArchRepo, setArchRepo, getArchRemote, setArchRemote } from '../lib/arch.js';

const GLOBAL_CONFIG_PATH = path.join(os.homedir(), '.omm', 'config.yaml');

interface OrgEntry {
  name: string;
  path: string;
  remote?: string;
}

function readOrgs(): OrgEntry[] {
  if (!fs.existsSync(GLOBAL_CONFIG_PATH)) return [];
  try {
    const config = YAML.parse(fs.readFileSync(GLOBAL_CONFIG_PATH, 'utf-8')) as Record<string, unknown>;
    return (config['orgs'] as OrgEntry[]) || [];
  } catch {
    return [];
  }
}

function writeOrgs(orgs: OrgEntry[]): void {
  let config: Record<string, unknown> = {};
  if (fs.existsSync(GLOBAL_CONFIG_PATH)) {
    try {
      config = YAML.parse(fs.readFileSync(GLOBAL_CONFIG_PATH, 'utf-8')) as Record<string, unknown> || {};
    } catch {}
  }
  config['orgs'] = orgs;
  fs.mkdirSync(path.dirname(GLOBAL_CONFIG_PATH), { recursive: true });
  fs.writeFileSync(GLOBAL_CONFIG_PATH, YAML.stringify(config), 'utf-8');
}

const HELP = `
omm org — Manage architecture repositories (teams).

Usage:
  omm org list                                List all configured arch repos
  omm org switch <name>                       Switch active arch repo
  omm org add <name> <path> [--remote <url>]  Register a new arch repo
  omm org edit <name> [--path <p>] [--remote <url>]  Edit an existing arch repo
  omm org remove <name>                       Remove an arch repo

Examples:
  omm org add team-alpha ~/arch/alpha --remote git@github.com:team/alpha.git
  omm org add team-beta ~/arch/beta
  omm org switch team-alpha
  omm org edit team-alpha --remote git@github.com:team/new-alpha.git
  omm org list
`;

export function commandOrg(args: string[]): void {
  const sub = args[0];

  if (!sub || sub === '--help' || sub === '-h') {
    process.stdout.write(HELP);
    return;
  }

  if (sub === 'list') {
    const orgs = readOrgs();
    const currentRepo = getArchRepo();

    if (orgs.length === 0) {
      // Show current config if no orgs defined
      if (currentRepo) {
        process.stdout.write('No named orgs configured. Current arch repo:\n');
        process.stdout.write(`  ${currentRepo}\n`);
        const remote = getArchRemote();
        if (remote) process.stdout.write(`  Remote: ${remote}\n`);
      } else {
        process.stdout.write('No architecture repositories configured.\n');
        process.stdout.write('  Run: omm org add <name> <path>\n');
      }
      return;
    }

    process.stdout.write('Architecture repositories:\n\n');
    for (const org of orgs) {
      const isActive = org.path === currentRepo;
      const marker = isActive ? '* ' : '  ';
      process.stdout.write(`${marker}${org.name.padEnd(20)} ${org.path}\n`);
      if (org.remote) process.stdout.write(`  ${''.padEnd(20)} remote: ${org.remote}\n`);
    }
    process.stdout.write('\n* = active. Use `omm org switch <name>` to change.\n');
    return;
  }

  if (sub === 'switch') {
    const name = args[1];
    if (!name) {
      process.stderr.write('error: omm org switch <name>\n');
      process.exit(1);
    }
    const orgs = readOrgs();
    const org = orgs.find(o => o.name === name);
    if (!org) {
      process.stderr.write(`error: org '${name}' not found.\n`);
      if (orgs.length > 0) process.stderr.write(`  Available: ${orgs.map(o => o.name).join(', ')}\n`);
      process.exit(1);
    }
    setArchRepo(org.path);
    if (org.remote) setArchRemote(org.remote);
    process.stderr.write(`Switched to: ${name} (${org.path})\n`);
    return;
  }

  if (sub === 'add') {
    const name = args[1];
    const repoPath = args[2];
    if (!name || !repoPath) {
      process.stderr.write('error: omm org add <name> <path> [--remote <url>]\n');
      process.exit(1);
    }
    const remoteIdx = args.indexOf('--remote');
    const remote = remoteIdx >= 0 ? args[remoteIdx + 1] : undefined;

    const orgs = readOrgs();
    const existing = orgs.findIndex(o => o.name === name);
    const entry: OrgEntry = { name, path: path.resolve(repoPath), remote };
    if (existing >= 0) {
      orgs[existing] = entry;
    } else {
      orgs.push(entry);
    }
    writeOrgs(orgs);
    process.stderr.write(`Added: ${name} → ${entry.path}${remote ? ` (${remote})` : ''}\n`);
    return;
  }

  if (sub === 'edit') {
    const name = args[1];
    if (!name) {
      process.stderr.write('error: omm org edit <name> [--path <p>] [--remote <url>]\n');
      process.exit(1);
    }
    const orgs = readOrgs();
    const org = orgs.find(o => o.name === name);
    if (!org) {
      process.stderr.write(`error: org '${name}' not found.\n`);
      if (orgs.length > 0) process.stderr.write(`  Available: ${orgs.map(o => o.name).join(', ')}\n`);
      process.exit(1);
    }
    const pathIdx = args.indexOf('--path');
    const remoteIdx = args.indexOf('--remote');
    if (pathIdx >= 0 && args[pathIdx + 1]) org.path = path.resolve(args[pathIdx + 1]);
    if (remoteIdx >= 0 && args[remoteIdx + 1]) org.remote = args[remoteIdx + 1];
    writeOrgs(orgs);
    process.stderr.write(`Updated: ${name} → ${org.path}${org.remote ? ` (${org.remote})` : ''}\n`);
    return;
  }

  if (sub === 'remove') {
    const name = args[1];
    if (!name) {
      process.stderr.write('error: omm org remove <name>\n');
      process.exit(1);
    }
    const orgs = readOrgs();
    const filtered = orgs.filter(o => o.name !== name);
    if (filtered.length === orgs.length) {
      process.stderr.write(`error: org '${name}' not found.\n`);
      process.exit(1);
    }
    writeOrgs(filtered);
    process.stderr.write(`Removed: ${name}\n`);
    return;
  }

  process.stderr.write(`error: unknown subcommand '${sub}'. Run 'omm org --help'.\n`);
  process.exit(1);
}
