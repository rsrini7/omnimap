/**
 * omm links <element> — manage external documentation links.
 *
 * Links are stored in meta.yaml and represent references to external docs,
 * ADRs, wikis, READMEs, etc. Separate from diagram @refs which represent
 * architectural dependencies between elements.
 *
 * Usage:
 *   omm links <element>                    Show all links for element
 *   omm links <element> --add <url>        Add external link
 *   omm links <element> --remove <url>     Remove link
 *   omm links <element> --json             JSON output
 *   omm links <element> --type <type>      Link type: local, external, source (default: external)
 *   omm links <element> --label <text>     Human-readable label for the link
 */

import { ensureOmmForRead, classExists, addLink, removeLink, getLinks } from '../lib/store.js';
import type { LinkEntry } from '../types.js';

const HELP = `
omm links <element> [options]

Manage external documentation links for an element.
Links are stored in meta.yaml and represent references to external docs,
ADRs, wikis, READMEs, etc.

This is separate from \`omm refs\` which shows diagram @ref dependencies.

Usage:
  omm links <element>                    Show all links for element
  omm links <element> --add <url>        Add external link
  omm links <element> --remove <url>     Remove link by URL
  omm links <element> --json             JSON output
  omm links <element> --type <type>      Link type: local, external, source
  omm links <element> --label <text>     Human-readable label for the link

Link Types:
  local      File relative to project root (e.g., docs/adr-001.md)
  external   External URL (e.g., https://wiki.example.com/page)
  source     Source file in the codebase (e.g., src/auth/README.md)

Examples:
  omm links auth-service --add https://jwt.io/introduction --label "JWT Introduction"
  omm links auth-service --add docs/adr-001-auth.md --type local --label "ADR-001"
  omm links auth-service --remove https://jwt.io/introduction
  omm links auth-service
  omm links auth-service --json
`;

interface ParsedArgs {
  element: string | undefined;
  addUrl: string | undefined;
  removeUrl: string | undefined;
  linkType: LinkEntry['type'];
  label: string | undefined;
  json: boolean;
  help: boolean;
}

function parseArgs(args: string[]): ParsedArgs {
  const out: ParsedArgs = {
    element: undefined,
    addUrl: undefined,
    removeUrl: undefined,
    linkType: 'external',
    label: undefined,
    json: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--add' && args[i + 1]) out.addUrl = args[++i];
    else if (a === '--remove' && args[i + 1]) out.removeUrl = args[++i];
    else if (a === '--type' && args[i + 1]) {
      const t = args[++i];
      if (t === 'local' || t === 'external' || t === 'source') out.linkType = t;
      else {
        process.stderr.write(`warning: invalid link type '${t}', using 'external'\n`);
      }
    }
    else if (a === '--label' && args[i + 1]) out.label = args[++i];
    else if (a === '--json') out.json = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (!a.startsWith('--')) out.element = a;
  }

  return out;
}

function printLinks(element: string, json: boolean, cwd?: string): void {
  const links = getLinks(element, cwd);

  if (json) {
    process.stdout.write(JSON.stringify({ element, links }, null, 2) + '\n');
    return;
  }

  if (links.length === 0) {
    process.stdout.write(`No links for '${element}'.\n`);
    process.stdout.write(`Add one with: omm links ${element} --add <url>\n`);
    return;
  }

  process.stdout.write(`Links for ${element}:\n\n`);
  for (const link of links) {
    const label = link.label ? ` — ${link.label}` : '';
    const added = link.added ? ` (added ${link.added.slice(0, 10)})` : '';
    process.stdout.write(`  [${link.type}] ${link.url}${label}${added}\n`);
  }
}

function isValidUrl(url: string): boolean {
  // Allow http/https URLs and relative file paths
  if (url.startsWith('http://') || url.startsWith('https://')) return true;
  // Allow relative paths (no leading slash, no protocol)
  if (!url.startsWith('/') && !url.includes('://')) return true;
  return false;
}

export function commandLinks(args: string[], cwd?: string): void {
  if (!ensureOmmForRead(cwd)) return;

  const parsed = parseArgs(args);

  if (parsed.help) {
    process.stdout.write(HELP.trim() + '\n');
    return;
  }

  const element = parsed.element;
  if (!element) {
    process.stderr.write('error: element path required. Usage: omm links <element>\n');
    process.exit(1);
    return;
  }

  if (!classExists(element, cwd)) {
    process.stderr.write(`error: element '${element}' not found\n`);
    process.exit(1);
    return;
  }

  // Handle --add
  if (parsed.addUrl) {
    const url = parsed.addUrl;
    if (!isValidUrl(url)) {
      process.stderr.write(`error: invalid URL '${url}'. Use http(s):// or a relative path.\n`);
      process.exit(1);
      return;
    }

    // Auto-detect type if not explicitly set
    let linkType = parsed.linkType;
    if (parsed.linkType === 'external' && !url.startsWith('http')) {
      // User didn't explicitly set type, and URL is a local path
      linkType = 'local';
    }

    const link: LinkEntry = {
      url,
      type: linkType,
      label: parsed.label,
    };

    addLink(element, link, cwd);
    return;
  }

  // Handle --remove
  if (parsed.removeUrl) {
    const removed = removeLink(element, parsed.removeUrl, cwd);
    if (!removed) {
      process.stderr.write(`error: link not found: ${parsed.removeUrl}\n`);
      process.exit(1);
    }
    return;
  }

  // Default: show links
  printLinks(element, parsed.json, cwd);
}
