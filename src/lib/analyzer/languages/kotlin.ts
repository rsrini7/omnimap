import type { ImportInfo, ExportInfo, DefinitionInfo, CallInfo } from '../types.js';
import type { LanguageHandler } from '../registry.js';
import { registerLanguage } from '../registry.js';
import { walkAST, getNodeText, getIdentifierName } from './base.js';
import type { ASTNode } from './base.js';

let KotlinParser: any = null;

async function loadParser(): Promise<any> {
  if (KotlinParser) return KotlinParser;
  try {
    const TreeSitter = (await import('tree-sitter')).default;
    const Kotlin = await import('tree-sitter-kotlin');
    KotlinParser = new TreeSitter();
    KotlinParser.setLanguage(Kotlin.default || Kotlin);
    return KotlinParser;
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

function extractKotlinImports(tree: ASTNode, source: string): ImportInfo[] {
  const imports: ImportInfo[] = [];

  walkAST(tree, (node) => {
    if (node.type === 'import_header') {
      const id = findFirstChild(node, 'identifier') || findFirstChild(node, 'scoped_identifier');
      if (!id) return;
      const text = getNodeText(id, source);
      const isWildcard = text.endsWith('.*');
      const sourceText = isWildcard ? text.slice(0, -2) : text;

      imports.push({
        source: sourceText,
        specifiers: isWildcard ? [] : [text.split('.').pop()!],
        line: node.startPosition.row + 1,
      });
    }
  });

  return imports;
}

function extractKotlinExports(tree: ASTNode, source: string): ExportInfo[] {
  const exports: ExportInfo[] = [];

  walkAST(tree, (node) => {
    const mods = getVisibilityModifiers(node, source);
    const isPublic = mods.includes('public') || (!mods.includes('private') && !mods.includes('protected') && !mods.includes('internal'));

    if (!isPublic) return;

    switch (node.type) {
      case 'class_declaration': {
        const name = getKotlinClassName(node, source);
        if (name) {
          const isData = node.children.some((c: ASTNode) => !c.isNamed && getNodeText(c, source) === 'data');
          const isSealed = node.children.some((c: ASTNode) => !c.isNamed && getNodeText(c, source) === 'sealed');
          exports.push({ name, kind: 'class', line: node.startPosition.row + 1 });
        }
        break;
      }
      case 'object_declaration': {
        const name = getIdentifierName(node, source);
        if (name) exports.push({ name, kind: 'class', line: node.startPosition.row + 1 });
        break;
      }
      case 'interface_declaration': {
        const name = getIdentifierName(node, source);
        if (name) exports.push({ name, kind: 'interface', line: node.startPosition.row + 1 });
        break;
      }
      case 'enum_declaration': {
        const name = getIdentifierName(node, source);
        if (name) exports.push({ name, kind: 'enum', line: node.startPosition.row + 1 });
        break;
      }
      case 'function_declaration': {
        const name = getIdentifierName(node, source);
        if (name) exports.push({ name, kind: 'function', line: node.startPosition.row + 1 });
        break;
      }
      case 'property_declaration': {
        const name = getKotlinPropertyName(node, source);
        if (name) exports.push({ name, kind: 'variable', line: node.startPosition.row + 1 });
        break;
      }
    }
  });

  return exports;
}

function extractKotlinDefinitions(tree: ASTNode, source: string): DefinitionInfo[] {
  const definitions: DefinitionInfo[] = [];

  walkAST(tree, (node) => {
    const mods = getVisibilityModifiers(node, source);
    const isPublic = mods.includes('public') || (!mods.includes('private') && !mods.includes('protected') && !mods.includes('internal'));

    switch (node.type) {
      case 'class_declaration': {
        const name = getKotlinClassName(node, source);
        if (name) {
          const methods = collectKotlinFunctions(node, source);
          definitions.push({
            name,
            kind: 'class',
            line: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            exported: isPublic,
            methods,
          });
        }
        break;
      }
      case 'object_declaration': {
        const name = getIdentifierName(node, source);
        if (name) {
          definitions.push({
            name,
            kind: 'class',
            line: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            exported: isPublic,
          });
        }
        break;
      }
      case 'interface_declaration': {
        const name = getIdentifierName(node, source);
        if (name) {
          definitions.push({
            name,
            kind: 'interface',
            line: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            exported: isPublic,
          });
        }
        break;
      }
      case 'enum_declaration': {
        const name = getIdentifierName(node, source);
        if (name) {
          definitions.push({
            name,
            kind: 'enum',
            line: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            exported: isPublic,
          });
        }
        break;
      }
      case 'function_declaration': {
        const name = getIdentifierName(node, source);
        if (name) {
          definitions.push({
            name,
            kind: 'function',
            line: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            exported: isPublic,
          });
        }
        break;
      }
      case 'property_declaration': {
        const name = getKotlinPropertyName(node, source);
        if (name) {
          definitions.push({
            name,
            kind: 'variable',
            line: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            exported: isPublic,
          });
        }
        break;
      }
    }
  });

  return definitions;
}

function extractKotlinCalls(tree: ASTNode, source: string): CallInfo[] {
  const calls: CallInfo[] = [];

  walkAST(tree, (node) => {
    if (node.type === 'call_expression') {
      const fn = node.childForFieldName('function');
      if (fn) {
        const name = getNodeText(fn, source).split('.').pop()!;
        calls.push({ name, line: node.startPosition.row + 1 });
      }
    }
    if (node.type === 'constructor_call') {
      const type = node.childForFieldName('type');
      if (type) {
        calls.push({ name: `<init>:${getNodeText(type, source)}`, line: node.startPosition.row + 1 });
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

function getKotlinClassName(node: ASTNode, source: string): string | null {
  const nameNode = node.childForFieldName('name');
  if (nameNode) return getNodeText(nameNode, source);
  for (const c of node.namedChildren) {
    if (c.type === 'simple_identifier' || c.type === 'identifier') {
      return getNodeText(c, source);
    }
  }
  return null;
}

function getKotlinPropertyName(node: ASTNode, source: string): string | null {
  for (const c of node.namedChildren) {
    if (c.type === 'variable_declaration') {
      const id = c.childForFieldName('name') || c.namedChildren.find((sc: ASTNode) => sc.type === 'simple_identifier');
      if (id) return getNodeText(id, source);
    }
    if (c.type === 'simple_identifier') return getNodeText(c, source);
  }
  return null;
}

function getVisibilityModifiers(node: ASTNode, source: string): string[] {
  const mods: string[] = [];
  for (const c of node.children) {
    if (!c.isNamed && ['public', 'private', 'protected', 'internal'].includes(c.type)) {
      mods.push(c.type);
    }
    if (c.type === 'modifiers' || c.type === 'visibility_modifier') {
      for (const mc of c.children) {
        const txt = getNodeText(mc, source);
        if (['public', 'private', 'protected', 'internal'].includes(txt)) mods.push(txt);
      }
    }
  }
  return mods;
}

function collectKotlinFunctions(classNode: ASTNode, source: string): string[] {
  const methods: string[] = [];
  walkAST(classNode, (n) => {
    if (n === classNode) return;
    if (n.type === 'class_declaration' || n.type === 'interface_declaration' || n.type === 'enum_declaration' || n.type === 'object_declaration') {
      return true; // Skip inner classes, interfaces, enums, objects
    }
    if (n.type === 'function_declaration') {
      const name = getIdentifierName(n, source);
      if (name) methods.push(name);
      return true; // Skip walking function body (closures, inner functions)
    }
  });
  return methods;
}

const kotlinHandler: LanguageHandler = {
  name: 'kotlin',
  extensions: ['.kt', '.kts'],
  extractImports: extractKotlinImports,
  extractExports: extractKotlinExports,
  extractDefinitions: extractKotlinDefinitions,
  extractCalls: extractKotlinCalls,
};

registerLanguage(kotlinHandler);

export { kotlinHandler, extractKotlinImports, extractKotlinExports, extractKotlinDefinitions, extractKotlinCalls };
