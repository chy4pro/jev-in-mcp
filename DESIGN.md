# Design

Settled on 2026-09-20. Code follows this document; change the document first.

## What it is

A relay. To the agent's client (Claude Code, Cursor, Claude Desktop, Codex, ...) it is one MCP server. To the user's MCP servers it is an MCP client. Every downstream server's tools pass through unchanged, and every server gets one extra tool, `use_jev`, that hands a goal to TypeSafe Jev. The large model stays in charge: it calls tools itself, or delegates a bounded task to Jev, and it supplies any text Jev cannot choose.

```
client (LLM) ──MCP──► jev-in-mcp ──MCP──► github
                           │       ──MCP──► filesystem
                           │       ──MCP──► browser
                           └── use_jev: runLoop (jev-dev-kit) over one server's tools
```

## Installation

Same as any MCP server: one entry in the client's config that runs `npx jev-in-mcp`. The user's existing `mcpServers` entries move into jev-in-mcp's own config file (`~/.config/jev-in-mcp/config.json`, same format), or `npx jev-in-mcp import` copies them from the client's config.

The Jev API key is entered on a local settings page: `npx jev-in-mcp setup` starts a temporary page on localhost, the key is saved to the config directory, the page closes. The key never passes through a conversation. (A long-lived local daemon that several clients share is a later option; the stdio process per client is enough to start.)

## Tools the client sees

- `<server>__<tool>` for every downstream tool, forwarded as is.
- `<server>__use_jev(goal, max_steps?, pause_after?, session?, input?)` per server.
- `use_jev(goal, servers?, max_steps?, pause_after?, session?, input?)`: the same over every connected server (or the listed ones). Can be turned off in the config.
- `jev_status()`: which servers are connected, whether a Jev key is configured, which tools each `use_jev` may use.

## What `use_jev` does

Built on jev-dev-kit: `runLoop` with an `App` whose parts are:

- **options**: that server's tools as candidates, described by what they do and what they take; enum and boolean parameters as choice decisions in the same request (named `tool__param`, only the chosen tool's answers used, unusable answers for unchosen tools ignored). Tools with a required parameter Jev cannot express (object, array) are not offered. Per-server allow/deny lists in the config decide which tools Jev may use; destructive tools are denied by default and remain available to the large model directly.
- **text**: the calling model. Two paths, chosen by what the client supports:
  1. **sampling** (`sampling/createMessage`): the relay asks the client's model for the value inside the tool call. The request carries the goal, the field (tool, parameter, type, description), and the bounded context (last results). The reply must be `{"text": ...}`; `parseFieldText` from the kit enforces it.
  2. **needs_input**: the tool call returns `{ status: "needs_input", session, field, context }`; the loop is suspended; the model calls `use_jev` again with `session` and `input`; the loop resumes. Requires suspend/resume in the kit's `runLoop`.
- **act**: `callTool` on the downstream client; the result becomes bounded text (default 800 chars, `ERROR:` prefix when `isError`).
- **encode**: `task`, the server's tool names, the last five calls with arguments and results. The last result is the fingerprint, so "no visible change" and the stuck check work as in the browser.

Returns the loop status, reason, the trace (every step's candidates, probabilities, latency, what was called and what came back) and the final results. `pause_after: N` returns after N steps with a `session` so the model can look and continue.

## The global `use_jev`

One candidate set with every tool of every server would be large, and Jev's tool choice degrades with the size of the set. So the global loop chooses in two stages inside one request: a `server` choice (each server described by what it is for and a summary of its tools), and one `tool` choice per server over that server's tools, plus the parameter choices as before. Only the chosen server's tool answer is used; the other heads are ignored, exactly like the extension's operation head and per-operation target heads. Every level stays small, and the request count per step stays one.

The state adds `server` to each recorded call so the model sees which server did what. Per-server allow/deny lists apply unchanged.

## Descriptions decide quality

Default candidate sentences come from the tool's description and parameter list. The config may override any tool's sentence with consequence-first wording; that is where a server adapter lives. Nothing else about a server is special-cased.

## Kit changes needed

- `runLoop`: suspend when the text callback signals it needs input from outside, and resume with the value (session kept in memory in the relay process).

Everything else already exists in the kit (candidates, validation, cross-checks, repeat and deadlock detection, fallback, trace).

## Later: options written by the model (not designed)

Today the candidates are the servers' tools. A later version lets the calling model add candidates of its own: a few fixed programs it writes for the task at hand (a script that filters a list, a recipe that chains three tool calls), registered with a description, run by the relay when Jev picks them. This is the kit's `options` callback with a model behind it. Open questions before any design: where the programs are stored and for how long, what sandbox they run in, how their descriptions are kept consequence-first, and whether Jev may pick them alongside raw tools or only in a separate head.

## Not in scope

A browser backend of its own (the browser is just another downstream server, e.g. jev-for-chrome's future MCP endpoint or Playwright MCP); free-form generation; planning above the loop, which is the client model's job.
