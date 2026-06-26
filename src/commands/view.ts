import { ensureOmmForRead, isArchRepo, listProjects, getOmmDir, setOmmDirOverride } from '../lib/store.js';
import { startServer } from '../server/index.js';
import path from 'node:path';

export function commandView(port: number = 3000, args: string[] = []): void {
  if (!ensureOmmForRead()) return;

  const projectFlag = args.indexOf('--project');
  const project = projectFlag >= 0 ? args[projectFlag + 1] : undefined;

  // Auto-select project if arch repo with single project
  if (isArchRepo() || project) {
    const ommDir = getOmmDir();
    const projects = listProjects();
    let projectName = project;
    if (!projectName && projects.length === 1) projectName = projects[0];
    if (!projectName && projects.length > 1) {
      // No --project given and multiple projects exist: let the server serve the picker page.
      // Don't set any override — the server will read ?project= from URL per-request.
      startServer(port);
      return;
    }
    if (!projectName && projects.length === 0) {
      // No projects in this arch repo: just start the server (will show empty data).
      startServer(port);
      return;
    }
    // --project specified (or single-project auto-select): validate and set override.
    if (!projectName) {
      // Single-project auto-select — already set above
      projectName = projects[0];
    }
    if (!projects.includes(projectName)) {
      process.stderr.write(`error: project '${projectName}' not found. Available: ${projects.join(', ')}\n`);
      process.exit(1);
    }
    // Override getOmmDir to point to the project's data directory
    const projectOmmDir = path.join(ommDir, projectName);
    setOmmDirOverride(projectOmmDir);
  }

  startServer(port);
}
