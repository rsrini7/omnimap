import { ensureOmmForRead, listNodes } from '../lib/store.js';
import { planIncrementalUpdate, markElementSources, recordScanGeneration, type IncrementalPlan, type PlanOptions } from '../lib/incremental.js';

function listNodesFromPath(elementPath: string): string[] {
  // Recursively list all children of a perspective
  const parts = elementPath.split('/');
  const perspective = parts[0];
  const result: string[] = [];
  function recurse(prefix: string) {
    const children = listNodes(perspective, prefix.slice(perspective.length + 1).split('/').filter(Boolean));
    for (const child of children) {
      const childPath = prefix + '/' + child;
      result.push(childPath);
      recurse(childPath);
    }
  }
  recurse(elementPath);
  return result;
}

function printHuman(plan: IncrementalPlan): void {
  const head = plan.currentCommit ? `HEAD = ${plan.currentCommit}` : 'no git';
  const baseline = plan.since ? `since = ${plan.since}` : 'since = (per-element meta)';
  process.stdout.write(`Incremental plan (${head}; ${baseline})\n\n`);

  if (plan.noGit) {
    process.stdout.write('(not a git repo — using mtime-only fallback)\n\n');
  }

  if (plan.changedFiles.length) {
    process.stdout.write(`Changed files (${plan.changedFiles.length}):\n`);
    for (const f of plan.changedFiles.slice(0, 30)) {
      process.stdout.write(`  ${f.status.padEnd(10)} ${f.path}\n`);
    }
    if (plan.changedFiles.length > 30) {
      process.stdout.write(`  … and ${plan.changedFiles.length - 30} more\n`);
    }
    process.stdout.write('\n');
  }

  if (plan.stale.length) {
    process.stdout.write(`Stale — re-analyze (${plan.stale.length}):\n`);
    for (const s of plan.stale) {
      const reasons = s.reasons.join(', ');
      const files = s.matchedFiles.length > 3
        ? `${s.matchedFiles.slice(0, 3).join(', ')}, +${s.matchedFiles.length - 3} more`
        : s.matchedFiles.join(', ');
      process.stdout.write(`  ${s.elementPath}  [${reasons}]  (${files})\n`);
    }
    process.stdout.write('\n');
  } else {
    process.stdout.write('Stale — re-analyze: (none)\n\n');
  }

  if (plan.fresh.length) {
    process.stdout.write(`Fresh — skip (${plan.fresh.length}):\n`);
    for (const f of plan.fresh) process.stdout.write(`  ${f}\n`);
    process.stdout.write('\n');
  }

  if (plan.unknown.length) {
    process.stdout.write(`Unknown — no source tracking (${plan.unknown.length}):\n`);
    for (const u of plan.unknown) process.stdout.write(`  ${u}\n`);
    process.stdout.write('  (run `omm incremental --mark <element> --globs …` to bootstrap tracking)\n\n');
  }
}

function printJson(plan: IncrementalPlan): void {
  process.stdout.write(JSON.stringify(plan, null, 2) + '\n');
}

function printExplain(plan: IncrementalPlan, elementPath: string): void {
  const stale = plan.stale.find(s => s.elementPath === elementPath);
  const isFresh = plan.fresh.includes(elementPath);
  const isUnknown = plan.unknown.includes(elementPath);

  process.stdout.write(`\nExplanation for ${elementPath}\n\n`);

  if (stale) {
    process.stdout.write(`Status: STALE (needs re-analysis)\n`);
    process.stdout.write(`Reasons: ${stale.reasons.join(', ')}\n`);
    if (stale.matchedFiles.length > 0) {
      process.stdout.write(`Matched files:\n`);
      for (const f of stale.matchedFiles.slice(0, 20)) {
        process.stdout.write(`  ${f}\n`);
      }
      if (stale.matchedFiles.length > 20) {
        process.stdout.write(`  ... and ${stale.matchedFiles.length - 20} more\n`);
      }
    }
    process.stdout.write(`\nTo fix: run /omm-scan on this element, or 'omm incremental --record <element>' to mark it as scanned.\n`);
    return;
  }

  if (isFresh) {
    process.stdout.write(`Status: FRESH (no changes since last scan)\n`);
    process.stdout.write(`No re-analysis needed.\n`);
    process.stdout.write(`\nTip: this element was marked as scanned at its last commit. If the source actually changed but the plan doesn't see it, try 'omm incremental --no-mtime' to skip the mtime fallback.\n`);
    return;
  }

  if (isUnknown) {
    process.stdout.write(`Status: UNKNOWN (no source tracking)\n`);
    process.stdout.write(`The element has no source_files or source_globs in meta.yaml.\n`);
    process.stdout.write(`\nTo fix: run 'omm incremental --mark ${elementPath} --files <path>...' to bootstrap tracking.\n`);
    return;
  }

  process.stdout.write(`Status: NOT FOUND\n`);
  process.stdout.write(`'${elementPath}' is not a known element. Run 'omm list' to see available perspectives.\n`);
}

interface ParsedArgs {
  mode: 'plan' | 'mark' | 'record';
  since?: string;
  json: boolean;
  mtimeFallback: boolean;
  // mark
  elementPath?: string;
  files?: string[];
  globs?: string[];
  replace?: boolean;
  recursive?: boolean;
  // explain
  explainPath?: string;
  // record
  recordMode?: 'full' | 'incremental';
}

function parseArgs(args: string[]): ParsedArgs {
  const out: ParsedArgs = {
    mode: 'plan',
    json: false,
    mtimeFallback: true,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') out.json = true;
    else if (a === '--help' || a === '-h') {
      process.stdout.write(HELP);
      process.exit(0);
    } else if (a === '--since' && args[i + 1]) {
      out.since = args[++i];
    } else if (a === '--no-mtime') {
      out.mtimeFallback = false;
    } else if (a === '--mark') {
      out.mode = 'mark';
      if (!args[i + 1]) {
        process.stderr.write('error: --mark requires <element-path>\n');
        process.exit(1);
      }
      out.elementPath = args[++i];
    } else if (a === '--record') {
      out.mode = 'record';
      if (!args[i + 1]) {
        process.stderr.write('error: --record requires <element-path>\n');
        process.exit(1);
      }
      out.elementPath = args[++i];
      out.recordMode = (args[i + 1] === 'incremental' ? 'incremental' : 'full');
      i++;
    } else if (a === '--files') {
      const list: string[] = [];
      while (args[i + 1] && !args[i + 1].startsWith('--')) list.push(args[++i]);
      out.files = [...(out.files ?? []), ...list];
    } else if (a === '--globs') {
      const list: string[] = [];
      while (args[i + 1] && !args[i + 1].startsWith('--')) list.push(args[++i]);
      out.globs = [...(out.globs ?? []), ...list];
    } else if (a === '--replace') {
      out.replace = true;
    } else if (a === '--recursive') {
      out.recursive = true;
    } else if (a === '--explain' && args[i + 1]) {
      out.mode = 'plan';
      out.explainPath = args[++i];
    } else {
      process.stderr.write(`error: unknown arg '${a}'\n`);
      process.exit(1);
    }
  }
  return out;
}

const HELP = `
omm incremental — detect changed files and plan incremental /omm-scan updates.

Usage:
  omm incremental [--since <ref>] [--json] [--no-mtime]
    Print a plan of stale / fresh / unknown elements since the last scan.

  omm incremental --mark <element-path> [--files <path>...] [--globs <glob>...] [--replace] [--recursive]
    Record the source files / globs an element covers. Bootstrap tracking.
    With --recursive, also mark all children with the same files/globs.

  omm incremental --explain <element-path>
    Show why a specific element is stale / fresh / unknown.

  omm incremental --record <element-path> [full|incremental]
    Mark an element as scanned at the current commit. The next incremental
    run will diff against this commit.

Options:
  --since <ref>     Use a specific git ref as the baseline for all elements
                    (overrides per-element meta.scan_generation.git_commit).
  --json            Output the plan as JSON.
  --no-mtime        Skip the mtime fallback (only diff against git).
  --replace         With --mark, replace existing source files / globs
                    instead of appending.
  --recursive       With --mark, also mark all children of the element.

Stale reasons:
  source_file           A tracked source file changed
  source_glob           A file matching a tracked glob changed
  orphaned_source       A tracked source file no longer exists on disk (renamed, deleted, or refactored)
  glob_coverage_changed A glob now matches different files (new files added or old ones deleted)
  no_source_tracking    Element has no source_files/globs; inherits staleness from parent
  source_file_mtime     Source file modified more recently than last scan (no git baseline)
`;

export async function commandIncremental(args: string[]): Promise<void> {
  if (!ensureOmmForRead()) return;
  const parsed = parseArgs(args);

  if (parsed.mode === 'plan') {
    const opts: PlanOptions = { mtimeFallback: parsed.mtimeFallback };
    if (parsed.since) opts.since = parsed.since;
    const plan = planIncrementalUpdate('.omm', process.cwd(), opts);

    // --explain <element>: show why one element is or isn't stale
    if (parsed.explainPath) {
      printExplain(plan, parsed.explainPath);
      return;
    }

    if (parsed.json) printJson(plan);
    else printHuman(plan);
    return;
  }

  if (parsed.mode === 'mark') {
    if (!parsed.elementPath) {
      process.stderr.write('error: --mark requires <element-path>\n');
      process.exit(1);
    }
    if (!parsed.files?.length && !parsed.globs?.length) {
      process.stderr.write('error: --mark requires --files and/or --globs\n');
      process.exit(1);
    }
    markElementSources(parsed.elementPath, {
      files: parsed.files,
      globs: parsed.globs,
      replaceFiles: parsed.replace,
      replaceGlobs: parsed.replace,
    });
    process.stderr.write(`marked ${parsed.elementPath}: ${parsed.files?.length ?? 0} files, ${parsed.globs?.length ?? 0} globs\n`);

    // Recursive: also mark all children
    if (parsed.recursive) {
      const childList = listNodesFromPath(parsed.elementPath);
      for (const child of childList) {
        markElementSources(child, {
          files: parsed.files,
          globs: parsed.globs,
          replaceFiles: parsed.replace,
          replaceGlobs: parsed.replace,
        });
        process.stderr.write(`marked ${child}: ${parsed.files?.length ?? 0} files, ${parsed.globs?.length ?? 0} globs\n`);
      }
    }
    return;
  }

  if (parsed.mode === 'record') {
    if (!parsed.elementPath) {
      process.stderr.write('error: --record requires <element-path>\n');
      process.exit(1);
    }
    recordScanGeneration(parsed.elementPath, parsed.recordMode ?? 'full');
    process.stderr.write(`recorded ${parsed.elementPath} as ${parsed.recordMode ?? 'full'}\n`);
    return;
  }
}
