import fs from 'node:fs';
import YAML from 'yaml';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { DIAGRAM_EXTENSIONS, FORMAT_DEFAULT_FILES, type DiagramFormat } from '../types.js';

/**
 * Detect diagram format from files in a directory.
 * Priority: meta.yaml > explicit extensions > default mermaid.
 */
export function detectDiagramFormat(dir: string): { format: DiagramFormat; file: string | null } {
  // 1. Check meta.yaml for explicit format
  const metaPath = path.join(dir, 'meta.yaml');
  if (fs.existsSync(metaPath)) {
    try {
      const meta = YAML.parse(fs.readFileSync(metaPath, 'utf-8'));
      if (meta?.diagram_format && (meta.diagram_format === 'mermaid' || meta.diagram_format === 'plantuml')) {
        const expectedFile = FORMAT_DEFAULT_FILES[meta.diagram_format as DiagramFormat];
        if (fs.existsSync(path.join(dir, expectedFile))) {
          return { format: meta.diagram_format, file: expectedFile };
        }
      }
    } catch { /* ignore */ }
  }

  // 2. Check for format-specific diagram files
  for (const [ext, format] of Object.entries(DIAGRAM_EXTENSIONS)) {
    const fileName = `diagram${ext}`;
    if (fs.existsSync(path.join(dir, fileName))) {
      return { format, file: fileName };
    }
  }

  // 3. Default to mermaid
  return { format: 'mermaid', file: null };
}


/**
 * Resolve the diagram file path for an element directory.
 * Returns the path to the diagram file if it exists.
 */
export function resolveDiagramFile(dir: string): { path: string; format: DiagramFormat } | null {
  const { format, file } = detectDiagramFormat(dir);
  if (file) {
    return { path: path.join(dir, file), format };
  }

  // Check default mermaid file
  const defaultPath = path.join(dir, FORMAT_DEFAULT_FILES.mermaid);
  if (fs.existsSync(defaultPath)) {
    return { path: defaultPath, format: 'mermaid' };
  }

  return null;
}

/**
 * Get the file extension for a diagram format.
 */
export function getFormatExtension(format: DiagramFormat): string {
  const file = FORMAT_DEFAULT_FILES[format];
  return path.extname(file);
}

/**
 * Rename diagram file to match the target format.
 * Returns the new file path.
 */
export function renameDiagramFile(dir: string, fromFormat: DiagramFormat, toFormat: DiagramFormat): string | null {
  const fromFile = FORMAT_DEFAULT_FILES[fromFormat];
  const toFile = FORMAT_DEFAULT_FILES[toFormat];
  const fromPath = path.join(dir, fromFile);
  const toPath = path.join(dir, toFile);

  if (!fs.existsSync(fromPath)) {
    return null;
  }

  if (fromPath !== toPath) {
    fs.renameSync(fromPath, toPath);
  }

  return toPath;
}

/**
 * Check if a format is PlantUML-based.
 */
export function isPlantUMLFormat(format: DiagramFormat): boolean {
  return format === 'plantuml';
}

/**
 * Render PlantUML source to SVG via Kroki or local jar.
 */
export async function renderPlantUML(
  source: string,
  options?: { krokiUrl?: string; plantumlJar?: string }
): Promise<string> {
  const krokiUrl = options?.krokiUrl || 'https://kroki.io';
  let plantumlJar = options?.plantumlJar;

  // Auto-detect jar if not provided
  if (!plantumlJar) {
    const { getConfiguredPlantUMLJar } = await import('./plantuml-setup.js');
    plantumlJar = getConfiguredPlantUMLJar() || undefined;
  }

  // Try local jar first if configured
  if (plantumlJar && fs.existsSync(plantumlJar)) {
    return renderPlantUMLLocal(source, plantumlJar);
  }

  // Use Kroki
  return renderPlantUMLKroki(source, krokiUrl);
}

/**
 * Render PlantUML using local plantuml.jar
 */
async function renderPlantUMLLocal(source: string, jarPath: string): Promise<string> {
  const { execSync } = await import('node:child_process');
  const { writeFileSync, unlinkSync } = await import('node:fs');
  const os = await import('node:os');
  const pathMod = await import('node:path');

  const tmpDir = os.tmpdir();
  const tmpFile = pathMod.join(tmpDir, `plantuml-${Date.now()}.puml`);
  const tmpSvg = tmpFile.replace('.puml', '.svg');

  try {
    writeFileSync(tmpFile, source, 'utf-8');
    execSync(`java -jar "${jarPath}" -tsvg -o "${tmpDir}" "${tmpFile}"`, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const svg = fs.readFileSync(tmpSvg, 'utf-8');
    return svg;
  } finally {
    try { unlinkSync(tmpFile); } catch { /* ignore */ }
    try { unlinkSync(tmpSvg); } catch { /* ignore */ }
  }
}

/**
 * Render PlantUML via Kroki API
 */
async function renderPlantUMLKroki(source: string, krokiUrl: string): Promise<string> {
  const compressed = deflateSync(source, { level: 9 });
  const encoded = compressed.toString('base64url');
  const url = `${krokiUrl}/plantuml/svg/${encoded}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: { 'Accept': 'image/svg+xml' },
  });

  if (!res.ok) {
    throw new Error(`Kroki render failed: ${res.status} ${res.statusText}`);
  }

  return res.text();
}
