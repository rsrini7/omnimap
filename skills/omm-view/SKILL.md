---
name: omm-view
description: Start the omm web viewer to explore architecture diagrams in the browser. Use when the user says "omm view", "open viewer", "show diagrams", "view architecture", or "open architecture".
argument-hint: "[--port <port>] [--project <name>]"
---

# omm-view — Architecture Viewer

## Purpose

Launch the interactive web viewer so the user can explore `.omm/` architecture diagrams in their browser.

The viewer supports both **Mermaid** and **PlantUML** diagrams:
- **Mermaid** — renders client-side (offline capable)
- **PlantUML** — renders via Kroki API or local `plantuml.jar` (configurable)

## Prerequisites

Ensure the `omm` CLI is available:

```bash
command -v omm || npm install -g @rsrini/omnimap
```

If the install command fails (permission denied), tell the user:
"Please run `npm install -g @rsrini/omnimap` in your terminal, then try again."

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
| **Diagram view** | Main canvas | Auto-layout SVG (Mermaid) or Kroki-rendered SVG (PlantUML) |
| **Format badge** | Diagram tab | Shows `[Mermaid]` or `[PlantUML]` badge |
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

## PlantUML Configuration

For PlantUML diagrams, the viewer uses one of these rendering methods:

| Method | Setup | Best for |
|--------|-------|----------|
| **Kroki API** (default) | None — works out of the box | Most users, online use |
| **Local plantuml.jar** | `omm config plantuml-jar /path/to/plantuml.jar` | Corporate/air-gapped environments |

### Kroki URL

By default, the viewer uses `https://kroki.io`. To use a self-hosted Kroki instance:

```bash
omm config kroki-url https://your-kroki-instance.com
```

### Offline PlantUML

For offline/air-gapped environments:

1. Download plantuml.jar from https://plantuml.com/download
2. Install Java (required for plantuml.jar)
3. Configure the jar path:

```bash
omm config plantuml-jar /path/to/plantuml.jar
```

If neither Kroki nor plantuml.jar is available, PlantUML diagrams will show as raw source code in a `<pre>` block.

## Rules

- Always check for existing classes before starting the viewer
- If in an arch repo with multiple projects, always ask which project to view
- If no classes exist, suggest `/omm-scan` instead of starting an empty viewer
- The viewer is read-only — it does not modify `.omm/` files

## Suggesting Feedback

If the user reports issues with the viewer (e.g., "Drag doesn't work", "Buttons don't show hover labels", "Layout is broken"), tell them:

> "If you have feedback on the viewer (rendering issues, interaction problems, missing features), run `/omm-feedback` to generate a report. Include a description of what you expected vs what happened, and the maintainer can investigate."
