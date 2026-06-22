declare module 'tree-sitter' {
  class Parser {
    setLanguage(language: any): void;
    parse(input: string): { rootNode: any };
  }
  export default Parser;
}

declare module 'tree-sitter-javascript' {
  const language: any;
  export default language;
}

declare module 'tree-sitter-typescript' {
  const typescript: any;
  const tsx: any;
  export { typescript, tsx };
}

declare module 'tree-sitter-java' {
  const language: any;
  export default language;
}

declare module 'tree-sitter-kotlin' {
  const language: any;
  export default language;
}

declare module 'tree-sitter-scala' {
  const language: any;
  export default language;
}

declare module 'tree-sitter-python' {
  const language: any;
  export default language;
}

declare module 'tree-sitter-go' {
  const language: any;
  export default language;
}

declare module 'tree-sitter-rust' {
  const language: any;
  export default language;
}
