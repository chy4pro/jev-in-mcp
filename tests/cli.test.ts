import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clientConfigFiles, collectServers } from '../src/importer.js';

const root = path.resolve(__dirname, '..');
let home: string;

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'jev-in-mcp-'));
  execFileSync('npx', ['tsc', '-p', 'tsconfig.build.json'], { cwd: root, stdio: 'ignore' });
});
afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

describe('importer', () => {
  it('collects mcpServers from client configs, including Claude Code project sections, skipping itself', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfgs-'));
    fs.writeFileSync(path.join(dir, 'claude.json'), JSON.stringify({ mcpServers: { github: { command: 'npx', args: ['-y', 'gh-mcp'] }, jev: { command: 'npx', args: ['-y', 'jev-in-mcp'] } }, projects: { '/p': { mcpServers: { fs: { command: 'node', args: ['fs.js'], env: { A: '1' } } } } } }));
    fs.writeFileSync(path.join(dir, 'cursor.json'), JSON.stringify({ mcpServers: { github: { command: 'other' }, remote: { url: 'https://x/mcp', headers: { Authorization: 'Bearer t' } }, broken: {} } }));
    const { servers, from } = collectServers([{ client: 'A', file: path.join(dir, 'claude.json') }, { client: 'B', file: path.join(dir, 'cursor.json') }, { client: 'C', file: path.join(dir, 'missing.json') }]);
    expect(Object.keys(servers)).toEqual(['github', 'fs', 'remote']);
    expect(servers.github.args).toEqual(['-y', 'gh-mcp']); // first file wins
    expect(servers.remote).toEqual({ url: 'https://x/mcp', headers: { Authorization: 'Bearer t' } });
    expect(from).toHaveLength(2);
    expect(clientConfigFiles('/h', 'linux').map((f) => f.client)).toEqual(['Claude Code', 'Cursor', 'Windsurf', 'Claude Desktop']);
  });
});

describe('cli over stdio', () => {
  it('serves the relay with a downstream stdio server from the config; status reports the setup', async () => {
    fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ servers: { echo: { command: process.execPath, args: [path.join(root, 'tests', 'fixtures', 'echo-server.mjs')] } } }));
    const env = { ...process.env, JEV_IN_MCP_HOME: home, JEV_API_KEY: '', TYPESAFE_API_KEY: '', OPENROUTER_API_KEY: '' };
    const status = execFileSync(process.execPath, [path.join(root, 'dist', 'cli.js'), 'status'], { env, encoding: 'utf8' });
    expect(status).toMatch(/jev key: none/);
    expect(status).toMatch(/echo: 2 tools/);

    const client = new Client({ name: 't', version: '1' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'dist', 'cli.js')], env, stderr: 'ignore' }));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['echo__echo', 'echo__mood', 'echo__use_jev', 'use_jev', 'jev_status']);
    const r: any = await client.callTool({ name: 'echo__echo', arguments: { text: 'hi' } });
    expect(r.content[0].text).toBe('echo: hi');
    const s: any = JSON.parse(((await client.callTool({ name: 'jev_status' })) as any).content[0].text);
    expect(s.servers[0]).toMatchObject({ name: 'echo', connected: true, use_jev: ['echo', 'mood'] });
    await client.close();
  }, 30000);
});
