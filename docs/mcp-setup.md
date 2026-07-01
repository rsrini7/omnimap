# MCP (Model Context Protocol) Setup

OmniMap provides an MCP server for AI agents (Claude, Cursor, etc.) to query architecture data directly.

## Quick Start

```bash
# Start stdio MCP server (for Claude Desktop, Cursor, etc.)
omm mcp

# Start HTTP MCP server (for custom integrations)
omm mcp --port 8080
```

## Available MCP Tools

| Tool | Description | Example |
|------|-------------|---------|
| `omm_analyze` | Run structural code analysis | Returns dependency graph, god nodes, communities, fitness score |
| `omm_search` | Fuzzy search across elements | Search for "auth" across all element names and descriptions |
| `omm_tour` | Generate guided reading tour | Topological reading order for onboarding |
| `omm_impact` | Change impact analysis | What breaks if a specific file changes |

## Tool Input Schemas

### `omm_analyze`

```json
{
  "dir": "src/",           // Directory to analyze (default: current)
  "format": "md"           // Output format: "md" or "json"
}
```

### `omm_search`

```json
{
  "query": "authentication",  // Search query (required)
  "limit": 20                 // Max results (default: 20)
}
```

### `omm_tour`

```json
{
  "dir": "src/",           // Directory to analyze
  "limit": 20              // Max stops (default: 20)
}
```

### `omm_impact`

```json
{
  "file": "src/auth.ts",   // File to check impact for (required)
  "dir": "src/"            // Directory to analyze
}
```

## Integration Examples

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "omnimap": {
      "command": "omm",
      "args": ["mcp"]
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "servers": {
    "omnimap": {
      "command": "omm",
      "args": ["mcp"]
    }
  }
}
```

### HTTP Mode (Custom)

Start HTTP server:
```bash
omm mcp --port 8080
```

Send JSON-RPC requests:
```bash
curl -X POST http://localhost:8080 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "omm_search",
      "arguments": { "query": "auth" }
    }
  }'
```

## JSON-RPC Protocol

The MCP server uses JSON-RPC 2.0 over stdio or HTTP.

### Initialize

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {}
}
```

### List Tools

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/list"
}
```

### Call Tool

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "omm_analyze",
    "arguments": { "format": "json" }
  }
}
```

## Troubleshooting

### Server won't start

```bash
# Check if omm is installed
omm --version

# Try with explicit port
omm mcp --port 8080
```

### No results from tools

```bash
# Make sure .omm/ exists
omm list

# Run analysis first
omm analyze
```

### Connection issues (HTTP mode)

```bash
# Check if port is in use
lsof -i :8080

# Try different port
omm mcp --port 9090
```
