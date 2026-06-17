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
command -v omm || npm install -g oh-my-mermaid
```

If the install fails, tell the user: "Please run `npm install -g oh-my-mermaid` in your terminal, then try again."

---

## Step 1: Check Language

```bash
omm config language
```

Write field content (description, context, constraint, concern, todo, note) in the configured language. Default is English. Element IDs, directory names, and diagram node IDs are always English kebab-case.

## Step 2: Run Initial Evaluation

```bash
# Get baseline report
omm eval --no-color

# Or get JSON for programmatic analysis
omm eval --json
```

Parse the report to understand:
- `summary.overallScore` — current quality score (0-100)
- `summary.fieldCoverage` — % of fields filled
- `summary.diagramCoverage` — % with valid diagrams
- `summary.flowCoverage` — % with flows
- `summary.refIntegrity` — % with cross-references
- `elements` — per-element scores (sorted worst-first)
- `issues` — specific issues to fix
- `suggestions` — improvement recommendations

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
- **Max iterations**: default 5 iterations
- **No improvement**: score didn't change in last 2 iterations
- **All critical issues resolved**: no more errors/warnings

## Step 5: Final Report

After the loop completes, report:

- **Initial score** (from Step 2)
- **Final score** (from last iteration)
- **Improvement delta** (final - initial)
- **Issues resolved** (count of fixed issues)
- **Issues remaining** (count and types)

## Loop Configuration

The user can pass arguments to control the loop:

- `--max-iterations <n>` — max iterations (default: 5)
- `--target <score>` — target score to reach (default: 80)

Default behavior: stop when score >= 80 OR no improvement in 2 iterations.

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

## Integration with /omm-scan

`/omm-eval` is complementary to `/omm-scan`:
- **`/omm-scan`** — generates new documentation from scratch
- **`/omm-eval`** — improves existing documentation iteratively

### Auto-improvement (default)

`/omm-scan` **automatically invokes `/omm-eval`** after initial generation. The loop runs until:
- Target score (default 80) is reached
- Max iterations (default 5) is hit
- No improvement in 2 consecutive iterations

### Manual chain

If you disabled auto-improvement (`--no-improve`), run `/omm-eval` manually:

```
/omm-scan --no-improve   → generate initial docs
/omm-eval                 → improve to target score
omm eval --threshold 80    → CI/CD quality gate
```
