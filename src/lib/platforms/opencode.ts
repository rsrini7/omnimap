import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Platform } from './types.js';
import { getSkillsSource, hasCommand } from './utils.js';

const CONFIG_PATH = path.join(os.homedir(), '.config', 'opencode', 'opencode.json');

function readConfig(): Record<string, unknown> | null {
  if (!fs.existsSync(CONFIG_PATH)) return null;
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    // opencode config may have trailing commas (JSONC). This naive stripper
    // works for the common case but will misparse commas inside string values
    // that contain `}` or `]` (e.g. `{"k": "v,]"}`). Acceptable here because
    // opencode configs are simple key-value structures, not free-form JSON.
    const cleaned = raw
      .replace(/,\s*(?=\})/g, '')
      .replace(/,\s*(?=\])/g, '');
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function writeConfig(config: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
}

function getSkillsPaths(config: Record<string, unknown>): string[] {
  const skills = config.skills as Record<string, unknown> | undefined;
  if (!skills || !Array.isArray(skills.paths)) return [];
  return (skills.paths as unknown[]).filter((p): p is string => typeof p === 'string');
}

function setSkillsPaths(config: Record<string, unknown>, paths: string[]): void {
  const skills = (config.skills as Record<string, unknown>) ?? {};
  skills.paths = paths;
  config.skills = skills;
}

export const opencode: Platform = {
  name: 'OpenCode',
  id: 'opencode',

  detect(): boolean {
    return hasCommand('opencode');
  },

  isSetup(): boolean {
    const config = readConfig();
    if (!config) return false;
    const source = getSkillsSource();
    if (!source) return false;
    return getSkillsPaths(config).includes(source);
  },

  /**
   * Opencode reads skills dynamically from the configured path, so
   * there's no separate "copy" to update. We just verify the path
   * is still in the config and the source directory exists.
   */
  needsUpdate(): { needed: boolean; changes: string[] } {
    const source = getSkillsSource();
    if (!source) return { needed: true, changes: ['(source not found)'] };
    if (!fs.existsSync(source)) return { needed: true, changes: [`(source missing: ${source})`] };
    // Check that the path is registered in opencode config
    const config = readConfig();
    if (!config) return { needed: true, changes: ['(config missing)'] };
    if (!getSkillsPaths(config).includes(source)) {
      return { needed: true, changes: ['(path not in config)'] };
    }
    return { needed: false, changes: [] };
  },

  async setup(): Promise<void> {
    const source = getSkillsSource();
    if (!source) {
      process.stderr.write('  Could not locate skills directory.\n');
      return;
    }

    let config = readConfig();
    if (!config) {
      if (fs.existsSync(CONFIG_PATH)) {
        process.stderr.write(`  Could not parse existing config at ${CONFIG_PATH}. Please back it up, remove it, and retry.\n`);
        return;
      }
      // Create minimal config
      config = { $schema: 'https://opencode.ai/config.json' };
    }

    const paths = getSkillsPaths(config);
    if (!paths.includes(source)) {
      paths.push(source);
      setSkillsPaths(config, paths);
      writeConfig(config);
      process.stderr.write(`  Added skills path → ${CONFIG_PATH}\n`);
    } else {
      process.stderr.write(`  Skills path already registered.\n`);
    }
  },

  teardown(): void {
    const config = readConfig();
    if (!config) {
      if (fs.existsSync(CONFIG_PATH)) {
        process.stderr.write(`  Could not parse existing config at ${CONFIG_PATH}. Skipping teardown.\n`);
      }
      return;
    }

    const source = getSkillsSource();
    if (!source) return;

    const paths = getSkillsPaths(config);
    const filtered = paths.filter(p => p !== source);
    if (filtered.length !== paths.length) {
      if (filtered.length === 0) {
        // Remove empty skills section entirely
        delete config.skills;
      } else {
        setSkillsPaths(config, filtered);
      }
      writeConfig(config);
    }
  },
};
