# jev-in-mcp

Jev lives inside an MCP relay. To the agent it is one MCP server; to the user's MCP servers it is a client. Every tool passes through unchanged, every server gets one extra tool, `<server>__use_jev`, and there is one global `use_jev` over all servers; each hands a goal to TypeSafe Jev: Jev picks the tool calls, the calling model supplies any text that has to be written, and the relay executes. Built on [jev-dev-kit](../jev-dev-kit/).

```
client (LLM) ──MCP──► jev-in-mcp ──MCP──► github, filesystem, browser, ...
                          ├── <server>__use_jev(goal): Jev runs that server's tools in a loop
                          └── use_jev(goal): the same over every server (server chosen first, then the tool)
```

## Install

Node 20+. Three commands, then restart your MCP client.

```bash
npx jev-in-mcp setup     # a local page to store the Jev API key (OpenRouter or TypeSafe); nothing goes through a chat
npx jev-in-mcp import    # copies the mcpServers entries of Claude Code, Cursor, Windsurf and Claude Desktop into jev-in-mcp's config
npx jev-in-mcp status    # what is configured, which servers connect, how many tools each has
```

Then replace the servers in your client's config with one entry:

```json
{ "mcpServers": { "jev": { "command": "npx", "args": ["-y", "jev-in-mcp"] } } }
```

Config lives in `~/.config/jev-in-mcp/config.json` (or `$JEV_IN_MCP_HOME`); the key in `credentials.json` next to it (mode 600), or in `JEV_API_KEY`. Not on npm yet: install from GitHub with `npm install -g github:chy4pro/jev-in-mcp` and use `jev-in-mcp` in place of `npx jev-in-mcp`.

```json
{
  "servers": {
    "github": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"], "env": { "GITHUB_TOKEN": "..." },
                "purpose": "Issues, pull requests and files on GitHub",
                "jev": { "deny": ["delete_repository"], "describe": { "create_issue": "Opens a new issue with the given title and body; returns its number." } } },
    "notes":  { "url": "http://localhost:8080/mcp" }
  },
  "jev": { "provider": "openrouter", "model": "typesafe/jev-1.13" },
  "use_jev": { "global": true, "max_steps": 20, "result_chars": 800 }
}
```

## What the client sees

- `<server>__<tool>`: every downstream tool, passed through unchanged.
- `<server>__use_jev(goal, max_steps?, pause_after?, session?, input?)`: Jev runs that server's tools toward the goal, one decision per step (~300 ms), and returns the status, the trace and every call made. When a value must be written rather than chosen (a search query, a note's text), the call returns `status: "needs_input"` with the field and a `session`; the model calls the same tool again with `session` and `input` and the run continues. Where the client supports MCP sampling, the relay asks the model inside the call instead and nothing is interrupted.
- `use_jev(goal, servers?, ...)`: the same over every server. Jev picks the server first, then the tool, in one request.
- `jev_status()`: servers, key status, and which tools each `use_jev` may use.

Tools with a required parameter Jev cannot express (objects, arrays) are not offered to Jev; `deny` keeps destructive tools away from it; `describe` replaces a tool's sentence with what actually happens when it is called, which is where the quality of a server's `use_jev` is decided.

## Status

0.1.1. Verified live against the reference filesystem server with real Jev and DeepSeek as the calling model, in both the needs_input and the sampling path: 6/6 tasks, one Jev decision each, 4 to 10 seconds per task including the model writing values. Details in [docs/live-run-2026-09-20.md](docs/live-run-2026-09-20.md). Other servers have not been tried yet.

## Relation to other projects

- [jev-dev-kit](../jev-dev-kit/): the framework this is built on. `use_jev` is its `runLoop`; the relay supplies candidates (tools), text (the calling model) and actions (tool calls).
- [jev-for-chrome](../jev-for-chrome/): the Chrome extension; a browser becomes one more downstream server once it exposes an MCP endpoint.
- [jiawei686/jev-ultrafast-mcp](https://github.com/jiawei686/jev-ultrafast-mcp): Jev driving a browser behind one MCP tool. jev-in-mcp is not browser-specific: any MCP server gets a `use_jev`.
- [abhishekashokvkumar/jev-mcp-dispatcher](https://github.com/abhishekashokvkumar/jev-mcp-dispatcher): Jev picking one tool call from one sentence. jev-in-mcp runs multi-step loops and lets the calling model write the values Jev cannot choose.

## Roadmap

1. Relay with pass-through tools, per-server `use_jev` with the needs_input path, setup page for the key.
2. Sampling path where the client supports it; config import from clients.
3. Per-tool description overrides and a small eval set per common server.
4. Options supplied by the model: the calling model writes a few fixed programs (scripts, recipes) and registers them as candidates, so Jev chooses among them and the relay runs them. Not designed yet; the open questions are where such programs live, how they are described to Jev, and how they are kept safe.

## License

MIT
