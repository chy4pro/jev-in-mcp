import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ServerConfig } from './config.js';

/** Known client config files and where their mcpServers live. */
export function clientConfigFiles(home = os.homedir(), platform = process.platform): Array<{ client: string; file: string }> {
  const list = [
    { client: 'Claude Code', file: path.join(home, '.claude.json') },
    { client: 'Cursor', file: path.join(home, '.cursor', 'mcp.json') },
    { client: 'Windsurf', file: path.join(home, '.codeium', 'windsurf', 'mcp_config.json') },
  ];
  if (platform === 'darwin') list.push({ client: 'Claude Desktop', file: path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json') });
  else if (platform === 'win32') list.push({ client: 'Claude Desktop', file: path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json') });
  else list.push({ client: 'Claude Desktop', file: path.join(home, '.config', 'Claude', 'claude_desktop_config.json') });
  return list;
}

const isSelf = (cfg: ServerConfig) => /jev-in-mcp/.test([cfg.command, ...(cfg.args || [])].join(' '));

/** Collects mcpServers entries from the given files (top level, and Claude Code's per-project sections). */
export function collectServers(files: Array<{ client: string; file: string }>): { servers: Record<string, ServerConfig>; from: string[] } {
  const servers: Record<string, ServerConfig> = {};
  const from: string[] = [];
  for (const { client, file } of files) {
    let raw: any;
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    const sections: Array<Record<string, any>> = [];
    if (raw?.mcpServers && typeof raw.mcpServers === 'object') sections.push(raw.mcpServers);
    if (raw?.projects && typeof raw.projects === 'object') for (const p of Object.values<any>(raw.projects)) if (p?.mcpServers) sections.push(p.mcpServers);
    let added = 0;
    for (const section of sections) {
      for (const [name, cfg] of Object.entries<any>(section)) {
        if (!cfg || typeof cfg !== 'object' || isSelf(cfg) || servers[name]) continue;
        const entry: ServerConfig = {};
        if (cfg.command) entry.command = cfg.command;
        if (Array.isArray(cfg.args)) entry.args = cfg.args;
        if (cfg.env && typeof cfg.env === 'object') entry.env = cfg.env;
        if (cfg.cwd) entry.cwd = cfg.cwd;
        if (cfg.url) entry.url = cfg.url;
        if (cfg.headers && typeof cfg.headers === 'object') entry.headers = cfg.headers;
        if (!entry.command && !entry.url) continue;
        servers[name] = entry;
        added++;
      }
    }
    if (added) from.push(`${client} (${file}): ${added}`);
  }
  return { servers, from };
}
