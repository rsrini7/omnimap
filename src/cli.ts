#!/usr/bin/env node

import { commandInit } from './commands/init.js';
import { commandClassField } from './commands/class-field.js';
import { commandList } from './commands/list.js';
import { commandShow } from './commands/show.js';
import { commandDelete } from './commands/delete.js';
import { commandStatus } from './commands/status.js';
import { commandDiff } from './commands/diff.js';
import { commandRefs } from './commands/refs.js';
import { commandView } from './commands/view.js';
import { commandPush } from './commands/push.js';
import { commandPull } from './commands/pull.js';
import { commandSetup } from './commands/setup.js';
import { commandUpdate } from './commands/update.js';
import { commandValidate } from './commands/validate.js';
import { commandTree } from './commands/tree.js';
import { commandRead, commandWrite } from './commands/read-write.js';
import { commandConfig } from './commands/config.js';
import { commandIncremental } from './commands/incremental.js';
import { commandExport } from './commands/export.js';
import { commandTag } from './commands/tag.js';
import { commandArch } from './commands/arch.js';
import { commandShare } from './commands/share.js';
import { commandOrg } from './commands/org.js';

const GLOBAL_COMMANDS = ['init', 'setup', 'update', 'list', 'show', 'delete', 'status', 'diff', 'refs', 'validate', 'view', 'push', 'pull', 'read', 'write', 'tree', 'config', 'incremental', 'export', 'tag', 'arch', 'share', 'org', 'help'];

function printHelp(): void {
  const help = `
oh-my-mermaid (omm) — Architecture mirror for vibe coding

Usage:
  omm init [--template <name>]      Initialize .omm/ directory or scaffold from template
  omm setup [platform]              Register skills with AI coding tools
  omm setup --list                  Show detected platforms
  omm setup --teardown              Unregister from all platforms
  omm update                        Update CLI + plugins to latest version
  omm list                          List perspectives
  omm tree <path>                   Show element tree
  omm read <path> <field>           Read a field (stdout)
  omm write <path> <field> <text|-> Write a field
  omm show <path>                   Show all fields for an element
  omm delete <path>                 Delete an element
  omm status                        Show overview of all elements
  omm diff <path>                   Compare current vs previous diagram
  omm refs <path>                   Show elements that reference this element
  omm validate [path]               Validate diagram(s) for syntax and conventions
  omm validate --changed [--json]   Validate only changed elements (for CI)
  omm view [--port <port>]         Start web viewer (default: 3000)
  omm incremental [--json|--mark|--record]  Plan or record incremental scan updates
  omm export <element> [--format svg|png] [-o file]  Export diagram as SVG or PNG
  omm tag <element> [add|remove|set] [tags]         Manage element tags

Architecture Repository:
  omm push [--to repo] [--commit] [--commit-push]  Push .omm/ to architecture repository
  omm pull [--from repo] [--all]     Pull .omm/ from architecture repository
  omm arch init [--remote <url>]     Initialize architecture repository with git
  omm share                          Print the arch repo URL (GitHub/GitLab)
  omm org list                       List configured architecture repositories
  omm org switch <name>              Switch active architecture repository

Paths: use / for nested elements (e.g. overall-architecture/main-process)
Fields: description, diagram, constraint, concern, context, todo, note
`;
  process.stdout.write(help.trim() + '\n');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
    printHelp();
    return;
  }

  if (args[0] === '--version' || args[0] === '-v' || args[0] === 'version') {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const pkg = require('../package.json');
    process.stdout.write(`omm ${pkg.version}\n`);
    return;
  }

  const cmd = args[0];

  switch (cmd) {
    case 'init':
      await commandInit(args.slice(1));
      return;

    case 'setup':
      await commandSetup(args.slice(1));
      return;

    case 'update':
      await commandUpdate();
      return;

    case 'list':
      commandList(args.slice(1));
      return;

    case 'tree':
      commandTree(args[1]);
      return;

    case 'config':
      commandConfig(args.slice(1));
      return;

    case 'read':
      commandRead(args[1], args[2]);
      return;

    case 'write':
      await commandWrite(args[1], args[2], args.slice(3));
      return;

    case 'show':
      if (!args[1]) {
        process.stderr.write('error: omm show <path>\n');
        process.exit(1);
      }
      await commandShow(args[1], args.slice(2));
      return;

    case 'delete':
      if (!args[1]) {
        process.stderr.write('error: omm delete <path>\n');
        process.exit(1);
      }
      commandDelete(args[1]);
      return;

    case 'status':
      commandStatus();
      return;

    case 'diff':
      if (!args[1]) {
        process.stderr.write('error: omm diff <class>\n');
        process.exit(1);
      }
      commandDiff(args[1]);
      return;

    case 'validate': {
      const valArgs = args.slice(1);
      const valFlags = valArgs.filter(a => a.startsWith('--'));
      const valClass = valArgs.find(a => !a.startsWith('--'));
      commandValidate(valClass, valFlags);
      return;
    }

    case 'refs': {
      let reverse = false;
      let className = args[1];
      if (args[1] === '--reverse') {
        reverse = true;
        className = args[2];
      }
      if (!className) {
        process.stderr.write('error: omm refs [--reverse] <class>\n');
        process.exit(1);
      }
      commandRefs(className, reverse);
      return;
    }

    case 'view': {
      let port = 3000;
      if (args[1] === '--port' && args[2]) {
        port = parseInt(args[2], 10);
        if (isNaN(port)) {
          process.stderr.write('error: invalid port number\n');
          process.exit(1);
        }
      }
      commandView(port, args.slice(1));
      return;
    }

    case 'push':
      await commandPush(args.slice(1));
      return;

    case 'pull':
      commandPull(args.slice(1));
      return;

    case 'incremental':
      await commandIncremental(args.slice(1));
      return;

    case 'export':
      await commandExport(args.slice(1));
      return;

    case 'tag':
      commandTag(args.slice(1));
      return;

    case 'arch':
      commandArch(args.slice(1));
      return;

    case 'share':
      commandShare();
      return;

    case 'org':
      commandOrg(args.slice(1));
      return;

    default:
      // Legacy alias: omm <path> <field> [content] → read/write
      if (args.length >= 2 && !GLOBAL_COMMANDS.includes(cmd)) {
        const targetPath = cmd;
        const field = args[1];
        if (args.length >= 3) {
          await commandWrite(targetPath, field, args.slice(2));
        } else {
          commandRead(targetPath, field);
        }
        return;
      }

      process.stderr.write(`error: unknown command '${cmd}'. Run 'omm help' for usage.\n`);
      process.exit(1);
  }
}

main().catch(err => {
  process.stderr.write(`error: ${err.message}\n`);
  process.exit(1);
});
