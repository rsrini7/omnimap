import os from 'node:os';
import path from 'node:path';
import { skillCopyPlatform } from './skill-copy-platform.js';

export const pi = skillCopyPlatform(
  'pi',
  'pi (pi.dev)',
  'pi',
  path.join(os.homedir(), '.pi', 'agent', 'skills', 'oh-my-mermaid'),
);
