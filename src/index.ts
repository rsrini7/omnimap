// Import language handlers to trigger self-registration in the analyzer registry
import './lib/analyzer/languages/javascript.js';
import './lib/analyzer/languages/typescript.js';
import './lib/analyzer/languages/java.js';
import './lib/analyzer/languages/kotlin.js';
import './lib/analyzer/languages/scala.js';
import './lib/analyzer/languages/python.js';
import './lib/analyzer/languages/go.js';
import './lib/analyzer/languages/rust.js';


// oh-my-mermaid public API
export { initOmm, ensureOmmForRead, ensureOmmForWrite, listClasses, readField, writeField, showClass, deleteClass, classExists } from './lib/store.js';
export { listPerspectives, listNodes, readNodeField, writeNodeField, showNode, nodeDir, readNodeMeta, readFlows, writeFlows } from './lib/store.js';
export { diffMermaid, parseMermaid, formatDiff } from './lib/diff.js';
export { extractRefs, getIncomingRefs, getOutgoingRefs, buildRefGraph } from './lib/refs.js';
export { evaluateProject } from './lib/eval.js';
export type { EvalReport, ElementEval, ScoreBreakdown } from './lib/eval.js';
export { validateDiagram, VALID_CLASSDEF_NAMES, CLASSDEF_PALETTE } from './lib/validate.js';
export { VALID_FIELDS, FIELD_FILES } from './types.js';
export type { Field, ClassMeta, ClassData, DiffResult, RefEntry, OmmConfig, ValidationIssue, ValidationResult, NodeKind, FlowStep, FlowDef, FlowsFile } from './types.js';
export { analyzeFile, analyzeDirectory, buildDependencyGraph, detectModuleBoundaries, formatAnalysisMarkdown, formatAnalysisJSON } from './lib/analyzer/index.js';
export type { FileAnalysis, DependencyGraph, DependencyNode, DependencyEdge, ModuleBoundary, AnalysisResult, ImportInfo, ExportInfo, DefinitionInfo, CallInfo, FingerprintDelta } from './lib/analyzer/types.js';
