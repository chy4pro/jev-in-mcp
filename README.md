# jev-in-mcp

Jev lives inside an MCP server. The server exposes a small set of browser tools that any MCP client (Claude Code, Cursor, Claude Desktop, Codex, ...) can call one at a time, plus one tool, `jev_run`, that hands a whole goal to TypeSafe Jev and runs the same tools in a loop at one decision per step. The large model plans and can step in at any point; Jev does the clicking.

Same session, two drivers:

```
agent ──► observe / click / type / select / scroll / navigate ──► page
agent ──► jev_run(goal) ──► Jev decides each step ──► same tools ──► page
```

## Status

Design stage. Nothing runnable yet. See [DESIGN.md](DESIGN.md).

## Relation to other projects

- [jev-for-chrome](../jev-for-chrome/): the Chrome extension. jev-in-mcp reuses its observation format, action space, rules and text helper, and can use the extension as its browser backend (your real Chrome, your logins).
- [jiawei686/jev-ultrafast-mcp](https://github.com/jiawei686/jev-ultrafast-mcp): the same idea in Python, driving a Chrome started with a remote-debugging port. jev-in-mcp differs by running inside the user's normal Chrome through the extension, by being an npm package (`npx jev-in-mcp`), and by sharing one executor with the extension.
- [abhishekashokvkumar/jev-mcp-dispatcher](https://github.com/abhishekashokvkumar/jev-mcp-dispatcher): Jev picking a tool and its arguments from one sentence, for any simple MCP server. The generic direction on the roadmap below builds on that idea.

## Roadmap

1. Browser tools + `jev_run` with the extension as the backend.
2. Playwright backend for headless and CI use, same tools.
3. Generic mode: proxy another MCP server's tools and let Jev run multi-step loops over them.

## License

MIT
