# Roadmap

## Completed

### Incremental analysis ✓
Detect changed files since last scan and update only affected perspectives and elements — skip unchanged subtrees.
- `omm incremental` — plan incremental updates
- `omm incremental --mark` — bootstrap source tracking
- `omm incremental --record` — mark element as scanned

### Guide & onboarding skill ✓
`/omm-guide` skill that walks new developers through the architecture interactively using the generated `.omm/` docs as context.

### treedocs-inspired features ✓
Features inspired by [DandyLyons/treedocs](https://github.com/DandyLyons/treedocs):
- **Code ↔ docs coverage map** (`omm treecode`) — shows which source files are covered by .omm/ elements
- **Structural signature** (`omm signature`) — SHA-256 hash of element paths for drift detection
- **Reconciliation** (`omm reconcile`) — detect and fix orphaned sources, missing descriptions, broken refs
- **External links** (`omm links`) — manage references to external docs, ADRs, wikis
- **Element inspection** (`omm inspect`) — detailed element view with score, fields, links, source tracking
- **Link resolution** (`omm inspect --links`) — graph-based @ref resolution with cycle detection
- **YAML tree output** (`omm tree --yaml`) — YAML format for configs and CI reports
- **Git hooks** (`omm hooks install --pre-commit`) — signature check before commits

## Planned

### Sub-agent scan pipeline
Split `/omm-scan` from a single skill into a multi-agent pipeline — parallel analysis per perspective, reduced token usage, faster scans.

### AI-powered search in viewer
Natural language search across architecture docs — "where does auth happen?" finds relevant elements across perspectives.

### Nested documentation boundaries
`.omm-boundary.yaml` for monorepo subtree delegation — each team owns their own .omm/ subtree.

### Schema validation
JSON Schema for `meta.yaml` validation — formal contract for external tools and CI.
