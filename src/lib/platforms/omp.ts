import os from 'node:os';
import path from 'node:path';
import { skillCopyPlatform } from './skill-copy-platform.js';

export const omp = skillCopyPlatform(
  'omp',
  'Oh my Pi (omp)',
  'omp',
  path.join(os.homedir(), '.omp', 'agent', 'skills', 'oh-my-mermaid'),
);
