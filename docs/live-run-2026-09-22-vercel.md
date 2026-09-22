# Live run on the Vercel AI Gateway — 2026-09-22

Same three tasks and the same reference filesystem MCP server as [the 2026-09-20 run](live-run-2026-09-20.md), with Jev reached through Vercel AI Gateway instead of OpenRouter: provider `typesafe` at `https://ai-gateway.vercel.sh/typesafe/v1/systemone`, model `typesafe-ai/jev`. The calling model that writes values is `deepseek/deepseek-v3.1` through the same gateway, so one key covers both. `scripts/e2e-live.ts` now takes the provider, model, endpoint and writer base URL from the environment, keeping OpenRouter as the default.

| Mode | Task | Status | Steps | Inputs | Samples | Seconds | Jev ms (median) |
|---|---|---|---|---|---|---|---|
| needs_input | read a file | ✅ done | 1 | 1 | 0 | 4.6 | 485 |
| needs_input | create a file | ✅ done | 1 | 2 | 0 | 8.4 | 307 |
| needs_input | move a file | ✅ done | 1 | 2 | 0 | 10 | 300 |
| sampling | read a file | ✅ done | 1 | 0 | 1 | 4.5 | 380 |
| sampling | create a file | ✅ done | 1 | 0 | 2 | 8.2 | 271 |
| sampling | move a file | ✅ done | 1 | 0 | 2 | 7.6 | 726 |

Six of six, the same as through OpenRouter, with the same one-decision-per-task pattern. Jev latency through the gateway is in the same range as OpenRouter on this sample; the per-request metadata shows the provider itself answering in 99 to 166 ms, so most of what remains is the hop to the gateway.

No change was needed in the relay or in jev-dev-kit: the gateway serves TypeSafe's own request and answer shapes, including `noul` answers and a `confidence` field on choices.
