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

    async setup(): Promise<void> {
      const source = getSkillsSource();
      if (!source) {
        process.stderr.write('  Could not locate skills directory.\n');
        return;
      }

      fs.mkdirSync(path.dirname(skillsTarget), { recursive: true });

      if (fs.existsSync(skillsTarget)) {
        fs.rmSync(skillsTarget, { recursive: true });
      }
      copyDirSync(source, skillsTarget);
      process.stderr.write(`  Copied skills → ${skillsTarget}\n`);
    },

    teardown(): void {
      if (fs.existsSync(skillsTarget)) {
        fs.rmSync(skillsTarget, { recursive: true });
      }
    },
  };
}
