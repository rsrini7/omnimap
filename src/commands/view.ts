import { ensureOmmForRead, isArchRepo, listProjects, getOmmDir, setOmmDirOverride } from '../lib/store.js';
import { startServer } from '../server/index.js';
import path from 'node:path';

export function commandView(port: number = 3000, args: string[] = []): void {
  if (!ensureOmmForRead()) return;

  const projectFlag = args.indexOf('--project');
  const project = projectFlag >= 0 ? args[projectFlag + 1] : undefined;
  const share = args.includes('--share');
  const host = share ? '0.0.0.0' : '127.0.0.1';

  // Auto-select project if arch repo with single project
  if (isArchRepo() || project) {
    const ommDir = getOmmDir();
    const projects = listProjects();
    let projectName = project;
    if (!projectName && projects.length === 1) projectName = projects[0];
    if (!projectName && projects.length > 1) {
      startServer(port, host);
      return;
    }
    if (!projectName && projects.length === 0) {
      startServer(port, host);
      return;
    }
    if (!projectName) {
      projectName = projects[0];
    }
    if (!projects.includes(projectName)) {
      process.stderr.write(`error: project '${projectName}' not found. Available: ${projects.join(', ')}\n`);
      process.exit(1);
    }
    const projectOmmDir = path.join(ommDir, projectName);
    setOmmDirOverride(projectOmmDir);
  }

  startServer(port, host);
}
