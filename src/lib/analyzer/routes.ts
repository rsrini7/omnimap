import type { ASTNode } from './languages/base.js';
import { walkAST, getNodeText, getIdentifierName } from './languages/base.js';

export interface RouteInfo {
  method: string;
  path: string;
  handler: string;
  file: string;
  line: number;
  framework: string;
}

interface FrameworkDetector {
  name: string;
  detect: (filePath: string, source: string) => boolean;
  extract: (tree: ASTNode, source: string, filePath: string) => RouteInfo[];
}

// ─── Express / Koa / Fastify ─────────────────────────────────────────────────

const expressDetector: FrameworkDetector = {
  name: 'express',
  detect: (filePath) => /\.(js|ts|mjs|cjs)$/.test(filePath),
  extract: (tree, source, filePath) => {
    const routes: RouteInfo[] = [];
    walkAST(tree, (node) => {
      if (node.type === 'call_expression') {
        const fn = node.childForFieldName('function');
        if (!fn) return;
        const fnText = getNodeText(fn, source);
        const methodMatch = fnText.match(/\.(get|post|put|patch|delete|all|options|head)\s*$/);
        if (methodMatch) {
          const args = node.childForFieldName('arguments');
          if (args?.namedChildren?.[0]?.type === 'string') {
            const routePath = getNodeText(args.namedChildren[0], source).replace(/['"]/g, '');
            const handler = args.namedChildren?.[1];
            const handlerName = handler ? getNodeText(handler, source).split('.').pop() || 'anonymous' : 'anonymous';
            routes.push({
              method: methodMatch[1].toUpperCase(),
              path: routePath,
              handler: handlerName,
              file: filePath,
              line: node.startPosition.row + 1,
              framework: 'express',
            });
          }
        }
      }
    });
    return routes;
  },
};

// ─── Django ──────────────────────────────────────────────────────────────────

const djangoDetector: FrameworkDetector = {
  name: 'django',
  detect: (filePath) => filePath.endsWith('urls.py'),
  extract: (tree, source, filePath) => {
    const routes: RouteInfo[] = [];
    walkAST(tree, (node) => {
      if (node.type === 'call') {
        const fn = node.childForFieldName('function');
        if (!fn) return;
        const fnName = getNodeText(fn, source);
        if (['path', 're_path', 'url'].includes(fnName)) {
          const args = node.childForFieldName('arguments');
          if (args?.namedChildren?.length) {
            const first = args.namedChildren[0];
            if (first.type === 'string') {
              const routePath = getNodeText(first, source).replace(/['"]/g, '');
              const second = args.namedChildren[1];
              const handler = second ? getNodeText(second, source) : 'unknown';
              routes.push({
                method: 'ANY',
                path: `/${routePath}`,
                handler,
                file: filePath,
                line: node.startPosition.row + 1,
                framework: 'django',
              });
            }
          }
        }
      }
    });
    return routes;
  },
};

// ─── Flask ───────────────────────────────────────────────────────────────────

const flaskDetector: FrameworkDetector = {
  name: 'flask',
  detect: (filePath) => /\.(py)$/.test(filePath),
  extract: (tree, source, filePath) => {
    const routes: RouteInfo[] = [];
    walkAST(tree, (node) => {
      if (node.type === 'decorated_definition') {
        const decorator = node.namedChildren?.[0];
        if (decorator?.type === 'decorator') {
          const decText = getNodeText(decorator, source);
          const routeMatch = decText.match(/@(?:app|bp|blueprint)\.(?:route|get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/);
          if (routeMatch) {
            const methodMatch = decText.match(/@(?:app|bp|blueprint)\.(get|post|put|patch|delete)/);
            const defNode = node.namedChildren?.[1];
            const handlerName = defNode ? getIdentifierName(defNode, source) || 'anonymous' : 'anonymous';
            routes.push({
              method: methodMatch ? methodMatch[1].toUpperCase() : 'ANY',
              path: routeMatch[1],
              handler: handlerName,
              file: filePath,
              line: node.startPosition.row + 1,
              framework: 'flask',
            });
          }
        }
      }
    });
    return routes;
  },
};

// ─── FastAPI ─────────────────────────────────────────────────────────────────

const fastapiDetector: FrameworkDetector = {
  name: 'fastapi',
  detect: (filePath) => /\.(py)$/.test(filePath),
  extract: (tree, source, filePath) => {
    const routes: RouteInfo[] = [];
    walkAST(tree, (node) => {
      if (node.type === 'decorated_definition') {
        const decorator = node.namedChildren?.[0];
        if (decorator?.type === 'decorator') {
          const decText = getNodeText(decorator, source);
          const routeMatch = decText.match(/@(?:app|router)\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/);
          if (routeMatch) {
            const defNode = node.namedChildren?.[1];
            const handlerName = defNode ? getIdentifierName(defNode, source) || 'anonymous' : 'anonymous';
            routes.push({
              method: routeMatch[1].toUpperCase(),
              path: routeMatch[2],
              handler: handlerName,
              file: filePath,
              line: node.startPosition.row + 1,
              framework: 'fastapi',
            });
          }
        }
      }
    });
    return routes;
  },
};

// ─── Spring ──────────────────────────────────────────────────────────────────

const springDetector: FrameworkDetector = {
  name: 'spring',
  detect: (filePath) => filePath.endsWith('.java'),
  extract: (tree, source, filePath) => {
    const routes: RouteInfo[] = [];
    walkAST(tree, (node) => {
      if (node.type === 'method_declaration') {
        let routePath = '';
        let method = 'ANY';
        for (const child of node.namedChildren) {
          if (child.type === 'modifiers') {
            for (const mod of child.namedChildren) {
              if (mod.type === 'annotation' || mod.type === 'marker_annotation') {
                const annText = getNodeText(mod, source);
                const mappingMatch = annText.match(/@(GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping|RequestMapping)\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/);
                if (mappingMatch) {
                  method = mappingMatch[1].replace('Mapping', '').toUpperCase();
                  routePath = mappingMatch[2];
                }
              }
            }
          }
        }
        if (routePath) {
          const name = node.childForFieldName('name');
          routes.push({
            method,
            path: routePath,
            handler: name ? getNodeText(name, source) : 'anonymous',
            file: filePath,
            line: node.startPosition.row + 1,
            framework: 'spring',
          });
        }
      }
    });
    return routes;
  },
};

// ─── NestJS ──────────────────────────────────────────────────────────────────

const nestDetector: FrameworkDetector = {
  name: 'nestjs',
  detect: (filePath) => /\.(ts)$/.test(filePath),
  extract: (tree, source, filePath) => {
    const routes: RouteInfo[] = [];
    walkAST(tree, (node) => {
      if (node.type === 'decorator' || node.type === 'call_expression') {
        const text = getNodeText(node, source);
        const routeMatch = text.match(/@(Get|Post|Put|Delete|Patch|All)\(\s*['"]([^'"]+)['"]/);
        if (routeMatch) {
          // Find the method this decorator is attached to
          const parent = node.parent;
          const methodName = parent?.childForFieldName('name');
          routes.push({
            method: routeMatch[1].toUpperCase(),
            path: routeMatch[2],
            handler: methodName ? getNodeText(methodName, source) : 'anonymous',
            file: filePath,
            line: node.startPosition.row + 1,
            framework: 'nestjs',
          });
        }
      }
    });
    return routes;
  },
};

// ─── Gin (Go) ───────────────────────────────────────────────────────────────

const ginDetector: FrameworkDetector = {
  name: 'gin',
  detect: (filePath) => filePath.endsWith('.go'),
  extract: (tree, source, filePath) => {
    const routes: RouteInfo[] = [];
    walkAST(tree, (node) => {
      if (node.type === 'call_expression') {
        const fn = node.childForFieldName('function');
        if (!fn) return;
        const fnText = getNodeText(fn, source);
        const methodMatch = fnText.match(/\.(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*$/);
        if (methodMatch) {
          const args = node.childForFieldName('arguments');
          if (args?.namedChildren?.[0]?.type === 'interpreted_string_literal') {
            const routePath = getNodeText(args.namedChildren[0], source).replace(/"/g, '');
            routes.push({
              method: methodMatch[1],
              path: routePath,
              handler: 'handler',
              file: filePath,
              line: node.startPosition.row + 1,
              framework: 'gin',
            });
          }
        }
      }
    });
    return routes;
  },
};

// ─── Registry ────────────────────────────────────────────────────────────────

const DETECTORS: FrameworkDetector[] = [
  expressDetector,
  djangoDetector,
  flaskDetector,
  fastapiDetector,
  springDetector,
  nestDetector,
  ginDetector,
];

export function extractRoutes(tree: ASTNode, source: string, filePath: string): RouteInfo[] {
  const routes: RouteInfo[] = [];
  for (const detector of DETECTORS) {
    if (detector.detect(filePath, source)) {
      routes.push(...detector.extract(tree, source, filePath));
    }
  }
  return routes;
}

export function formatRoutes(routes: RouteInfo[]): string {
  if (routes.length === 0) return '';
  const lines: string[] = [];
  lines.push(`### Framework Routes (${routes.length} found)\n`);
  const byFramework = new Map<string, RouteInfo[]>();
  for (const r of routes) {
    if (!byFramework.has(r.framework)) byFramework.set(r.framework, []);
    byFramework.get(r.framework)!.push(r);
  }
  for (const [fw, fRoutes] of byFramework) {
    lines.push(`  ${fw}:`);
    for (const r of fRoutes.slice(0, 20)) {
      lines.push(`    ${r.method.padEnd(7)} ${r.path}  → ${r.handler} (${r.file}:${r.line})`);
    }
    if (fRoutes.length > 20) lines.push(`    ... and ${fRoutes.length - 20} more`);
  }
  lines.push('');
  return lines.join('\n');
}
