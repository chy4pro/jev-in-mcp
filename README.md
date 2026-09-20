# jev-in-mcp

Jev lives inside an MCP relay. To the agent it is one MCP server; to the user's MCP servers it is a client. Every tool passes through unchanged, every server gets one extra tool, `<server>__use_jev`, and there is one global `use_jev` over all servers; each hands a goal to TypeSafe Jev: Jev picks the tool calls, the calling model supplies any text that has to be written, and the relay executes. Built on [jev-dev-kit](../jev-dev-kit/).

```
client (LLM) ──MCP──► jev-in-mcp ──MCP──► github, filesystem, browser, ...
                          ├── <server>__use_jev(goal): Jev runs that server's tools in a loop
                          └── use_jev(goal): the same over every server (server chosen first, then the tool)
```

## Status

Design settled (see [DESIGN.md](DESIGN.md)); implementation next.

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
