import type { ImportInfo, ExportInfo, DefinitionInfo, CallInfo } from '../types.js';
import type { LanguageHandler } from '../registry.js';
import { registerLanguage } from '../registry.js';
import { walkAST, getNodeText, getIdentifierName } from './base.js';
import type { ASTNode } from './base.js';
import { extractJSImports, extractJSCalls } from './javascript.js';

let TSParser: any = null;

async function loadParser(): Promise<any> {
  if (TSParser) return TSParser;
  try {
    const TreeSitter = (await import('tree-sitter')).default;
    const TypeScript = await import('tree-sitter-typescript');
    const parser = new TreeSitter();
    const lang = TypeScript.typescript || TypeScript.default?.typescript || TypeScript.default || TypeScript;
    parser.setLanguage(lang);
    TSParser = parser;
    return TSParser;
  } catch {
    return null;
  }
}

export async function ensureParser(): Promise<any> {
  return loadParser();
}

export async function isAvailable(): Promise<boolean> {
  try {
    const parser = await loadParser();
    return parser !== null;
  } catch {
    return false;
  }
}

function extractTSImports(tree: ASTNode, source: string, filePath: string): ImportInfo[] {
  return extractJSImports(tree, source, filePath);
}

function extractTSExports(tree: ASTNode, source: string): ExportInfo[] {
  const exports: ExportInfo[] = [];

  walkAST(tree, (node) => {
    if (node.type === 'export_statement') {
      const declaration = node.childForFieldName('declaration');
      if (declaration) {
        const kind = classifyTSDeclaration(declaration.type);
        const name = getIdentifierName(declaration, source);
        if (name && kind) {
          exports.push({ name, kind, line: node.startPosition.row + 1 });
        }
      }
      for (const child of node.namedChildren) {
        if (child.type === 'export_clause') {
          for (const spec of child.namedChildren) {
            if (spec.type === 'export_specifier') {
              const name = spec.childForFieldName('name') || spec.namedChild(0);
              if (name) {
                exports.push({
                  name: getNodeText(name, source),
                  kind: 'variable',
                  line: spec.startPosition.row + 1,
                });
              }
            }
          }
        }
      }
    }
  });

  return exports;
}

function extractTSDefinitions(tree: ASTNode, source: string): DefinitionInfo[] {
  const definitions: DefinitionInfo[] = [];
  const exportedNames = new Set<string>();

  walkAST(tree, (node) => {
    if (node.type === 'export_statement') {
      const decl = node.childForFieldName('declaration');
      if (decl) {
        const name = getIdentifierName(decl, source);
        if (name) exportedNames.add(name);
      }
    }
  });

  walkAST(tree, (node) => {
    let kind: DefinitionInfo['kind'] | null = null;
    let name: string | null = null;

    switch (node.type) {
      case 'function_declaration':
        kind = 'function';
        name = getIdentifierName(node, source);
        break;
      case 'class_declaration':
        kind = 'class';
        name = getIdentifierName(node, source);
        break;
      case 'method_definition':
        kind = 'method';
        name = getIdentifierName(node, source);
        break;
      case 'interface_declaration':
        kind = 'interface';
        name = getIdentifierName(node, source);
        break;
      case 'type_alias_declaration':
        kind = 'type';
        name = getIdentifierName(node, source);
        break;
      case 'enum_declaration':
        kind = 'enum';
        name = getIdentifierName(node, source);
        break;
      case 'abstract_class_declaration':
        kind = 'class';
        name = getIdentifierName(node, source);
        break;
      case 'lexical_declaration':
      case 'variable_declaration': {
        for (const child of node.namedChildren) {
          if (child.type === 'variable_declarator') {
            const id = child.childForFieldName('name');
            if (id) {
              const init = child.childForFieldName('value');
              const idText = getNodeText(id, source);
              if (init && (init.type === 'arrow_function' || init.type === 'function')) {
                definitions.push({
                  name: idText,
                  kind: 'function',
                  line: node.startPosition.row + 1,
                  endLine: node.endPosition.row + 1,
                  exported: exportedNames.has(idText),
                });
              } else if (init && (init.type === 'class' || init.type === 'class_declaration')) {
                definitions.push({
                  name: idText,
                  kind: 'class',
                  line: node.startPosition.row + 1,
                  endLine: node.endPosition.row + 1,
                  exported: exportedNames.has(idText),
                });
              }
            }
          }
        }
        return;
      }
    }

    if (kind && name) {
      definitions.push({
        name,
        kind,
        line: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        exported: exportedNames.has(name),
      });
    }
  });

  return definitions;
}

function extractTSCalls(tree: ASTNode, source: string): CallInfo[] {
  return extractJSCalls(tree, source);
}

function classifyTSDeclaration(type: string): ExportInfo['kind'] | null {
  switch (type) {
    case 'function_declaration': return 'function';
    case 'class_declaration': return 'class';
    case 'interface_declaration': return 'interface';
    case 'type_alias_declaration': return 'type';
    case 'enum_declaration': return 'enum';
    case 'abstract_class_declaration': return 'class';
    default: return 'variable';
  }
}

const typescriptHandler: LanguageHandler = {
  name: 'typescript',
  extensions: ['.ts', '.tsx', '.mts', '.cts'],
  extractImports: extractTSImports,
  extractExports: extractTSExports,
  extractDefinitions: extractTSDefinitions,
  extractCalls: extractTSCalls,
};

registerLanguage(typescriptHandler);

export { typescriptHandler, extractTSImports, extractTSExports, extractTSDefinitions, extractTSCalls };
