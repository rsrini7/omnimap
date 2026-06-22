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

declare module 'better-sqlite3' {
  interface Statement {
    run(...params: any[]): any;
    get(...params: any[]): any;
    all(...params: any[]): any[];
  }

  interface Database {
    exec(sql: string): Database;
    prepare(sql: string): Statement;
    pragma(pragma: string, value?: any): any;
    transaction(fn: () => void): () => void;
    close(): void;
  }

  interface DatabaseConstructor {
    new (path: string): Database;
    (path: string): Database;
  }

  const Database: DatabaseConstructor;
  export default Database;
}
