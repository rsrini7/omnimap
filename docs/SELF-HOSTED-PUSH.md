# omm Self-Hosted Push — Design Document

## Problem

The current `omm push` sends all `.omm/` files to `ohmymermaid.com` cloud. This creates:
- External dependency on a third-party service
- No version history in the cloud (last push overwrites)
- Privacy concerns (architecture docs leave the network)
- No offline/team collaboration without internet

## Goals

| Goal | Requirement |
|------|------------|
| **Portable** | Runs on any machine, no Docker, no external services |
| **Git-native** | Uses git for storage — natural version history, familiar workflow |
| **Team-ready** | Multiple developers can push/pull via shared repo |
| **Feature-complete** | Supports tags, version history, search, viewer, metrics |
| **Zero-config** | Works with existing `omm` CLI, minimal setup |
| **Offline-capable** | Full functionality without internet |

## Architecture

### Storage: Git Repository

```
remote-repo/                    ← any git host (GitHub, GitLab, Gitea, bare repo, USB drive)
├── .omm/
│   ├── config.yaml
│   ├── auth-service/
│   │   ├── description.md
│   │   ├── diagram.mmd
│   │   ├── meta.yaml           ← tags, version history, metrics
│   │   └── ...
│   └── overall-architecture/
│       └── ...
├── .omm-lock                   ← prevents concurrent pushes
└── .omm-history/               ← optional: enriched commit metadata
    └── push-log.jsonl          ← append-only push log
```

Each `omm push` = `git add .omm/ && git commit && git push`.
Each `omm pull` = `git pull`.
History = `git log -- .omm/`.

### Two Modes

#### Mode 1: Shared Repository (Team)

The `.omm/` directory lives in the project repo alongside the code.

```
my-project/
├── src/
├── .omm/           ← tracked in git
├── package.json
└── .gitignore      ← .omm/ NOT ignored
```

**Workflow:**
```bash
# Developer A
omm scan              # generate docs
omm tag auth-service add microservice
git add .omm/
git commit -m "docs: add auth-service architecture"
git push

# Developer B
git pull
omm view              # see the updated docs
omm validate --changed
```

**Pros:** Natural git workflow, full history, diff/merge, PRs for architecture changes.
**Cons:** `.omm/` in repo (some teams prefer separate).

#### Mode 2: Separate Architecture Repo (Isolated)

Architecture docs live in a dedicated repo, separate from code.

```
# Setup
cd my-project
git init --initial-branch=main .arch-repo
omm config arch-repo .arch-repo

# Push
omm push              # copies .omm/ → .arch-repo/, commits, pushes

# Pull
omm pull              # pulls from .arch-repo → .omm/
```

**Workflow:**
```bash
# Push (from code repo)
cd ~/code/my-project
omm push              # → commits to ~/arch/my-project-repo

# Pull (from code repo)
omm pull              # ← pulls from ~/arch/my-project-repo
```

**Pros:** Clean separation, code repo stays lean.
**Cons:** Extra repo to manage.

#### Mode 3: Bare Git Repo (Self-Hosted Server)

For teams without GitHub/GitLab — a bare repo on a shared server.

```bash
# Server setup (one-time)
ssh server
git init --bare /srv/omm/my-project.git

# Client setup
cd my-project
git remote add arch ssh://server/srv/omm/my-project.git
omm config remote arch

# Push
omm push              # → pushes .omm/ to remote `arch`

# Pull
omm pull              # ← pulls from remote `arch`
```

**Pros:** No external service, full control.
**Cons:** Requires SSH access to server.

#### Mode 4: Local-Only (No Remote)

Just use `.omm/` in the project repo. No push/pull needed — docs live with code.

```bash
omm scan              # generate
git add .omm/
git commit -m "docs: architecture update"
# That's it — no remote needed
```

**Pros:** Simplest, no setup.
**Cons:** No team collaboration without a git remote.

---

## CLI Changes

### `omm push` (redesigned)

```bash
omm push                          # Push to configured remote
omm push --remote origin          # Push to specific remote
omm push --branch arch-docs       # Push to specific branch
omm push --message "docs: update" # Custom commit message
omm push --dry-run                # Show what would be committed
omm push --json                   # JSON output for CI
```

**Behavior:**
1. Check `.omm/` exists
2. Detect git repo (or initialize)
3. Check for changes (`git status --porcelain -- .omm/`)
4. If no changes: "Nothing to push."
5. Stage: `git add .omm/`
6. Commit: `git commit -m "omm: {element_count} elements, {change_summary}"`
7. Push: `git push {remote} {branch}`
8. Output: commit hash, element count, URL (if remote is GitHub/GitLab)

### `omm pull` (redesigned)

```bash
omm pull                          # Pull from configured remote
omm pull --remote origin          # Pull from specific remote
omm pull --branch arch-docs       # Pull from specific branch
omm pull --rebase                 # Rebase instead of merge
omm pull --json                   # JSON output
```

**Behavior:**
1. Check git repo exists
2. `git fetch {remote}`
3. Check for conflicts: `git merge --no-commit --no-ff {remote}/{branch}`
4. If conflicts in `.omm/`: report conflicts, abort merge, suggest manual resolution
5. If clean: `git merge {remote}/{branch}`
6. Output: files changed, elements added/removed/modified

### `omm log` (new)

```bash
omm log                           # Show architecture change history
omm log --limit 10                # Last 10 changes
omm log auth-service              # History for specific element
omm log --since "2025-01-01"      # Changes since date
omm log --json                    # JSON output
```

**Behavior:**
1. `git log --oneline -- .omm/` (filtered by element path if specified)
2. For each commit: parse commit message, show changed elements
3. Display: date, author, commit hash, summary, changed elements

### `omm diff-cloud` (new)

```bash
omm diff-cloud                    # Show local vs remote differences
omm diff-cloud --json             # JSON output
```

**Behavior:**
1. `git fetch {remote}`
2. `git diff --stat {remote}/{branch} -- .omm/`
3. Show: added/removed/modified elements
4. Show: which tags changed, which diagrams changed

### `omm config` (extended)

```bash
omm config remote                 # Show configured remote
omm config remote origin          # Set remote
omm config branch                 # Show configured branch
omm config branch arch-docs       # Set branch
omm config arch-repo              # Show separate repo path
omm config arch-repo ~/arch/proj  # Set separate repo path
```

---

## Commit Message Format

Auto-generated commit messages follow Conventional Commits:

```
omm: {summary}

Elements: {count}
Changed: {list}
Tags: {tag_changes}
Scan: {git_commit}
```

Example:
```
omm: update auth-service diagram, add microservice tag

Elements: 12
Changed: auth-service/diagram.mmd, auth-service/meta.yaml
Tags: auth-service: +microservice
Scan: abc1234
```

---

## Conflict Resolution

When `omm pull` detects conflicts in `.omm/`:

### Auto-resolve strategy

| Conflict type | Resolution |
|--------------|------------|
| Both modified same field | Keep local, warn user |
| One added, one deleted | Keep add (don't lose work) |
| Both added same element | Keep both (merge) |
| `meta.yaml` conflicts | Merge tags/history, keep latest timestamps |

### Manual resolution

```bash
omm pull
# CONFLICT: auth-service/diagram.mmd
# Local:  "graph LR\nA --> B"
# Remote: "graph LR\nA --> C"
# 
# Options:
#   [l] Keep local
#   [r] Keep remote
#   [m] Open merge tool
#   [s] Skip this file
```

---

## Integration with Existing Features

### Tags

Tags are stored in `meta.yaml` → pushed/pulled with git. No special handling needed.

### Version History

Local `diagram_history` in `meta.yaml` is preserved. Git log provides the cloud-level history. Two levels:

```
Local:  meta.yaml → diagram_history (last 20 versions, with diagram content)
Remote: git log → commit history (all versions, with diffs)
```

### Search

Search works locally (reads `.omm/` files). After `omm pull`, search automatically includes remote content.

### Viewer

`omm view` serves from local `.omm/`. After `omm pull`, viewer shows the latest remote content.

### Validate CI

```yaml
# GitHub Actions
- name: Validate architecture
  run: |
    git fetch origin
    omm validate --changed --json
```

### Incremental Scan

`omm incremental` works with git — detects changed files since last scan. After `omm push`, the scan generation baseline is updated in `meta.yaml`.

---

## Implementation Plan

### Phase 1: Git-native push/pull (MVP)

- [ ] Redesign `omm push` to use `git add/commit/push`
- [ ] Redesign `omm pull` to use `git fetch/merge`
- [ ] Add `omm config remote/branch`
- [ ] Auto-generated commit messages
- [ ] `--dry-run`, `--json` flags
- [ ] Update `omm-push` skill

### Phase 2: History & diff

- [ ] `omm log` — architecture change history
- [ ] `omm diff-cloud` — local vs remote diff
- [ ] Conflict resolution UI in viewer

### Phase 3: Advanced

- [ ] Separate architecture repo mode
- [ ] Bare repo support
- [ ] `omm share` — generate static HTML site from `.omm/`
- [ ] Webhook integration (auto-scan on push)

---

## Migration from Cloud

For users migrating from `ohmymermaid.com`:

```bash
# Pull existing data
omm pull

# Reconfigure for git
omm config remote origin
omm config branch main

# Push to new location
omm push
```

The `.omm/` directory is identical regardless of storage backend — no data migration needed.
