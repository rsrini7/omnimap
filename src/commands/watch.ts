import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const HELP = `
omm watch [dir] [options]

Watch for file changes and auto-run omm analyze.
Uses native fs.watch (no external dependencies).

Usage:
  omm watch                     Watch current directory
  omm watch src/                Watch specific directory
  omm watch --debounce 3000     Debounce in ms (default: 2000)
  omm watch --ignore "node_modules,.git,dist"
  omm watch --hook              Install as post-commit hook (alias for omm hooks install)
`;

function run(cmd: string, cwd: string): void {
  try {
    execSync(cmd, { cwd, stdio: 'inherit' });
  } catch {
    // non-zero exit from omm analyze is ok
  }
}

export async function commandWatch(args: string[]): Promise<void> {
  let dir = '.';
  let debounce = 2000;
  let ignore = 'node_modules,.git,dist,build,coverage,.next,.nuxt,__pycache__,.venv';
  let help = false;
  let asHook = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--debounce' && args[i + 1]) debounce = parseInt(args[++i], 10) || 2000;
    else if (args[i] === '--ignore' && args[i + 1]) ignore = args[++i];
    else if (args[i] === '--hook') asHook = true;
    else if (args[i] === '--help' || args[i] === '-h') help = true;
    else if (!args[i].startsWith('--')) dir = args[i];
  }

  if (help) {
    process.stdout.write(HELP.trim() + '\n');
    return;
  }

  if (asHook) {
    // Delegate to hooks install
    const { commandHooks } = await import('./hooks.js');
    commandHooks(['install']);
    return;
  }

  const absDir = path.resolve(dir);
  if (!fs.existsSync(absDir)) {
    process.stderr.write(`error: directory not found: ${absDir}\n`);
    process.exit(1);
  }

  const ignoredSet = new Set(ignore.split(',').map(s => s.trim()));
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;

  function triggerChange(filePath: string): void {
    if (running) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      running = true;
      const relPath = path.relative(absDir, filePath);
      process.stderr.write(`\n[${new Date().toLocaleTimeString()}] Changed: ${relPath}\n`);
      process.stderr.write(`Running omm analyze...\n`);
      run(`omm analyze --format md > /dev/null 2>&1`, absDir);
      process.stderr.write(`Done.\n`);
      running = false;
    }, debounce);
  }

  process.stderr.write(`Watching ${absDir} (debounce: ${debounce}ms)\n`);
  process.stderr.write(`Ignoring: ${ignore}\n`);
  process.stderr.write(`Press Ctrl+C to stop.\n\n`);

  // Recursive watcher using fs.watch
  const watchers: fs.FSWatcher[] = [];

  function watchDir(dirPath: string): void {
    try {
      const watcher = fs.watch(dirPath, { recursive: false }, (eventType, filename) => {
        if (!filename) return;
        const fullPath = path.join(dirPath, filename);
        const relPath = path.relative(absDir, fullPath);

        // Check ignore
        for (const ign of ignoredSet) {
          if (relPath.includes(ign)) return;
        }

        try {
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            watchDir(fullPath);
          } else if (stat.isFile()) {
            triggerChange(fullPath);
          }
        } catch {
          // file deleted, ignore
        }
      });
      watchers.push(watcher);

      // Watch existing subdirectories
      try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && !ignoredSet.has(entry.name)) {
            watchDir(path.join(dirPath, entry.name));
          }
        }
      } catch {
        // permission error, ignore
      }
    } catch {
      // can't watch this dir
    }
  }

  watchDir(absDir);

  // Keep alive
  process.on('SIGINT', () => {
    process.stderr.write('\nStopping watcher...\n');
    for (const w of watchers) w.close();
    process.exit(0);
  });

  // Keep process alive
  setInterval(() => {}, 60_000);
}
