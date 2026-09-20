#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { configPath, keySource, loadConfig, loadKey, saveConfig } from './config.js';
import { closeAll, connectAll } from './downstream.js';
import { clientConfigFiles, collectServers } from './importer.js';
import { defaultModel, makeJevClient } from './jev.js';
import { createRelay } from './relay.js';
import { runSetup } from './setup.js';

const VERSION = '0.1.0';

async function serve(): Promise<void> {
  const config = loadConfig();
  const key = loadKey();
  const downstreams = await connectAll(config.servers);
  for (const d of downstreams) if (d.error) console.error(`[jev-in-mcp] ${d.name}: not connected (${d.error})`);
  const { server } = createRelay({
    config,
    downstreams,
    jev: key ? makeJevClient(config.jev, key) : null,
    model: defaultModel(config.jev),
    keySource: keySource(),
    version: VERSION,
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  const stop = () => closeAll(downstreams).finally(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

async function status(): Promise<void> {
  const config = loadConfig();
  console.log(`config: ${configPath()}`);
  console.log(`jev key: ${keySource() || 'none (run: npx jev-in-mcp setup)'}; provider: ${config.jev.provider}; model: ${defaultModel(config.jev)}`);
  const names = Object.keys(config.servers);
  console.log(`servers: ${names.length ? names.join(', ') : 'none (run: npx jev-in-mcp import, or edit the config)'}`);
  if (names.length) {
    const downstreams = await connectAll(config.servers);
    for (const d of downstreams) console.log(`  ${d.name}: ${d.error ? `not connected (${d.error})` : `${d.tools.length} tools`}`);
    await closeAll(downstreams);
  }
}

function importServers(): void {
  const config = loadConfig();
  const { servers, from } = collectServers(clientConfigFiles());
  const added: string[] = [];
  for (const [name, cfg] of Object.entries(servers)) {
    if (config.servers[name]) continue;
    config.servers[name] = cfg;
    added.push(name);
  }
  saveConfig(config);
  console.log(from.length ? `read: ${from.join('; ')}` : 'no client config with mcpServers found');
  console.log(added.length ? `added: ${added.join(', ')}` : 'nothing new to add');
  console.log(`config: ${configPath()}`);
  console.log('Next: point your client at jev-in-mcp instead of these servers, e.g. {"mcpServers":{"jev":{"command":"npx","args":["-y","jev-in-mcp"]}}}');
}

const cmd = process.argv[2];
const run =
  cmd === 'setup' ? runSetup()
  : cmd === 'import' ? Promise.resolve(importServers())
  : cmd === 'status' ? status()
  : cmd === undefined || cmd === 'serve' ? serve()
  : Promise.reject(new Error(`Unknown command "${cmd}". Commands: serve (default), setup, import, status`));
run.catch((err) => { console.error(err?.message || String(err)); process.exit(1); });
