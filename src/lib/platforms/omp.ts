import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Platform } from './types.js';
import { getSkillsSource, hasCommand } from './utils.js';

const SKILLS_TARGET = path.join(os.homedir(), '.omp', 'agent', 'skills', 'oh-my-mermaid');

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

export const omp: Platform = {
  name: 'Oh my Pi (omp)',
  id: 'omp',

  detect(): boolean {
    return hasCommand('omp');
  },

  isSetup(): boolean {
    return fs.existsSync(SKILLS_TARGET);
  },

  async setup(): Promise<void> {
    const source = getSkillsSource();
    if (!source) {
      process.stderr.write('  Could not locate skills directory.\n');
      return;
    }

    fs.mkdirSync(path.dirname(SKILLS_TARGET), { recursive: true });

    if (fs.existsSync(SKILLS_TARGET)) {
      fs.rmSync(SKILLS_TARGET, { recursive: true });
    }
    copyDirSync(source, SKILLS_TARGET);
    process.stderr.write(`  Copied skills → ${SKILLS_TARGET}\n`);
  },

  teardown(): void {
    if (fs.existsSync(SKILLS_TARGET)) {
      fs.rmSync(SKILLS_TARGET, { recursive: true });
    }
  },
};
