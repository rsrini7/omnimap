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

describe('omp platform', () => {
  const originalCwd = process.cwd();
  const originalHome = process.env.HOME;
  let tmpDir: string;
  let skillsSource: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omm-omp-'));
    skillsSource = fs.mkdtempSync(path.join(os.tmpdir(), 'omm-omp-source-'));

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
    const { omp } = await import('../lib/platforms/omp.js');
    expect(omp.isSetup()).toBe(false);
  });

  it('isSetup() returns true when target exists', async () => {
    const targetDir = path.join(tmpDir, '.omp', 'agent', 'skills', 'oh-my-mermaid');
    fs.mkdirSync(path.dirname(targetDir), { recursive: true });
    fs.symlinkSync(skillsSource, targetDir, 'dir');

    const { omp } = await import('../lib/platforms/omp.js');
    expect(omp.isSetup()).toBe(true);
  });

  it('setup() creates skill copy when target missing', async () => {
    const { omp } = await import('../lib/platforms/omp.js');

    await omp.setup();

    const targetDir = path.join(tmpDir, '.omp', 'agent', 'skills', 'oh-my-mermaid');
    expect(fs.existsSync(targetDir)).toBe(true);
    expect(fs.statSync(targetDir).isDirectory()).toBe(true);
  });

  it('setup() replaces existing target with fresh copy', async () => {
    const targetDir = path.join(tmpDir, '.omp', 'agent', 'skills', 'oh-my-mermaid');
    fs.mkdirSync(path.dirname(targetDir), { recursive: true });
    fs.symlinkSync(skillsSource, targetDir, 'dir');

    // Create a different source with a marker to detect recreation
    const newSource = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'omm-omp-new-src-'));
    fs.writeFileSync(path.join(newSource, 'marker.txt'), 'new-content');
    getSkillsSource.mockReturnValue(newSource);

    const { omp } = await import('../lib/platforms/omp.js');
    await omp.setup();

    expect(fs.existsSync(targetDir)).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'marker.txt'))).toBe(true);

    fs.rmSync(newSource, { recursive: true, force: true });
  });

  it('teardown() removes target when it exists', async () => {
    const targetDir = path.join(tmpDir, '.omp', 'agent', 'skills', 'oh-my-mermaid');
    fs.mkdirSync(path.dirname(targetDir), { recursive: true });
    fs.symlinkSync(skillsSource, targetDir, 'dir');

    const { omp } = await import('../lib/platforms/omp.js');
    omp.teardown();

    expect(fs.existsSync(targetDir)).toBe(false);
  });

  it('teardown() is no-op when target missing', async () => {
    const targetDir = path.join(tmpDir, '.omp', 'agent', 'skills', 'oh-my-mermaid');

    const { omp } = await import('../lib/platforms/omp.js');
    // Should not throw
    omp.teardown();

    expect(fs.existsSync(targetDir)).toBe(false);
  });
});