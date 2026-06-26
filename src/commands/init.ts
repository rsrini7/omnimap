import { initOmm, ommExists, ensureOmmForWrite, writeField } from '../lib/store.js';
import { listTemplates, getTemplate } from '../templates/index.js';

export function commandInit(args: string[]): void {
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
    process.stderr.write('.omm/ already initialized.\n');
  } else {
    initOmm(cwd);
    process.stderr.write('Created .omm/ directory. Add to .gitignore if not wanted.\n');
  }
}
