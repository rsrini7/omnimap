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

describe('opencode platform', () => {
  const originalCwd = process.cwd();
  const originalHome = process.env.HOME;
  let tmpDir: string;
  let skillsSource: string;
  let stderr: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omm-opencode-'));
    skillsSource = '/tmp/omm-test-skills';

    process.env.HOME = tmpDir;
    getSkillsSource.mockReturnValue(skillsSource);
    hasCommand.mockReturnValue(true);

    stderr = '';
    vi.spyOn(process.stderr, 'write').mockImplementation((msg: string | Uint8Array) => {
      stderr += msg;
      return true;
    });

    // Ensure no leftover state between tests
    vi.resetModules();
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function configPath(): string {
    return path.join(tmpDir, '.config', 'opencode', 'opencode.json');
  }

  it('isSetup() returns false when config file missing', async () => {
    const { opencode } = await import('../lib/platforms/opencode.js');
    expect(opencode.isSetup()).toBe(false);
  });

  it('isSetup() returns false when skills.paths does not include source', async () => {
    const cfg = path.join(tmpDir, '.config', 'opencode');
    fs.mkdirSync(cfg, { recursive: true });
    fs.writeFileSync(path.join(cfg, 'opencode.json'), JSON.stringify({ skills: { paths: ['/other'] } }));

    const { opencode } = await import('../lib/platforms/opencode.js');
    expect(opencode.isSetup()).toBe(false);
  });

  it('isSetup() returns true when skills.paths includes source', async () => {
    const cfg = path.join(tmpDir, '.config', 'opencode');
    fs.mkdirSync(cfg, { recursive: true });
    fs.writeFileSync(path.join(cfg, 'opencode.json'), JSON.stringify({ skills: { paths: [skillsSource] } }));

    const { opencode } = await import('../lib/platforms/opencode.js');
    expect(opencode.isSetup()).toBe(true);
  });

  it('setup() creates config + adds skills path when file missing', async () => {
    const { opencode } = await import('../lib/platforms/opencode.js');

    await opencode.setup();

    const cfg = configPath();
    expect(fs.existsSync(cfg)).toBe(true);
    const content = JSON.parse(fs.readFileSync(cfg, 'utf-8'));
    expect(content.skills.paths).toContain(skillsSource);
  });

  it('setup() appends skills path to existing config', async () => {
    const cfg = path.join(tmpDir, '.config', 'opencode');
    fs.mkdirSync(cfg, { recursive: true });
    fs.writeFileSync(path.join(cfg, 'opencode.json'), JSON.stringify({ skills: { paths: ['/other'] } }));

    const { opencode } = await import('../lib/platforms/opencode.js');
    await opencode.setup();

    const content = JSON.parse(fs.readFileSync(configPath(), 'utf-8'));
    expect(content.skills.paths).toContain(skillsSource);
    expect(content.skills.paths).toContain('/other');
  });

  it('setup() does NOT duplicate path if already present', async () => {
    const cfg = path.join(tmpDir, '.config', 'opencode');
    fs.mkdirSync(cfg, { recursive: true });
    fs.writeFileSync(path.join(cfg, 'opencode.json'), JSON.stringify({ skills: { paths: [skillsSource] } }));

    const { opencode } = await import('../lib/platforms/opencode.js');
    await opencode.setup();

    const content = JSON.parse(fs.readFileSync(configPath(), 'utf-8'));
    expect(content.skills.paths.filter((p: unknown) => p === skillsSource).length).toBe(1);
    expect(stderr).toContain('already registered');
  });

  it('setup() parses config with trailing commas successfully', async () => {
    const cfg = path.join(tmpDir, '.config', 'opencode');
    fs.mkdirSync(cfg, { recursive: true });
    // Trailing comma after array
    fs.writeFileSync(path.join(cfg, 'opencode.json'), '{"skills": {"paths": ["/other",]}}');

    const { opencode } = await import('../lib/platforms/opencode.js');
    await opencode.setup();

    const content = JSON.parse(fs.readFileSync(configPath(), 'utf-8'));
    expect(content.skills.paths).toContain('/other');
    expect(content.skills.paths).toContain(skillsSource);
  });

  it('setup() does NOT overwrite config with comments (refuses, logs error)', async () => {
    const cfg = path.join(tmpDir, '.config', 'opencode');
    fs.mkdirSync(cfg, { recursive: true });
    const originalContent = `{\n  // comment\n  "skills": { "paths": ["/other"] }\n}`;
    fs.writeFileSync(path.join(cfg, 'opencode.json'), originalContent);

    const { opencode } = await import('../lib/platforms/opencode.js');
    await opencode.setup();

    const content = fs.readFileSync(configPath(), 'utf-8');
    expect(content).toBe(originalContent);
    expect(stderr).toContain('Could not parse existing config');
  });

  it('teardown() removes path from config', async () => {
    const cfg = path.join(tmpDir, '.config', 'opencode');
    fs.mkdirSync(cfg, { recursive: true });
    fs.writeFileSync(path.join(cfg, 'opencode.json'), JSON.stringify({ skills: { paths: [skillsSource, '/other'] } }));

    const { opencode } = await import('../lib/platforms/opencode.js');
    opencode.teardown();

    const content = JSON.parse(fs.readFileSync(configPath(), 'utf-8'));
    expect(content.skills.paths).not.toContain(skillsSource);
    expect(content.skills.paths).toContain('/other');
  });

  it('teardown() deletes skills section when paths become empty', async () => {
    const cfg = path.join(tmpDir, '.config', 'opencode');
    fs.mkdirSync(cfg, { recursive: true });
    fs.writeFileSync(path.join(cfg, 'opencode.json'), JSON.stringify({ skills: { paths: [skillsSource] } }));

    const { opencode } = await import('../lib/platforms/opencode.js');
    opencode.teardown();

    const content = JSON.parse(fs.readFileSync(configPath(), 'utf-8'));
    expect(content.skills).toBeUndefined();
  });

  it('teardown() warns when config exists but is unreadable', async () => {
    const cfg = path.join(tmpDir, '.config', 'opencode');
    fs.mkdirSync(cfg, { recursive: true });
    fs.writeFileSync(path.join(cfg, 'opencode.json'), 'broken json {');

    const { opencode } = await import('../lib/platforms/opencode.js');
    opencode.teardown();

    expect(stderr).toContain('Skipping teardown');
  });
});