import type { JevClient, JevRequest, JevResponse } from 'jev-dev-kit';
import type { Config } from './config.js';

const TRANSIENT = new Set([429, 503, 529]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One fetch to the configured provider, with backoff on transient statuses. */
export function makeJevClient(config: Config['jev'], apiKey: string, fetchImpl: typeof fetch = fetch): JevClient {
  const openrouter = config.provider === 'openrouter';
  const endpoint = config.endpoint || (openrouter ? 'https://openrouter.ai/api/alpha/decisions' : 'https://api.typesafe.ai/v1/systemone');
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
  if (openrouter) {
    headers['HTTP-Referer'] = 'https://github.com/chy4pro/jev-in-mcp';
    headers['X-Title'] = 'jev-in-mcp';
  }
  return async (request: JevRequest): Promise<JevResponse> => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetchImpl(endpoint, { method: 'POST', headers, body: JSON.stringify(request) });
      if (TRANSIENT.has(res.status) && attempt < 3) {
        await sleep(800 * 2 ** attempt);
        continue;
      }
      if (!res.ok) {
        let detail = '';
        try { detail = (await res.text()).slice(0, 300); } catch { /* unreadable */ }
        throw new Error(`Jev provider error (HTTP ${res.status})${detail ? `: ${detail}` : ''}`);
      }
      return (await res.json()) as JevResponse;
    }
  };
}

export function defaultModel(config: Config['jev']): string {
  return config.model || (config.provider === 'openrouter' ? 'typesafe/jev-1.13' : 'jev-latest');
}
