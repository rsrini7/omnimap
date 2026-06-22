import { getOmmDir, listClasses, listNodes, readField, readNodeField } from '../lib/store.js';
import { fuzzySearch, type SearchResult } from '../lib/analyzer/insights.js';

const HELP = `
omm search <query>

Fuzzy search across element names, descriptions, and paths.

Usage:
  omm search auth                Search for "auth" in all elements
  omm search "payment flow"      Search for phrase
  omm search --limit 5 session   Limit results
  omm search --json              Output as JSON
`;

export function commandSearch(args: string[]): void {
  let query = '';
  let limit = 20;
  let json = false;
  let help = false;

  const parts: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) limit = parseInt(args[++i], 10) || 20;
    else if (args[i] === '--json') json = true;
    else if (args[i] === '--help' || args[i] === '-h') help = true;
    else if (!args[i].startsWith('--')) parts.push(args[i]);
  }
  query = parts.join(' ');

  if (help || !query) {
    process.stdout.write(HELP.trim() + '\n');
    return;
  }

  const ommDir = getOmmDir();
  if (!ommDir) {
    process.stderr.write('error: .omm/ not found. Run `omm init` first.\n');
    process.exit(1);
  }

  const perspectives = listClasses();
  const elements: { path: string; description?: string }[] = [];

  function collectAllElements(perspective: string, nodePath: string[] = []): void {
    const children = listNodes(perspective, nodePath);
    for (const child of children) {
      const currentPath = [...nodePath, child];
      const childDesc = readNodeField(perspective, currentPath, 'description') || undefined;
      elements.push({ path: [perspective, ...currentPath].join('/'), description: childDesc });
      collectAllElements(perspective, currentPath);
    }
  }

  for (const persp of perspectives) {
    const desc = readField(persp, 'description') || undefined;
    elements.push({ path: persp, description: desc });
    collectAllElements(persp, []);
  }

  const results = fuzzySearch(query, elements, limit);

  if (json) {
    process.stdout.write(JSON.stringify(results, null, 2) + '\n');
  } else {
    if (results.length === 0) {
      process.stdout.write(`No results for "${query}".\n`);
      return;
    }
    process.stdout.write(`Search results for "${query}":\n\n`);
    for (const r of results) {
      const score = `${r.score}`.padStart(3);
      const tag = r.matchType === 'description' && r.snippet ? `\n    ${r.snippet}` : '';
      process.stdout.write(`  [${score}] ${r.element}${tag}\n`);
    }
    process.stdout.write('\n');
  }
}
