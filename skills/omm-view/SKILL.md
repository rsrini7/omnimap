---
name: omm-view
description: Start the omm web viewer to explore architecture diagrams in the browser. Use when the user says "omm view", "open viewer", "show diagrams", "view architecture", or "open architecture".
argument-hint: "[--port <port>] [--project <name>]"
---

# omm-view — Architecture Viewer

## Purpose

Launch the interactive web viewer so the user can explore `.omm/` architecture diagrams in their browser.

## Prerequisites

Ensure the `omm` CLI is available:

```bash
command -v omm || npm install -g oh-my-mermaid
```

If the install command fails (permission denied), tell the user:
"Please run `npm install -g oh-my-mermaid` in your terminal, then try again."

## Steps

### Step 1: Check if arch repo or regular project

Run `omm list`. If it shows "Architecture repository (N projects)", the user is in an arch repo.

### Step 2a: Arch repo — select project

If multiple projects exist, ask which one to view:

```bash
omm view --project <name>
```

If only one project, `omm view` auto-selects it.

### Step 2b: Regular project — just launch

```bash
omm view
```

If the user specified a port:

```bash
omm view --port <port>
```

### Step 3: Report

Tell the user the viewer is running and provide the URL (default: `http://localhost:3000`).

The viewer auto-refreshes when `.omm/` files change.

## Viewer Features

Once the viewer is running, the user has access to:

| Feature | Where | What it does |
|---------|-------|-------------|
| **Mermaid diagram** | Main canvas | Auto-layout SVG with dagre, click to inspect |
| **Rich view** | Sidebar → Rich tab | Interactive SVG with flow animation (in-tab flow chips) |
| **Flow chips** | Bottom of canvas | Click to animate paths through the diagram |
| **D3 network** | ⬡ button | Force-directed view of all elements + relationships |
| **Relationship graph** | ◈ button | Cross-perspective connections (dagre layout) |
| **HTML export** | ↓ → HTML | Self-contained .html file with interactive SVG |
| **Element type** | `omm show <el> --type` | CLI command to show perspective/leaf/group type |
| **Search** | Left sidebar | Fuzzy matching with `tag:` filter |
| **Theme** | ○ button | Dark/light toggle with `prefers-color-scheme` + localStorage persistence |
| **Help tooltips** | Hover any button | Native browser tooltips explain each button |

Tell the user to explore these features and use `/omm-feedback` if anything is confusing or broken.

## Rules

- Always check for existing classes before starting the viewer
- If in an arch repo with multiple projects, always ask which project to view
- If no classes exist, suggest `/omm-scan` instead of starting an empty viewer
- The viewer is read-only — it does not modify `.omm/` files

## Suggesting Feedback

If the user reports issues with the viewer (e.g., "Drag doesn't work", "Buttons don't show hover labels", "Layout is broken"), tell them:

> "If you have feedback on the viewer (rendering issues, interaction problems, missing features), run `/omm-feedback` to generate a report. Include a description of what you expected vs what happened, and the maintainer can investigate."
