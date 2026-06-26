import fs from 'node:fs';
import path from 'node:path';
import { initOmm, ommExists, ensureOmmForWrite, writeField } from '../lib/store.js';
import { listTemplates, getTemplate } from '../templates/index.js';
import { getDetectedPlatforms } from '../lib/platforms/index.js';

const GITIGNORE_ENTRIES = '.omm/*\n!.omm/config.yaml';

function ensureGitignore(cwd: string): void {
  const gitignorePath = path.join(cwd, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, GITIGNORE_ENTRIES + '\n', 'utf-8');
    process.stderr.write('Created .gitignore with .omm/* entries.\n');
    return;
  }
  const content = fs.readFileSync(gitignorePath, 'utf-8');
  if (content.includes('.omm/*')) return; // already has it
  const separator = content.endsWith('\n') ? '' : '\n';
  fs.writeFileSync(gitignorePath, content + separator + GITIGNORE_ENTRIES + '\n', 'utf-8');
  process.stderr.write('Added .omm/* to .gitignore.\n');
}

async function updateSkills(): Promise<void> {
  const platforms = getDetectedPlatforms();
  if (platforms.length === 0) return;

  let updated = 0;
  for (const platform of platforms) {
    if (!platform.isSetup()) continue;
    if (!platform.needsUpdate) continue;
    const { needed } = platform.needsUpdate();
    if (needed) {
      await platform.setup();
      updated++;
    }
  }
  if (updated > 0) {
    process.stderr.write(`Updated skills for ${updated} platform(s).\n`);
  }
}

export async function commandInit(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const templateName = args.includes('--template') ? args[args.indexOf('--template') + 1] : undefined;

  if (templateName) {
    // List templates
    if (templateName === 'list') {
      process.stderr.write('Available templates:\n');
      for (const name of listTemplates()) {
        const t = getTemplate(name)!;
        process.stderr.write(`  ${name.padEnd(20)} ${t.description}\n`);
      }
      return;
    }

    const template = getTemplate(templateName);
    if (!template) {
      process.stderr.write(`error: unknown template '${templateName}'. Use 'omm init --template list' to see available templates.\n`);
      process.exit(1);
    }

    ensureOmmForWrite(cwd);
    ensureGitignore(cwd);
    await updateSkills();

    for (const p of template.perspectives) {
      writeField(p.name, 'description', p.description, cwd);
      writeField(p.name, 'diagram', p.diagram, cwd);
      if (p.context) writeField(p.name, 'context', p.context, cwd);
      if (p.constraint) writeField(p.name, 'constraint', p.constraint, cwd);
      if (p.concern) writeField(p.name, 'concern', p.concern, cwd);
    }

    process.stderr.write(`Created ${template.perspectives.length} perspectives from '${template.name}' template.\n`);
    process.stderr.write(`Run 'omm view' to explore, or 'omm tag' to categorize.\n`);
    return;
  }

  if (ommExists(cwd)) {
    ensureGitignore(cwd);
    await updateSkills();
    process.stderr.write('.omm/ already initialized.\n');
  } else {
    initOmm(cwd);
    ensureGitignore(cwd);
    await updateSkills();
    process.stderr.write('Created .omm/ directory.\n');
  }
}
