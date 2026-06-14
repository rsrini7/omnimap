import fs from 'node:fs';
import path from 'node:path';
import type { Field } from '../types.js';
import { FIELD_FILES } from '../types.js';
import { getOmmDir } from '../lib/store.js';

export type SearchField = Field;

export interface SearchResult {
  /** Full element path relative to .omm/, e.g. "persp" or "persp/child/leaf". */
  elementPath: string;
  /** Short perspective name (first segment of elementPath). Kept for back-compat. */
  perspective: string;
  field: SearchField;
  /** Final score after field weighting and phrase boost. */
  score: number;
  /** HTML snippet with <mark> tags around matched terms. Safe to innerHTML. */
  snippet: string;
}

export interface SearchResponse {
  query: string;
  total: number;
  results: SearchResult[];
  /** Echoed for the viewer to use. */
  limit: number;
  offset: number;
  /** When q is empty, we return "featured" perspectives (top-level). */
  featured: boolean;
}

export interface SearchOptions {
  limit?: number;
  offset?: number;
  /** Minimum final score to include in results. Default 2. */
  minScore?: number;
}

interface IndexEntry {
  elementPath: string;     // e.g. "persp/child/leaf" or "persp"
  perspective: string;     // first segment
  field: SearchField;
  text: string;
  fullPath: string;        // absolute file path
}

interface Index {
  builtAt: number;
  entries: IndexEntry[];
}

let cachedIndex: Index | null = null;

/** Hook used by the SSE watcher to invalidate the cache on any .omm/ change. */
export function invalidateSearchIndex(): void {
  cachedIndex = null;
}

const MIN_TOKEN_LENGTH = 2;
const MAX_RESULTS = 50;
const DEFAULT_LIMIT = 20;

/** Split a query / identifier into searchable tokens. */
function tokenize(q: string): string[] {
  if (!q) return [];
  // Split on non-alphanumerics, then split camelCase / kebab / snake.
  return Array.from(
    new Set(
      q
        .toLowerCase()
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[^a-z0-9\s_-]/g, ' ')
        .split(/[\s_-]+/)
        .map(s => s.trim())
        .filter(s => s.length >= MIN_TOKEN_LENGTH),
    ),
  );
}

/** Per-field weight — entry-point and intent fields outrank free-form notes. */
const FIELD_WEIGHT: Record<Field, number> = {
  description: 4.0,
  diagram: 3.5,
  context: 2.5,
  constraint: 2.0,
  concern: 1.5,
  todo: 1.0,
  note: 0.5,
};

/**
 * Score a doc against the query tokens.
 * - Each token hit adds score proportional to its length.
 * - A literal phrase hit (the full query as a substring) adds a flat bonus.
 * - Field weight is applied as a multiplier.
 */
function scoreDoc(tokens: string[], phrase: string, docText: string, field: Field): number {
  const lower = docText.toLowerCase();
  let s = 0;
  for (const t of tokens) {
    if (lower.includes(t)) s += Math.min(t.length, 12) * 2;
  }
  if (phrase && phrase.length >= MIN_TOKEN_LENGTH && lower.includes(phrase)) {
    s += phrase.length * 3;
  }
  return s * FIELD_WEIGHT[field];
}

/**
 * Build a snippet that highlights one of the matched tokens (or the phrase).
 * Output is HTML with <mark> tags; tokens are HTML-escaped first.
 */
function makeSnippet(text: string, query: string, tokens: string[]): string {
  const esc = (s: string) => s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const phrase = query.trim().toLowerCase();
  const lower = text.toLowerCase();
  let idx = -1;
  let hitLen = 0;
  if (phrase.length >= MIN_TOKEN_LENGTH && lower.includes(phrase)) {
    idx = lower.indexOf(phrase);
    hitLen = phrase.length;
  } else {
    for (const t of tokens) {
      const at = lower.indexOf(t);
      if (at >= 0 && (idx < 0 || at < idx)) {
        idx = at;
        hitLen = t.length;
      }
    }
  }

  if (idx < 0) {
    const head = text.slice(0, 220).trim();
    return esc(head) + (text.length > 220 ? '…' : '');
  }

  const start = Math.max(0, idx - 90);
  const end = Math.min(text.length, idx + hitLen + 140);
  const slice = text.slice(start, end);
  // Find the hit region inside slice.
  const hitOffset = idx - start;
  const before = esc(slice.slice(0, hitOffset));
  const hit = esc(slice.slice(hitOffset, hitOffset + hitLen));
  const after = esc(slice.slice(hitOffset + hitLen));
  return (start > 0 ? '…' : '') + before + '<mark>' + hit + '</mark>' + after + (end < text.length ? '…' : '');
}

function listOmmFiles(ommDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) out.push(p);
    }
  };
  walk(ommDir);
  return out;
}

function buildIndex(ommDir: string): Index {
  const entries: IndexEntry[] = [];
  const files = listOmmFiles(ommDir);
  const fieldByName: Record<string, Field> = {};
  for (const f of Object.keys(FIELD_FILES) as Field[]) {
    fieldByName[FIELD_FILES[f]] = f;
  }

  for (const filePath of files) {
    const rel = path.relative(ommDir, filePath);
    if (rel.startsWith('config.yaml') || rel.endsWith(path.sep + 'meta.yaml') || rel === 'meta.yaml') continue;
    const base = path.basename(filePath);
    const field = fieldByName[base];
    if (!field) continue;

    // Build elementPath = posix path of the file's parent dir relative to ommDir.
    const parentRel = path.relative(ommDir, path.dirname(filePath));
    const elementPath = parentRel.split(path.sep).join('/');
    const perspective = elementPath.split('/')[0];

    let text: string;
    try {
      text = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }
    if (!text || !text.trim()) continue;
    entries.push({ elementPath, perspective, field, text, fullPath: filePath });
  }

  return { builtAt: Date.now(), entries };
}

function getIndex(ommDir: string): Index | null {
  if (cachedIndex) return cachedIndex;
  cachedIndex = buildIndex(ommDir);
  return cachedIndex;
}

export function searchOmm(query: string, opts: SearchOptions = {}): SearchResponse {
  const limit = Math.max(1, Math.min(MAX_RESULTS, opts.limit ?? DEFAULT_LIMIT));
  const offset = Math.max(0, opts.offset ?? 0);
  const minScore = opts.minScore ?? 2;
  const ommDir = getOmmDir();

  if (!fs.existsSync(ommDir)) {
    return { query, total: 0, results: [], limit, offset, featured: false };
  }

  const index = getIndex(ommDir);
  const q = query.trim();
  const tokens = tokenize(q);

  // Empty query: return top-level perspectives as "featured" suggestions.
  if (!tokens.length) {
    const seen = new Set<string>();
    const featured: SearchResult[] = [];
    for (const e of index?.entries ?? []) {
      if (seen.has(e.perspective)) continue;
      seen.add(e.perspective);
      featured.push({
        elementPath: e.perspective,
        perspective: e.perspective,
        field: e.field,
        score: 0,
        snippet: '',
      });
      if (featured.length >= limit) break;
    }
    return { query, total: featured.length, results: featured, limit, offset, featured: true };
  }

  const phrase = q.toLowerCase();
  const ranked: SearchResult[] = [];
  for (const e of index?.entries ?? []) {
    const s = scoreDoc(tokens, phrase, e.text, e.field);
    if (s < minScore) continue;
    ranked.push({
      elementPath: e.elementPath,
      perspective: e.perspective,
      field: e.field,
      score: Math.round(s * 10) / 10,
      snippet: makeSnippet(e.text, q, tokens),
    });
  }

  ranked.sort((a, b) => b.score - a.score);

  return {
    query,
    total: ranked.length,
    results: ranked.slice(offset, offset + limit),
    limit,
    offset,
    featured: false,
  };
}
