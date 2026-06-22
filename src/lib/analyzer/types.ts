import type { RouteInfo } from './routes.js';

export interface ImportInfo {
  source: string;
  specifiers: string[];
  default?: string;
  namespace?: string;
  resolved?: string;
  line: number;
}

export interface ExportInfo {
  name: string;
  kind: 'function' | 'class' | 'variable' | 'type' | 'interface' | 'enum' | 'default' | 'method';
  line: number;
}

export interface DefinitionInfo {
  name: string;
  kind: 'function' | 'class' | 'method' | 'interface' | 'enum' | 'type' | 'variable';
  line: number;
  endLine: number;
  exported: boolean;
  methods?: string[];
}

export interface CallInfo {
  name: string;
  line: number;
}

export interface FileAnalysis {
  file: string;
  language: string;
  imports: ImportInfo[];
  exports: ExportInfo[];
  definitions: DefinitionInfo[];
  calls: CallInfo[];
  routes?: RouteInfo[];
  error?: string;
}

export interface DependencyNode {
  id: string;
  file: string;
  exports: string[];
}

export interface DependencyEdge {
  from: string;
  to: string;
  imports: string[];
}

export interface DependencyGraph {
  nodes: DependencyNode[];
  edges: DependencyEdge[];
}

export interface ModuleBoundary {
  name: string;
  files: string[];
  entryPoints: string[];
  dependencies: string[];
  internalEdges: number;
  externalEdges: number;
  cohesion: number;
}

export interface FingerprintDelta {
  file: string;
  added: DefinitionInfo[];
  removed: DefinitionInfo[];
  modified: DefinitionInfo[];
  unchanged: number;
  hasChanges: boolean;
}

export interface AnalysisResult {
  files: FileAnalysis[];
  graph: DependencyGraph;
  modules: ModuleBoundary[];
  errors: { file: string; error: string }[];
  stats: {
    totalFiles: number;
    analyzedFiles: number;
    skippedFiles: number;
    errorFiles: number;
    languages: Record<string, number>;
  };
}
