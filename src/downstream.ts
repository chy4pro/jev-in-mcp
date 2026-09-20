import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { Tool } from './candidates.js';
import type { ServerConfig } from './config.js';

/** One connected downstream server. */
export interface Downstream {
  name: string;
  config: ServerConfig;
  client: Client;
  tools: Tool[];
  error?: string;
}

export function transportFor(cfg: ServerConfig): Transport {
  if (cfg.url) return new StreamableHTTPClientTransport(new URL(cfg.url), cfg.headers ? { requestInit: { headers: cfg.headers } } : undefined);
  if (!cfg.command) throw new Error('server config needs "command" or "url"');
  return new StdioClientTransport({ command: cfg.command, args: cfg.args || [], env: { ...(process.env as Record<string, string>), ...(cfg.env || {}) }, cwd: cfg.cwd, stderr: 'ignore' });
}

/** Connects one server; a failure is recorded, not thrown, so one bad server does not stop the relay. */
export async function connectDownstream(name: string, config: ServerConfig, transport: Transport = transportFor(config)): Promise<Downstream> {
  const client = new Client({ name: 'jev-in-mcp', version: '0.1.0' });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    return { name, config, client, tools: tools as Tool[] };
  } catch (err: any) {
    return { name, config, client, tools: [], error: err?.message || String(err) };
  }
}

export async function connectAll(servers: Record<string, ServerConfig>): Promise<Downstream[]> {
  return Promise.all(Object.entries(servers).map(([name, cfg]) => connectDownstream(name, cfg)));
}

export async function closeAll(downstreams: Downstream[]): Promise<void> {
  await Promise.all(downstreams.map((d) => d.client.close().catch(() => undefined)));
}
