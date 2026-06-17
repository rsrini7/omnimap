/**
 * omm ref-syntax — Document the @class-name cross-reference convention
 */

import { listClasses } from '../lib/store.js';

const HELP = `
omm ref-syntax — The @class-name cross-reference convention

Overview
--------
Inside a mermaid diagram, you can reference another perspective using
the @class-name syntax. When the viewer renders a diagram, any node
whose ID starts with @ becomes a clickable link to that perspective.

Syntax
------
@<class-name>["Label"]

Examples:
  @auth                  — link to the "auth" perspective (no label)
  @command-surface["CLI"] — link with display label "CLI"

Rules
-----
1. Only top-level perspective names work as refs. Child paths do NOT
   resolve:
     @command-surface        ✓ resolves to command-surface perspective
     @command-surface/agent  ✗ invalid — not a top-level class

2. The referenced class must exist in the project. Otherwise the
   validator (omm validate) reports [ref-exists] error.

3. A diagram cannot reference its own class (creates a self-loop).
   The validator reports [ref-self] error.

4. In the parser, refs use regex: /@([\\w-]+)/g
   - Letters, digits, underscores, hyphens
   - Must follow @ with no whitespace

5. Refs appear in the viewer as dashed-border nodes with a click
   handler that opens the target perspective's sidebar.

Usage
-----
Add a ref to your diagram like any other node:

  graph LR
      client["Client App"] --> @api[API]
      api --> @db[Database]
      api --> @auth[Auth Service]

This creates three clickable cross-perspective links.

Validation
----------
Run: omm validate <perspective>

It will report:
  [ref-exists]  error   @target does not exist (typo or wrong name)
  [ref-self]    error   Diagram references its own class

See: omm validate --explain

Available refs
---------------
Run: omm list
Shows all perspective names that can be used as @refs.
`;

export function commandRefSyntax(): void {
  process.stdout.write(HELP.trim() + '\n\n');

  // Show current available refs
  try {
    const classes = listClasses();
    if (classes.length > 0) {
      process.stdout.write('Available @refs in this project:\n');
      for (const c of classes) {
        process.stdout.write(`  @${c}\n`);
      }
      process.stdout.write('\n');
    }
  } catch {
    // no .omm/ — just print the docs
  }
}
