# jev-in-mcp

Jev lives inside an MCP relay. To the agent it is one MCP server; to the user's MCP servers it is a client. Every tool passes through unchanged, and every server gets one extra tool, `use_jev`, that hands a goal to TypeSafe Jev: Jev picks the tool calls, the calling model supplies any text that has to be written, and the relay executes. Built on [jev-dev-kit](../jev-dev-kit/).

agent ──► observe / click / type / select / scroll / navigate ──► page
agent ──► jev_run(goal) ──► Jev decides each step ──► same tools ──► page
```

## Status

Design settled (see [DESIGN.md](DESIGN.md)); implementation next.

## Relation to other projects

- [jev-for-chrome](../jev-for-chrome/): the Chrome extension. jev-in-mcp reuses its observation format, action space, rules and text helper, and can use the extension as its browser backend (your real Chrome, your logins).
- [jiawei686/jev-ultrafast-mcp](https://github.com/jiawei686/jev-ultrafast-mcp): the same idea in Python, driving a Chrome started with a remote-debugging port. jev-in-mcp differs by running inside the user's normal Chrome through the extension, by being an npm package (`npx jev-in-mcp`), and by sharing one executor with the extension.
- [abhishekashokvkumar/jev-mcp-dispatcher](https://github.com/abhishekashokvkumar/jev-mcp-dispatcher): Jev picking a tool and its arguments from one sentence, for any simple MCP server. The generic direction on the roadmap below builds on that idea.

## Roadmap

1. Relay with pass-through tools, per-server `use_jev` with the needs_input path, setup page for the key.
2. Sampling path where the client supports it; config import from clients.
3. Per-tool description overrides and a small eval set per common server.

## License

MIT
