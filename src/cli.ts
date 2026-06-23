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
import { commandFlows } from './commands/flows.js';
import { commandEval } from './commands/eval.js';
import { commandRefSyntax } from './commands/ref-syntax.js';
import { commandFeedback } from './commands/feedback.js';
import { commandDiagramRefs } from './commands/diagram-refs.js';
import { commandAnalyze } from './commands/analyze.js';
import { commandQuery } from './commands/query.js';
import { commandHooks } from './commands/hooks.js';
import { commandPr } from './commands/pr.js';
import { commandTour } from './commands/tour.js';
import { commandWiki } from './commands/wiki.js';
import { commandSearch } from './commands/search.js';
import { commandMerge } from './commands/merge.js';
import { commandSync } from './commands/sync.js';
import { commandAffected } from './commands/affected.js';
import { commandMcp } from './commands/mcp.js';
import { commandWatch } from './commands/watch.js';
import { commandWiki2Html } from './commands/wiki2html.js';
import { commandWiki2Pdf } from './commands/wiki2pdf.js';

const GLOBAL_COMMANDS = ['init', 'setup', 'update', 'list', 'show', 'delete', 'status', 'diff', 'refs', 'validate', 'view', 'push', 'pull', 'read', 'write', 'tree', 'config', 'incremental', 'export', 'tag', 'arch', 'share', 'org', 'flows', 'eval', 'ref-syntax', 'feedback', 'diagram-refs', 'analyze', 'query', 'hooks', 'pr', 'tour', 'wiki', 'search', 'merge', 'sync', 'affected', 'mcp', 'watch', 'wiki2html', 'wiki2pdf', 'help'];

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
  omm validate <path> --fix         Auto-fix fixable issues (writes back)
  omm validate --explain|--rules   Document validation rules
  omm view [--port <port>]         Start web viewer (default: 3000)
  omm incremental [--json|--mark|--record]  Plan or record incremental scan updates
  omm export <element> [--format svg|png|html] [-o file]  Export diagram
  omm tag <element> [add|remove|set|clear] [tags]  Manage element tags
  omm flows <element> [add|remove] [name]          Manage flow animations
  omm eval [--json|--explain|--suggest|--threshold <score>]  Evaluate documentation quality
  omm analyze [dir] [--format md|json] [--diagram] [--validate] [--impact <file>] [--extensions]  Structural code analysis via tree-sitter
  omm query <question> [--dir <path>] [--json]    Query dependency graph (no LLM)
  omm hooks [install|uninstall|status]             Manage git hooks for auto-analysis
  omm pr [number|branch] [--staged] [--diff <ref>] Show PR/module impact
  omm tour [dir] [--limit n]                       Guided tour (read in dependency order)
  omm wiki [--out dir]                              Generate crawlable markdown wiki
  omm wiki2html [--src dir] [--out dir]             Convert Markdown files/wiki to styled HTML site
  omm wiki2pdf [--src dir] [--out file.pdf]          Convert Markdown files/wiki to a single styled PDF
  omm search <query>                                Fuzzy search across elements
  omm merge <source> [--out dir]                    Merge another .omm/ into current
  omm sync [--search <query>]                       Sync .omm/ to SQLite for FTS5 search
  omm affected [files...] [--staged] [--diff ref]   Find test files impacted by changes
  omm mcp [--port <port>]                           Start MCP server for AI agents
  omm watch [dir] [--debounce ms]                   Auto-run omm analyze on file changes
  omm view [--port p] [--share]                     Open viewer (--share for network access)
  omm show <path> --type            Show element type (perspective/leaf/group)
  omm ref-syntax                    Document the @class-name convention
  omm diagram-refs <path> [--json]  List @refs in a diagram with pass/fail status
  omm feedback [--format md|json] [--include <msg>]  Generate feedback report in .omm/

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

  // omm help <cmd> — drill down to per-command help (must come before general help check)
  if (args[0] === 'help' && args[1]) {
    const cmd = args[1];
    if (!GLOBAL_COMMANDS.includes(cmd)) {
      process.stderr.write(`error: unknown command '${cmd}'. Run 'omm help' for the full list.\n`);
      process.exit(1);
    }
    const { execFileSync } = await import('node:child_process');
    try {
      execFileSync('omm', [cmd, '--help'], { stdio: 'inherit' });
    } catch {
      process.stderr.write(`\nNo per-command help available for '${cmd}'. Run 'omm ${cmd} --help' directly or 'omm help' for the full list.\n`);
    }
    return;
  }

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
      const portIdx = args.indexOf('--port');
      if (portIdx >= 0 && args[portIdx + 1]) {
        port = parseInt(args[portIdx + 1], 10);
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

    case 'flows':
      commandFlows(args.slice(1));
      return;

    case 'eval':
      commandEval(args.slice(1));
      return;

    case 'ref-syntax':
      commandRefSyntax();
      return;

    case 'feedback':
      commandFeedback(args.slice(1));
      return;

    case 'diagram-refs':
      commandDiagramRefs(args.slice(1));
      return;

    case 'analyze':
      await commandAnalyze(args.slice(1));
      return;

    case 'query':
      await commandQuery(args.slice(1));
      return;

    case 'hooks':
      commandHooks(args.slice(1));
      return;

    case 'pr':
      await commandPr(args.slice(1));
      return;

    case 'tour':
      await commandTour(args.slice(1));
      return;

    case 'wiki':
      commandWiki(args.slice(1));
      return;

    case 'wiki2html':
      await commandWiki2Html(args.slice(1));
      return;

    case 'wiki2pdf':
      await commandWiki2Pdf(args.slice(1));
      return;

    case 'search':
      commandSearch(args.slice(1));
      return;

    case 'merge':
      commandMerge(args.slice(1));
      return;

    case 'sync':
      await commandSync(args.slice(1));
      return;

    case 'affected':
      await commandAffected(args.slice(1));
      return;

    case 'mcp':
      await commandMcp(args.slice(1));
      return;

    case 'watch':
      await commandWatch(args.slice(1));
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
