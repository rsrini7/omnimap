import type { ImportInfo, ExportInfo, DefinitionInfo, CallInfo } from '../types.js';
import type { LanguageHandler } from '../registry.js';
import { registerLanguage } from '../registry.js';
import { walkAST, getNodeText, getIdentifierName } from './base.js';
import type { ASTNode } from './base.js';

let ScalaParser: any = null;

async function loadParser(): Promise<any> {
  if (ScalaParser) return ScalaParser;
  try {
    const TreeSitter = (await import('tree-sitter')).default;
    const Scala = await import('tree-sitter-scala');
    ScalaParser = new TreeSitter();
    ScalaParser.setLanguage(Scala.default || Scala);
    return ScalaParser;
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

function extractScalaImports(tree: ASTNode, source: string): ImportInfo[] {
  const imports: ImportInfo[] = [];

  walkAST(tree, (node) => {
    if (node.type === 'import_declaration') {
      // Track whether a stable_identifier already handled this declaration
      let handledByStableId = false;
      for (const child of node.namedChildren) {
        if (child.type === 'stable_identifier') {
          const text = getNodeText(child, source);
          const isWildcard = text.endsWith('._');
          imports.push({
            source: isWildcard ? text.slice(0, -2) : text,
            specifiers: isWildcard ? [] : [text.split('.').pop()!],
            line: node.startPosition.row + 1,
          });
          handledByStableId = true;
        } else if (child.type === 'import_wildcard' && !handledByStableId) {
          // Only fire if stable_identifier didn't already produce an entry
          const prev = node.namedChildren[node.namedChildren.indexOf(child) - 1];
          if (prev && prev.type !== 'stable_identifier') {
            imports.push({
              source: getNodeText(prev, source),
              specifiers: [],
              line: node.startPosition.row + 1,
            });
          }
        } else if (child.type === 'import_selectors') {
          for (const sel of child.namedChildren) {
            if (sel.type === 'import_selector') {
              const name = sel.namedChildren[0];
              if (name) {
                imports.push({
                  source: getNodeText(name, source),
                  specifiers: [getNodeText(name, source)],
                  line: node.startPosition.row + 1,
                });
              }
            }
          }
        }
      }
    }
  });

  return imports;
}

function extractScalaExports(tree: ASTNode, source: string): ExportInfo[] {
  const exports: ExportInfo[] = [];

  walkAST(tree, (node) => {
    const mods = getScalaModifiers(node, source);
    const isPublic = !mods.includes('private') && !mods.includes('protected');

    if (!isPublic) return;

    switch (node.type) {
      case 'class_definition': {
        const name = getScalaName(node, source);
        if (name) exports.push({ name, kind: 'class', line: node.startPosition.row + 1 });
        break;
      }
      case 'trait_definition': {
        const name = getScalaName(node, source);
        if (name) exports.push({ name, kind: 'interface', line: node.startPosition.row + 1 });
        break;
      }
      case 'object_definition': {
        const name = getScalaName(node, source);
        if (name) exports.push({ name, kind: 'class', line: node.startPosition.row + 1 });
        break;
      }
      case 'enum_definition': {
        const name = getScalaName(node, source);
        if (name) exports.push({ name, kind: 'enum', line: node.startPosition.row + 1 });
        break;
      }
      case 'function_definition': {
        const name = getScalaName(node, source);
        if (name) exports.push({ name, kind: 'function', line: node.startPosition.row + 1 });
        break;
      }
      case 'val_definition':
      case 'var_definition': {
        const name = getScalaValName(node, source);
        if (name) exports.push({ name, kind: 'variable', line: node.startPosition.row + 1 });
        break;
      }
    }
  });

  return exports;
}

function extractScalaDefinitions(tree: ASTNode, source: string): DefinitionInfo[] {
  const definitions: DefinitionInfo[] = [];

  walkAST(tree, (node) => {
    const mods = getScalaModifiers(node, source);
    const isPublic = !mods.includes('private') && !mods.includes('protected');

    switch (node.type) {
      case 'class_definition': {
        const name = getScalaName(node, source);
        if (name) {
          const methods = collectScalaMethods(node, source);
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
      case 'trait_definition': {
        const name = getScalaName(node, source);
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
      case 'object_definition': {
        const name = getScalaName(node, source);
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
      case 'enum_definition': {
        const name = getScalaName(node, source);
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
      case 'function_definition': {
        const name = getScalaName(node, source);
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
      case 'val_definition':
      case 'var_definition': {
        const name = getScalaValName(node, source);
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

function extractScalaCalls(tree: ASTNode, source: string): CallInfo[] {
  const calls: CallInfo[] = [];

  walkAST(tree, (node) => {
    if (node.type === 'call_expression') {
      const fn = node.childForFieldName('function');
      if (fn) {
        const name = getNodeText(fn, source).split('.').pop()!;
        calls.push({ name, line: node.startPosition.row + 1 });
      }
    }
  });

  return calls;
}

function getScalaName(node: ASTNode, source: string): string | null {
  const nameNode = node.childForFieldName('name');
  if (nameNode) return getNodeText(nameNode, source);
  for (const c of node.namedChildren) {
    if (c.type === 'identifier') return getNodeText(c, source);
  }
  return null;
}

function getScalaValName(node: ASTNode, source: string): string | null {
  for (const c of node.namedChildren) {
    if (c.type === 'pattern' || c.type === 'identifier') {
      const text = getNodeText(c, source);
      if (text && !text.includes('=') && !text.includes(':')) return text;
    }
  }
  return null;
}

function getScalaModifiers(node: ASTNode, source: string): string[] {
  const mods: string[] = [];
  for (const c of node.namedChildren) {
    if (c.type === 'modifiers') {
      for (const mc of c.namedChildren) {
        const txt = getNodeText(mc, source);
        if (['private', 'protected', 'override', 'abstract', 'final', 'sealed', 'implicit', 'lazy'].includes(txt)) {
          mods.push(txt);
        }
      }
    }
  }
  return mods;
}

function collectScalaMethods(classNode: ASTNode, source: string): string[] {
  const methods: string[] = [];
  walkAST(classNode, (n) => {
    if (n === classNode) return;
    if (n.type === 'class_definition' || n.type === 'trait_definition' || n.type === 'object_definition' || n.type === 'enum_definition') {
      return true; // Skip inner classes, traits, objects, enums
    }
    if (n.type === 'function_definition') {
      const name = getScalaName(n, source);
      if (name) methods.push(name);
      return true; // Skip walking function body (closures, inner functions)
    }
  });
  return methods;
}

const scalaHandler: LanguageHandler = {
  name: 'scala',
  extensions: ['.scala', '.sc'],
  extractImports: extractScalaImports,
  extractExports: extractScalaExports,
  extractDefinitions: extractScalaDefinitions,
  extractCalls: extractScalaCalls,
};

registerLanguage(scalaHandler);

export { scalaHandler, extractScalaImports, extractScalaExports, extractScalaDefinitions, extractScalaCalls };
