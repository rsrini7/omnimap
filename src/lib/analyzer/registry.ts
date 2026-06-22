import type { ImportInfo, ExportInfo, DefinitionInfo, CallInfo } from './types.js';

export interface LanguageHandler {
  name: string;
  extensions: string[];
  extractImports(tree: any, source: string, filePath: string): ImportInfo[];
  extractExports(tree: any, source: string): ExportInfo[];
  extractDefinitions(tree: any, source: string): DefinitionInfo[];
  extractCalls(tree: any, source: string): CallInfo[];
}

const handlers = new Map<string, LanguageHandler>();
const extensionMap = new Map<string, LanguageHandler>();

export function registerLanguage(handler: LanguageHandler): void {
  handlers.set(handler.name, handler);
  for (const ext of handler.extensions) {
    extensionMap.set(ext, handler);
  }
}

export function getHandlerForFile(filePath: string): LanguageHandler | null {
  const lastDot = filePath.lastIndexOf('.');
  if (lastDot === -1) return null;
  const ext = filePath.slice(lastDot);
  return extensionMap.get(ext) ?? null;
}

export function getHandler(name: string): LanguageHandler | null {
  return handlers.get(name) ?? null;
}

export function getRegisteredLanguages(): string[] {
  return [...handlers.keys()];
}

export function getSupportedExtensions(): string[] {
  return [...extensionMap.keys()];
}
