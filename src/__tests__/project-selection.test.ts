import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  setOmmDirOverride,
  getOmmDirOverride,
  getOmmDir,
  isArchRepo,
  listProjects,
  listClasses,
  showClass,
  readField,
} from '../lib/store.js';
import { initArchRepo } from '../lib/arch.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omm-projsel-'));
  // Reset override between tests
  setOmmDirOverride(null);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  setOmmDirOverride(null);
});

describe('setOmmDirOverride', () => {
  it('overrides getOmmDir when set', () => {
    const customDir = path.join(tmpDir, 'custom-omm');
    fs.mkdirSync(customDir, { recursive: true });
    setOmmDirOverride(customDir);
    expect(getOmmDir()).toBe(customDir);
  });

  it('reverts to default when cleared', () => {
    const customDir = path.join(tmpDir, 'custom-omm');
    fs.mkdirSync(customDir, { recursive: true });
    setOmmDirOverride(customDir);
    expect(getOmmDir()).toBe(customDir);
    setOmmDirOverride(null);
    expect(getOmmDir()).toBe(path.join(process.cwd(), '.omm'));
  });

  it('affects listClasses', () => {
    // Create a normal project
    const projectDir = path.join(tmpDir, 'my-project');
    fs.mkdirSync(path.join(projectDir, '.omm', 'auth-service'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, '.omm', 'api-gateway'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, '.omm', 'config.yaml'), 'version: 0.1.0');

    // Override to point to project's .omm
    setOmmDirOverride(path.join(projectDir, '.omm'));
    const classes = listClasses();
    expect(classes).toContain('auth-service');
    expect(classes).toContain('api-gateway');
  });

  it('affects showClass', () => {
    const projectDir = path.join(tmpDir, 'my-project');
    fs.mkdirSync(path.join(projectDir, '.omm', 'auth'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, '.omm', 'auth', 'description.md'), 'Auth service');
    fs.writeFileSync(path.join(projectDir, '.omm', 'config.yaml'), 'version: 0.1.0');

    setOmmDirOverride(path.join(projectDir, '.omm'));
    const data = showClass('auth');
    expect(data).toBeTruthy();
    expect(data!.description).toBe('Auth service');
  });

  it('affects readField', () => {
    const projectDir = path.join(tmpDir, 'my-project');
    fs.mkdirSync(path.join(projectDir, '.omm', 'storage'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, '.omm', 'storage', 'diagram.mmd'), 'graph LR\nA-->B');
    fs.writeFileSync(path.join(projectDir, '.omm', 'config.yaml'), 'version: 0.1.0');

    setOmmDirOverride(path.join(projectDir, '.omm'));
    const diagram = readField('storage', 'diagram');
    expect(diagram).toContain('graph LR');
  });
});

describe('isArchRepo', () => {
  it('returns false for regular project', () => {
    fs.mkdirSync(path.join(tmpDir, '.omm'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.omm', 'config.yaml'), 'version: 0.1.0');
    expect(isArchRepo(tmpDir)).toBe(false);
  });

  it('returns true when arch_repo: true in config', () => {
    fs.mkdirSync(path.join(tmpDir, '.omm'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.omm', 'config.yaml'), 'version: 0.1.0\narch_repo: true');
    expect(isArchRepo(tmpDir)).toBe(true);
  });

  it('returns false when .omm does not exist', () => {
    expect(isArchRepo(tmpDir)).toBe(false);
  });
});

describe('listProjects', () => {
  it('returns project directories in arch repo', () => {
    initArchRepo(tmpDir);
    fs.mkdirSync(path.join(tmpDir, '.omm', 'project-a'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.omm', 'project-b'), { recursive: true });
    expect(listProjects(tmpDir)).toEqual(['project-a', 'project-b']);
  });

  it('returns empty for non-arch directory', () => {
    fs.mkdirSync(path.join(tmpDir, '.omm'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.omm', 'config.yaml'), 'version: 0.1.0');
    expect(listProjects(tmpDir)).toEqual([]);
  });

  it('ignores config.yaml and dotfiles', () => {
    initArchRepo(tmpDir);
    fs.mkdirSync(path.join(tmpDir, '.omm', 'my-project'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.omm', 'config.yaml'), '');
    expect(listProjects(tmpDir)).toEqual(['my-project']);
  });
});

describe('project selection flow', () => {
  it('switching override scopes data to selected project', () => {
    // Create arch repo with two projects
    initArchRepo(tmpDir);
    fs.mkdirSync(path.join(tmpDir, '.omm', 'project-a', 'auth'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.omm', 'project-a', 'auth', 'description.md'), 'Project A Auth');
    fs.mkdirSync(path.join(tmpDir, '.omm', 'project-b', 'storage'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.omm', 'project-b', 'storage', 'description.md'), 'Project B Storage');

    // List projects
    const projects = listProjects(tmpDir);
    expect(projects).toEqual(['project-a', 'project-b']);

    // Select project-a
    setOmmDirOverride(path.join(tmpDir, '.omm', 'project-a'));
    expect(listClasses()).toEqual(['auth']);
    expect(readField('auth', 'description')).toBe('Project A Auth');

    // Switch to project-b
    setOmmDirOverride(path.join(tmpDir, '.omm', 'project-b'));
    expect(listClasses()).toEqual(['storage']);
    expect(readField('storage', 'description')).toBe('Project B Storage');

    // Switch to arch repo level (override points to .omm/ root)
    setOmmDirOverride(path.join(tmpDir, '.omm'));
    const allClasses = listClasses();
    expect(allClasses).toContain('project-a');
    expect(allClasses).toContain('project-b');
  });

  it('override does not persist across clear', () => {
    initArchRepo(tmpDir);
    fs.mkdirSync(path.join(tmpDir, '.omm', 'proj', 'auth'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.omm', 'proj', 'auth', 'description.md'), 'test');

    setOmmDirOverride(path.join(tmpDir, '.omm', 'proj'));
    expect(listClasses()).toEqual(['auth']);

    setOmmDirOverride(null);
    // After clearing, getOmmDir uses process.cwd()/.omm which is a different directory
    // The override should NOT persist — auth should not be in the default listing
    const defaultClasses = listClasses();
    expect(defaultClasses).not.toContain('auth');
  });
});
