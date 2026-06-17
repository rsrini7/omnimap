---
name: omm-feedback
description: Generate a feedback report inside .omm/ to share with the omm maintainer. Use when the user says "omm feedback", "report issue", "send feedback", "improvement suggestion", or wants to share their experience with the tool.
argument-hint: "[--include <message>] [--format md|json]"
---

# omm-feedback — Internal Feedback Loop

## Purpose

Generate a feedback report inside `.omm/` that the user can share with the omm maintainer. The file is created locally and travels with the project — no external system required.

This skill is for:
- Reporting issues or bugs encountered while using omm
- Suggesting improvements or new features
- Capturing "I wish omm did X" moments
- Documenting edge cases that need handling
- Sharing successful workflows that should be documented

## Prerequisites

```bash
command -v omm || npm install -g oh-my-mermaid
```

If the install fails, tell the user: "Please run `npm install -g oh-my-mermaid` in your terminal, then try again."

---

## Step 1: Gather User's Message

Ask the user what they want to report. If they have a specific message, capture it. If they're vague ("I had a problem"), prompt with:

- "What were you trying to do?"
- "What happened instead?"
- "What did you expect to happen?"
- "What command did you run?"

Before writing feedback, also try the diagnostic commands so the feedback includes the actual state:

```bash
omm eval --json                       # current eval state (includes scoreBreakdown per element)
omm eval --explain <element>         # score breakdown for one element
omm validate <element>                # diagram validation
omm diagram-refs <element>            # resolved @refs
omm show <element> --type             # element classification
```

These help the maintainer understand the context. Include the output in the feedback if it helps explain the issue.

Capture the answers in the `--include` argument.

## Step 2: Generate the Feedback Report

```bash
# Basic feedback
omm feedback

# With a specific message
omm feedback --include "The --recursive flag wasn't documented in the original help text"

# JSON format (for programmatic use)
omm feedback --format json --include "..."

# Print to stdout (don't write to file)
omm feedback --print

# Custom output path
omm feedback --out /tmp/my-feedback.md
```

The feedback file is written to `.omm/feedback.md` (or `.omm/feedback.json`).

## Step 3: Verify the Report

After generation, read the file and confirm it contains:

- omm version + git context
- Project state (eval metrics)
- User's message
- Suggestions from omm eval

If the file is good, tell the user:

> "Your feedback report is in `.omm/feedback.md`. Share this file with the omm maintainer to improve the tool. The file contains your message, the current project state, and any suggestions from eval — everything needed to act on the feedback."

## Step 4: Suggest Next Steps

Based on what the user reported:

### If the user reported a bug:
1. Run `omm validate <element>` to check for known issues
2. Run `omm eval --explain <element>` to see the score breakdown
3. Suggest workarounds if available
4. Tell the user to share `.omm/feedback.md` with the maintainer

### If the user suggested an improvement:
1. Check if a similar feature exists (`omm help <command>`)
2. Note it in the feedback file
3. Tell the user to share `.omm/feedback.md` with the maintainer

### If the user reported a successful workflow:
1. Capture it in the feedback file
2. Suggest the user document it for others
3. Tell the user to share `.omm/feedback.md` with the maintainer

## What's in the Report

The feedback report contains:

| Section | Content |
|---------|---------|
| Header | Timestamp, omm version, git commit/branch |
| Project state | Element counts, eval score, coverage metrics |
| Lowest scoring | Top 10 elements below 80/100 |
| Issues | Errors, warnings, info from eval |
| Suggestions | From `omm eval` (top 10) |
| User message | Your `--include` text |
| Footer | Sharing instructions |

## Example Session

```bash
# User: "The --recursive flag for omm incremental --mark wasn't documented"
$ omm feedback --include "The --recursive flag for omm incremental --mark wasn't documented in the original help. Took me 10 minutes to figure out."
wrote .omm/feedback.md (542 bytes)
Share this file with the omm maintainer to improve the tool.

$ cat .omm/feedback.md
# omm feedback report

Generated: 2026-06-17T18:07:54.143Z
omm version: 0.3.0
git commit: 59c437d
git branch: main

## Project state
- Total elements: 37
- Overall score: 100/100
...

## User message
The --recursive flag for omm incremental --mark wasn't documented in the
original help. Took me 10 minutes to figure out.
```

## Cross-Skill Integration

Other skills should prompt the user to use this skill when they encounter:

| Skill | When to suggest `/omm-feedback` |
|-------|-------------------------------|
| `/omm-scan` | If scan produces unexpected results or finds inconsistencies |
| `/omm-eval` | If the scoring formula or eval output is confusing |
| `/omm-guide` | If the docs don't explain something the user asks about |
| `/omm-tag` | If tag commands behave unexpectedly |
| `/omm-view` | If the viewer has rendering or interaction issues |
| `/omm-push` | If push fails or the arch repo workflow is unclear |

When other skills finish, they should end with a prompt like:

> "If you encountered any issues or have suggestions, run `/omm-feedback` to generate a report."

## Rules

- The feedback file lives in `.omm/` — it travels with the project
- No external services or accounts required
- The file is plain markdown or JSON — easy to read, edit, and share
- Don't auto-send the feedback — the user must share it manually
- Don't write feedback on the user's behalf — always ask first
- Encourage the user to include specific examples and steps to reproduce
- For sensitive content (passwords, internal URLs), warn the user to scrub before sharing
