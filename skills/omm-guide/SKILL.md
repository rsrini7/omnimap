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
command -v omm || npm install -g oh-my-mermaid
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

1. If user passed `[topic]`, choose the most relevant perspective/class by scanning these fields (in order):
   - description
   - context
   - constraint
   - todo
2. If no topic, start from `overall-architecture` if it exists.
3. If `overall-architecture` doesn't exist, pick the first perspective returned by `omm list`.

---

## Step 2: Explain the "shape" of the docs

Show:
- how to navigate in the viewer (`omm view`)
- that each perspective/element has fields: description, diagram, context, constraint, concern, todo, note

---

## Step 3: Guided walkthrough (interactive)

Repeat this loop for 3–6 steps (based on availability and user interest):

For the current selected element `<E>`:
1. Run:
   - `omm show <E>` (add `--project <name>` if arch repo)
2. Present:
   - Description (short)
   - Context (why/decisions)
   - Constraints (rules)
   - Concerns (risks)
   - TODO (next improvements)
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
