---
name: omm-guide
description: Guide new developers through the architecture using existing `.omm/` docs. Read-only; does not create or modify files.
argument-hint: "[topic]"
---

# omm-guide — Architecture Guide & Onboarding

## Purpose

Walk new developers through the architecture interactively using the existing `.omm/` structure and generated markdown files.

- This skill is **read-only**.
- It does **not** run code analysis or modify `.omm/` files.

## Prerequisites

```bash
command -v omm || npm install -g @rsrini/omnimap
omm list
```

If `omm list` shows no perspectives, tell the user:
"No architecture docs found. Run `/omm-scan` first, then open the guide."

---

## Step 0: Detect arch repo vs regular project

Run `omm list`. If it shows "Architecture repository (N projects)":
- Ask which project to explore
- Use `--project <name>` for all subsequent `omm show` calls
- Example: `omm show command-surface --project ArcClawInternal`

---

## Step 1: Pick a starting point

1. Run `omm tour --limit 10` to get a dependency-ordered reading list. Use this as the starting point for onboarding.
2. If user passed `[topic]`, choose the most relevant perspective/class by scanning these fields (in order):
   - description
   - context
   - constraint
   - todo
3. If no topic, start from `overall-architecture` if it exists.
4. If `overall-architecture` doesn't exist, pick the first perspective returned by `omm list`.

---

## Step 2: Explain the "shape" of the docs

Show:
- how to navigate in the viewer (`omm view`) — main canvas, Rich tab, D3 network (⬡), relationship graph (◈), search, theme toggle
- that each perspective/element has fields: description, diagram, context, constraint, concern, todo, note
- how to interpret `@class-name` references (use `omm ref-syntax` to see the convention)
- how to verify docs match reality: `omm analyze --validate` compares documented edges against actual import dependencies
- the architectural fitness score from `omm analyze --format md` — a 0-100 score covering circular deps, cohesion, coupling, layer purity, and doc accuracy
- the guided tour: `omm tour --limit 20` — read files in dependency order to understand the codebase
- fuzzy search: `omm search <query>` — find elements by name, description, or path
- full-text search: `omm sync --search <query>` — SQLite FTS5 search (requires `better-sqlite3`)
- framework routes: `omm analyze --routes` — see Express/Django/Spring/etc. routing
- affected tests: `omm affected --staged` — find test files impacted by recent changes

---

## Step 3: Guided walkthrough (interactive)

Repeat this loop for 3–6 steps (based on availability and user interest):

For the current selected element `<E>`:
1. Run:
   - `omm show <E>` (add `--project <name>` if arch repo)
   - `omm show <E> --type` to show element type (perspective/leaf/group)
   - `omm inspect <E>` for detailed view (score, field coverage, source tracking)
   - `omm inspect <E> --links` to show @ref link resolution (cycles, broken refs)
   - `omm links <E>` to show external documentation links
   - `omm refs <E>` to see incoming references
   - `omm refs --reverse <E>` to see outgoing references
   - `omm diagram-refs <E>` to see resolved @refs and pass/fail
   - `omm search <E>` to find related elements
2. Present:
   - Description (short)
   - Context (why/decisions)
   - Constraints (rules)
   - Concerns (risks)
   - TODO (next improvements)
   - External links (if any)
   - Link resolution status (if cycles or broken refs)
3. If there are references:
   - `omm refs <E>` and `omm refs --reverse <E>`
   - summarize incoming/outgoing relationships in plain language

Then ask the user to choose:
- (a) Go deeper: pick one referenced element and continue
- (b) Return to a parent perspective
- (c) Change topic
- (d) Finish

---
## Step 4: How to go deeper

When the user selects a referenced element `<R>`:
- Call `omm show <R>` (add `--project <name>` if arch repo) and continue from Step 3.
- The recursion is agent-driven (the user picks a branch), not a fresh scan.

---
## Rules

- Do not invent architecture facts.
- Only describe what exists in `.omm/` files.
- If something is missing (e.g., no constraint.md), say so plainly and move on.
- When in an arch repo, always use `--project <name>` for `omm show` calls.

## Next Steps

When the guide session ends, present these next steps:

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
9. `omm eval` — run quality evaluation (target: 80+)

**External References:**
10. `omm links <element> --add <url>` — add links to external docs, ADRs, wikis

**Automation:**
11. `omm hooks install --all` — install git hooks (auto-analysis + signature check)
12. `omm watch` — auto-rebuild on file changes
```

## Suggesting Feedback

If the user asks a question that the existing `.omm/` docs don't answer (e.g., "Why was this structure chosen?" or "What's the relationship between X and Y?" when it's not documented), tell them:

> "That information isn't in the current `.omm/` docs. If this is a pattern worth documenting, run `/omm-feedback` to report it. The maintainer can use the report to improve either the docs structure or add a 'why' field that captures decisions."

If the user wants to drill down into something the docs don't cover, suggest they also run `/omm-feedback` so the maintainer knows the docs are missing this content.
