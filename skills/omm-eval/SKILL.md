---
name: omm-eval
description: Evaluate .omm/ documentation quality and improve it iteratively. Use when the user says "omm eval", "improve docs", "check coverage", "score docs", "fix documentation gaps".
argument-hint: "[--max-iterations <n>] [--target <score>]"
---

# omm-eval — Documentation Quality Improver

## Purpose

Evaluate the quality and coverage of `.omm/` documentation and iteratively improve it by:

1. Running `omm eval` to get a quality report
2. Identifying specific gaps (missing fields, invalid diagrams, missing flows, etc.)
3. Filling in the gaps by writing to the appropriate fields
4. Re-running eval to verify improvement
5. Repeating until target score is reached or max iterations hit

This creates an **iterative improvement loop** that progressively raises documentation quality.

## Prerequisites

```bash
command -v omm || npm install -g @rsrini/omnimap
```

If the install fails, tell the user: "Please run `npm install -g @rsrini/omnimap` in your terminal, then try again."

---

## Step 1: Check Language

```bash
omm config language
```

Write field content (description, context, constraint, concern, todo, note) in the configured language. Default is English. Element IDs, directory names, and diagram node IDs are always English kebab-case.

## Useful Companion Commands

When iterating, these commands help diagnose specific issues:

```bash
# Get deterministic code structure + architecture insights (fitness score, cycles, hotspots, god nodes, communities)
omm analyze --format md

# Check if documented architecture matches actual code
omm analyze --validate

# Show change impact for a specific file
omm analyze --impact <file>

# Extract framework routes
omm analyze --routes

# Search across all elements (fuzzy)
omm search <query>

# Full-text search via SQLite
omm sync --search <query>

# Guided tour (read in dependency order)
omm tour --limit 20

# Find test files impacted by changes
omm affected --staged

# Show element type (perspective/leaf/group) and why
omm show <element> --type

# Validate diagram syntax with rule explanations
omm validate <element>
omm validate --explain      # full rule docs (rule + fix + example)
omm validate --rules        # one-liner rule list
omm validate <element> --fix  # auto-fix fixable issues (classdef-color), writes back

# Diagram format support
# omm eval and omm validate detect format automatically:
#   .puml files → PlantUML validation (@startuml/@enduml, participants, arrows)
#   .mmd files  → Mermaid validation (graph declaration, nodes, edges)
# Set format explicitly: omm format <element> set plantuml

# Check for circular cross-references between perspectives
# Look for 'perspective-cross-ref' warnings in the output
omm validate 2>&1 | grep -i "perspective-cross-ref\|circular"

# Document the @class-name cross-reference convention
omm ref-syntax

# List @refs in a diagram with pass/fail status
omm diagram-refs <element>
omm diagram-refs <element> --json

# Show lowest-scoring elements with gap analysis
omm eval --suggest

# Programmatic score breakdown (same as --explain but JSON)
omm eval --explain <element> --json

# Generate feedback report to share with maintainer
omm feedback --include "your suggestion"

# Check code ↔ docs coverage (find undocumented source files)
omm treecode --stats

# Detailed element inspection (score, fields, source tracking, links)
omm inspect <element>

# Check for structural drift (elements added/removed)
omm signature --check

# Reconcile .omm/ with source code (orphaned sources, broken refs)
omm reconcile
```

## Step 2: Run Initial Evaluation

```bash
# Get baseline report
omm eval --no-color

# Or get JSON for programmatic analysis (includes scoreBreakdown per element)
omm eval --json

# Deep-dive into one element's score (visual progress bars + improvement actions)
omm eval --explain <element>

# Same breakdown, JSON output (for programmatic consumption)
omm eval --explain <element> --json

# Top 10 elements to improve, ranked by ROI (potential score gain)
omm eval --suggest
```

Parse the report to understand:
- `summary.overallScore` — current quality score (0-100)
- `summary.fieldCoverage` — % of fields filled
- `summary.diagramCoverage` — % with valid diagrams
- `summary.flowCoverage` — % with flows
- `summary.refIntegrity` — % with cross-references
- `elements` — per-element scores (sorted worst-first)
  - `elements[i].scoreBreakdown` — how the score was computed (fields/diagram/description/flows/refs/children)
- `issues` — specific issues to fix
- `suggestions` — improvement recommendations

### Additional diagnostics with new commands

```bash
# Check code ↔ docs coverage
omm treecode --stats

# Check for structural drift
omm signature --check

# Full reconciliation report
omm reconcile

# Detailed inspection of worst-scoring element
omm inspect <worst-element>

# Check link resolution for an element
omm inspect <element> --links

# Show external links for an element
omm links <element>
```

### Score breakdown (from `scoreBreakdown` in JSON)

The overall score is the sum of 6 components:

| Component | Max | When earned |
|-----------|-----|-------------|
| `fields` | 40 | proportional to fields filled (7 total) |
| `diagram` | 20 | 20 if valid (Mermaid or PlantUML), 10 if has but invalid |
| `description` | 10 | 10 if >50 chars, 5 if >20 chars |
| `flows` | 10 | 10 if any flow definitions exist |
| `refs` | 10 | 10 if any @cross-references in diagram |
| `children` | 10 | 10 if no children OR all children covered |

Use `omm eval --explain <element>` to see which components are missing for a specific element.

### Issue types (from `issues` array)

The eval report includes an `issues` array. Each issue has:
- `type` — one of: `missing-description`, `invalid-diagram`, `incomplete-children`, `sparse-fields`, `no-flows`, `corrupted-tags`, `undocumented-diagram-node`
- `severity` — `error` | `warning` | `info`
- `message` — human-readable description with fix suggestion
- `path` — element path

When the loop runs, address issues in priority order:
1. **errors** — must fix
2. **warnings** — should fix
3. **info** — nice to fix

### `undocumented-diagram-node` detection

When a diagram contains a node (e.g., `budget["Budget\nSessionBudgetTracker"]`) but no corresponding `.omm` child element exists, the eval reports it as a warning. These nodes are invisible in the viewer — clicking them shows "this is a diagram node" with no content.

To fix:
```bash
# Create a description for the undocumented node
omm write <parent>/<node-id> description - <<'EOF'
What this component does, based on the code it represents.
EOF
```

The `summary.undocumentedDiagramNodes` count in the JSON report tracks how many diagram nodes lack `.omm` elements. The eval summary line shows: `Diagram gaps: N node(s) without .omm element`.

### `corrupted-tags` detection

If a tag was written as something other than a string (e.g. an error message from a failed command that got passed to `omm tag add`), the eval will report `corrupted-tags` as a warning. To fix:

```bash
# 1. Eval detects the corruption
omm eval
# ⚠ path/to/element: 1 tag(s) are not strings...

# 2. Read the message — it tells you the exact fix command
# 3. Run the fix
omm tag path/to/element set valid-tag-1,valid-tag-2
```

This commonly happens when an AI agent pipes a command's error output into `omm tag add`. Always validate tag values are simple strings before adding.

## Step 3: Iterative Improvement Loop

Run the following loop until score >= target or max iterations reached:

```bash
# 1. Get current report
REPORT=$(omm eval --json)

# 2. Parse and identify top issues
# 3. For each element with score < target:
#    a. Read the element's existing fields
#    b. Read the corresponding source code
#    c. Write missing fields (context, constraint, concern, todo, note)
#    d. If missing flows, add them with `omm flows`
#    e. If no tags, add tags with `omm tag`

# 4. Re-run eval
NEW_REPORT=$(omm eval --no-color)
SCORE=$(echo "$NEW_REPORT" | grep "Overall score" | grep -oE '[0-9]+' | head -1)
```

### Writing fields

For each missing field, use `omm write`:

```bash
omm write <element> <field> - <<'EOF'
Content here, in the configured language.
EOF
```

**Field guidance:**
- **description** — what this element does, which files/dirs it covers
- **context** — why this structure exists, background, decision history
- **constraint** — rules, requirements, dependencies
- **concern** — risks, technical debt, known issues
- **todo** — pending tasks, improvements, `- [ ]` format
- **note** — anything else worth knowing

### Adding flows

If an element has no flows and is a perspective or group with children:

```bash
cat <<'EOF' | omm flows <element> add <FlowName>
name: FlowName
description: What this flow traces
steps:
  - node: entry-node
  - edge: entry-node->next-node
  - node: next-node
  - edge: next-node->terminal-node
  - node: terminal-node
EOF
```

### Adding tags

If an element has no tags:

```bash
omm tag <element> add tag1,tag2
```

**Common tags:** `core`, `infra`, `frontend`, `backend`, `api`, `cli`, `data`, `auth`, `config`

## Step 4: Stop Conditions

Stop the loop when:
- **Target score reached**: `score >= 80` (configurable)
- **Max iterations**: default 10 iterations
- **No improvement**: score didn't change in last 2 iterations
- **All critical issues resolved**: no more errors/warnings

## Step 5: Post-Evaluation Verification

After the loop completes, run these verification commands:

```bash
# Check code ↔ docs coverage
omm treecode --stats

# Update structural signature
omm signature --update

# Run reconciliation
omm reconcile
```

If `omm reconcile` reports issues, fix them:
```bash
omm reconcile --fix
```

## Step 6: Final Report

Report:

- **Initial score** (from Step 2)
- **Final score** (from last iteration)
- **Improvement delta** (final - initial)
- **Issues resolved** (count of fixed issues)
- **Issues remaining** (count and types)
- **Code coverage** (from `omm treecode --stats`)
- **Reconciliation status** (from `omm reconcile`)

## Loop Configuration

The user can pass arguments to control the loop:

- `--max-iterations <n>` — max iterations (default: 10)
- `--target <score>` — target score to reach (default: 80)

## Stop Conditions

The loop stops when ALL of these are met:
- Overall score >= target (default 80)
- **Field coverage >= 50%** (at least 4 of 7 fields filled on average)
- **Diagram coverage >= 50%** (at least half of elements have diagrams)
- **Flow coverage >= 30%** (at least 30% of elements have flows)
- **Ref integrity >= 20%** (at least 20% of elements have cross-references)

If the overall score reaches 80 but any per-component minimum is not met, **continue iterating** targeting the weakest component. The overall score alone is not sufficient — all gates must pass.

### Why per-component gates?

An overall score of 80 can hide critical gaps:
- Fields 100% + Diagram 100% + Description 100% = 70 points (70%)
- Add Children 100% = 80 points — but Flows 0% and Refs 0%

This means the documentation is structurally complete but has no flow definitions or cross-references — making it less useful for navigation and understanding. The per-component gates ensure minimum coverage across all dimensions.

## Example Session

```bash
# Initial: score 31
$ omm eval
Overall score: 31/100
Field cov:    22%
Issues: 0 errors, 4 warnings, 34 info

# Iteration 1: fill in context for top 5 worst elements
# (AI reads each element, reads source code, writes context field)

# Iteration 2: fill in constraint + concern
# Iteration 3: add flows to perspectives
# Iteration 4: add tags to elements

# Final: score 78
$ omm eval
Overall score: 78/100
Field cov:    68%
Issues: 0 errors, 0 warnings, 12 info

# Improvement: +47 points
```

## Important Rules

- **Always run `omm eval` after changes** to verify improvement
- **Stop at max iterations** to prevent infinite loops
- **Prioritize high-impact fixes first** (low-scoring elements, then sparse fields)
- **Don't make up content** — read the actual source code before writing fields
- **Keep iterations focused** — fix a few elements per iteration, not all at once
- **Re-evaluate after each batch of changes** before deciding the next batch
- **Write in the configured language** (check `omm config language` first)
- **Use `omm treecode --stats`** to check code ↔ docs coverage
- **Use `omm inspect <element>`** for detailed element inspection
- **Use `omm reconcile`** to check for orphaned sources and broken refs
- **Run `omm signature --update`** after completing all improvements

## Step 7: Suggest Feedback & Next Steps

At the end of the iteration, present these next steps to the user:

```
### Next Steps

**Visualization & Navigation:**
1. `omm view` — visualize the architecture in your browser
2. `omm wiki` — generate a crawlable markdown wiki for sharing
3. `omm tour --limit 20` — guided reading order for onboarding

**Code ↔ Docs Coverage:**
4. `omm treecode --stats` — check which source files are covered by .omm/ elements
5. `omm treecode --uncovered` — find undocumented source files
6. `omm inspect <element>` — detailed element inspection (score, fields, links)

**Quality & Maintenance:**
7. `omm signature --update` — store structural signature for drift detection
8. `omm reconcile` — check for orphaned sources, broken refs, missing descriptions

**External References:**
9. `omm links <element> --add <url>` — add links to external docs, ADRs, wikis

**Automation:**
10. `omm hooks install --all` — install git hooks (auto-analysis + signature check)
11. `omm watch` — auto-rebuild on file changes
12. `omm sync` — sync to SQLite for full-text search
```

Then suggest feedback:

> "If you have feedback on the eval system (issues, missing features, scoring questions), run `/omm-feedback` to generate a report in `.omm/feedback.md`. The file will be created with the current eval state and your message — share it with the omm maintainer to improve the tool."

## Integration with /omm-scan

`/omm-eval` is complementary to `/omm-scan`:
- **`/omm-scan`** — generates new documentation from scratch
- **`/omm-eval`** — improves existing documentation iteratively

### Auto-improvement (default)

`/omm-scan` **automatically invokes `/omm-eval`** after initial generation. The loop runs until:
- Target score (default 80) is reached
- Max iterations (default 10) is hit
- No improvement in 2 consecutive iterations

### Manual chain

If you disabled auto-improvement (`--no-improve`), run `/omm-eval` manually:

```
/omm-scan --no-improve   → generate initial docs
/omm-eval                 → improve to target score
omm eval --threshold 80    → CI/CD quality gate
```
