import fs from 'node:fs';
import path from 'node:path';
import { VALID_FIELDS, FIELD_FILES, type Field, type ClassData, type ClassMeta } from '../types.js';
import { listClasses, listNodes, readField, readNodeField, readMeta, readNodeMeta, readFlows, getOmmDir } from './store.js';
import { getIncomingRefs, getOutgoingRefs } from './refs.js';
import { validateDiagram } from './validate.js';
import { parseMermaid } from './diff.js';

export interface ScoreBreakdown {
  fields: { earned: number; max: number; present: number; total: number };
  diagram: { earned: number; max: number; valid: boolean; has: boolean };
  description: { earned: number; max: number; length: number };
  flows: { earned: number; max: number; count: number };
  refs: { earned: number; max: number; incoming: number; outgoing: number };
  children: { earned: number; max: number; covered: number; total: number };
}

export interface ElementEval {
  name: string;
  path: string;
  type: 'perspective' | 'leaf' | 'group';
  fieldsPresent: Field[];
  fieldsMissing: Field[];
  fieldCoverage: number; // 0-1
  hasDiagram: boolean;
  diagramValid: boolean;
  diagramIssues: string[];
  hasFlows: boolean;
  flowCount: number;
  hasDescription: boolean;
  descriptionLength: number;
  isRefTarget: boolean;
  refCount: number;
  tags: string[];
  corruptedTagCount: number; // count of tags that aren't strings (objects/numbers)
  childCount: number;
  childrenCovered: number;
  score: number; // 0-100
  scoreBreakdown: ScoreBreakdown;
}

export interface EvalReport {
  summary: {
    totalElements: number;
    perspectives: number;
    leaves: number;
    groups: number;
    overallScore: number;
    fieldCoverage: number;
    diagramCoverage: number;
    flowCoverage: number;
    refIntegrity: number;
    undocumentedDiagramNodes: number;
  };
  elements: ElementEval[];
  issues: { type: string; severity: 'error' | 'warning' | 'info'; message: string; path?: string }[];
  suggestions: string[];
}

function evaluateElement(elemPath: string, isPerspective: boolean, cwd?: string): ElementEval {
  const parts = elemPath.split('/');
  const perspective = parts[0];
  const nodePath = parts.slice(1);

  // Helper to read a field for either perspective or nested element
  const readFieldFor = (field: Field): string | null => {
    if (nodePath.length > 0) {
      return readNodeField(perspective, nodePath, field, cwd);
    }
    return readField(perspective, field, cwd);
  };

  // Read all fields
  const fieldsPresent: Field[] = [];
  const fieldsMissing: Field[] = [];
  for (const field of VALID_FIELDS) {
    const content = readFieldFor(field);
    if (content && content.trim().length > 0) {
      fieldsPresent.push(field);
    } else {
      fieldsMissing.push(field);
    }
  }

  const diagram = readFieldFor('diagram');
  const hasDiagram = !!diagram && diagram.trim().length > 0;
  const description = readFieldFor('description');
  const hasDescription = !!description && description.trim().length > 0;

  // Diagram validation
  let diagramValid = false;
  let diagramIssues: string[] = [];
  if (hasDiagram) {
    const allClasses = listClasses(cwd);
    const result = validateDiagram(diagram!, { className: elemPath, allClasses });
    diagramValid = result.valid;
    diagramIssues = result.issues.map(i => `${i.rule}: ${i.message}`);
  }

  // Flows
  const flows = readFlows(elemPath, cwd);
  const hasFlows = flows.length > 0;

  // Refs
  const incoming = getIncomingRefs(elemPath, cwd);
  const outgoing = getOutgoingRefs(elemPath, cwd);

  // Children
  const children = listNodes(perspective, nodePath, cwd);
  const childCount = children.length;
  let childrenCovered = 0;
  for (const child of children) {
    const childPath = elemPath + '/' + child;
    const childDiag = readNodeField(perspective, [...nodePath, child], 'diagram', cwd);
    if (childDiag && childDiag.trim().length > 0) childrenCovered++;
  }

  // Tags (read from meta)
  const meta = nodePath.length > 0
    ? readNodeMeta(perspective, nodePath, cwd)
    : readMeta(perspective, cwd);

  // Tags — sanitize: keep only string tags, count corrupted ones
  const rawTags = meta?.tags || [];
  const tags: string[] = [];
  let corruptedTagCount = 0;
  for (const t of rawTags) {
    if (typeof t === 'string') {
      tags.push(t);
    } else {
      // Non-string tags indicate data corruption (e.g. an AI agent wrote an error message as a tag)
      corruptedTagCount++;
    }
  }

  // Type
  const type: 'perspective' | 'leaf' | 'group' = isPerspective ? 'perspective' : (hasDiagram ? 'group' : 'leaf');

  // Score (0-100)
  let score = 0;
  // Field coverage: 40 points
  // Score breakdown — each component tracked separately
  const scoreBreakdown = {
    fields: { earned: 0, max: 40, present: fieldsPresent.length, total: VALID_FIELDS.length },
    diagram: { earned: 0, max: 20, valid: hasDiagram && diagramValid, has: hasDiagram },
    description: { earned: 0, max: 10, length: description?.length || 0 },
    flows: { earned: 0, max: 10, count: flows.length },
    refs: { earned: 0, max: 10, incoming: incoming.length, outgoing: outgoing.length },
    children: { earned: 0, max: 10, covered: childrenCovered, total: childCount },
  };

  score += (fieldsPresent.length / VALID_FIELDS.length) * 40;
  scoreBreakdown.fields.earned = (fieldsPresent.length / VALID_FIELDS.length) * 40;
  // Diagram: 20 points
  if (hasDiagram && diagramValid) { score += 20; scoreBreakdown.diagram.earned = 20; }
  else if (hasDiagram) { score += 10; scoreBreakdown.diagram.earned = 10; }
  // Description quality: 10 points
  if (hasDescription) {
    if (description!.length > 50) { score += 10; scoreBreakdown.description.earned = 10; }
    else if (description!.length > 20) { score += 5; scoreBreakdown.description.earned = 5; }
  }
  // Flows: 10 points
  if (hasFlows) { score += 10; scoreBreakdown.flows.earned = 10; }
  // Refs: 10 points
  if (incoming.length > 0 || outgoing.length > 0) { score += 10; scoreBreakdown.refs.earned = 10; }
  // Children coverage: 10 points
  if (childCount === 0) { score += 10; scoreBreakdown.children.earned = 10; }
  else if (childrenCovered === childCount) { score += 10; scoreBreakdown.children.earned = 10; }
  else { const c = (childrenCovered / childCount) * 10; score += c; scoreBreakdown.children.earned = c; }

  return {
    name: parts[parts.length - 1],
    path: elemPath,
    type,
    fieldsPresent,
    fieldsMissing,
    fieldCoverage: fieldsPresent.length / VALID_FIELDS.length,
    hasDiagram,
    diagramValid,
    diagramIssues,
    hasFlows,
    flowCount: flows.length,
    hasDescription,
    descriptionLength: description?.length || 0,
    isRefTarget: incoming.length > 0,
    refCount: incoming.length + outgoing.length,
    tags,
    corruptedTagCount,
    childCount,
    childrenCovered,
    score: Math.round(score),
    scoreBreakdown,
  };
}

export function evaluateProject(cwd?: string): EvalReport {
  const perspectives = listClasses(cwd);
  const allElements: ElementEval[] = [];
  const issues: EvalReport['issues'] = [];
  const suggestions: string[] = [];

  // Evaluate perspectives
  for (const persp of perspectives) {
    allElements.push(evaluateElement(persp, true, cwd));
    // Evaluate children
    const children = listNodes(persp, [], cwd);
    for (const child of children) {
      allElements.push(evaluateElement(persp + '/' + child, false, cwd));
    }
  }

  // Collect issues
  for (const el of allElements) {
    if (!el.hasDescription) {
      issues.push({ type: 'missing-description', severity: 'warning', message: `Missing description`, path: el.path });
    }
    if (el.hasDiagram && !el.diagramValid) {
      issues.push({ type: 'invalid-diagram', severity: 'error', message: `Diagram has issues: ${el.diagramIssues.join('; ')}`, path: el.path });
    }
    if ((el.type === 'group' || el.type === 'perspective') && el.childCount > 0 && el.childrenCovered < el.childCount) {
      issues.push({ type: 'incomplete-children', severity: 'warning', message: `${el.childCount - el.childrenCovered}/${el.childCount} children are not documented`, path: el.path });
    }
    if (el.fieldsMissing.length > 3) {
      issues.push({ type: 'sparse-fields', severity: 'info', message: `Only ${el.fieldsPresent.length}/${VALID_FIELDS.length} fields filled`, path: el.path });
    }
    if (el.type === 'perspective' && !el.hasFlows) {
      issues.push({ type: 'no-flows', severity: 'info', message: `Perspective has no flow definitions`, path: el.path });
    }
    if ((el.type === 'group' || el.type === 'perspective') && !el.hasFlows && el.childCount > 3) {
      suggestions.push(`Consider adding flows to ${el.path} (has ${el.childCount} children)`);
    }
    if (el.tags.length === 0 && el.type === 'perspective') {
      suggestions.push(`Consider adding tags to perspective ${el.path} for categorization`);
    }
    if (el.corruptedTagCount > 0) {
      issues.push({
        type: 'corrupted-tags',
        severity: 'warning',
        message: `${el.corruptedTagCount} tag(s) are not strings (likely written by an AI agent from an error message). Use 'omm tag ${el.path} set <valid-tags>' to fix.`,
        path: el.path,
      });
    }
  }

  // Detect diagram nodes without .omm elements (undocumented diagram nodes)
  const existingPaths = new Set(allElements.map(e => e.path));
  const undocumentedDiagramNodes: { parent: string; nodeId: string; label: string }[] = [];

  for (const el of allElements) {
    if (!el.hasDiagram) continue;
    const diagram = el.type === 'perspective'
      ? readField(el.path, 'diagram', cwd)
      : readNodeField(el.path.split('/')[0], el.path.split('/').slice(1), 'diagram', cwd);
    if (!diagram) continue;

    try {
      const parsed = parseMermaid(diagram);
      for (const nodeId of parsed.nodes) {
        // Skip @refs and special nodes
        if (nodeId.startsWith('@') || nodeId.startsWith('__')) continue;
        // Check if a child element exists for this node
        const childPath = el.path + '/' + nodeId;
        if (!existingPaths.has(childPath)) {
          // Extract label from diagram
          const labelMatch = diagram.match(new RegExp(nodeId + '\\["([^"]+)"\\]'));
          const label = labelMatch ? labelMatch[1].replace(/\\n/g, ' — ') : nodeId;
          undocumentedDiagramNodes.push({ parent: el.path, nodeId, label });
        }
      }
    } catch {
      // skip unparseable diagrams
    }
  }

  // Report undocumented diagram nodes
  for (const node of undocumentedDiagramNodes) {
    issues.push({
      type: 'undocumented-diagram-node',
      severity: 'warning',
      message: `Diagram node "${node.nodeId}" (${node.label}) has no documentation element — clicking it in the viewer shows no content`,
      path: node.parent + '/' + node.nodeId,
    });
  }

  if (undocumentedDiagramNodes.length > 0) {
    suggestions.push(`${undocumentedDiagramNodes.length} diagram node(s) lack documentation. Run /omm-scan and ask: "create descriptions for undocumented diagram nodes"`);
  }

  // Summary
  const totalElements = allElements.length;
  const perspCount = allElements.filter(e => e.type === 'perspective').length;
  const leafCount = allElements.filter(e => e.type === 'leaf').length;
  const groupCount = allElements.filter(e => e.type === 'group').length;
  const fieldCoverage = totalElements > 0
    ? allElements.reduce((sum, e) => sum + e.fieldCoverage, 0) / totalElements
    : 0;
  const diagramCoverage = totalElements > 0
    ? allElements.filter(e => e.hasDiagram).length / totalElements
    : 0;
  const flowCoverage = totalElements > 0
    ? allElements.filter(e => e.hasFlows).length / totalElements
    : 0;
  const refIntegrity = totalElements > 0
    ? allElements.filter(e => e.refCount > 0 || e.isRefTarget).length / totalElements
    : 0;
  const overallScore = totalElements > 0
    ? Math.round(allElements.reduce((sum, e) => sum + e.score, 0) / totalElements)
    : 0;

  return {
    summary: {
      totalElements,
      perspectives: perspCount,
      leaves: leafCount,
      groups: groupCount,
      overallScore,
      fieldCoverage: Math.round(fieldCoverage * 100),
      diagramCoverage: Math.round(diagramCoverage * 100),
      flowCoverage: Math.round(flowCoverage * 100),
      refIntegrity: Math.round(refIntegrity * 100),
      undocumentedDiagramNodes: undocumentedDiagramNodes.length,
    },
    elements: allElements.sort((a, b) => a.score - b.score), // worst first
    issues,
    suggestions,
  };
}
