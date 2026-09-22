/**
 * Live check of the relay against the reference filesystem MCP server, with a real Jev
 * (OpenRouter) and DeepSeek standing in for the calling model. Two client modes:
 *   sampling     the client declares MCP sampling; the relay asks it for text inside the call
 *   needs_input  the client gets needs_input back and calls again with session + input
 * Run: OPENROUTER_API_KEY=... npx tsx scripts/e2e-live.ts [sampling|needs_input|both]
 * Output: .e2e-out/live-<mode>.json and a summary on stdout. The key is never printed.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CreateMessageRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const KEY = (process.env.JEV_API_KEY || process.env.OPENROUTER_API_KEY || '').trim();
if (!KEY) { console.error('JEV_API_KEY (or OPENROUTER_API_KEY) missing'); process.exit(2); }
const WRITER_API_KEY = (process.env.WRITER_API_KEY || process.env.OPENROUTER_API_KEY || '').trim();
if (!WRITER_API_KEY) { console.error('WRITER_API_KEY (or OPENROUTER_API_KEY) missing'); process.exit(2); }
const WRITER_MODEL = process.env.WRITER_MODEL || 'deepseek/deepseek-chat';
const WRITER_BASE_URL = process.env.WRITER_BASE_URL || 'https://openrouter.ai/api/v1';
const JEV_PROVIDER = (process.env.JEV_PROVIDER || 'openrouter') as 'openrouter' | 'typesafe';
const JEV_MODEL = process.env.JEV_MODEL || 'typesafe/jev-1.13';
const JEV_ENDPOINT = process.env.JEV_ENDPOINT;
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const modes = (process.argv[2] || 'both') === 'both' ? ['needs_input', 'sampling'] : [process.argv[2]];

import { WRITER_PROMPT } from '../src/relay.js';

async function writer(payload: unknown): Promise<string> {
  const res = await fetch(`${WRITER_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WRITER_API_KEY}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://github.com/chy4pro/jev-in-mcp', 'X-Title': 'jev-in-mcp live test' },
    body: JSON.stringify({ model: WRITER_MODEL, max_tokens: 400, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: WRITER_PROMPT }, { role: 'user', content: JSON.stringify(payload) }] }),
  });
  if (!res.ok) throw new Error(`writer HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json: any = await res.json();
  return String(json.choices?.[0]?.message?.content || '');
}

interface Task { name: string; goal: (dir: string) => string; verify: (dir: string, result: any) => string | null }
const tasks: Task[] = [
  {
    name: 'read a file',
    goal: (d) => `In the working directory ${d}: read the file notes.txt and stop when its contents have been read.`,
    verify: (_d, r) => (JSON.stringify(r).includes('Dentist on Friday') ? null : 'notes.txt contents never appeared in a result'),
  },
  {
    name: 'create a file',
    goal: (d) => `In the working directory ${d}: create a new file named todo.txt containing exactly three lines, each a task for tomorrow, then stop.`,
    verify: (d) => { const f = path.join(d, 'todo.txt'); if (!fs.existsSync(f)) return 'todo.txt was not created'; const lines = fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean); return lines.length === 3 ? null : `todo.txt has ${lines.length} lines`; },
  },
  {
    name: 'move a file',
    goal: (d) => `In the working directory ${d}: move the file report-2026-09.txt into the existing folder archive (same file name), then stop.`,
    verify: (d) => (fs.existsSync(path.join(d, 'archive', 'report-2026-09.txt')) && !fs.existsSync(path.join(d, 'report-2026-09.txt')) ? null : 'file was not moved into archive/'),
  },
];

function seed(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'jev-live-'));
  fs.writeFileSync(path.join(d, 'notes.txt'), 'Shopping: milk, eggs.\nDentist on Friday at 3pm.\n');
  fs.writeFileSync(path.join(d, 'report-2026-09.txt'), 'Monthly report. Invoice total: 1200.\n');
  fs.mkdirSync(path.join(d, 'archive'));
  return d;
}

async function run(mode: string) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'jev-in-mcp-live-'));
  const results: any[] = [];
  for (const task of tasks) {
    const dir = seed();
    fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({
      servers: { filesystem: { command: process.execPath, args: [path.join(root, 'node_modules', '@modelcontextprotocol', 'server-filesystem', 'dist', 'index.js'), dir], purpose: 'Files in the working directory' } },
      jev: { provider: JEV_PROVIDER, model: JEV_MODEL, ...(JEV_ENDPOINT ? { endpoint: JEV_ENDPOINT } : {}) },
      use_jev: { global: true, max_steps: 8, result_chars: 600 },
    }));
    const client = new Client({ name: 'live-test', version: '1' }, mode === 'sampling' ? { capabilities: { sampling: {} } } : {});
    let samples = 0;
    if (mode === 'sampling') {
      client.setRequestHandler(CreateMessageRequestSchema, async (req) => {
        samples++;
        const text = await writer({ system: req.params.systemPrompt, messages: req.params.messages.map((m) => (m.content as any).text) });
        return { role: 'assistant', model: WRITER_MODEL, content: { type: 'text', text } };
      });
    }
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'dist', 'cli.js')], env: { ...process.env, JEV_IN_MCP_HOME: home, JEV_API_KEY: KEY }, stderr: 'ignore' }));
    const started = Date.now();
    let inputs = 0;
    let r: any;
    let err: string | undefined;
    try {
      let args: any = { goal: task.goal(dir) };
      for (let round = 0; round < 12; round++) {
        r = JSON.parse(((await client.callTool({ name: 'filesystem__use_jev', arguments: args })) as any).content[0].text);
        if (r.status !== 'needs_input') break;
        inputs++;
        const raw = await writer({ goal: r.goal, field: r.field, context: r.context });
        const value = JSON.parse(raw.replace(/```(?:json)?/g, '').trim()).text;
        if (typeof value !== 'string') { err = `writer gave no value for ${r.field?.parameter}`; break; }
        args = { session: r.session, input: value };
      }
    } catch (e: any) {
      err = e?.message || String(e);
    }
    await client.close().catch(() => undefined);
    const verify = err ? err : task.verify(dir, r);
    const jevMs = (r?.trace || []).filter((t: any) => t.via === 'jev').map((t: any) => t.latency_ms);
    const entry = { mode, task: task.name, status: r?.status, reason: r?.reason, steps: r?.steps, inputs, samples, seconds: +((Date.now() - started) / 1000).toFixed(1), jev_ms_median: jevMs.length ? jevMs.sort((a: number, b: number) => a - b)[Math.floor(jevMs.length / 2)] : null, verified: verify === null, detail: verify, calls: r?.calls, trace: r?.trace };
    results.push(entry);
    console.log(`${verify === null ? 'PASS' : 'FAIL'} [${mode}] ${task.name}: ${entry.status} in ${entry.steps ?? '?'} steps, ${inputs} inputs, ${samples} samples, ${entry.seconds}s${verify ? ` — ${verify}` : ''}`);
    for (const c of r?.calls || []) console.log(`      ${c.outcome}`);
  }
  fs.mkdirSync(path.join(root, '.e2e-out'), { recursive: true });
  fs.writeFileSync(path.join(root, '.e2e-out', `live-${mode}.json`), JSON.stringify(results, null, 2));
  return results;
}

let failed = 0;
for (const mode of modes) for (const r of await run(mode)) if (!r.verified) failed++;
console.log(`\n${failed === 0 ? 'ALL PASSED' : `${failed} failed`}`);
process.exit(failed ? 1 : 0);
