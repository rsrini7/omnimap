import { ensureOmmForRead, listClasses, readField, classExists } from '../lib/store.js';
import { validateDiagram } from '../lib/validate.js';
import { planIncrementalUpdate } from '../lib/incremental.js';
import { getOmmDir } from '../lib/store.js';

function validateClass(className: string, allClasses: string[]): { errors: number; warnings: number } {
  const diagram = readField(className, 'diagram');
  if (!diagram) {
    process.stdout.write(`${className}:\n  (no diagram)\n\n`);
    return { errors: 0, warnings: 0 };
  }

  const result = validateDiagram(diagram, { className, allClasses });
  const errors = result.issues.filter(i => i.level === 'error').length;
  const warnings = result.issues.filter(i => i.level === 'warning').length;

  const status = result.valid
    ? `✓ valid${warnings > 0 ? ` (${warnings} warning${warnings > 1 ? 's' : ''})` : ''}`
    : `✗ invalid (${errors} error${errors > 1 ? 's' : ''}${warnings > 0 ? `, ${warnings} warning${warnings > 1 ? 's' : ''}` : ''})`;

  process.stdout.write(`${className}:\n  ${status}\n`);
  for (const issue of result.issues) {
    const loc = issue.line ? ` line ${issue.line}:` : '';
    process.stdout.write(`  ${issue.level} [${issue.rule}]${loc} ${issue.message}\n`);
  }
  process.stdout.write('\n');

  return { errors, warnings };
}

export function commandValidate(className?: string, flags?: string[]): void {
  if (!ensureOmmForRead()) return;

  const allClasses = listClasses();
  const useJson = flags?.includes('--json');
  const changedOnly = flags?.includes('--changed');

  // --changed: only validate stale elements from incremental plan
  if (changedOnly) {
    const ommDir = getOmmDir();
    const plan = planIncrementalUpdate(ommDir);
    const staleElements = plan.stale.map(s => s.elementPath);
    const unknownElements = plan.unknown;
    const targets = [...staleElements, ...unknownElements].filter(c => classExists(c));

    if (targets.length === 0) {
      if (useJson) {
        process.stdout.write(JSON.stringify({ status: 'ok', message: 'No changed elements to validate', validated: 0, errors: 0, warnings: 0 }) + '\n');
      } else {
        process.stdout.write('No changed elements to validate.\n');
      }
      return;
    }

    let totalErrors = 0, totalWarnings = 0;
    const results: Array<{ element: string; valid: boolean; errors: number; warnings: number; issues: any[] }> = [];

    for (const cls of targets) {
      const diagram = readField(cls, 'diagram');
      if (!diagram) {
        if (useJson) results.push({ element: cls, valid: true, errors: 0, warnings: 0, issues: [] });
        continue;
      }
      const result = validateDiagram(diagram, { className: cls, allClasses });
      const errors = result.issues.filter(i => i.level === 'error').length;
      const warnings = result.issues.filter(i => i.level === 'warning').length;
      totalErrors += errors;
      totalWarnings += warnings;

      if (useJson) {
        results.push({ element: cls, valid: result.valid, errors, warnings, issues: result.issues });
      } else {
        const status = result.valid
          ? `✓ valid${warnings > 0 ? ` (${warnings} warning${warnings > 1 ? 's' : ''})` : ''}`
          : `✗ invalid (${errors} error${errors > 1 ? 's' : ''}${warnings > 0 ? `, ${warnings} warning${warnings > 1 ? 's' : ''}` : ''})`;
        process.stdout.write(`${cls}:\n  ${status}\n`);
        for (const issue of result.issues) {
          const loc = issue.line ? ` line ${issue.line}:` : '';
          process.stdout.write(`  ${issue.level} [${issue.rule}]${loc} ${issue.message}\n`);
        }
        process.stdout.write('\n');
      }
    }

    if (useJson) {
      process.stdout.write(JSON.stringify({ status: totalErrors > 0 ? 'fail' : 'ok', validated: targets.length, errors: totalErrors, warnings: totalWarnings, results }, null, 2) + '\n');
    } else {
      process.stdout.write(`Validated ${targets.length} changed element${targets.length > 1 ? 's' : ''}: ${totalErrors} error${totalErrors !== 1 ? 's' : ''}, ${totalWarnings} warning${totalWarnings !== 1 ? 's' : ''}.\n`);
    }
    if (totalErrors > 0) process.exit(1);
    return;
  }

  if (className) {
    if (!classExists(className)) {
      process.stderr.write(`error: element '${className}' not found\n`);
      process.exit(1);
    }
    const { errors } = validateClass(className, allClasses);
    if (errors > 0) process.exit(1);
    return;
  }

  // Validate all classes
  let totalErrors = 0;
  for (const cls of allClasses) {
    const { errors } = validateClass(cls, allClasses);
    totalErrors += errors;
  }

  if (totalErrors > 0) process.exit(1);
}
