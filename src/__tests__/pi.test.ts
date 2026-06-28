import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getSkillsSource = vi.fn();
const hasCommand = vi.fn();

vi.mock('../lib/platforms/utils.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/platforms/utils.js')>('../lib/platforms/utils.js');
  return {
    ...actual,
    getSkillsSource,
    hasCommand,
  };
});

describe('pi platform', () => {
  const originalCwd = process.cwd();
  const originalHome = process.env.HOME;
  let tmpDir: string;
  let skillsSource: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omm-pi-'));
    skillsSource = fs.mkdtempSync(path.join(os.tmpdir(), 'omm-pi-source-'));

    process.env.HOME = tmpDir;
    getSkillsSource.mockReturnValue(skillsSource);
    hasCommand.mockReturnValue(true);

    // Ensure no leftover state between tests
    vi.resetModules();
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(skillsSource, { recursive: true, force: true });
  });

  it('isSetup() returns false when target does not exist', async () => {
    const { pi } = await import('../lib/platforms/pi.js');
    expect(pi.isSetup()).toBe(false);
  });

  it('isSetup() returns true when target exists', async () => {
    const targetDir = path.join(tmpDir, '.pi', 'agent', 'skills', 'omnimap');
    fs.mkdirSync(path.dirname(targetDir), { recursive: true });
    fs.symlinkSync(skillsSource, targetDir, 'dir');

    const { pi } = await import('../lib/platforms/pi.js');
    expect(pi.isSetup()).toBe(true);
  });

  it('setup() creates skill copy when target missing', async () => {
    const { pi } = await import('../lib/platforms/pi.js');

    await pi.setup();

    const targetDir = path.join(tmpDir, '.pi', 'agent', 'skills', 'omnimap');
    expect(fs.existsSync(targetDir)).toBe(true);
    expect(fs.statSync(targetDir).isDirectory()).toBe(true);
  });

  it('setup() replaces existing target with fresh copy', async () => {
    const targetDir = path.join(tmpDir, '.pi', 'agent', 'skills', 'omnimap');
    fs.mkdirSync(path.dirname(targetDir), { recursive: true });
    fs.symlinkSync(skillsSource, targetDir, 'dir');

    // Create a different source with a marker to detect recreation
    const newSource = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'omm-pi-new-src-'));
    fs.writeFileSync(path.join(newSource, 'marker.txt'), 'new-content');
    getSkillsSource.mockReturnValue(newSource);

    const { pi } = await import('../lib/platforms/pi.js');
    await pi.setup();

    expect(fs.existsSync(targetDir)).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'marker.txt'))).toBe(true);

    fs.rmSync(newSource, { recursive: true, force: true });
  });

  it('teardown() removes target when it exists', async () => {
    const targetDir = path.join(tmpDir, '.pi', 'agent', 'skills', 'omnimap');
    fs.mkdirSync(path.dirname(targetDir), { recursive: true });
    fs.symlinkSync(skillsSource, targetDir, 'dir');

    const { pi } = await import('../lib/platforms/pi.js');
    pi.teardown();

    expect(fs.existsSync(targetDir)).toBe(false);
  });

  it('teardown() is no-op when target missing', async () => {
    const targetDir = path.join(tmpDir, '.pi', 'agent', 'skills', 'omnimap');

    const { pi } = await import('../lib/platforms/pi.js');
    // Should not throw
    pi.teardown();

    expect(fs.existsSync(targetDir)).toBe(false);
  });
});