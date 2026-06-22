import type { ImportInfo, ExportInfo, DefinitionInfo, CallInfo } from '../types.js';
import type { LanguageHandler } from '../registry.js';
import { registerLanguage } from '../registry.js';
import { walkAST, getNodeText, getIdentifierName } from './base.js';
import type { ASTNode } from './base.js';

let PythonParser: any = null;

async function loadParser(): Promise<any> {
  if (PythonParser) return PythonParser;
  try {
    const TreeSitter = (await import('tree-sitter')).default;
    const Python = await import('tree-sitter-python');
    PythonParser = new TreeSitter();
    PythonParser.setLanguage(Python.default || Python);
    return PythonParser;
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

/** Check if a node is a direct child of the module root (not nested inside a function/class). */
function isModuleLevel(node: ASTNode): boolean {
  const parent = node.parent;
  if (!parent) return true;
  // Module root has type 'module'
  if (parent.type === 'module') return true;
  // Some parsers use 'expression_statement' wrapping at module level
  if (parent.type === 'expression_statement' && parent.parent?.type === 'module') return true;
  return false;
}

function extractPythonImports(tree: ASTNode, source: string): ImportInfo[] {
  const imports: ImportInfo[] = [];

  walkAST(tree, (node) => {
    if (node.type === 'import_statement') {
      for (const child of node.namedChildren) {
        if (child.type === 'dotted_name') {
          const text = getNodeText(child, source);
          // `import os.path` binds `os`, not `path`
          imports.push({
            source: text,
            specifiers: [text.split('.')[0]],
            line: node.startPosition.row + 1,
          });
        } else if (child.type === 'aliased_import') {
          const name = child.childForFieldName('name');
          const alias = child.childForFieldName('alias');
          if (name) {
            imports.push({
              source: getNodeText(name, source),
              specifiers: [alias ? getNodeText(alias, source) : getNodeText(name, source).split('.')[0]],
              line: node.startPosition.row + 1,
            });
          }
        }
      }
    } else if (node.type === 'import_from_statement') {
      const moduleName = node.childForFieldName('module_name');
      const sourceText = moduleName ? getNodeText(moduleName, source) : '';
      const specifiers: string[] = [];
      let wildcard = false;

      for (const child of node.namedChildren) {
        if (child.type === 'dotted_name' && child === moduleName) continue;
        if (child.type === 'wildcard_import') {
          wildcard = true;
        } else if (child.type === 'aliased_import') {
          const name = child.childForFieldName('name');
          if (name) specifiers.push(getNodeText(name, source));
        } else if (child.type === 'dotted_name') {
          specifiers.push(getNodeText(child, source).split('.').pop()!);
        }
      }

      imports.push({
        source: sourceText,
        specifiers: wildcard ? [] : specifiers,
        line: node.startPosition.row + 1,
      });
    }
  });

  return imports;
}

function extractPythonExports(tree: ASTNode, source: string): ExportInfo[] {
  const exports: ExportInfo[] = [];
  let dunderAll: string[] = [];

  // First pass: collect __all__ if present
  walkAST(tree, (node) => {
    if (node.type === 'assignment' && isModuleLevel(node)) {
      const left = node.childForFieldName('left');
      if (left && getNodeText(left, source) === '__all__') {
        const right = node.childForFieldName('right');
        if (right && right.type === 'list') {
          const allList: string[] = [];
          for (const item of right.namedChildren) {
            if (item.type === 'string') {
              allList.push(getNodeText(item, source).replace(/['"]/g, ''));
            }
          }
          if (allList.length > 0) dunderAll = allList;
        }
      }
    }
  });

  // Second pass: collect exports (only module-level)
  walkAST(tree, (node) => {
    if (!isModuleLevel(node)) return;

    switch (node.type) {
      case 'function_definition': {
        const name = getIdentifierName(node, source);
        if (name && !name.startsWith('_')) {
          exports.push({ name, kind: 'function', line: node.startPosition.row + 1 });
        }
        break;
      }
      case 'class_definition': {
        const name = getIdentifierName(node, source);
        if (name && !name.startsWith('_')) {
          exports.push({ name, kind: 'class', line: node.startPosition.row + 1 });
        }
        break;
      }
      case 'assignment': {
        const left = node.childForFieldName('left');
        if (left) {
          const name = getNodeText(left, source);
          if (name && !name.startsWith('_') && name !== '__all__') {
            exports.push({ name, kind: 'variable', line: node.startPosition.row + 1 });
          }
        }
        break;
      }
    }
  });

  // If __all__ is defined, filter exports to only those in __all__
  if (dunderAll.length > 0) {
    const allowed = new Set(dunderAll);
    return exports.filter(e => allowed.has(e.name));
  }

  return exports;
}

function extractPythonDefinitions(tree: ASTNode, source: string): DefinitionInfo[] {
  const definitions: DefinitionInfo[] = [];

  walkAST(tree, (node) => {
    switch (node.type) {
      case 'function_definition':
      case 'async_function_definition': {
        const name = getIdentifierName(node, source);
        if (name) {
          const isAsync = node.type === 'async_function_definition';
          const isTopLevel = isModuleLevel(node);
          definitions.push({
            name: isAsync ? `async ${name}` : name,
            kind: 'function',
            line: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            exported: isTopLevel && !name.startsWith('_'),
          });
        }
        break;
      }
      case 'class_definition': {
        const name = getIdentifierName(node, source);
        if (name) {
          const methods = collectPythonMethods(node, source);
          definitions.push({
            name,
            kind: 'class',
            line: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            exported: isModuleLevel(node) && !name.startsWith('_'),
            methods,
          });
        }
        break;
      }
      case 'assignment': {
        if (!isModuleLevel(node)) break;
        const left = node.childForFieldName('left');
        if (left && left.type === 'identifier') {
          const name = getNodeText(left, source);
          if (name && !name.startsWith('_')) {
            definitions.push({
              name,
              kind: 'variable',
              line: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
              exported: true,
            });
          }
        }
        break;
      }
    }
  });

  return definitions;
}

function extractPythonCalls(tree: ASTNode, source: string): CallInfo[] {
  const calls: CallInfo[] = [];

  walkAST(tree, (node) => {
    if (node.type === 'call') {
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

function collectPythonMethods(classNode: ASTNode, source: string): string[] {
  const methods: string[] = [];
  walkAST(classNode, (n) => {
    if (n === classNode) return;
    if (n.type === 'class_definition') {
      return true; // Skip inner classes
    }
    if (n.type === 'function_definition' || n.type === 'async_function_definition') {
      const name = getIdentifierName(n, source);
      if (name) methods.push(name);
      return true; // Skip walking method body (closures, inner functions)
    }
  });
  return methods;
}

const pythonHandler: LanguageHandler = {
  name: 'python',
  extensions: ['.py', '.pyw', '.pyi'],
  extractImports: extractPythonImports,
  extractExports: extractPythonExports,
  extractDefinitions: extractPythonDefinitions,
  extractCalls: extractPythonCalls,
};

registerLanguage(pythonHandler);

export { pythonHandler, extractPythonImports, extractPythonExports, extractPythonDefinitions, extractPythonCalls };
