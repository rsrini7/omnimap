import path from 'node:path';
import fs from 'node:fs';
import { analyzeDirectory } from '../lib/analyzer/index.js';
import { generateTour, formatTour } from '../lib/analyzer/insights.js';

// Import language handlers
import '../lib/analyzer/languages/javascript.js';
import '../lib/analyzer/languages/typescript.js';
import '../lib/analyzer/languages/java.js';
import '../lib/analyzer/languages/kotlin.js';
import '../lib/analyzer/languages/scala.js';
import '../lib/analyzer/languages/python.js';
import '../lib/analyzer/languages/go.js';
import '../lib/analyzer/languages/rust.js';

const HELP = `
omm tour [dir] [options]

Generate a guided tour: read files in dependency order to understand the codebase.

Usage:
  omm tour                    Generate tour for current directory
  omm tour src/               Tour specific directory
  omm tour --limit <n>        Limit to top N files
  omm tour --json             Output as JSON

The tour uses topological sort of the dependency graph:
- Start from entry points (files with no incoming dependencies)
- Walk outward through the dependency chain
- Files in cycles are listed at the end
`;

export async function commandTour(args: string[]): Promise<void> {
  let dir = '.';
  let limit = 50;
  let json = false;
  let help = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) limit = parseInt(args[++i], 10) || 50;
    else if (args[i] === '--json') json = true;
    else if (args[i] === '--help' || args[i] === '-h') help = true;
    else if (!args[i].startsWith('--')) dir = args[i];
  }

  if (help) {
    process.stdout.write(HELP.trim() + '\n');
    return;
  }

  const absDir = path.resolve(dir);
  if (!fs.existsSync(absDir)) {
    process.stderr.write(`error: directory not found: ${absDir}\n`);
    process.exit(1);
  }

  process.stderr.write(`Analyzing ${absDir}...\n`);
  const result = await analyzeDirectory(absDir);
  const tour = generateTour(result.graph).slice(0, limit);

  if (json) {
    process.stdout.write(JSON.stringify(tour, null, 2) + '\n');
  } else {
    process.stdout.write(formatTour(tour));
  }
}
