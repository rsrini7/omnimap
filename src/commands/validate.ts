import { ensureOmmForRead, listClasses, readField, classExists, writeField, writeNodeField, readNodeField } from '../lib/store.js';
import { validateDiagram } from '../lib/validate.js';
import { fixDiagram, type FixResult } from '../lib/fix-diagram.js';
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

  // --explain: show rule documentation
  if (flags?.includes('--explain')) {
    printExplain();
    return;
  }

  // --rules: list all validation rules
  if (flags?.includes('--rules')) {
    printRules();
    return;
  }

  // --fix: auto-fix fixable issues (classdef-color) and write back
  if (flags?.includes('--fix')) {
    if (!className) {
      process.stderr.write('error: omm validate <element> --fix (requires element path)\n');
      process.exit(1);
    }
    if (!classExists(className)) {
      process.stderr.write(`error: element '${className}' not found\n`);
      process.exit(1);
    }
    runFix(className);
    return;
  }

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

const RULE_DOCS: Record<string, { level: string; description: string; fix: string; example?: string }> = {
  'graph-declaration': {
    level: 'error',
    description: 'Diagram must start with a graph/flowchart direction declaration.',
    fix: 'Add "graph LR" (or TD/TB/BT/RL) as the first line.',
    example: 'graph LR\n    A --> B',
  },
  'balanced-brackets': {
    level: 'error',
    description: 'All brackets ([], (), {}) on a line must be balanced. Quote-aware — text inside double-quotes is ignored.',
    fix: 'Count opening and closing brackets. Strings inside node labels can contain brackets if quoted.',
    example: 'A["Label with (parens)"]',
  },
  'edge-label': {
    level: 'warning',
    description: 'Every edge should have a label explaining what flows across it.',
    fix: 'Add a label between pipes: A -->|"my label"| B',
    example: 'A -->|"sends data"| B',
  },
  'classdef-name': {
    level: 'warning',
    description: 'classDef name should be one of: external, concern, entry, store.',
    fix: 'Use one of the standard names. Custom names won\'t get semantic colors in the viewer.',
    example: 'classDef concern fill:#f38ba8,stroke:#f38ba8,color:#1e1e2e',
  },
  'classdef-color': {
    level: 'warning',
    description: 'classDef color should match the standard palette for that name.',
    fix: 'Use the canonical color from the palette. The viewer applies these colors to nodes.',
    example: 'classDef external fill:#585b70,stroke:#585b70,color:#cdd6f4',
  },
  'ref-exists': {
    level: 'error',
    description: '@ref must point to an existing perspective (not a child path).',
    fix: 'Only top-level class names work as refs. Use @perspective-name, not @perspective-name/child.',
    example: '@command-surface  # ✓ valid\n@command-surface/agent  # ✗ not supported',
  },
  'ref-self': {
    level: 'error',
    description: 'A diagram cannot reference its own class — that creates a self-loop.',
    fix: 'Reference a different perspective, or remove the @ref if it\'s your own class.',
    example: 'In overall-architecture: don\'t write @overall-architecture',
  },
  'node-count': {
    level: 'warning',
    description: 'Diagrams with <3 nodes are too simple; >15 nodes are too complex.',
    fix: 'Split complex diagrams into sub-diagrams, or combine too-simple ones into a larger view.',
    example: 'Recommended: 5-15 nodes per diagram',
  },
};

function printExplain(): void {
  process.stdout.write('\n=== omm validate rules ===\n\n');
  process.stdout.write('Use --rules to see this list as a one-liner table.\n\n');
  for (const [rule, doc] of Object.entries(RULE_DOCS)) {
    process.stdout.write(`[${rule}] (${doc.level})\n`);
    process.stdout.write(`  What: ${doc.description}\n`);
    process.stdout.write(`  Fix:  ${doc.fix}\n`);
    if (doc.example) {
      process.stdout.write(`  Eg:   ${doc.example}\n`);
    }
    process.stdout.write('\n');
  }
  process.stdout.write('Diagrams are validated with: omm validate [element] [--json] [--changed]\n');
  process.stdout.write('CI integration:  omm validate --json | jq \'.results[].errors\'\n');
}

function printRules(): void {
  process.stdout.write('\nValidation rules:\n');
  const rules = Object.entries(RULE_DOCS);
  const maxLen = Math.max(...rules.map(([k]) => k.length));
  for (const [rule, doc] of rules) {
    process.stdout.write(`  ${rule.padEnd(maxLen + 2)} (${doc.level.padEnd(7)}) ${doc.description.split('.')[0]}\n`);
  }
  process.stdout.write('\nUse `omm validate --explain` for full docs.\n');
}

function runFix(className: string): void {
  const allClasses = listClasses();
  const parts = className.split('/');
  const perspective = parts[0];
  const nodePath = parts.slice(1);

  const diagram = nodePath.length > 0
    ? readNodeField(perspective, nodePath, 'diagram')
    : readField(className, 'diagram');

  if (!diagram) {
    process.stderr.write(`error: ${className} has no diagram to fix\n`);
    process.exit(1);
  }

  // Run validation to find issues
  const result = validateDiagram(diagram, { className, allClasses });

  if (result.issues.length === 0) {
    process.stdout.write(`${className}: no issues to fix\n`);
    return;
  }

  // Apply auto-fixes
  const fix = fixDiagram(diagram, result.issues);

  if (!fix.changed) {
    process.stdout.write(`${className}: no auto-fixable issues\n`);
    if (fix.unfixedIssues.length > 0) {
      process.stdout.write(`  ${fix.unfixedIssues.length} issue(s) need manual fixing:\n`);
      for (const i of fix.unfixedIssues) {
        process.stdout.write(`    [${i.rule}] ${i.message}\n`);
      }
    }
    return;
  }

  // Write the fixed diagram back
  if (nodePath.length > 0) {
    writeNodeField(perspective, nodePath, 'diagram', fix.fixed);
  } else {
    writeField(className, 'diagram', fix.fixed);
  }

  process.stdout.write(`${className}: fixed ${fix.fixedIssues.length} issue(s)\n`);
  for (const i of fix.fixedIssues) {
    process.stdout.write(`  ✓ [${i.rule}] ${i.message}\n`);
  }
  if (fix.unfixedIssues.length > 0) {
    process.stdout.write(`  ${fix.unfixedIssues.length} issue(s) need manual fixing:\n`);
    for (const i of fix.unfixedIssues) {
      process.stdout.write(`    [${i.rule}] ${i.message}\n`);
    }
  }
}
