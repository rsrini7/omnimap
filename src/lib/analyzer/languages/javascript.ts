import type { ImportInfo, ExportInfo, DefinitionInfo, CallInfo } from '../types.js';
import type { LanguageHandler } from '../registry.js';
import { registerLanguage } from '../registry.js';
import { walkAST, getNodeText, getIdentifierName, resolveRelativePath } from './base.js';
import type { ASTNode } from './base.js';

let JSParser: any = null;

async function loadParser(): Promise<any> {
  if (JSParser) return JSParser;
  try {
    const TreeSitter = (await import('tree-sitter')).default;
    const JavaScript = await import('tree-sitter-javascript');
    JSParser = new TreeSitter();
    JSParser.setLanguage(JavaScript.default || JavaScript);
    return JSParser;
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

export function parseJS(source: string, parser: any): ASTNode | null {
  try {
    return parser.parse(source).rootNode;
  } catch {
    return null;
  }
}

function extractJSImports(tree: ASTNode, source: string, filePath: string): ImportInfo[] {
  const imports: ImportInfo[] = [];

  walkAST(tree, (node) => {
    if (node.type === 'import_statement') {
      const sourceNode = node.childForFieldName('source');
      if (!sourceNode) return;
      const sourceText = getNodeText(sourceNode, source).replace(/['"]/g, '');
      const specifiers: string[] = [];
      let defaultName: string | undefined;
      let namespaceName: string | undefined;

      for (const child of node.namedChildren) {
        if (child.type === 'import_clause') {
          for (const clause of child.namedChildren) {
            if (clause.type === 'identifier') {
              defaultName = getNodeText(clause, source);
            } else if (clause.type === 'named_imports') {
              for (const spec of clause.namedChildren) {
                if (spec.type === 'import_specifier') {
                  const name = spec.childForFieldName('name') || spec.namedChild(0);
                  if (name) specifiers.push(getNodeText(name, source));
                }
              }
            } else if (clause.type === 'namespace_import') {
              const id = clause.namedChildren.find((c: ASTNode) => c.type === 'identifier');
              if (id) namespaceName = getNodeText(id, source);
            }
          }
        }
      }

      imports.push({
        source: sourceText,
        specifiers,
        default: defaultName,
        namespace: namespaceName,
        resolved: resolveRelativePath(filePath, sourceText),
        line: node.startPosition.row + 1,
      });
    } else if (node.type === 'call_expression') {
      const fn = node.childForFieldName('function');
      const args = node.childForFieldName('arguments');
      if (!fn || !args) return;
      const fnText = getNodeText(fn, source);
      if (fnText === 'require' && args.namedChildren.length > 0) {
        const first = args.namedChildren[0];
        if (first.type === 'string') {
          const sourceText = getNodeText(first, source).replace(/['"]/g, '');
          imports.push({
            source: sourceText,
            specifiers: [],
            resolved: resolveRelativePath(filePath, sourceText),
            line: node.startPosition.row + 1,
          });
        }
      }
    }
  });

  return imports;
}

function extractJSExports(tree: ASTNode, source: string): ExportInfo[] {
  const exports: ExportInfo[] = [];

  walkAST(tree, (node) => {
    if (node.type === 'export_statement') {
      const declaration = node.childForFieldName('declaration');
      if (declaration) {
        const kind = classifyDeclaration(declaration.type);
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
    } else if (node.type === 'assignment_expression') {
      const left = node.childForFieldName('left');
      if (left) {
        const text = getNodeText(left, source);
        if (text.startsWith('module.exports') || text.startsWith('exports.')) {
          const right = node.childForFieldName('right');
          if (right) {
            const name = text.includes('.') ? text.split('.').pop()! : 'default';
            exports.push({ name, kind: 'variable', line: node.startPosition.row + 1 });
          }
        }
      }
    }
  });

  return exports;
}

function extractJSDefinitions(tree: ASTNode, source: string): DefinitionInfo[] {
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
      case 'function_declaration': {
        kind = 'function';
        name = getIdentifierName(node, source);
        break;
      }
      case 'class_declaration': {
        kind = 'class';
        name = getIdentifierName(node, source);
        break;
      }
      case 'method_definition': {
        kind = 'method';
        name = getIdentifierName(node, source);
        break;
      }
      case 'lexical_declaration':
      case 'variable_declaration': {
        for (const child of node.namedChildren) {
          if (child.type === 'variable_declarator') {
            const id = child.childForFieldName('name');
            if (id) {
              const init = child.childForFieldName('value');
              if (init && (init.type === 'arrow_function' || init.type === 'function')) {
                definitions.push({
                  name: getNodeText(id, source),
                  kind: 'function',
                  line: node.startPosition.row + 1,
                  endLine: node.endPosition.row + 1,
                  exported: exportedNames.has(getNodeText(id, source)),
                });
              } else if (init && init.type === 'class') {
                definitions.push({
                  name: getNodeText(id, source),
                  kind: 'class',
                  line: node.startPosition.row + 1,
                  endLine: node.endPosition.row + 1,
                  exported: exportedNames.has(getNodeText(id, source)),
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

function extractJSCalls(tree: ASTNode, source: string): CallInfo[] {
  const calls: CallInfo[] = [];

  walkAST(tree, (node) => {
    if (node.type === 'call_expression') {
      const fn = node.childForFieldName('function');
      if (fn) {
        let name: string;
        if (fn.type === 'identifier') {
          name = getNodeText(fn, source);
        } else if (fn.type === 'member_expression') {
          const prop = fn.childForFieldName('property');
          name = prop ? getNodeText(prop, source) : getNodeText(fn, source);
        } else {
          return;
        }
        if (name === 'require' || name === 'import') return;
        calls.push({ name, line: node.startPosition.row + 1 });
      }
    }
  });

  return calls;
}

function classifyDeclaration(type: string): ExportInfo['kind'] | null {
  switch (type) {
    case 'function_declaration': return 'function';
    case 'class_declaration': return 'class';
    case 'interface_declaration': return 'interface';
    case 'type_alias_declaration': return 'type';
    case 'enum_declaration': return 'enum';
    default: return 'variable';
  }
}

const javascriptHandler: LanguageHandler = {
  name: 'javascript',
  extensions: ['.js', '.jsx', '.mjs', '.cjs'],
  extractImports: extractJSImports,
  extractExports: extractJSExports,
  extractDefinitions: extractJSDefinitions,
  extractCalls: extractJSCalls,
};

registerLanguage(javascriptHandler);

export { javascriptHandler, extractJSImports, extractJSExports, extractJSDefinitions, extractJSCalls };
