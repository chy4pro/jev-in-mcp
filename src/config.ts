import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** A downstream server, in the same shape clients use in their `mcpServers` entries. */
export interface ServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  /** Streamable HTTP endpoint instead of a command. */
  url?: string;
  headers?: Record<string, string>;
  /** What Jev is told this server is for (used by the global use_jev to pick a server). */
  purpose?: string;
  jev?: {
    /** Only these tools may be used by use_jev (default: all except `deny`). */
    allow?: string[];
    /** Never used by use_jev; still available to the model directly. */
    deny?: string[];
    /** Candidate sentence overrides per tool: what happens when it is called. */
    describe?: Record<string, string>;
  };
}

export interface Config {
  servers: Record<string, ServerConfig>;
  jev: {
    provider: 'openrouter' | 'typesafe';
    model?: string;
    endpoint?: string;
  };
  use_jev: {
    /** Offer the global use_jev over all servers. */
    global: boolean;
    max_steps: number;
    /** Characters of each tool result kept in the state. */
    result_chars: number;
  };
}

export const DEFAULT_CONFIG: Config = {
  servers: {},
  jev: { provider: 'openrouter', model: 'typesafe/jev-1.13' },
  use_jev: { global: true, max_steps: 20, result_chars: 800 },
};

export function configDir(): string {
  return process.env.JEV_IN_MCP_HOME || path.join(os.homedir(), '.config', 'jev-in-mcp');
}

export const configPath = () => path.join(configDir(), 'config.json');
export const credentialsPath = () => path.join(configDir(), 'credentials.json');

function readJson(file: string): any {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err: any) {
    if (err?.code === 'ENOENT') return null;
    throw new Error(`Cannot read ${file}: ${err?.message || String(err)}`);
  }
}

export function loadConfig(): Config {
  const raw = readJson(configPath()) || {};
  return {
    servers: raw.servers || raw.mcpServers || {},
    jev: { ...DEFAULT_CONFIG.jev, ...(raw.jev || {}) },
    use_jev: { ...DEFAULT_CONFIG.use_jev, ...(raw.use_jev || {}) },
  };
}

export function saveConfig(config: Config): void {
  fs.mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
}

/** The Jev API key: environment first, then the credentials file. Never logged. */
export function loadKey(): string | null {
  const env = (process.env.JEV_API_KEY || process.env.TYPESAFE_API_KEY || process.env.OPENROUTER_API_KEY || '').trim();
  if (env) return env;
  const raw = readJson(credentialsPath());
  const key = typeof raw?.apiKey === 'string' ? raw.apiKey.trim() : '';
  return key || null;
}

export function saveKey(apiKey: string): void {
  fs.mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(credentialsPath(), JSON.stringify({ apiKey }, null, 2) + '\n', { mode: 0o600 });
}

/** Where the key comes from, for status output; never the key itself. */
export function keySource(): 'env' | 'file' | null {
  if ((process.env.JEV_API_KEY || process.env.TYPESAFE_API_KEY || process.env.OPENROUTER_API_KEY || '').trim()) return 'env';
  return loadKey() ? 'file' : null;
}
