/**
 * The relay: an MCP server to the client, an MCP client to the downstream servers. Every
 * downstream tool passes through as `<server>__<tool>`; every server gets `<server>__use_jev`;
 * there is one global `use_jev` (server chosen first, then the tool) and `jev_status`.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult, Tool as McpTool } from '@modelcontextprotocol/sdk/types.js';
import { NeedsInput, parseFieldText, runLoop, type App, type Chosen, type Decision, type JevClient, type LoopResult, type TextContext, type TextProvider } from 'jev-dev-kit';
import { describeResult, parameterDecisions, resolveArguments, toolCandidates, usableTools, type Tool } from './candidates.js';
import type { Config } from './config.js';
import type { Downstream } from './downstream.js';

export interface RelayOptions {
  config: Config;
  downstreams: Downstream[];
  /** Null when no key is configured: use_jev then explains instead of running. */
  jev: JevClient | null;
  model: string;
  keySource: 'env' | 'file' | null;
  version?: string;
}

interface Call {
  step: number;
  server: string;
  tool: string;
  args: Record<string, unknown>;
  result: string;
  isError: boolean;
}

interface State {
  goal: string;
  calls: Call[];
}

interface Session {
  id: string;
  result: LoopResult;
  createdAt: number;
}

const SAFE = /[^A-Za-z0-9_-]/g;
const MAX_NAME = 64;

/** `<server>__<tool>` within MCP's name rules; collisions after truncation get a numeric suffix. */
export function exposedName(server: string, tool: string, taken: Set<string>): string {
  const base = `${server}__${tool}`.replace(SAFE, '_');
  let name = base.length > MAX_NAME ? base.slice(0, MAX_NAME) : base;
  for (let i = 2; taken.has(name); i++) name = `${base.slice(0, MAX_NAME - 3)}_${i}`;
  taken.add(name);
  return name;
}

const USE_JEV_SCHEMA = (global: boolean) => ({
  type: 'object',
  properties: {
    goal: { type: 'string', description: 'What to accomplish, in one or two sentences. Include every value the task needs (names, dates, ids).' },
    ...(global ? { servers: { type: 'array', items: { type: 'string' }, description: 'Limit to these servers (default: all).' } } : {}),
    max_steps: { type: 'integer', description: 'Tool calls Jev may make before stopping.' },
    pause_after: { type: 'integer', description: 'Return after this many steps with a session id, so you can look and continue.' },
    session: { type: 'string', description: 'Continue a run that returned needs_input or paused: pass its session id.' },
    input: { type: 'string', description: 'With session: the value that was asked for.' },
  },
  required: [],
});

export function createRelay(opts: RelayOptions): { server: Server; sessions: Map<string, Session> } {
  const { config, downstreams } = opts;
  const server = new Server({ name: 'jev-in-mcp', version: opts.version || '0.1.0' }, { capabilities: { tools: {} } });
  const sessions = new Map<string, Session>();
  const byName = new Map<string, { server: Downstream; tool: Tool }>();
  const useJevFor = new Map<string, Downstream>();
  const taken = new Set<string>(['use_jev', 'jev_status']);

  // Tool table, built once from what the downstreams listed at connect time.
  const listed: McpTool[] = [];
  for (const d of downstreams) {
    for (const t of d.tools) {
      const name = exposedName(d.name, t.name, taken);
      byName.set(name, { server: d, tool: t });
      listed.push({ name, description: `[${d.name}] ${t.description || t.name}`, inputSchema: (t.inputSchema as McpTool['inputSchema']) || { type: 'object', properties: {} } });
    }
    const name = exposedName(d.name, 'use_jev', taken);
    useJevFor.set(name, d);
    const { offered } = usableTools(d.tools, d.config);
    listed.push({
      name,
      description: `Hand a goal to TypeSafe Jev, which runs this server's tools (${offered.map((t) => t.name).join(', ') || 'none usable'}) step by step at ~300 ms per decision and returns the trace. Use it for multi-step tasks whose every value is in the goal; when Jev needs text it cannot choose, this returns status "needs_input" and you call it again with session and input.`,
      inputSchema: USE_JEV_SCHEMA(false) as McpTool['inputSchema'],
    });
  }
  if (config.use_jev.global && downstreams.length > 0) {
    listed.push({
      name: 'use_jev',
      description: `Hand a goal to TypeSafe Jev over every connected server (${downstreams.map((d) => d.name).join(', ')}). Jev picks the server, then the tool, each step. Same contract as the per-server use_jev tools.`,
      inputSchema: USE_JEV_SCHEMA(true) as McpTool['inputSchema'],
    });
  }
  listed.push({
    name: 'jev_status',
    description: 'Which servers are connected, whether a Jev key is configured, and which tools each use_jev may use.',
    inputSchema: { type: 'object', properties: {} },
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: listed }));

  server.setRequestHandler(CallToolRequestSchema, async (req): Promise<CallToolResult> => {
    const { name, arguments: args = {} } = req.params;
    const pass = byName.get(name);
    if (pass) {
      return (await pass.server.client.callTool({ name: pass.tool.name, arguments: args as Record<string, unknown> })) as CallToolResult;
    }
    if (name === 'jev_status') return json(status());
    const target = useJevFor.get(name);
    if (target) return useJev([target], args as Record<string, unknown>, false);
    if (name === 'use_jev' && config.use_jev.global) {
      const wanted = Array.isArray((args as any).servers) ? new Set((args as any).servers as string[]) : null;
      return useJev(downstreams.filter((d) => !wanted || wanted.has(d.name)), args as Record<string, unknown>, true);
    }
    return json({ error: `Unknown tool: ${name}` }, true);
  });

  function status() {
    return {
      jev: { configured: !!opts.jev, key: opts.keySource, provider: config.jev.provider, model: opts.model },
      servers: downstreams.map((d) => {
        const { offered, excluded } = usableTools(d.tools, d.config);
        return { name: d.name, connected: !d.error, error: d.error, tools: d.tools.length, use_jev: offered.map((t) => t.name), excluded };
      }),
      global_use_jev: config.use_jev.global,
    };
  }

  /** The text provider for a run: the client's model via sampling when it can, else suspend. */
  function textProvider(): TextProvider {
    const caps = server.getClientCapabilities();
    if (!caps?.sampling) return async (ctx) => { throw new NeedsInput(ctx); };
    return async (ctx: TextContext) => {
      const reply = await server.createMessage({
        messages: [{ role: 'user', content: { type: 'text', text: JSON.stringify(ctx) } }],
        systemPrompt: 'Return a JSON object with exactly one key, text: the exact value for the field described, using only the goal and the context. If the goal gives no value for it, return {"text": null}. No explanations.',
        maxTokens: 512,
      });
      const content = reply.content as { type: string; text?: string };
      if (content?.type !== 'text' || typeof content.text !== 'string') throw new NeedsInput(ctx);
      return parseFieldText(content.text);
    };
  }

  async function useJev(targets: Downstream[], args: Record<string, unknown>, global: boolean): Promise<CallToolResult> {
    if (typeof args.session === 'string') {
      const s = sessions.get(args.session);
      if (!s) return json({ error: `Unknown or expired session ${args.session}` }, true);
      if (!s.result.resume) return json({ error: 'This session is not waiting for input' }, true);
      if (typeof args.input !== 'string') return json({ error: 'input is required to continue this session' }, true);
      sessions.delete(s.id);
      return report(await s.result.resume(args.input));
    }
    if (!opts.jev) return json({ error: 'No Jev API key is configured. Run `npx jev-in-mcp setup` (or set JEV_API_KEY) and restart the client.' }, true);
    const goal = typeof args.goal === 'string' ? args.goal.trim() : '';
    if (!goal) return json({ error: 'goal is required' }, true);
    const live = targets.filter((d) => !d.error);
    if (live.length === 0) return json({ error: 'No connected server to run on' }, true);
    const maxSteps = typeof args.max_steps === 'number' ? args.max_steps : config.use_jev.max_steps;
    const pauseAfter = typeof args.pause_after === 'number' ? args.pause_after : undefined;
    const state: State = { goal, calls: [] };
    const app = global ? globalApp(live, state) : serverApp(live[0], state);
    const text = textProvider();
    let stepsThisRun = 0;
    const result = await runLoop(app, {
      jev: opts.jev,
      model: opts.model,
      text,
      maxSteps: pauseAfter ? Math.min(maxSteps, pauseAfter) : maxSteps,
      onStep: () => { stepsThisRun++; },
    });
    void stepsThisRun;
    return report(result);
  }

  function report(result: LoopResult): CallToolResult {
    const trace = result.trace.map((t) => ({ step: t.step, via: t.via, chosen: t.chosen, confidence: t.confidence, goal_done: t.goalDone, stuck: t.stuck, latency_ms: t.latencyMs, outcome: t.outcome, note: t.note }));
    if (result.status === 'suspended' && result.resume) {
      const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      sessions.set(id, { id, result, createdAt: Date.now() });
      for (const [k, s] of sessions) if (Date.now() - s.createdAt > 30 * 60 * 1000) sessions.delete(k);
      return json({ status: 'needs_input', session: id, field: result.needsInput?.field, goal: result.needsInput?.goal, context: result.needsInput?.context, instructions: 'Supply the value for this field by calling the same tool again with { session, input }.', steps: result.steps, trace });
    }
    return json({ status: result.status, reason: result.reason, steps: result.steps, trace, calls: result.history.filter((h) => h.id !== 'routine').map((h) => ({ step: h.step, action: h.label, text: h.text, outcome: h.outcome })) }, result.status === 'error');
  }

  function serverApp(d: Downstream, state: State): App<State> {
    const { offered } = usableTools(d.tools, d.config);
    const decisions: Record<string, Decision<State>> = {
      action: {
        kind: 'choice',
        fixed: toolCandidates(offered, d.config),
        rules: `Choose the one tool call that best advances the task from the current state on the server "${d.name}". Do not repeat a call whose result is already in \`calls\`; choose DONE when the task is visibly complete there.`,
      },
      ...parameterDecisions<State>(offered),
    };
    return {
      observe: async () => ({ goal: state.goal, calls: state.calls.slice(-5) }),
      encode: (s) => ({ task: s.goal, server: d.name, calls: s.calls.map(({ step, tool, args, result }) => ({ step, tool, args, result })) }),
      decisions,
      act: (chosen, _s, text) => callTool(d, offered.find((t) => t.name === chosen.id), chosen, text, state, ''),
      fingerprint: (s) => `${s.calls.length}:${s.calls[s.calls.length - 1]?.result ?? ''}`,
    };
  }

  function globalApp(live: Downstream[], state: State): App<State> {
    const per = new Map(live.map((d) => [d.name, usableTools(d.tools, d.config).offered]));
    const decisions: Record<string, Decision<State>> = {
      action: {
        kind: 'choice',
        fixed: live.map((d) => ({ id: d.name, description: `${d.config.purpose || `Server "${d.name}"`}. Tools: ${(per.get(d.name) || []).map((t) => t.name).join(', ') || 'none usable'}.` })),
        rules: 'Choose the server whose tools best advance the task from the current state; choose DONE when the task is visibly complete.',
      },
    };
    for (const d of live) {
      const tools = per.get(d.name) || [];
      decisions[`tool__${d.name}`] = {
        kind: 'choice',
        optional: true,
        fixed: toolCandidates(tools, d.config),
        rules: `If the server "${d.name}" is chosen, which of its tools should be called next?`,
      };
      Object.assign(decisions, parameterDecisions<State>(tools, `${d.name}__`));
    }
    return {
      observe: async () => ({ goal: state.goal, calls: state.calls.slice(-5) }),
      encode: (s) => ({ task: s.goal, servers: live.map((d) => d.name), calls: s.calls.map(({ step, server, tool, args, result }) => ({ step, server, tool, args, result })) }),
      decisions,
      actionKey: (c) => `${c.id}/${(c.answers[`tool__${c.id}`] as { choice?: string } | undefined)?.choice ?? '?'}`,
      act: (chosen, _s, text) => {
        const d = live.find((x) => x.name === chosen.id)!;
        const toolName = (chosen.answers[`tool__${d.name}`] as { choice?: string } | undefined)?.choice;
        if (!toolName) return Promise.resolve({ error: `Jev chose the server "${d.name}" but no usable tool on it.` });
        return callTool(d, (per.get(d.name) || []).find((t) => t.name === toolName), chosen, text, state, `${d.name}__`);
      },
      fingerprint: (s) => `${s.calls.length}:${s.calls[s.calls.length - 1]?.result ?? ''}`,
    };
  }

  async function callTool(d: Downstream, tool: Tool | undefined, chosen: Chosen, text: TextProvider | undefined, state: State, prefix: string) {
    if (!tool) return { error: `Unknown tool "${chosen.id}" on "${d.name}"` };
    const args = await resolveArguments(tool, chosen, text, { goal: state.goal, state: { calls: state.calls.slice(-2) }, prefix, server: d.name });
    let raw: unknown;
    try {
      raw = await d.client.callTool({ name: tool.name, arguments: args });
    } catch (err: any) {
      return { error: `${tool.name} failed: ${err?.message || String(err)}` };
    }
    const { text: result, isError } = describeResult(raw, config.use_jev.result_chars);
    state.calls.push({ step: state.calls.length + 1, server: d.name, tool: tool.name, args, result, isError });
    return { note: `${d.name}.${tool.name}(${JSON.stringify(args)}) → ${result.slice(0, 160)}`, text: JSON.stringify(args), ...(isError ? { error: result } : {}) };
  }

  return { server, sessions };
}

function json(value: unknown, isError = false): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], isError };
}
