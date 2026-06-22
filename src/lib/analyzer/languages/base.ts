import type { ImportInfo, ExportInfo, DefinitionInfo, CallInfo } from '../types.js';

export interface ASTNode {
  type: string;
  text: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  startIndex: number;
  endIndex: number;
  children: ASTNode[];
  namedChildren: ASTNode[];
  parent: ASTNode | null;
  childForFieldName(name: string): ASTNode | null;
  fieldNameForChild(childIndex: number): string | null;
  namedChild(index: number): ASTNode | null;
  childCount: number;
  namedChildCount: number;
  isNamed: boolean;
}

/**
 * Walk AST depth-first. Return `true` from visitor to skip children of the current node.
 */
export function walkAST(node: ASTNode, visitor: (node: ASTNode) => boolean | void): void {
  const skipChildren = visitor(node);
  if (skipChildren === true) return;
  for (const child of node.namedChildren) {
    walkAST(child, visitor);
  }
}

export function findChildrenOfType(node: ASTNode, type: string): ASTNode[] {
  const results: ASTNode[] = [];
  walkAST(node, (n) => {
    if (n.type === type) {
      results.push(n);
    }
  });
  return results;
}

export function getFirstChildOfType(node: ASTNode, type: string): ASTNode | null {
  for (const child of node.namedChildren) {
    if (child.type === type) return child;
  }
  return null;
}

export function getNodeText(node: ASTNode, source: string): string {
  return source.slice(node.startIndex, node.endIndex);
}

export function getIdentifierName(node: ASTNode, source: string): string | null {
  if (node.type === 'identifier' || node.type === 'type_identifier' || node.type === 'shorthand_property_identifier') {
    return getNodeText(node, source);
  }
  const nameNode = node.childForFieldName('name');
  if (nameNode) return getNodeText(nameNode, source);
  return null;
}

export function resolveRelativePath(from: string, specifier: string): string {
  if (!specifier.startsWith('.')) return specifier;
  const fromDir = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : '.';
  const parts = fromDir.split('/').filter(p => p && p !== '.');
  for (const seg of specifier.split('/')) {
    if (seg === '.') continue;
    if (seg === '..') {
      parts.pop();
    } else {
      parts.push(seg);
    }
  }
  return parts.join('/');
}
