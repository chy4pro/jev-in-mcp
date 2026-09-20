import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { JevClient, JevResponse } from 'jev-dev-kit';
import { z } from 'zod';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG, type Config } from '../src/config.js';
import { connectDownstream } from '../src/downstream.js';
import { createRelay, exposedName } from '../src/relay.js';

/** A fake music server, in process. */
async function musicServer(log: any[]) {
  const s = new McpServer({ name: 'music', version: '1' });
  s.registerTool('play', { description: 'Start playback.' }, async () => ({ content: [{ type: 'text', text: 'playing' }] }));
  s.registerTool('set_repeat_mode', { description: 'Set repeat.', inputSchema: { mode: z.enum(['off', 'one', 'all']) } }, async ({ mode }) => { log.push(['set_repeat_mode', mode]); return { content: [{ type: 'text', text: `repeat=${mode}` }] }; });
  s.registerTool('search', { description: 'Search the library.', inputSchema: { query: z.string() } }, async ({ query }) => { log.push(['search', query]); return { content: [{ type: 'text', text: `3 results for ${query}` }] }; });
  s.registerTool('wipe', { description: 'Delete the library.' }, async () => ({ content: [{ type: 'text', text: 'gone' }] }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  await s.connect(a);
  return b;
}

async function notesServer() {
  const s = new McpServer({ name: 'notes', version: '1' });
  s.registerTool('add_note', { description: 'Add a note.', inputSchema: { text: z.string() } }, async ({ text }) => ({ content: [{ type: 'text', text: `saved: ${text}` }] }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  await s.connect(a);
  return b;
}

const answer = (choice: string, extra: Record<string, unknown> = {}, goal = 0.1): JevResponse => ({
  model: 'm',
  answers: { action: { choice, confidence: 0.9, probabilities: { [choice]: 0.9, BLOCKED: 0.1 } }, goal_done: { probability: goal }, stuck: { probability: 0.1 }, ...extra },
});
const pick = (choice: string) => ({ choice, confidence: 0.9, probabilities: { [choice]: 1 } });

async function relayWith(jev: JevClient | null, cfg: Partial<Config> = {}) {
  const log: any[] = [];
  const config: Config = { ...DEFAULT_CONFIG, ...cfg, servers: { music: { command: 'x', jev: { deny: ['wipe'] } }, notes: { command: 'x', purpose: 'Personal notes' }, ...(cfg.servers || {}) } };
  const downstreams = [
    await connectDownstream('music', config.servers.music, await musicServer(log)),
    await connectDownstream('notes', config.servers.notes, await notesServer()),
  ];
  const { server, sessions } = createRelay({ config, downstreams, jev, model: 'm', keySource: jev ? 'file' : null });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: 'test-client', version: '1' });
  await client.connect(b);
  return { client, sessions, log, config };
}

describe('relay', () => {
  afterEach(() => vi.restoreAllMocks());

  it('names tools within MCP rules', () => {
    const taken = new Set<string>();
    expect(exposedName('git hub', 'create.issue', taken)).toBe('git_hub__create_issue');
    const long = exposedName('a'.repeat(40), 'b'.repeat(40), taken);
    expect(long).toHaveLength(64);
    expect(exposedName('a'.repeat(40), 'b'.repeat(40), taken)).not.toBe(long);
  });

  it('lists pass-through tools, one use_jev per server, the global use_jev and jev_status; pass-through calls reach the server', async () => {
    const { client, log } = await relayWith(null);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['music__play', 'music__set_repeat_mode', 'music__search', 'music__wipe', 'music__use_jev', 'notes__add_note', 'notes__use_jev', 'use_jev', 'jev_status']);
    expect(tools.find((t) => t.name === 'music__set_repeat_mode')!.inputSchema.properties).toHaveProperty('mode');
    expect(tools.find((t) => t.name === 'music__use_jev')!.description).toMatch(/play, set_repeat_mode, search\)/); // wipe is denied

    const r: any = await client.callTool({ name: 'music__set_repeat_mode', arguments: { mode: 'all' } });
    expect(r.content[0].text).toBe('repeat=all');
    expect(log).toEqual([['set_repeat_mode', 'all']]);

    const status: any = JSON.parse(((await client.callTool({ name: 'jev_status' })) as any).content[0].text);
    expect(status.jev).toMatchObject({ configured: false, key: null });
    expect(status.servers[0]).toMatchObject({ name: 'music', connected: true, use_jev: ['play', 'set_repeat_mode', 'search'] });
  });

  it('use_jev without a key explains instead of running', async () => {
    const { client } = await relayWith(null);
    const r: any = await client.callTool({ name: 'music__use_jev', arguments: { goal: 'x' } });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/npx jev-in-mcp setup/);
  });

  it('per-server use_jev: Jev picks the tool and its enum parameter, the result enters the state, DONE ends the run', async () => {
    const jev = vi.fn<JevClient>()
      .mockResolvedValueOnce(answer('set_repeat_mode', { set_repeat_mode__mode: pick('one') }))
      .mockResolvedValueOnce(answer('DONE', {}, 0.95));
    const { client, log } = await relayWith(jev);
    const r: any = JSON.parse(((await client.callTool({ name: 'music__use_jev', arguments: { goal: 'Set repeat to one' } })) as any).content[0].text);

    expect(r.status).toBe('done');
    expect(log).toEqual([['set_repeat_mode', 'one']]);
    expect(r.calls).toEqual([{ step: 1, action: 'set_repeat_mode: Set repeat. Takes mode (off|one|all).', text: '{"mode":"one"}', outcome: 'music.set_repeat_mode({"mode":"one"}) → repeat=one' }]);
    const first = jev.mock.calls[0][0];
    expect(Object.keys(first.questions)).toEqual(['action', 'set_repeat_mode__mode', 'goal_done', 'stuck']);
    expect(Object.keys((first.questions.action as any).criteria)).toEqual(['play', 'set_repeat_mode', 'search', 'DONE', 'BLOCKED']);
    expect((jev.mock.calls[1][0].state as any).calls[0]).toMatchObject({ tool: 'set_repeat_mode', result: 'repeat=one' });
  });

  it('a text parameter suspends the run as needs_input; the client answers with session and input; the run continues', async () => {
    const jev = vi.fn<JevClient>()
      .mockResolvedValueOnce(answer('search'))
      .mockResolvedValueOnce(answer('DONE', {}, 0.95));
    const { client, sessions, log } = await relayWith(jev);
    const first: any = JSON.parse(((await client.callTool({ name: 'music__use_jev', arguments: { goal: 'Find songs by The Weeknd' } })) as any).content[0].text);

    expect(first.status).toBe('needs_input');
    expect(first.field).toMatchObject({ server: 'music', tool: 'search', parameter: 'query', type: 'string', required: true });
    expect(first.goal).toBe('Find songs by The Weeknd');
    expect(sessions.size).toBe(1);
    expect(log).toEqual([]);

    const second: any = JSON.parse(((await client.callTool({ name: 'music__use_jev', arguments: { session: first.session, input: 'The Weeknd' } })) as any).content[0].text);
    expect(second.status).toBe('done');
    expect(log).toEqual([['search', 'The Weeknd']]);
    expect(sessions.size).toBe(0);
    expect(jev).toHaveBeenCalledTimes(2);
  });

  it('global use_jev: server first, then that server\'s tool, in one request; other servers\' heads are ignored', async () => {
    const jev = vi.fn<JevClient>()
      .mockResolvedValueOnce(answer('music', { tool__music: pick('play'), tool__notes: { choice: 'nonsense', probabilities: { nonsense: 1 } } }))
      .mockResolvedValueOnce(answer('DONE', {}, 0.95));
    const { client } = await relayWith(jev);
    const r: any = JSON.parse(((await client.callTool({ name: 'use_jev', arguments: { goal: 'Start the music' } })) as any).content[0].text);
    expect(r.status).toBe('done');
    expect(r.calls[0].outcome).toBe('music.play({}) → playing');
    const q = jev.mock.calls[0][0].questions;
    expect(Object.keys(q)).toEqual(['action', 'tool__music', 'music__set_repeat_mode__mode', 'tool__notes', 'goal_done', 'stuck']);
    expect((q.action as any).criteria.notes).toMatch(/Personal notes/);
    expect(r.calls[0].action).toMatch(/^music\/play/);
  });
});
