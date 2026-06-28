# Roadmap

## Completed

### PlantUML Diagram Support ✓
Added PlantUML rendering for sequence diagrams and C4 architecture models.
- Format detection (`.puml`, `.plantuml` extensions)
- Kroki proxy for online rendering
- Local `plantuml.jar` support for offline/air-gapped use
- C4 templates for enterprise architecture docs
- Auto-download: `omm config plantuml-download`
- See [plantuml-setup.md](./plantuml-setup.md)

### MCP Server (Full Coverage) ✓
MCP server with all omm commands exposed as tools for AI agents.
- `omm_list` — List all elements
- `omm_show` — Show element details
- `omm_read` — Read field content
- `omm_eval` — Quality evaluation
- `omm_validate` — Diagram validation
- `omm_refs` — Cross-references
- `omm_inspect` — Detailed inspection
- `omm_tree` — Element tree
- `omm_diff` — Diagram diff
- `omm_treecode` — Code coverage
- `omm_analyze` — Structural analysis
- `omm_search` — Fuzzy search
- `omm_query` — Graph traversal
- `omm_tour` — Guided tour
- `omm_impact` — Change impact
- See [mcp-setup.md](./mcp-setup.md)

## Planned

### AI-powered search in viewer
Natural language search across architecture docs — "where does auth happen?" finds relevant elements across perspectives.

### Nested documentation boundaries
`.omm-boundary.yaml` for monorepo subtree delegation — each team owns their own .omm/ subtree.

### Schema validation
JSON Schema for `meta.yaml` validation — formal contract for external tools and CI.

## Future Scope

### Graphviz/DOT Support
Dependency graph rendering with advanced layouts (fdp, neato, circo, osage) for large codebases with 100+ modules.
- Client-side rendering via `@hpcc-js/wasm` (offline-capable)
- Better subgraph clustering than Mermaid
- `--format dot` option for `omm analyze`

### D2 Diagram Support
Modern diagramming language with grid layouts, icons, and SQL table support.
- Requires local `d2` binary or Kroki proxy
