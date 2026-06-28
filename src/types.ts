export const VALID_FIELDS = ['description', 'diagram', 'constraint', 'concern', 'context', 'todo', 'note'] as const;
export type Field = (typeof VALID_FIELDS)[number];

export const FIELD_FILES: Record<Field, string> = {
  description: 'description.md',
  diagram: 'diagram.mmd',
  constraint: 'constraint.md',
  concern: 'concern.md',
  context: 'context.md',
  todo: 'todo.md',
  note: 'note.md',
};

export type NodeKind = 'perspective' | 'nested-class';

/**
 * External documentation link entry.
 *
 * Stored in meta.yaml under `links` to track references to external docs,
 * ADRs, wikis, READMEs, etc. Separate from diagram @refs which represent
 * architectural dependencies.
 */
export interface LinkEntry {
  /** URL or relative path to the linked resource. */
  url: string;
  /** Type of link: local file, external URL, or source file. */
  type: 'local' | 'external' | 'source';
  /** Optional human-readable label for the link. */
  label?: string;
  /** ISO date when the link was added. */
  added?: string;
}

export interface ClassMeta {
  created: string;
  updated: string;
  update_count: number;
  last_field: Field;
  git_commit?: string;
  git_branch?: string;
  prev_diagram?: string;
  kind?: NodeKind;
  title?: string;
  children?: string[];
  parentPath?: string[];
  tags?: string[];
  diagram_history?: Array<{ diagram: string; at: string; commit?: string }>;
  change_log?: Array<{ field: string; at: string; commit?: string }>;

  /**
   * Incremental analysis metadata.
   *
   * Stored per element/class (including nested elements) to enable selecting
   * only affected subtrees on the next /omm-scan.
   */
  source_files?: string[];
  source_globs?: string[];
  scan_generation?: {
    mode?: 'full' | 'incremental';
    git_commit?: string;
    at?: string;
  };

  /**
   * External documentation links.
   *
   * Stored per element to track references to external docs, ADRs, wikis,
   * READMEs, etc. Managed via `omm links` command.
   */
  links?: LinkEntry[];
}

export interface ClassData {
  name: string;
  description?: string;
  diagram?: string;
  constraint?: string;
  concern?: string;
  context?: string;
  todo?: string;
  note?: string;
  meta?: ClassMeta;
}

export interface OmmConfig {
  version: string;
  theme?: string;
  language?: string;
  /** Structural signature of .omm/ element tree (SHA-256 hash of element paths). */
  signature?: string;
  /** ISO date when the signature was last computed and stored. */
  signature_updated?: string;
}

export interface DiffResult {
  added_nodes: string[];
  removed_nodes: string[];
  added_edges: string[];
  removed_edges: string[];
  has_changes: boolean;
}

export interface RefEntry {
  source_class: string;
  target_class: string;
  node_id: string;
  node_label?: string;
}

export interface ValidationIssue {
  level: 'error' | 'warning';
  rule: string;
  message: string;
  line?: number;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export interface FlowStep {
  node?: string;
  edge?: string;  // format: "from->to"
}

export interface FlowDef {
  name: string;
  description?: string;
  steps: FlowStep[];
}

export interface FlowsFile {
  flows: FlowDef[];
}
