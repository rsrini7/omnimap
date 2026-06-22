import type { ImportInfo, ExportInfo, DefinitionInfo, CallInfo } from '../types.js';
import type { LanguageHandler } from '../registry.js';
import { registerLanguage } from '../registry.js';
import { walkAST, getNodeText, getIdentifierName } from './base.js';
import type { ASTNode } from './base.js';

let GoParser: any = null;

async function loadParser(): Promise<any> {
  if (GoParser) return GoParser;
  try {
    const TreeSitter = (await import('tree-sitter')).default;
    const Go = await import('tree-sitter-go');
    GoParser = new TreeSitter();
    GoParser.setLanguage(Go.default || Go);
    return GoParser;
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

function extractGoImports(tree: ASTNode, source: string): ImportInfo[] {
  const imports: ImportInfo[] = [];

  walkAST(tree, (node) => {
    if (node.type === 'import_declaration') {
      for (const child of node.namedChildren) {
        if (child.type === 'import_spec') {
          const path = child.childForFieldName('path');
          if (path) {
            const sourceText = getNodeText(path, source).replace(/['"]/g, '');
            const name = child.childForFieldName('name');
            imports.push({
              source: sourceText,
              specifiers: name ? [getNodeText(name, source)] : [sourceText.split('/').pop()!],
              line: node.startPosition.row + 1,
            });
          }
        } else if (child.type === 'import_spec_list') {
          for (const spec of child.namedChildren) {
            if (spec.type === 'import_spec') {
              const path = spec.childForFieldName('path');
              if (path) {
                const sourceText = getNodeText(path, source).replace(/['"]/g, '');
                const name = spec.childForFieldName('name');
                imports.push({
                  source: sourceText,
                  specifiers: name ? [getNodeText(name, source)] : [sourceText.split('/').pop()!],
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

function extractGoExports(tree: ASTNode, source: string): ExportInfo[] {
  const exports: ExportInfo[] = [];

  walkAST(tree, (node) => {
    switch (node.type) {
      case 'function_declaration': {
        const name = getIdentifierName(node, source);
        if (name && isExported(name)) {
          const receiver = getGoReceiver(node, source);
          exports.push({ name: receiver ? `${receiver}.${name}` : name, kind: 'function', line: node.startPosition.row + 1 });
        }
        break;
      }
      case 'type_declaration': {
        for (const child of node.namedChildren) {
          if (child.type === 'type_spec') {
            const name = child.childForFieldName('name');
            if (name) {
              const nameText = getNodeText(name, source);
              if (isExported(nameText)) {
                const typeNode = child.childForFieldName('type');
                let kind: ExportInfo['kind'] = 'class';
                if (typeNode?.type === 'interface_type') kind = 'interface';
                exports.push({ name: nameText, kind, line: node.startPosition.row + 1 });
              }
            }
          }
        }
        break;
      }
      case 'var_declaration':
      case 'const_declaration': {
        const specType = node.type === 'var_declaration' ? 'var_spec' : 'const_spec';
        for (const child of node.namedChildren) {
          if (child.type === specType) {
            const name = child.childForFieldName('name');
            if (name) {
              const nameText = getNodeText(name, source);
              if (isExported(nameText)) {
                exports.push({ name: nameText, kind: 'variable', line: node.startPosition.row + 1 });
              }
            }
          }
        }
        break;
      }
    }
  });

  return exports;
}

function extractGoDefinitions(tree: ASTNode, source: string): DefinitionInfo[] {
  const definitions: DefinitionInfo[] = [];

  walkAST(tree, (node) => {
    switch (node.type) {
      case 'function_declaration': {
        const name = getIdentifierName(node, source);
        if (name) {
          const receiver = getGoReceiver(node, source);
          definitions.push({
            name: receiver ? `${receiver}.${name}` : name,
            kind: receiver ? 'method' : 'function',
            line: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            exported: isExported(name),
          });
        }
        break;
      }
      case 'type_declaration': {
        for (const child of node.namedChildren) {
          if (child.type === 'type_spec') {
            const name = child.childForFieldName('name');
            if (name) {
              const nameText = getNodeText(name, source);
              const typeNode = child.childForFieldName('type');
              let kind: DefinitionInfo['kind'] = 'class';
              if (typeNode?.type === 'interface_type') kind = 'interface';
              const methods = kind === 'class' ? collectGoMethods(typeNode, source) : [];
              definitions.push({
                name: nameText,
                kind,
                line: node.startPosition.row + 1,
                endLine: node.endPosition.row + 1,
                exported: isExported(nameText),
                methods,
              });
            }
          }
        }
        break;
      }
      case 'var_declaration':
      case 'const_declaration': {
        const specType = node.type === 'var_declaration' ? 'var_spec' : 'const_spec';
        for (const child of node.namedChildren) {
          if (child.type === specType) {
            const name = child.childForFieldName('name');
            if (name) {
              definitions.push({
                name: getNodeText(name, source),
                kind: 'variable',
                line: node.startPosition.row + 1,
                endLine: node.endPosition.row + 1,
                exported: isExported(getNodeText(name, source)),
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

function extractGoCalls(tree: ASTNode, source: string): CallInfo[] {
  const calls: CallInfo[] = [];

  walkAST(tree, (node) => {
    if (node.type === 'call_expression') {
      const fn = node.childForFieldName('function');
      if (fn) {
        const text = getNodeText(fn, source);
        const name = text.includes('.') ? text.split('.').pop()! : text;
        calls.push({ name, line: node.startPosition.row + 1 });
      }
    }
  });

  return calls;
}

function isExported(name: string): boolean {
  return name.length > 0 && name[0] === name[0].toUpperCase() && name[0] !== name[0].toLowerCase();
}

function getGoReceiver(node: ASTNode, source: string): string | null {
  const params = node.childForFieldName('parameters');
  if (!params) return null;
  for (const child of params.namedChildren) {
    if (child.type === 'parameter_declaration') {
      const type = child.childForFieldName('type');
      if (type) {
        const text = getNodeText(type, source).replace(/[*&]/g, '');
        return text;
      }
    }
  }
  return null;
}

function collectGoMethods(typeNode: ASTNode | null, source: string): string[] {
  if (!typeNode) return [];
  const structName = getIdentifierName(typeNode.parent!, source) || '';
  // Go methods are top-level function_declarations with receivers,
  // not nested inside the struct. Walk the parent (type_declaration)
  // and scan siblings for matching receiver types.
  const methods: string[] = [];
  const root = typeNode.parent?.parent;
  if (!root) return methods;

  walkAST(root, (n) => {
    if (n.type === 'function_declaration') {
      const params = n.childForFieldName('parameters');
      if (!params) return;
      for (const child of params.namedChildren) {
        if (child.type === 'parameter_declaration') {
          const type = child.childForFieldName('type');
          if (type) {
            const receiverType = getNodeText(type, source).replace(/[*&]/g, '');
            if (receiverType === structName) {
              const name = getIdentifierName(n, source);
              if (name) methods.push(name);
            }
          }
        }
      }
    }
  });

  return methods;
}

const goHandler: LanguageHandler = {
  name: 'go',
  extensions: ['.go'],
  extractImports: extractGoImports,
  extractExports: extractGoExports,
  extractDefinitions: extractGoDefinitions,
  extractCalls: extractGoCalls,
};

registerLanguage(goHandler);

export { goHandler, extractGoImports, extractGoExports, extractGoDefinitions, extractGoCalls };
