import http from 'node:http';
import { exec } from 'node:child_process';
import { loadConfig, saveConfig, saveKey, keySource, configPath, credentialsPath } from './config.js';

const page = (msg: string, cfg: ReturnType<typeof loadConfig>) => `<!doctype html><meta charset="utf-8"><title>jev-in-mcp setup</title>
<style>body{font:15px system-ui;max-width:560px;margin:40px auto;padding:0 16px;color:#222}label{display:block;margin:14px 0 4px}input,select{width:100%;padding:8px;font:inherit}button{margin-top:16px;padding:8px 16px;font:inherit}.ok{color:#0a7}.k{color:#666;font-size:13px}</style>
<h1>jev-in-mcp setup</h1>
${msg ? `<p class="ok">${msg}</p>` : ''}
<form method="post">
<label>Provider</label><select name="provider"><option value="openrouter"${cfg.jev.provider === 'openrouter' ? ' selected' : ''}>OpenRouter (typesafe/jev-1.13)</option><option value="typesafe"${cfg.jev.provider === 'typesafe' ? ' selected' : ''}>TypeSafe (jev-latest)</option></select>
<label>API key</label><input name="apiKey" type="password" autocomplete="off" placeholder="${keySource() ? 'a key is already stored; leave empty to keep it' : 'paste the key'}">
<label>Model (optional)</label><input name="model" value="${cfg.jev.model || ''}" placeholder="typesafe/jev-1.13 or jev-latest">
<button>Save</button>
</form>
<p class="k">Saved to <code>${credentialsPath()}</code> (key, mode 600) and <code>${configPath()}</code>. Restart your MCP client afterwards. Close this tab when done; the page stops with the command.</p>`;

/** A temporary local page to store the key without it passing through any conversation. */
export function runSetup(): Promise<void> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const cfg = loadConfig();
      if (req.method === 'POST') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          const form = new URLSearchParams(body);
          const provider = form.get('provider') === 'typesafe' ? 'typesafe' : 'openrouter';
          const key = (form.get('apiKey') || '').trim();
          const model = (form.get('model') || '').trim();
          cfg.jev.provider = provider;
          cfg.jev.model = model || (provider === 'openrouter' ? 'typesafe/jev-1.13' : 'jev-latest');
          saveConfig(cfg);
          if (key) saveKey(key);
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(page(key ? 'Saved. You can close this tab.' : 'Settings saved (key unchanged). You can close this tab.', loadConfig()));
          setTimeout(() => { server.close(); resolve(); }, 500);
        });
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(page('', cfg));
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      const url = `http://127.0.0.1:${port}/`;
      console.error(`Open ${url} to enter the Jev API key (this page runs until you save).`);
      const open = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open';
      exec(`${open} ${url}`, () => undefined);
    });
  });
}
