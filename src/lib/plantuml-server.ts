import { execSync, spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const PLANTUML_DIR = path.join(os.homedir(), '.omnimap');
const PLANTUML_JAR = path.join(PLANTUML_DIR, 'plantuml.jar');
const PID_FILE = path.join(PLANTUML_DIR, 'plantuml-server.pid');

/**
 * Check if PlantUML server is running
 */
export function isPlantUMLServerRunning(): boolean {
  if (fs.existsSync(PID_FILE)) {
    try {
      const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim());
      process.kill(pid, 0);
      return true;
    } catch {
      try { fs.unlinkSync(PID_FILE); } catch { /* ignore */ }
    }
  }
  return false;
}

/**
 * Start PlantUML server (not recommended - use Kroki instead)
 */
export function startPlantUMLServer(): boolean {
  // Not implemented - Kroki is faster and more reliable
  return false;
}

/**
 * Stop PlantUML server
 */
export function stopPlantUMLServer(): void {
  if (fs.existsSync(PID_FILE)) {
    try {
      const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim());
      process.kill(pid, 'SIGTERM');
    } catch { /* ignore */ }
    try { fs.unlinkSync(PID_FILE); } catch { /* ignore */ }
  }
}

/**
 * Ensure PlantUML server is running (stub - uses Kroki instead)
 */
export function ensurePlantUMLServer(): boolean {
  return false; // Kroki is the default renderer
}
