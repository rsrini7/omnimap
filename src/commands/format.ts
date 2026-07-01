import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import {
  ensureOmmForRead,
  showClass,
  showNode,
  readNodeMeta,
  writeNodeMeta,
  getOmmDir,
} from '../lib/store.js';
import { detectDiagramFormat, renameDiagramFile } from '../lib/format.js';
import { FORMAT_DEFAULT_FILES, type DiagramFormat } from '../types.js';

const HELP = `
omm format <element> [set <format>]

Show or set the diagram format for an element.

Usage:
  omm format <element>              Show current format and source file
  omm format <element> set mermaid  Set format to Mermaid
  omm format <element> set plantuml Set format to PlantUML

Options:
  -h, --help   Show this help

Examples:
  omm format auth-service                  # Show format
  omm format auth-service set plantuml     # Switch to PlantUML
  omm format overall-architecture/flow set mermaid  # Nested element
`;

function parseArgs(args: string[]): { element: string; action: 'show' | 'set'; format?: DiagramFormat } {
  const result: { element: string; action: 'show' | 'set'; format?: DiagramFormat } = {
    element: '',
    action: 'show',
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--help' || a === '-h') {
      process.stdout.write(HELP.trim() + '\n');
      process.exit(0);
    } else if (a === 'set' && args[i + 1]) {
      result.action = 'set';
      const fmt = args[++i].toLowerCase();
      if (fmt !== 'mermaid' && fmt !== 'plantuml') {
        process.stderr.write(`error: unsupported format '${fmt}'. Use 'mermaid' or 'plantuml'.\n`);
        process.exit(1);
      }
      result.format = fmt;
    } else if (!a.startsWith('-') && !result.element) {
      result.element = a;
    }
  }

  if (!result.element) {
    process.stderr.write('error: element path required.\n');
    process.exit(1);
  }

  return result;
}

function resolveElementDir(element: string, cwd: string): string | null {
  const parts = element.split('/');
  const ommDir = getOmmDir(cwd);

  if (parts.length === 1) {
    const dir = path.join(ommDir, element);
    return fs.existsSync(dir) ? dir : null;
  }

  const perspective = parts[0];
  const nodePath = parts.slice(1);
  const dir = path.join(ommDir, perspective, ...nodePath);
  return fs.existsSync(dir) ? dir : null;
}

export async function commandFormat(args: string[]): Promise<void> {
  const cwd = process.cwd();
  if (!ensureOmmForRead(cwd)) return;

  const parsed = parseArgs(args);
  const dir = resolveElementDir(parsed.element, cwd);

  if (!dir) {
    process.stderr.write(`error: element '${parsed.element}' not found.\n`);
    process.exit(1);
  }

  if (parsed.action === 'show') {
    const { format, file } = detectDiagramFormat(dir);
    const metaPath = path.join(dir, 'meta.yaml');
    let metaFormat: DiagramFormat | undefined;

    if (fs.existsSync(metaPath)) {
      try {
        const meta = YAML.parse(fs.readFileSync(metaPath, 'utf-8'));
        metaFormat = meta?.diagram_format;
      } catch { /* ignore */ }
    }

    const resolvedFormat = metaFormat || format;
    const resolvedFile = file || FORMAT_DEFAULT_FILES[resolvedFormat];
    const filePath = path.join(dir, resolvedFile);
    const exists = fs.existsSync(filePath);

    process.stdout.write(`Element: ${parsed.element}\n`);
    process.stdout.write(`Format:  ${resolvedFormat}${metaFormat ? ' (from meta.yaml)' : ' (auto-detected)'}\n`);
    process.stdout.write(`File:    ${resolvedFile}${exists ? '' : ' (not found)'}\n`);
    if (exists) {
      process.stdout.write(`Path:    ${filePath}\n`);
    }
    return;
  }

  // Set format
  const targetFormat = parsed.format!;
  const { format: currentFormat, file: currentFile } = detectDiagramFormat(dir);

  if (currentFormat === targetFormat && currentFile) {
    process.stdout.write(`Already in ${targetFormat} format.\n`);
    return;
  }

  // Check if target format file already exists
  const targetFile = FORMAT_DEFAULT_FILES[targetFormat];
  const targetPath = path.join(dir, targetFile);
  if (fs.existsSync(targetPath)) {
    process.stdout.write(`Target file ${targetFile} already exists.\n`);
    // Still update meta.yaml
    updateMetaFormat(dir, targetFormat);
    process.stdout.write(`Format set to ${targetFormat}.\n`);
    return;
  }

  // Rename file if source exists
  if (currentFile) {
    const renamed = renameDiagramFile(dir, currentFormat, targetFormat);
    if (renamed) {
      process.stdout.write(`Renamed ${currentFile} → ${targetFile}\n`);
    }
  }

  // Update meta.yaml
  updateMetaFormat(dir, targetFormat);
  process.stdout.write(`Format set to ${targetFormat}.\n`);
}

function updateMetaFormat(dir: string, format: DiagramFormat): void {
  const metaPath = path.join(dir, 'meta.yaml');
  let meta: Record<string, unknown> = {};

  if (fs.existsSync(metaPath)) {
    try {
      meta = YAML.parse(fs.readFileSync(metaPath, 'utf-8')) || {};
    } catch { /* ignore */ }
  }

  meta.diagram_format = format;
  meta.updated = new Date().toISOString();
  fs.writeFileSync(metaPath, YAML.stringify(meta), 'utf-8');
}
