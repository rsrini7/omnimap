import type { ImportInfo, ExportInfo, DefinitionInfo, CallInfo } from '../types.js';
import type { LanguageHandler } from '../registry.js';
import { registerLanguage } from '../registry.js';
import { walkAST, getNodeText, getIdentifierName } from './base.js';
import type { ASTNode } from './base.js';

let JavaParser: any = null;

async function loadParser(): Promise<any> {
  if (JavaParser) return JavaParser;
  try {
    const TreeSitter = (await import('tree-sitter')).default;
    const Java = await import('tree-sitter-java');
    JavaParser = new TreeSitter();
    JavaParser.setLanguage(Java.default || Java);
    return JavaParser;
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

function extractJavaImports(tree: ASTNode, source: string): ImportInfo[] {
  const imports: ImportInfo[] = [];

  walkAST(tree, (node) => {
    if (node.type === 'import_declaration') {
      const scopedId = findFirstChild(node, 'scoped_identifier');
      const uid = findFirstChild(node, 'identifier');
      const text = scopedId ? getNodeText(scopedId, source) : uid ? getNodeText(uid, source) : '';
      if (!text) return;

      const isStatic = node.children.some((c: ASTNode) => !c.isNamed && getNodeText(c, source) === 'static');
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

function extractJavaExports(tree: ASTNode, source: string): ExportInfo[] {
  const exports: ExportInfo[] = [];

  walkAST(tree, (node) => {
    const mods = getModifierTexts(node, source);
    if (!mods.includes('public')) return;

    switch (node.type) {
      case 'class_declaration':
      case 'record_declaration': {
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
      case 'method_definition': {
        const name = getIdentifierName(node, source);
        if (name) exports.push({ name, kind: 'method', line: node.startPosition.row + 1 });
        break;
      }
    }
  });

  return exports;
}

function extractJavaDefinitions(tree: ASTNode, source: string): DefinitionInfo[] {
  const definitions: DefinitionInfo[] = [];

  walkAST(tree, (node) => {
    switch (node.type) {
      case 'class_declaration':
      case 'record_declaration': {
        const name = getIdentifierName(node, source);
        if (name) {
          const methods = collectMethods(node, source);
          definitions.push({
            name,
            kind: 'class',
            line: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            exported: getModifierTexts(node, source).includes('public'),
            methods,
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
            exported: getModifierTexts(node, source).includes('public'),
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
            exported: getModifierTexts(node, source).includes('public'),
          });
        }
        break;
      }
      case 'method_declaration':
      case 'constructor_declaration': {
        const name = getIdentifierName(node, source) || (node.type === 'constructor_declaration' ? '<init>' : null);
        if (name) {
          definitions.push({
            name,
            kind: 'method',
            line: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            exported: getModifierTexts(node, source).includes('public'),
          });
        }
        break;
      }
      case 'field_declaration': {
        const mods = getModifierTexts(node, source);
        for (const child of node.namedChildren) {
          if (child.type === 'variable_declarator') {
            const id = child.childForFieldName('name');
            if (id) {
              definitions.push({
                name: getNodeText(id, source),
                kind: 'variable',
                line: node.startPosition.row + 1,
                endLine: node.endPosition.row + 1,
                exported: mods.includes('public'),
              });
            }
          }
        }
        break;
      }
    }
  });

  return definitions;
}

function extractJavaCalls(tree: ASTNode, source: string): CallInfo[] {
  const calls: CallInfo[] = [];

  walkAST(tree, (node) => {
    if (node.type === 'method_invocation') {
      const name = node.childForFieldName('name');
      if (name) {
        calls.push({ name: getNodeText(name, source), line: node.startPosition.row + 1 });
      }
    }
    if (node.type === 'object_creation_expression') {
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

function getModifierTexts(node: ASTNode, source: string): string[] {
  const mods: string[] = [];
  for (const c of node.namedChildren) {
    if (c.type === 'modifiers') {
      for (const mc of c.children) {
        if (!mc.isNamed && ['public', 'private', 'protected', 'static', 'abstract', 'final'].includes(mc.type)) {
          mods.push(mc.type);
        }
      }
    }
  }
  return mods;
}

function collectMethods(classNode: ASTNode, source: string): string[] {
  const methods: string[] = [];
  walkAST(classNode, (n) => {
    if (n === classNode) return;
    if (n.type === 'class_declaration' || n.type === 'interface_declaration' || n.type === 'enum_declaration' || n.type === 'record_declaration') {
      return true; // Skip inner classes, interfaces, enums, records
    }
    if (n.type === 'method_declaration' || n.type === 'constructor_declaration') {
      const name = getIdentifierName(n, source) || (n.type === 'constructor_declaration' ? '<init>' : null);
      if (name) methods.push(name);
      return true; // Skip walking the body of methods/constructors
    }
  });
  return methods;
}

const javaHandler: LanguageHandler = {
  name: 'java',
  extensions: ['.java'],
  extractImports: extractJavaImports,
  extractExports: extractJavaExports,
  extractDefinitions: extractJavaDefinitions,
  extractCalls: extractJavaCalls,
};

registerLanguage(javaHandler);

export { javaHandler, extractJavaImports, extractJavaExports, extractJavaDefinitions, extractJavaCalls };
