import path from 'node:path';
import fs from 'node:fs';
import { getOmmDir } from '../lib/store.js';

const HELP = `
omm merge <source> [--out <dir>]

Merge another .omm/ directory into the current one.
Useful for combining architecture docs from multiple projects.

Usage:
  omm merge ../other-project/.omm          Merge into current .omm/
  omm merge ../proj/.omm --out merged/     Merge into custom output
  omm merge --list                          List all merge sources

The merge:
- Copies all perspectives from source that don't exist in target
- For matching perspectives, copies child elements that are missing
- Does NOT overwrite existing elements (target wins on conflicts)
`;

export function commandMerge(args: string[]): void {
  let source = '';
  let outDir = '';
  let listOnly = false;
  let help = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out' && args[i + 1]) outDir = args[++i];
    else if (args[i] === '--list') listOnly = true;
    else if (args[i] === '--help' || args[i] === '-h') help = true;
    else if (!args[i].startsWith('--')) source = args[i];
  }

  const targetDir = outDir || getOmmDir();
  if (!targetDir) {
    process.stderr.write('error: .omm/ not found. Run `omm init` first.\n');
    process.exit(1);
  }

  if (help) {
    process.stdout.write(HELP.trim() + '\n');
    return;
  }

  if (listOnly) {
    const mergeFile = path.join(targetDir, '.merge-sources');
    if (fs.existsSync(mergeFile)) {
      process.stdout.write(fs.readFileSync(mergeFile, 'utf-8'));
    } else {
      process.stdout.write('No merge sources recorded.\n');
    }
    return;
  }

  if (!source) {
    process.stderr.write('error: specify source .omm/ directory\n');
    process.exit(1);
  }

  const absSource = path.resolve(source);
  if (!fs.existsSync(absSource)) {
    process.stderr.write(`error: source not found: ${absSource}\n`);
    process.exit(1);
  }

  // Ensure target exists
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

  let copied = 0;
  let skipped = 0;

  function mergeElements(srcDir: string, destDir: string, elemPath: string): void {
    if (!fs.existsSync(destDir)) {
      fs.cpSync(srcDir, destDir, { recursive: true });
      copied++;
      process.stdout.write(`  + ${elemPath} (new element)\n`);
      return;
    }

    const files = fs.readdirSync(srcDir, { withFileTypes: true });
    let hasNewFields = false;
    for (const f of files) {
      if (f.isFile() && !f.name.startsWith('.')) {
        const srcFile = path.join(srcDir, f.name);
        const destFile = path.join(destDir, f.name);
        if (!fs.existsSync(destFile)) {
          fs.copyFileSync(srcFile, destFile);
          hasNewFields = true;
        } else {
          skipped++;
        }
      }
    }
    if (hasNewFields) {
      copied++;
      process.stdout.write(`  + ${elemPath} (merged fields)\n`);
    }

    for (const f of files) {
      if (f.isDirectory() && !f.name.startsWith('.')) {
        mergeElements(path.join(srcDir, f.name), path.join(destDir, f.name), `${elemPath}/${f.name}`);
      }
    }
  }

  // Walk source directories
  const entries = fs.readdirSync(absSource, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    mergeElements(path.join(absSource, entry.name), path.join(targetDir, entry.name), entry.name);
  }

  // Record merge source
  const mergeFile = path.join(targetDir, '.merge-sources');
  const entry = `${new Date().toISOString()}  ${absSource}\n`;
  fs.appendFileSync(mergeFile, entry, 'utf-8');

  process.stdout.write(`\nMerged: ${copied} element(s) copied, ${skipped} skipped (already exist).\n`);
}
