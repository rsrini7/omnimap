/**
 * omm config <key> [value] — read/write project config (.omm/config.yaml)
 *
 * Usage:
 *   omm config                  Show all config
 *   omm config language         Show language setting
 *   omm config language ko      Set language to ko
 *   omm config arch-repo <path> Set architecture repository path
 */

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { ensureOmmForWrite, getOmmDir } from '../lib/store.js';
import type { OmmConfig } from '../types.js';

const CONFIG_FILE = 'config.yaml';

/** Known config keys with descriptions. */
const KNOWN_KEYS: Record<string, string> = {
  language: 'Content language (en, ko, ja, zh, tr)',
  arch_repo: 'Path to shared architecture repository',
  'arch-repo': 'Alias for arch_repo',
  arch_remote: 'Git remote URL for architecture repository',
  'arch-remote': 'Alias for arch_remote',
  theme: 'Default theme (dark, light)',
};

function readConfig(cwd?: string): OmmConfig {
  const filePath = path.join(getOmmDir(cwd), CONFIG_FILE);
  if (!fs.existsSync(filePath)) return { version: '0.1.0' };
  return YAML.parse(fs.readFileSync(filePath, 'utf-8')) as OmmConfig;
}

function writeConfig(config: OmmConfig, cwd?: string): void {
  ensureOmmForWrite(cwd);
  const filePath = path.join(getOmmDir(cwd), CONFIG_FILE);
  fs.writeFileSync(filePath, YAML.stringify(config), 'utf-8');
}

export function commandConfig(args: string[]): void {
  const key = args[0];
  const value = args[1];

  // omm config — show all
  if (!key) {
    const config = readConfig();
    process.stdout.write(YAML.stringify(config));
    return;
  }

  // omm config <key> — read
  if (!value) {
    const config = readConfig();
    const val = (config as unknown as Record<string, unknown>)[key];
    if (val !== undefined) {
      process.stdout.write(String(val) + '\n');
    } else {
      if (KNOWN_KEYS[key]) {
        process.stdout.write(`(not set) — ${KNOWN_KEYS[key]}\n`);
      } else {
        process.stdout.write('(not set)\n');
      }
    }
    return;
  }

  // omm config <key> <value> — write
  if (!KNOWN_KEYS[key]) {
    process.stderr.write(`warning: '${key}' is not a recognized config key.\n`);
    process.stderr.write(`Known keys:\n`);
    for (const [k, desc] of Object.entries(KNOWN_KEYS)) {
      process.stderr.write(`  ${k.padEnd(16)} ${desc}\n`);
    }
    process.stderr.write(`\nProceeding anyway (custom keys are allowed).\n\n`);
  }

  const config = readConfig();
  (config as unknown as Record<string, unknown>)[key] = value;
  writeConfig(config);
  process.stderr.write(`config: ${key}=${value}\n`);
}
