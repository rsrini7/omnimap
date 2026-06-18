import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Platform } from './types.js';
import { getPackageVersion, getSkillsSource, hasCommand } from './utils.js';

function run(cmd: string): { ok: boolean; out: string } {
  try {
    const out = execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
    return { ok: true, out };
  } catch {
    return { ok: false, out: '' };
  }
}

/** List omm skill directory names from the source skills directory. */
function getOmmSkillNames(): string[] {
  const src = getSkillsSource();
  if (!src) return [];
  try {
    return fs.readdirSync(src, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name);
  } catch {
    return [];
  }
}

function claudeSkillsDir(): string {
  return path.join(os.homedir(), '.claude', 'skills');
}

function copySkillsDirect(): boolean {
  const src = getSkillsSource();
  if (!src) return false;
  const dest = claudeSkillsDir();
  const skills = getOmmSkillNames();
  if (!skills.length) return false;
  try {
    fs.mkdirSync(dest, { recursive: true });
    for (const skill of skills) {
      const srcDir = path.join(src, skill);
      fs.cpSync(srcDir, path.join(dest, skill), { recursive: true });
    }
    return true;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`  Warning: failed to copy skills: ${msg}\n`);
    return false;
  }
}

function removeSkillsDirect(): void {
  const dest = claudeSkillsDir();
  if (!fs.existsSync(dest)) return;
  const skills = getOmmSkillNames();
  for (const skill of skills) {
    const skillDir = path.join(dest, skill);
    if (fs.existsSync(skillDir)) {
      fs.rmSync(skillDir, { recursive: true, force: true });
    }
  }
}

function isInstalledDirect(): boolean {
  const dest = claudeSkillsDir();
  if (!fs.existsSync(dest)) return false;
  const skills = getOmmSkillNames();
  return skills.some(skill => fs.existsSync(path.join(dest, skill)));
}

/** Extract installed plugin version from `claude plugin list` output */
function getInstalledVersion(): string | null {
  const { ok, out } = run('claude plugin list 2>&1');
  if (!ok) return null;
  // Match "Version: X.Y.Z" line after oh-my-mermaid
  const lines = out.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('oh-my-mermaid') && !lines[i].includes('oh-my-claudecode')) {
      // Look for Version line in next few lines
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        const m = lines[j].match(/Version:\s*([\d.]+)/);
        if (m) return m[1];
      }
    }
  }
  return null;
}

export const claude: Platform = {
  name: 'Claude Code',
  id: 'claude',

  detect(): boolean {
    return hasCommand('claude');
  },

  isSetup(): boolean {
    const installed = getInstalledVersion();
    if (installed) {
      const current = getPackageVersion();
      return !current || installed === current;
    }
    return isInstalledDirect();
  },

  async setup(): Promise<void> {
    const installed = getInstalledVersion();

    // Uninstall old version first if present
    if (installed) {
      const current = getPackageVersion();
      process.stderr.write(`  Updating ${installed} -> ${current}...\n`);
      run('claude plugin uninstall oh-my-mermaid 2>&1');
    }

    // Add marketplace (may already exist - ignore error)
    run('claude plugin marketplace add oh-my-mermaid/oh-my-mermaid');

    const { ok, out } = run('claude plugin install oh-my-mermaid 2>&1');
    if (ok) {
      process.stderr.write(`  ${out}\n`);
      return;
    }

    // Fallback: copy skills directly to ~/.claude/skills/
    process.stderr.write(`  Plugin marketplace unavailable, installing skills directly...\n`);
    const copied = copySkillsDirect();
    if (copied) {
      process.stderr.write(`  Skills installed to ~/.claude/skills/\n`);
    } else {
      process.stderr.write(`  Could not auto-install plugin. Run manually:\n`);
      process.stderr.write(`    claude plugin marketplace add oh-my-mermaid/oh-my-mermaid\n`);
      process.stderr.write(`    claude plugin install oh-my-mermaid\n`);
    }
  },

  teardown(): void {
    run('claude plugin uninstall oh-my-mermaid 2>&1');
    run('claude plugin marketplace remove oh-my-mermaid 2>&1');
    removeSkillsDirect();
  },
};
