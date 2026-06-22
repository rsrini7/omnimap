import { getOmmDir } from '../lib/store.js';
import { syncToSqlite, isSqliteAvailable, searchElements, closeDb } from '../lib/storage/sqlite.js';

const HELP = `
omm sync [--search <query>]

Sync .omm/ flat files to SQLite database for full-text search.
Requires better-sqlite3: npm install -g oh-my-mermaid (or install better-sqlite3 separately)

Usage:
  omm sync                    Sync all elements to SQLite
  omm sync --search <query>   Full-text search via SQLite FTS5
  omm sync --status           Check if SQLite is available
`;

export async function commandSync(args: string[]): Promise<void> {
  const ommDir = getOmmDir();
  if (!ommDir) {
    process.stderr.write('error: .omm/ not found. Run `omm init` first.\n');
    process.exit(1);
  }

  let search = '';
  let statusOnly = false;
  let help = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--search' && args[i + 1]) search = args[++i];
    else if (args[i] === '--status') statusOnly = true;
    else if (args[i] === '--help' || args[i] === '-h') help = true;
  }

  if (help) {
    process.stdout.write(HELP.trim() + '\n');
    return;
  }

  if (statusOnly) {
    const available = await isSqliteAvailable();
    process.stdout.write(`SQLite: ${available ? 'available' : 'not available (install better-sqlite3)'}\n`);
    return;
  }

  if (search) {
    const results = await searchElements(search);
    if (results.length === 0) {
      process.stdout.write(`No results for "${search}".\n`);
    } else {
      process.stdout.write(`FTS5 results for "${search}":\n\n`);
      for (const r of results) {
        process.stdout.write(`  ${r.path}\n`);
        if (r.snippet) process.stdout.write(`    ${r.snippet}\n`);
      }
      process.stdout.write('\n');
    }
    closeDb();
    return;
  }

  // Sync
  process.stderr.write('Syncing .omm/ to SQLite...\n');
  await syncToSqlite();
  closeDb();
  process.stdout.write('Sync complete.\n');
}
