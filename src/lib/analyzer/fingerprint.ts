import fs from 'node:fs';
import crypto from 'node:crypto';
import type { FingerprintDelta, DefinitionInfo } from './types.js';

export interface FileFingerprint {
  file: string;
  hash: string;
  definitions: DefinitionInfo[];
  definitionHashes: Map<string, string>;
}

export function hashDefinition(def: DefinitionInfo): string {
  const content = `${def.name}:${def.kind}:${def.line}:${def.endLine}`;
  return crypto.createHash('md5').update(content).digest('hex').slice(0, 12);
}

export function fingerprintFile(file: string, definitions: DefinitionInfo[]): FileFingerprint {
  const definitionHashes = new Map<string, string>();
  for (const def of definitions) {
    const key = `${def.kind}:${def.name}`;
    definitionHashes.set(key, hashDefinition(def));
  }

  const hashContent = definitions
    .map(d => `${d.kind}:${d.name}:${d.line}:${d.endLine}`)
    .sort()
    .join('\n');
  const hash = crypto.createHash('md5').update(hashContent || 'empty').digest('hex').slice(0, 16);

  return { file, hash, definitions, definitionHashes };
}

export function diffFingerprints(
  prev: FileFingerprint,
  curr: FileFingerprint,
): FingerprintDelta {
  const added: DefinitionInfo[] = [];
  const removed: DefinitionInfo[] = [];
  const modified: DefinitionInfo[] = [];

  const prevByKey = new Map<string, DefinitionInfo>();
  for (const def of prev.definitions) {
    prevByKey.set(`${def.kind}:${def.name}`, def);
  }

  const currByKey = new Map<string, DefinitionInfo>();
  for (const def of curr.definitions) {
    currByKey.set(`${def.kind}:${def.name}`, def);
  }

  for (const [key, def] of currByKey) {
    if (!prevByKey.has(key)) {
      added.push(def);
    } else {
      const prevDef = prevByKey.get(key)!;
      const prevHash = prev.definitionHashes.get(key);
      const currHash = curr.definitionHashes.get(key);
      if (prevHash !== currHash) {
        modified.push(def);
      }
    }
  }

  for (const [key, def] of prevByKey) {
    if (!currByKey.has(key)) {
      removed.push(def);
    }
  }

  const unchanged = curr.definitions.length - added.length - modified.length;

  return {
    file: curr.file,
    added,
    removed,
    modified,
    unchanged,
    hasChanges: added.length > 0 || removed.length > 0 || modified.length > 0,
  };
}

export function loadFingerprintCache(cachePath: string): Map<string, FileFingerprint> {
  const cache = new Map<string, FileFingerprint>();
  try {
    if (!fs.existsSync(cachePath)) return cache;
    const data = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    for (const [file, fp] of Object.entries(data as Record<string, any>)) {
      cache.set(file, {
        file: fp.file,
        hash: fp.hash,
        definitions: fp.definitions,
        definitionHashes: new Map(Object.entries(fp.definitionHashes)),
      });
    }
  } catch (err: any) {
    process.stderr.write(`warning: could not read fingerprint cache (${err.message}), starting fresh\n`);
  }
  return cache;
}

export function saveFingerprintCache(cachePath: string, cache: Map<string, FileFingerprint>): void {
  const data: Record<string, any> = {};
  for (const [file, fp] of cache) {
    data[file] = {
      file: fp.file,
      hash: fp.hash,
      definitions: fp.definitions,
      definitionHashes: Object.fromEntries(fp.definitionHashes),
    };
  }
  fs.writeFileSync(cachePath, JSON.stringify(data, null, 2), 'utf-8');
}

export function computeFingerprintDeltas(
  prevCache: Map<string, FileFingerprint>,
  currentFiles: Map<string, DefinitionInfo[]>,
): FingerprintDelta[] {
  const deltas: FingerprintDelta[] = [];

  for (const [file, definitions] of currentFiles) {
    const curr = fingerprintFile(file, definitions);
    const prev = prevCache.get(file);

    if (!prev) {
      deltas.push({
        file,
        added: definitions,
        removed: [],
        modified: [],
        unchanged: 0,
        hasChanges: true,
      });
    } else if (prev.hash !== curr.hash) {
      deltas.push(diffFingerprints(prev, curr));
    }
  }

  for (const [file] of prevCache) {
    if (!currentFiles.has(file)) {
      deltas.push({
        file,
        added: [],
        removed: prevCache.get(file)!.definitions,
        modified: [],
        unchanged: 0,
        hasChanges: true,
      });
    }
  }

  return deltas;
}
