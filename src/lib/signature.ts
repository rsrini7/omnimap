/**
 * signature.ts — Structural signature for .omm/ drift detection.
 *
 * Computes a SHA-256 hash of element paths (structure only, not content).
 * Used to detect when elements are added, removed, or renamed.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { getOmmDir } from './store.js';
import { loadElementIndex } from './incremental.js';

// ── Types ──────────────────────────────────────────────────────────

export interface SignatureResult {
  signature: string;
  elementCount: number;
  perspectives: number;
}

export interface SignatureCheckResult {
  match: boolean;
  stored: string | null;
  current: string;
  currentResult: SignatureResult;
}

// ── Core functions ─────────────────────────────────────────────────

/**
 * Compute SHA-256 signature of the element tree structure.
 *
 * The signature hashes element paths only (not descriptions, diagrams, etc.).
 * This means:
 * - Editing a description → signature unchanged (content drift, not structural drift)
 * - Adding/removing an element → signature changes (structural drift)
 *
 * @param ommDir - Path to .omm/ directory
 * @returns Signature result with hash and element counts
 */
export function computeSignature(ommDir: string): SignatureResult {
  // Reuse loadElementIndex — already walks .omm/ and parses meta.yaml
  const paths = loadElementIndex(ommDir)
    .map(el => el.elementPath)
    .sort();

  const payload = paths.join('\n');
  const hash = crypto.createHash('sha256').update(payload).digest('hex');
  const signature = `sha256:${hash}`;

  return {
    signature,
    elementCount: paths.length,
    perspectives: paths.filter(p => !p.includes('/')).length,
  };
}

/**
 * Read stored signature from config.yaml.
 *
 * @param ommDir - Path to .omm/ directory
 * @returns Stored signature string, or null if not set
 */
export function readStoredSignature(ommDir: string): string | null {
  const configPath = path.join(ommDir, 'config.yaml');
  if (!fs.existsSync(configPath)) return null;

  try {
    const config = YAML.parse(fs.readFileSync(configPath, 'utf-8'));
    return config?.signature ?? null;
  } catch {
    return null;
  }
}

/**
 * Write signature to config.yaml.
 *
 * @param ommDir - Path to .omm/ directory
 * @param signature - Signature string to store
 */
export function writeSignature(ommDir: string, signature: string): void {
  const configPath = path.join(ommDir, 'config.yaml');

  let config: Record<string, unknown> = { version: '0.1.0' };
  if (fs.existsSync(configPath)) {
    try {
      config = YAML.parse(fs.readFileSync(configPath, 'utf-8')) ?? config;
    } catch {
      // use default
    }
  }

  config.signature = signature;
  config.signature_updated = new Date().toISOString();

  fs.writeFileSync(configPath, YAML.stringify(config), 'utf-8');
}

/**
 * Check if stored signature matches current tree structure.
 *
 * @param ommDir - Path to .omm/ directory
 * @returns Check result with match status and signatures
 */
export function checkSignature(ommDir: string): SignatureCheckResult {
  const stored = readStoredSignature(ommDir);
  const currentResult = computeSignature(ommDir);

  return {
    match: stored === currentResult.signature,
    stored,
    current: currentResult.signature,
    currentResult,
  };
}
