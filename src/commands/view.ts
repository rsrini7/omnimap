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
    if (!projectName) {
      if (projects.length > 1) {
        process.stderr.write('Multiple projects found. Use: omm view --project <name>\n');
        process.stderr.write(`  Available: ${projects.join(', ')}\n`);
      } else {
        process.stderr.write('No projects found.\n');
      }
      process.exit(1);
    }
    // Override getOmmDir to point to the project's data directory
    const projectOmmDir = path.join(ommDir, projectName);
    setOmmDirOverride(projectOmmDir);
  }

  startServer(port);
}
