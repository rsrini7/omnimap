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
    // opencode config may have trailing commas from JSONC origin - strip them
    const cleaned = raw.replace(/,\s*}/g, '}').replace(/,\s*\]/g, ']');
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
