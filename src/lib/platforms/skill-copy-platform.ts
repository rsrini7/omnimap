import fs from 'node:fs';
import path from 'node:path';
import type { Platform } from './types.js';
import { getSkillsSource, hasCommand } from './utils.js';

function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/** Compare source and target directories. Returns list of new/changed files. */
function diffDirSync(src: string, dest: string, prefix = ''): string[] {
  const changes: string[] = [];
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      if (!fs.existsSync(destPath)) {
        changes.push(`+ ${rel}/`);
      } else {
        changes.push(...diffDirSync(srcPath, destPath, rel));
      }
    } else {
      if (!fs.existsSync(destPath)) {
        changes.push(`+ ${rel}`);
      } else {
        const srcStat = fs.statSync(srcPath);
        const destStat = fs.statSync(destPath);
        if (srcStat.size !== destStat.size || srcStat.mtimeMs > destStat.mtimeMs) {
          changes.push(`~ ${rel}`);
        }
      }
    }
  }
  return changes;
}

/**
 * Create a Platform that installs skills by copying the skills/ directory
 * into a target directory under the user's home folder.
 */
export function skillCopyPlatform(id: string, name: string, commandName: string, skillsTarget: string): Platform {
  return {
    name,
    id,

    detect(): boolean {
      return hasCommand(commandName);
    },

    isSetup(): boolean {
      return fs.existsSync(skillsTarget);
    },

    /** Check if source skills differ from installed target. */
    needsUpdate(): { needed: boolean; changes: string[] } {
      const source = getSkillsSource();
      if (!source) return { needed: false, changes: [] };
      if (!fs.existsSync(skillsTarget)) return { needed: true, changes: ['(not installed)'] };
      const changes = diffDirSync(source, skillsTarget);
      return { needed: changes.length > 0, changes };
    },

    async setup(): Promise<void> {
      const source = getSkillsSource();
      if (!source) {
        process.stderr.write('  Could not locate skills directory.\n');
        return;
      }

      const isUpdate = fs.existsSync(skillsTarget);
      fs.mkdirSync(path.dirname(skillsTarget), { recursive: true });

      if (isUpdate) {
        fs.rmSync(skillsTarget, { recursive: true });
      }
      copyDirSync(source, skillsTarget);

      // List installed skill names
      const skillNames = fs.readdirSync(skillsTarget, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name);

      if (isUpdate) {
        process.stderr.write(`  Updated skills → ${skillsTarget}\n`);
      } else {
        process.stderr.write(`  Copied skills → ${skillsTarget}\n`);
      }
      process.stderr.write(`  Skills: ${skillNames.join(', ')}\n`);
    },

    teardown(): void {
      if (fs.existsSync(skillsTarget)) {
        fs.rmSync(skillsTarget, { recursive: true });
      }
    },
  };
}
