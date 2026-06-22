import fs from 'node:fs';
import path from 'node:path';
import { getOmmDir } from '../store.js';

let _db: any = null;

async function getDb(): Promise<any | null> {
  if (_db) return _db;
  try {
    const Database = (await import('better-sqlite3')).default;
    const ommDir = getOmmDir();
    if (!ommDir) return null;
    const dbPath = path.join(ommDir, 'omm.db');
    _db = new Database(dbPath);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    initSchema(_db);
    return _db;
  } catch {
    return null;
  }
}

function initSchema(db: any): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS elements (
      path TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      description TEXT,
      diagram TEXT,
      context TEXT,
      constraint_text TEXT,
      concern TEXT,
      todo TEXT,
      note TEXT,
      meta_json TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS flows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      element_path TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      steps_json TEXT,
      FOREIGN KEY (element_path) REFERENCES elements(path) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS analysis_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_at TEXT DEFAULT (datetime('now')),
      stats_json TEXT,
      graph_json TEXT,
      insights_json TEXT
    );

    CREATE TABLE IF NOT EXISTS file_index (
      file_path TEXT PRIMARY KEY,
      language TEXT,
      definitions_json TEXT,
      imports_json TEXT,
      exports_json TEXT,
      fingerprint TEXT,
      last_analyzed TEXT
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS elements_fts USING fts5(
      path, name, description, context, concern, todo, note,
      content='elements',
      content_rowid='rowid'
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS file_index_fts USING fts5(
      file_path, language, definitions_json,
      content='file_index',
      content_rowid='rowid'
    );

    CREATE TRIGGER IF NOT EXISTS elements_ai AFTER INSERT ON elements BEGIN
      INSERT INTO elements_fts(rowid, path, name, description, context, concern, todo, note)
      VALUES (new.rowid, new.path, new.name, new.description, new.context, new.concern, new.todo, new.note);
    END;

    CREATE TRIGGER IF NOT EXISTS elements_ad AFTER DELETE ON elements BEGIN
      INSERT INTO elements_fts(elements_fts, rowid, path, name, description, context, concern, todo, note)
      VALUES ('delete', old.rowid, old.path, old.name, old.description, old.context, old.concern, old.todo, old.note);
    END;

    CREATE TRIGGER IF NOT EXISTS elements_au AFTER UPDATE ON elements BEGIN
      INSERT INTO elements_fts(elements_fts, rowid, path, name, description, context, concern, todo, note)
      VALUES ('delete', old.rowid, old.path, old.name, old.description, old.context, old.concern, old.todo, old.note);
      INSERT INTO elements_fts(rowid, path, name, description, context, concern, todo, note)
      VALUES (new.rowid, new.path, new.name, new.description, new.context, new.concern, new.todo, new.note);
    END;
  `);
}

export async function isSqliteAvailable(): Promise<boolean> {
  try {
    const db = await getDb();
    return db !== null;
  } catch {
    return false;
  }
}

export async function syncToSqlite(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const { listClasses, listNodes, readField, readNodeField, readMeta, readNodeMeta, readFlows } = await import('../store.js');

  const perspectives = listClasses();
  const upsert = db.prepare(`
    INSERT INTO elements (path, name, type, description, diagram, context, constraint_text, concern, todo, note, meta_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(path) DO UPDATE SET
      name=excluded.name, type=excluded.type, description=excluded.description,
      diagram=excluded.diagram, context=excluded.context, constraint_text=excluded.constraint_text,
      concern=excluded.concern, todo=excluded.todo, note=excluded.note,
      meta_json=excluded.meta_json, updated_at=datetime('now')
  `);

  const upsertFlow = db.prepare(`
    INSERT INTO flows (element_path, name, description, steps_json)
    VALUES (?, ?, ?, ?)
  `);

  const deleteFlows = db.prepare(`DELETE FROM flows WHERE element_path = ?`);

  const transaction = db.transaction(() => {
    // Clear existing records to handle deleted files
    db.prepare('DELETE FROM elements').run();

    for (const persp of perspectives) {
      const desc = readField(persp, 'description') || null;
      const diagram = readField(persp, 'diagram') || null;
      const ctx = readField(persp, 'context') || null;
      const con = readField(persp, 'constraint') || null;
      const concern = readField(persp, 'concern') || null;
      const todo = readField(persp, 'todo') || null;
      const note = readField(persp, 'note') || null;
      const meta = readMeta(persp);
      upsert.run(persp, persp.split('/').pop(), 'perspective', desc, diagram, ctx, con, concern, todo, note, meta ? JSON.stringify(meta) : null);

      const flows = readFlows(persp);
      if (flows.length > 0) {
        deleteFlows.run(persp);
        for (const flow of flows) {
          upsertFlow.run(persp, flow.name, flow.description || null, JSON.stringify(flow.steps));
        }
      }

      const walk = (nodePath: string[]) => {
        const childPath = `${persp}/${nodePath.join('/')}`;
        const name = nodePath[nodePath.length - 1];
        const cDesc = readNodeField(persp, nodePath, 'description') || null;
        const cDiagram = readNodeField(persp, nodePath, 'diagram') || null;
        const cCtx = readNodeField(persp, nodePath, 'context') || null;
        const cCon = readNodeField(persp, nodePath, 'constraint') || null;
        const cConcern = readNodeField(persp, nodePath, 'concern') || null;
        const cTodo = readNodeField(persp, nodePath, 'todo') || null;
        const cNote = readNodeField(persp, nodePath, 'note') || null;
        const cMeta = readNodeMeta(persp, nodePath);
        upsert.run(childPath, name, 'leaf', cDesc, cDiagram, cCtx, cCon, cConcern, cTodo, cNote, cMeta ? JSON.stringify(cMeta) : null);

        const childFlows = readFlows(childPath);
        if (childFlows.length > 0) {
          deleteFlows.run(childPath);
          for (const flow of childFlows) {
            upsertFlow.run(childPath, flow.name, flow.description || null, JSON.stringify(flow.steps));
          }
        }

        const children = listNodes(persp, nodePath);
        for (const child of children) {
          walk([...nodePath, child]);
        }
      };

      const children = listNodes(persp, []);
      for (const child of children) {
        walk([child]);
      }
    }
  });

  transaction();
}

export async function searchElements(query: string, limit: number = 20): Promise<{ path: string; rank: number; snippet: string }[]> {
  const db = await getDb();
  if (!db) return [];

  try {
    const rows = db.prepare(`
      SELECT path, rank, snippet(elements_fts, -1, '>>>', '<<<', '...', 32) as snip
      FROM elements_fts
      WHERE elements_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(query, limit);

    return rows.map((r: any) => ({ path: r.path, rank: r.rank, snippet: r.snip }));
  } catch {
    return [];
  }
}

export async function searchFiles(query: string, limit: number = 20): Promise<{ file_path: string; rank: number }[]> {
  const db = await getDb();
  if (!db) return [];

  try {
    const rows = db.prepare(`
      SELECT file_path, rank
      FROM file_index_fts
      WHERE file_index_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(query, limit);

    return rows.map((r: any) => ({ file_path: r.file_path, rank: r.rank }));
  } catch {
    return [];
  }
}

export async function storeAnalysisResult(stats: any, graph: any, insights: any): Promise<void> {
  const db = await getDb();
  if (!db) return;

  db.prepare(`
    INSERT INTO analysis_results (stats_json, graph_json, insights_json)
    VALUES (?, ?, ?)
  `).run(JSON.stringify(stats), JSON.stringify(graph), JSON.stringify(insights));
}

export async function storeFileIndex(filePath: string, language: string, definitions: any[], imports: any[], exports: any[], fingerprint: string): Promise<void> {
  const db = await getDb();
  if (!db) return;

  db.prepare(`
    INSERT INTO file_index (file_path, language, definitions_json, imports_json, exports_json, fingerprint, last_analyzed)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(file_path) DO UPDATE SET
      language=excluded.language, definitions_json=excluded.definitions_json,
      imports_json=excluded.imports_json, exports_json=excluded.exports_json,
      fingerprint=excluded.fingerprint, last_analyzed=datetime('now')
  `).run(filePath, language, JSON.stringify(definitions), JSON.stringify(imports), JSON.stringify(exports), fingerprint);
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
