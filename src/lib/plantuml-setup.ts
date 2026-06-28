import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const PLANTUML_VERSION = '1.2026.6';
const PLANTUML_DIR = path.join(os.homedir(), '.omnimap');
const PLANTUML_NATIVE = path.join(PLANTUML_DIR, process.platform === 'win32' ? 'plantuml.exe' : 'plantuml');
const PLANTUML_JAR = path.join(PLANTUML_DIR, 'plantuml.jar');

// Native binary URLs by platform
const NATIVE_URLS: Record<string, string> = {
  'darwin-arm64': `https://github.com/plantuml/plantuml/releases/download/v${PLANTUML_VERSION}/native-plantuml-macos-arm64-${PLANTUML_VERSION}.zip`,
  'darwin-x64': `https://github.com/plantuml/plantuml/releases/download/v${PLANTUML_VERSION}/native-plantuml-macos-x86_64-${PLANTUML_VERSION}.zip`,
  'linux-x64': `https://github.com/plantuml/plantuml/releases/download/v${PLANTUML_VERSION}/native-plantuml-linux-amd64-${PLANTUML_VERSION}.zip`,
  'linux-arm64': `https://github.com/plantuml/plantuml/releases/download/v${PLANTUML_VERSION}/native-plantuml-linux-arm64-${PLANTUML_VERSION}.zip`,
  'win32-x64': `https://github.com/plantuml/plantuml/releases/download/v${PLANTUML_VERSION}/native-plantuml-windows-amd64-${PLANTUML_VERSION}.zip`,
};

function getPlatformKey(): string {
  const platform = process.platform;
  const arch = process.arch;
  return `${platform}-${arch}`;
}

/**
 * Get the path to plantuml binary (native or jar), downloading if needed.
 * Returns null if not available.
 */
export async function ensurePlantUML(): Promise<string | null> {
  // Prefer native binary (fast, no Java needed)
  if (fs.existsSync(PLANTUML_NATIVE)) return PLANTUML_NATIVE;
  
  // Fall back to JAR (requires Java)
  if (isJavaAvailable() && fs.existsSync(PLANTUML_JAR)) return PLANTUML_JAR;
  
  // Auto-download
  return await downloadPlantUML();
}

/**
 * Check if Java is installed
 */
export function isJavaAvailable(): boolean {
  try {
    execSync('java -version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Download PlantUML (native binary preferred, JAR fallback) to ~/.omnimap/
 */
export async function downloadPlantUML(): Promise<string | null> {
  if (!fs.existsSync(PLANTUML_DIR)) {
    fs.mkdirSync(PLANTUML_DIR, { recursive: true });
  }

  const hasCurl = (() => { try { execSync('command -v curl', { stdio: 'ignore' }); return true; } catch { return false; } })();
  const hasWget = (() => { try { execSync('command -v wget', { stdio: 'ignore' }); return true; } catch { return false; } })();

  if (!hasCurl && !hasWget) {
    process.stderr.write('warning: curl or wget required to download PlantUML.\n');
    return null;
  }

  // Try native binary first (10x faster)
  const platformKey = getPlatformKey();
  const nativeUrl = NATIVE_URLS[platformKey];

  if (nativeUrl) {
    process.stderr.write(`Downloading PlantUML native binary v${PLANTUML_VERSION}...\n`);
    try {
      const zipPath = path.join(PLANTUML_DIR, 'plantuml.zip');
      if (hasCurl) {
        execSync(`curl -L -o "${zipPath}" "${nativeUrl}"`, { stdio: 'ignore' });
      } else {
        execSync(`wget -O "${zipPath}" "${nativeUrl}"`, { stdio: 'ignore' });
      }
      execSync(`cd "${PLANTUML_DIR}" && unzip -o plantuml.zip && chmod +x plantuml && rm plantuml.zip`, { stdio: 'ignore' });

      if (fs.existsSync(PLANTUML_NATIVE)) {
        process.stderr.write(`Done! Native binary saved to ${PLANTUML_NATIVE}\n`);
        process.stderr.write(`Speed: ~200ms (10x faster than JAR)\n`);
        return PLANTUML_NATIVE;
      }
    } catch { /* fall through to JAR */ }
  }

  // Fall back to JAR
  process.stderr.write(`Downloading PlantUML JAR v${PLANTUML_VERSION}...\n`);
  const jarUrl = `https://github.com/plantuml/plantuml/releases/download/v${PLANTUML_VERSION}/plantuml-${PLANTUML_VERSION}.jar`;

  try {
    if (hasCurl) {
      execSync(`curl -L -o "${PLANTUML_JAR}" "${jarUrl}"`, { stdio: 'ignore' });
    } else {
      execSync(`wget -O "${PLANTUML_JAR}" "${jarUrl}"`, { stdio: 'ignore' });
    }

    const stats = fs.statSync(PLANTUML_JAR);
    if (stats.size < 1000000) {
      fs.unlinkSync(PLANTUML_JAR);
      process.stderr.write('warning: Download incomplete.\n');
      return null;
    }

    process.stderr.write(`Done! JAR saved to ${PLANTUML_JAR}\n`);
    return PLANTUML_JAR;
  } catch (err: any) {
    process.stderr.write(`warning: Download failed: ${err.message}\n`);
    return null;
  }
}

/**
 * Get the configured plantuml path (native or jar)
 */
export function getConfiguredPlantUML(): string | null {
  // Check config.yaml for custom path
  try {
    const YAML = require('yaml');
    const ommDir = path.join(process.cwd(), '.omm');
    const configPath = path.join(ommDir, 'config.yaml');
    if (fs.existsSync(configPath)) {
      const config = YAML.parse(fs.readFileSync(configPath, 'utf-8'));
      if (config?.plantuml_jar && fs.existsSync(config.plantuml_jar)) {
        return config.plantuml_jar;
      }
    }
  } catch { /* ignore */ }

  // Prefer native binary (fast)
  if (fs.existsSync(PLANTUML_NATIVE)) return PLANTUML_NATIVE;

  // Fall back to JAR
  if (fs.existsSync(PLANTUML_JAR)) return PLANTUML_JAR;
  return null;
}

/** @deprecated Use getConfiguredPlantUML() */
export function getConfiguredPlantUMLJar(): string | null {
  return getConfiguredPlantUML();
}

/**
 * Get status info
 */
export function getPlantUMLStatus(): { available: boolean; path?: string; java: boolean; native: boolean } {
  const java = isJavaAvailable();
  const plantumlPath = getConfiguredPlantUML();
  const isNative = plantumlPath !== null && plantumlPath.endsWith('/plantuml') && !plantumlPath.endsWith('.jar');
  return { 
    available: plantumlPath !== null && (java || isNative), 
    path: plantumlPath || undefined, 
    java,
    native: isNative,
  };
}
