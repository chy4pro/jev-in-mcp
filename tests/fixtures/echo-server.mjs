// A tiny stdio MCP server used by the end-to-end test.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
const s = new McpServer({ name: 'echo', version: '1' });
s.registerTool('echo', { description: 'Echo the text back.', inputSchema: { text: z.string() } }, async ({ text }) => ({ content: [{ type: 'text', text: `echo: ${text}` }] }));
s.registerTool('mood', { description: 'Set the mood.', inputSchema: { mood: z.enum(['calm', 'loud']) } }, async ({ mood }) => ({ content: [{ type: 'text', text: `mood=${mood}` }] }));
await s.connect(new StdioServerTransport());
