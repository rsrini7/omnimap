import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
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

/** Per-field weight — entry-point and intent fields outrank free-form notes.
 *  Diagram is weighted low because mermaid syntax (graph LR; A-->B) contains
 *  identifiers that are rarely meaningful search targets. */
const FIELD_WEIGHT: Record<Field, number> = {
  description: 4.0,
  context: 2.5,
  constraint: 2.0,
  concern: 1.5,
  diagram: 1.0,
  todo: 1.0,
  note: 0.5,
};

/** Levenshtein distance between two strings. */
function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      dp[j] = a[i - 1] === b[j - 1]
        ? prev
        : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = temp;
    }
  }
  return dp[n];
}

/** Find the best fuzzy match score for a token against words in text.
 *  Returns 0 if no match, or a score proportional to similarity (max ~token length). */
function fuzzyMatch(token: string, text: string): number {
  const words = text.split(/[^a-z0-9]+/).filter(w => w.length >= 2);
  let best = 0;
  const maxDist = token.length >= 5 ? 2 : 1;
  for (const w of words) {
    if (Math.abs(w.length - token.length) > maxDist) continue;
    const dist = editDistance(token, w);
    if (dist <= maxDist) {
      const score = (token.length - dist) * 1.5; // lower than exact match
      if (score > best) best = score;
    }
  }
  return best;
}

/**
 * Score a doc against the query tokens.
 * - Each token hit adds score proportional to its length.
 * - A literal phrase hit (the full query as a substring) adds a flat bonus.
 * - Fuzzy matches get partial scores when exact match fails.
 * - Field weight is applied as a multiplier.
 */
function scoreDoc(tokens: string[], phrase: string, docText: string, field: Field): number {
  const lower = docText.toLowerCase();
  let s = 0;
  for (const t of tokens) {
    if (lower.includes(t)) {
      s += Math.min(t.length, 12) * 2;
    } else {
      // Fallback: fuzzy match
      s += fuzzyMatch(t, lower);
    }
  }
  if (phrase && phrase.length >= MIN_TOKEN_LENGTH && lower.includes(phrase)) {
    s += phrase.length * 3;
  }
  return s * FIELD_WEIGHT[field];
}

/**
 * Render a snippet with markdown formatting and match highlighting.
 * Extracts a window around the match, renders inline markdown, then highlights.
 */
function makeSnippet(text: string, query: string, tokens: string[]): string {
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
    // Fuzzy fallback: find closest word if no exact match
    if (idx < 0) {
      const words = lower.split(/[^a-z0-9]+/);
      for (const t of tokens) {
        const maxDist = t.length >= 5 ? 2 : 1;
        for (const w of words) {
          if (w.length < 2 || Math.abs(w.length - t.length) > maxDist) continue;
          const dist = editDistance(t, w);
          if (dist <= maxDist) {
            const wIdx = lower.indexOf(w);
            if (wIdx >= 0 && (idx < 0 || dist < hitLen)) {
              idx = wIdx;
              hitLen = w.length;
            }
          }
        }
      }
    }
  }

  // Extract a window around the match
  let snippet: string;
  if (idx < 0) {
    snippet = text.slice(0, 220).trim();
    if (text.length > 220) snippet += '…';
  } else {
    const start = Math.max(0, idx - 90);
    const end = Math.min(text.length, idx + hitLen + 140);
    snippet = (start > 0 ? '…' : '') + text.slice(start, end).trim() + (end < text.length ? '…' : '');
  }

  // Render inline markdown (bold, links, code) — safe subset
  let html = snippet
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  // Bold **text**
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic *text*
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Inline code `text`
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Links [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:inherit">$1</a>');

  // Highlight the matched term in the rendered HTML
  if (idx >= 0 && tokens.length > 0) {
    const matchText = snippet.slice(
      idx < 0 ? 0 : idx - Math.max(0, idx - 90),
      idx < 0 ? 0 : idx - Math.max(0, idx - 90) + hitLen
    );
    if (matchText) {
      const escaped = matchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      try {
        html = html.replace(new RegExp(escaped, 'i'), '<mark>$&</mark>');
      } catch { /* regex safety */ }
    }
  }

  return html;
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

  // Parse tag:xxx filters from query
  const tagFilter: string[] = [];
  const remaining = q.replace(/tag:([\w-]+)/g, (_, tag) => { tagFilter.push(tag.toLowerCase()); return ''; }).trim();
  const tokens = tokenize(remaining);
  const phrase = remaining.toLowerCase();

  // Filter by tags if specified
  function hasTag(elementPath: string): boolean {
    if (!tagFilter.length) return true;
    const metaPath = path.join(ommDir, elementPath.replace(/\//g, path.sep), 'meta.yaml');
    try {
      const meta = YAML.parse(fs.readFileSync(metaPath, 'utf-8')) as { tags?: string[] } | null;
      const tags = (meta?.tags ?? []).map(t => t.toLowerCase());
      return tagFilter.every(ft => tags.includes(ft));
    } catch { return false; }
  }

  // Empty query (or tag-only query): return matching elements
  if (!tokens.length) {
    const seen = new Set<string>();
    const featured: SearchResult[] = [];
    if (tagFilter.length) {
      // Tag-only: show all matching elements
      for (const e of index?.entries ?? []) {
        if (seen.has(e.elementPath)) continue;
        if (!hasTag(e.elementPath)) continue;
        seen.add(e.elementPath);
        featured.push({ elementPath: e.elementPath, perspective: e.perspective, field: e.field, score: 0, snippet: '' });
        if (featured.length >= limit) break;
      }
    } else {
      // No query: show top-level perspectives only
      for (const e of index?.entries ?? []) {
        if (seen.has(e.perspective)) continue;
        seen.add(e.perspective);
        featured.push({ elementPath: e.perspective, perspective: e.perspective, field: e.field, score: 0, snippet: '' });
        if (featured.length >= limit) break;
      }
    }
    return { query, total: featured.length, results: featured, limit, offset, featured: !tagFilter.length };
  }

  const ranked: SearchResult[] = [];
  for (const e of index?.entries ?? []) {
    if (!hasTag(e.elementPath)) continue;
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
