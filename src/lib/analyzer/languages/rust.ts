import type { ImportInfo, ExportInfo, DefinitionInfo, CallInfo } from '../types.js';
import type { LanguageHandler } from '../registry.js';
import { registerLanguage } from '../registry.js';
import { walkAST, getNodeText, getIdentifierName } from './base.js';
import type { ASTNode } from './base.js';

let RustParser: any = null;

async function loadParser(): Promise<any> {
  if (RustParser) return RustParser;
  try {
    const TreeSitter = (await import('tree-sitter')).default;
    const Rust = await import('tree-sitter-rust');
    RustParser = new TreeSitter();
    RustParser.setLanguage(Rust.default || Rust);
    return RustParser;
  } catch {
    return null;
  }
}

export async function ensureParser(): Promise<any> {
  return loadParser();
}

export async function isAvailable(): Promise<boolean> {
  try {
    return (await loadParser()) !== null;
  } catch {
    return false;
  }
}

function extractRustImports(tree: ASTNode, source: string): ImportInfo[] {
  const imports: ImportInfo[] = [];

  walkAST(tree, (node) => {
    if (node.type === 'use_declaration') {
      const arg = findFirstChild(node, 'scoped_identifier') || findFirstChild(node, 'identifier');
      if (arg) {
        const text = getNodeText(arg, source);
        const isWildcard = text.endsWith('::*');
        const isGlob = text.endsWith('*');
        imports.push({
          source: isWildcard ? text.slice(0, -2) : text,
          specifiers: isWildcard || isGlob ? [] : [text.split('::').pop()!],
          line: node.startPosition.row + 1,
        });
      }
    }
    if (node.type === 'extern_crate_declaration') {
      const name = getIdentifierName(node, source);
      if (name) {
        imports.push({ source: name, specifiers: [name], line: node.startPosition.row + 1 });
      }
    }
  });

  return imports;
}

function extractRustExports(tree: ASTNode, source: string): ExportInfo[] {
  const exports: ExportInfo[] = [];

  walkAST(tree, (node) => {
    const isPub = hasRustModifier(node, source, 'pub');

    switch (node.type) {
      case 'function_item': {
        const name = getIdentifierName(node, source);
        if (name && isPub) exports.push({ name, kind: 'function', line: node.startPosition.row + 1 });
        break;
      }
      case 'struct_item': {
        const name = getIdentifierName(node, source);
        if (name && isPub) exports.push({ name, kind: 'class', line: node.startPosition.row + 1 });
        break;
      }
      case 'enum_item': {
        const name = getIdentifierName(node, source);
        if (name && isPub) exports.push({ name, kind: 'enum', line: node.startPosition.row + 1 });
        break;
      }
      case 'trait_item': {
        const name = getIdentifierName(node, source);
        if (name && isPub) exports.push({ name, kind: 'interface', line: node.startPosition.row + 1 });
        break;
      }
      case 'type_item': {
        const name = getIdentifierName(node, source);
        if (name && isPub) exports.push({ name, kind: 'type', line: node.startPosition.row + 1 });
        break;
      }
      case 'const_item': {
        const name = getIdentifierName(node, source);
        if (name && isPub) exports.push({ name, kind: 'variable', line: node.startPosition.row + 1 });
        break;
      }
      case 'static_item': {
        const name = getIdentifierName(node, source);
        if (name && isPub) exports.push({ name, kind: 'variable', line: node.startPosition.row + 1 });
        break;
      }
    }
  });

  return exports;
}

function extractRustDefinitions(tree: ASTNode, source: string): DefinitionInfo[] {
  const definitions: DefinitionInfo[] = [];

  walkAST(tree, (node) => {
    const isPub = hasRustModifier(node, source, 'pub');

    switch (node.type) {
      case 'function_item': {
        const name = getIdentifierName(node, source);
        if (name) {
          definitions.push({
            name,
            kind: 'function',
            line: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            exported: isPub,
          });
        }
        break;
      }
      case 'struct_item': {
        const name = getIdentifierName(node, source);
        if (name) {
          const methods = collectRustMethods(tree, name, source);
          definitions.push({
            name,
            kind: 'class',
            line: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            exported: isPub,
            methods,
          });
        }
        break;
      }
      case 'enum_item': {
        const name = getIdentifierName(node, source);
        if (name) {
          definitions.push({
            name,
            kind: 'enum',
            line: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            exported: isPub,
          });
        }
        break;
      }
      case 'trait_item': {
        const name = getIdentifierName(node, source);
        if (name) {
          definitions.push({
            name,
            kind: 'interface',
            line: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            exported: isPub,
          });
        }
        break;
      }
      case 'type_item': {
        const name = getIdentifierName(node, source);
        if (name) {
          definitions.push({
            name,
            kind: 'type',
            line: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            exported: isPub,
          });
        }
        break;
      }
      case 'const_item':
      case 'static_item': {
        const name = getIdentifierName(node, source);
        if (name) {
          definitions.push({
            name,
            kind: 'variable',
            line: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            exported: isPub,
          });
        }
        break;
      }
    }
  });

  return definitions;
}

function extractRustCalls(tree: ASTNode, source: string): CallInfo[] {
  const calls: CallInfo[] = [];

  walkAST(tree, (node) => {
    if (node.type === 'call_expression') {
      const fn = node.childForFieldName('function');
      if (fn) {
        const text = getNodeText(fn, source);
        const name = text.includes('::') ? text.split('::').pop()! : text;
        calls.push({ name, line: node.startPosition.row + 1 });
      }
    }
    if (node.type === 'macro_invocation') {
      const name = node.childForFieldName('macro');
      if (name) {
        calls.push({ name: `${getNodeText(name, source)}!`, line: node.startPosition.row + 1 });
      }
    }
  });

  return calls;
}

function findFirstChild(node: ASTNode, type: string): ASTNode | null {
  for (const c of node.namedChildren) {
    if (c.type === type) return c;
  }
  return null;
}

function hasRustModifier(node: ASTNode, source: string, modifier: string): boolean {
  for (const c of node.namedChildren) {
    if (c.type === 'visibility_modifier') {
      if (getNodeText(c, source).includes(modifier)) return true;
    }
    if (c.type === 'function_modifiers' || c.type === 'item_modifiers') {
      for (const mc of c.namedChildren) {
        if (getNodeText(mc, source) === modifier) return true;
      }
    }
  }
  return false;
}

function collectRustMethods(rootTree: ASTNode, structName: string, source: string): string[] {
  const methods: string[] = [];
  walkAST(rootTree, (n) => {
    if (n.type === 'impl_item') {
      const type = n.childForFieldName('type');
      if (type && getNodeText(type, source) === structName) {
        for (const child of n.namedChildren) {
          if (child.type === 'function_item') {
            const name = getIdentifierName(child, source);
            if (name) methods.push(name);
          }
        }
      }
    }
  });
  return methods;
}

const rustHandler: LanguageHandler = {
  name: 'rust',
  extensions: ['.rs'],
  extractImports: extractRustImports,
  extractExports: extractRustExports,
  extractDefinitions: extractRustDefinitions,
  extractCalls: extractRustCalls,
};

registerLanguage(rustHandler);

export { rustHandler, extractRustImports, extractRustExports, extractRustDefinitions, extractRustCalls };
