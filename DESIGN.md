# Design

## Tools

| Tool | What it does | Needs a Jev key |
|---|---|---|
| `browser_open(url, session?)` | Opens or reuses a tab, returns the element table | no |
| `browser_observe(session?)` | Element table, page text, URL, title; the same snapshot the extension shows as badges | no |
| `browser_click(ref)` / `browser_type(ref, text)` / `browser_select(ref, value)` / `browser_scroll(direction)` / `browser_press_enter()` | One action on an observed element, then a fresh observation | no |
| `browser_assert(checks)` | Code-checked assertions on URL, title, text, element presence | no |
| `jev_run(goal, url?, max_steps?, verify?)` | Jev drives the loop until DONE/BLOCKED or the budget; returns status, trace, final observation | yes |

`ref` values are the `e1`, `e2`, ... ids from the observation, identical to the extension's action ids.

## Backends

One interface, two implementations:

```ts
interface Backend {
  open(url: string): Promise<Observation>;
  observe(): Promise<Observation>;
  act(action: PageAction, text?: string): Promise<ActResult>;
}
```

- **Extension backend** (first). The MCP server opens a localhost WebSocket; jev-for-chrome connects to it when "Allow local agents" is enabled in Options. Observe and act are the extension's own `CONTENT_OBSERVE` and trusted-input act path, so the page is driven inside the user's real Chrome with their logins, no remote-debugging flag, no second browser.
- **Playwright backend** (later). Launches Chromium, injects the same content bundle, dispatches input through CDP. For headless runs, CI and machines without the extension.

## Shared code

The decision loop, action space, rules, answer validation and text helper come from jev-for-chrome's `src/shared`. They move into a small package inside the umbrella (`packages/jev-core` or published as `jev-for-chrome/core`) that both the extension and the server import. Nothing is forked.

## Loop

`jev_run` is the extension's `AgentRunner.executeOneStep` with the backend swapped: observe → build request (task, page, elements, recent actions, visited URLs) → Jev answers operation + target + goal_done + stuck → validate → act → repeat. Same veto rules, same repeat detection, same stale handling. The trace format is the extension's Copy-trace JSON.

## Generic mode (roadmap)

Point jev-in-mcp at another MCP server. Its tools become the candidates of a Choice; the "page" is the last tool result plus the goal; arguments come from enum Choices, word highlighting over the goal and previous results (the dispatcher's method), and the text helper as the last resort. Out of scope until the browser mode is solid.

## Open questions

- Whether `jev_run` should return control after every N steps so the large model can look, or only on DONE/BLOCKED/budget (jev-ultrafast-mcp returns only at the end; a `pause_after` parameter would cover both).
- Session model: one tab per session, sessions named by the client.
- Later thoughts (2026-09-20, not settled): a gateway that passes the user's MCP servers through and adds one `use_jev` per server; or the reverse, Jev as the caller of an MCP built for it, with a generative model asked for content when a value must be written and scripts supplying the rest. The large model stays the lead; Jev is the supporting role. Design to be finished before any code.
