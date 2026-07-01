---
name: omm-tag
description: Tag architecture elements with labels for categorization and filtering.
argument-hint: "[element] [add|remove|set] [tags]"
---

# omm-tag — Element Tagging

## Purpose

Add, remove, or list tags on architecture elements in `.omm/`. Tags are lightweight labels (e.g. `microservice`, `database`, `external-api`, `critical`) stored in each element's `meta.yaml`.

Use tags to categorize perspectives and nested elements for filtering, search, and organizational clarity.

## Prerequisites

```bash
command -v omm || npm install -g @rsrini/omnimap
omm list
```

If `omm list` shows no perspectives, tell the user:
"No architecture docs found. Run `/omm-scan` first, then add tags."

---

## Usage

### List tags on an element
```bash
omm tag <element>
```

### Add tags (appends, no duplicates)
```bash
omm tag <element> add microservice,core
```

### Remove a single tag
```bash
omm tag <element> remove core
```

### Replace all tags
```bash
omm tag <element> set microservice,security,external-api
```

### Clear all tags
```bash
omm tag <element> clear
```

### Get help (works now — was crashing before)
```bash
omm tag --help
```

### Per-command help via omm help
```bash
omm help tag
```

### Nested elements
```bash
omm tag overall-architecture/agent-kernel add critical
```

---

## Step 1: Identify elements to tag

After a scan (or on existing `.omm/` data), review the perspectives and their nested elements:

```bash
omm list
omm tree
```

Suggest tags based on the element's role:

| Role | Suggested tags |
|------|---------------|
| Entry point / API layer | `entry`, `api` |
| Core business logic | `core`, `domain` |
| Data storage | `database`, `store` |
| External integration | `external`, `integration` |
| Background processing | `worker`, `async` |
| User interface | `ui`, `frontend` |
| Shared utility | `shared`, `utility` |
| Security / auth | `security`, `auth` |
| High-risk / complex | `critical`, `complex` |

---

## Step 2: Apply tags

Run `omm tag` for each element that needs categorization:

```bash
omm tag auth-service add microservice,security
omm tag postgres-adapter add database,store
omm tag overall-architecture/agent-kernel add core,critical
```

---

## Step 3: Verify

```bash
# List all tags on an element
omm tag auth-service

# Search by tag (in viewer or CLI)
# In the viewer search bar: tag:microservice
```

---

## Rules

- Tags are stored in `meta.yaml` under the `tags` key (string array).
- Tags are case-insensitive for search but preserve original casing in storage.
- Do not invent tags — suggest from the table above or ask the user.
- Keep tags short, lowercase, hyphenated: `microservice`, `external-api`, `data-pipeline`.
- After tagging, remind the user they can filter by tag in the viewer search: `tag:<name>`.

## Suggesting Feedback

If the user runs into issues with `omm tag` (e.g., "Why doesn't this tag work?", "I expected comma-separated tags to work", "Help is unclear"), tell them:

> "If you have feedback on the tag system (issues, missing features, unclear help), run `/omm-feedback` to generate a report. The file will capture your message and the current state — share it with the omm maintainer to improve the tool."
