---
name: omm-push
description: Push architecture docs to the shared architecture repository. Handles setup, push, and commit workflow. Use when the user says "omm push", "push docs", "sync architecture", or "share architecture".
---

# omm-push — Architecture Repository Push

## Purpose

Push `.omm/` architecture docs to a shared git repository for team collaboration.

## Prerequisites

```bash
command -v omm || npm install -g @rsrini/omnimap
```

## Workflow

### Step 1: Check arch repo config

Run `omm config arch-repo` via Bash. If it returns "(not set)":
- Ask the user for the path to their shared architecture repository
- Run `omm config arch-repo <path>` to set it globally
- If they also have a git remote, run `omm config arch-remote <url>`

### Step 2: Preview changes

Run `omm push --dry-run` via Bash. Show the user:
- Number of files to be pushed
- Added/modified/removed counts
- Target path

### Step 3: Push

Based on user preference:

| Command | What it does |
|---------|-------------|
| `omm push` | Copy files only (no git) |
| `omm push --commit` | Copy + git commit locally |
| `omm push --commit-push` | Copy + git commit + push to remote |

If the user just says "push", use `omm push --commit-push`.

### Step 4: Report

On success, output:
- Number of files pushed
- Commit message (if committed)
- Remote URL (if pushed)

## Error Handling

- **No arch repo configured**: "Run `omm config arch-repo <path>` first."
- **No remote configured**: "Run `omm config arch-remote <url>` to set the git remote."
- **Push failed**: "Check remote access. You may need to pull first: `cd <arch-repo> && git pull`."
- **Merge conflict**: "Resolve conflicts in the arch repo manually, then retry."

## Rules

- Always preview with `--dry-run` first
- Use `--commit-push` for full workflow (copy + commit + push)
- Use `--commit` for local-only commits (no remote push)
- The arch repo path is global (~/.omm/config.yaml) — works from any project

## Related: Merging from other projects

If the user wants to combine `.omm/` docs from multiple projects into one:

```bash
# Merge another project's docs into current .omm/
omm merge ../other-project/.omm

# Merge into a custom output directory
omm merge ../other-project/.omm --out ./merged-docs
```

The merge copies perspectives and child elements that don't already exist (target wins on conflicts).

## Suggesting Feedback

If the user reports issues with push (e.g., "Push fails silently", "Conflict resolution is unclear", "I expected a different merge behavior"), tell them:

> "If you have feedback on the push workflow (issues, unclear errors, missing features), run `/omm-feedback` to generate a report. The file will capture your message and the current arch-repo state — share it with the omm maintainer to improve the tool."
