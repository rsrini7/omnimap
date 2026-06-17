// oh-my-mermaid public API
export { initOmm, ensureOmmForRead, ensureOmmForWrite, listClasses, readField, writeField, showClass, deleteClass, classExists } from './lib/store.js';
export { listPerspectives, listNodes, readNodeField, writeNodeField, showNode, nodeDir, readNodeMeta, readFlows, writeFlows } from './lib/store.js';
export { diffMermaid, parseMermaid, formatDiff } from './lib/diff.js';
export { extractRefs, getIncomingRefs, getOutgoingRefs, buildRefGraph } from './lib/refs.js';
export { evaluateProject } from './lib/eval.js';
export type { EvalReport, ElementEval } from './lib/eval.js';
export { validateDiagram, VALID_CLASSDEF_NAMES, CLASSDEF_PALETTE } from './lib/validate.js';
export { VALID_FIELDS, FIELD_FILES } from './types.js';
export type { Field, ClassMeta, ClassData, DiffResult, RefEntry, OmmConfig, ValidationIssue, ValidationResult, NodeKind, FlowStep, FlowDef, FlowsFile } from './types.js';
