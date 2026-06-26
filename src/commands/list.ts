import { listClasses, isArchRepo, listProjects, getOmmDir } from '../lib/store.js';
import path from 'node:path';

export function commandList(args: string[]): void {
  const projectFlag = args.indexOf('--project');
  const project = projectFlag >= 0 ? args[projectFlag + 1] : undefined;
  const ommDir = getOmmDir();

  // Auto-detect arch repo
  if (isArchRepo() && !project) {
    const projects = listProjects();
    if (projects.length === 0) {
      process.stderr.write('No projects found.\n');
      return;
    }
    process.stderr.write(`Architecture repository (${projects.length} projects):\n\n`);
    for (const p of projects) {
      const projectOmmDir = path.join(ommDir, p);
      const classes = listClasses(projectOmmDir);
      process.stderr.write(`  ${p} (${classes.length} perspectives)\n`);
      for (const c of classes) {
        process.stdout.write(`    ${c}\n`);
      }
    }
    return;
  }

  // Single project (from arch repo)
  if (isArchRepo() && project) {
    const projectOmmDir = path.join(ommDir, project);
    const classes = listClasses(projectOmmDir);
    if (classes.length === 0) {
      process.stderr.write(`No perspectives found in project '${project}'.\n`);
      return;
    }
    process.stdout.write(classes.join('\n') + '\n');
    return;
  }

  // Regular project (not arch repo)
  const classes = listClasses();
  if (classes.length === 0) {
    process.stderr.write('No perspectives found.\n');
    return;
  }
  process.stdout.write(classes.join('\n') + '\n');
}
