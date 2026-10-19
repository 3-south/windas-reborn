// Local server for the WinDAS Reborn launcher: `npm start`.
//  - serves the static app
//  - /__ping            heartbeat from the page; the server exits shortly after the window closes
//  - /__hcfr/*, /__events   optional HCFR link (PGenerator emulation) and HCFR launcher; local use only
//  - WINDAS_DIR env     also exposes your WinDAS folder at /__windas/ (dev/testing only)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { spawn } from 'node:child_process';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const windas = process.env.WINDAS_DIR;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
const port = Number(process.env.PORT ?? 8080);

// The page pings every few seconds; once it has pinged, exit shortly after it goes quiet (window closed).
let lastPing = 0;
setInterval(() => { if (lastPing && Date.now() - lastPing > 20000) process.exit(0); }, 5000).unref();

// ---- HCFR link ----
let emu = null;
const sse = new Set();
const send = (obj) => { const line = `data: ${JSON.stringify(obj)}\n\n`; for (const r of sse) r.write(line); };
const hcfrPaths = () => [process.env.HCFR_PATH, 'C:\\Program Files (x86)\\HCFR Calibration\\ColorHCFR.exe', 'C:\\Program Files\\HCFR Calibration\\ColorHCFR.exe'].filter(Boolean);

async function hcfrStart(opts) {
  if (!emu) {
    const { PGenEmulator } = await import('./src/server/pgen.js');
    emu = new PGenEmulator({ protocol: { width: opts.width || 1920, height: opts.height || 1080 } });
    emu.on('state', (s) => send({ type: 'state', ...s }));
    emu.on('event', (e) => send(e));
  }
  if (opts.width && opts.height) emu.setDisplay(opts.width, opts.height);
  await emu.start();
  return emu.status();
}

// Select HCFR's generator by editing its ini (Defaults/Generator is the combo-box text HCFR saves). Backs up first.
const hcfrRunning = () => { try { return /ColorHCFR\.exe/i.test(execFileSync('tasklist', ['/FI', 'IMAGENAME eq ColorHCFR.exe', '/NH'], { encoding: 'utf8' })); } catch { return false; } };
function hcfrConfigure(generator) {
  const exe = hcfrPaths().find(existsSync);
  if (!exe) throw new Error('HCFR was not found.');
  if (hcfrRunning()) throw new Error('Close HCFR first (it rewrites its settings when it exits), then try again.');
  const ini = join(dirname(exe), 'ColorHCFR.ini');
  if (!existsSync(ini)) throw new Error('ColorHCFR.ini not found next to HCFR.');
  const backup = ini + '.windas-backup';
  if (!existsSync(backup)) copyFileSync(ini, backup);                 // keep the very first copy only
  let text = readFileSync(ini, 'latin1'); const nl = text.includes('\r\n') ? '\r\n' : '\n';
  const m = /^\[Defaults\][\s\S]*?(?=^\[|(?![\s\S]))/m.exec(text);
  const previous = m && /^Generator=(.*)$/m.exec(m[0])?.[1].trim();
  if (m && /^Generator=.*$/m.test(m[0])) text = text.replace(m[0], m[0].replace(/^Generator=.*$/m, 'Generator=' + generator));
  else if (m) text = text.replace(m[0], m[0].replace(/^\[Defaults\]\r?\n/, (h) => h + 'Generator=' + generator + nl));
  else text += nl + '[Defaults]' + nl + 'Generator=' + generator + nl;
  writeFileSync(ini, text, 'latin1');
  return { ini, previous: previous ?? null, backup };
}

function hcfrRestore() {
  const exe = hcfrPaths().find(existsSync);
  if (!exe) throw new Error('HCFR was not found.');
  if (hcfrRunning()) throw new Error('Close HCFR first, then try again.');
  const ini = join(dirname(exe), 'ColorHCFR.ini'), backup = ini + '.windas-backup';
  if (!existsSync(backup)) throw new Error('No backup found — nothing to restore.');
  copyFileSync(backup, ini);
  return { restored: ini };
}

// Only the launcher's own page may use the control endpoints (blocks other sites and DNS-rebinding tricks).
const hostOk = (req) => /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host ?? '');
const body = (req) => new Promise((res) => { let s = ''; req.on('data', (c) => (s += c)); req.on('end', () => { try { res(JSON.parse(s || '{}')); } catch { res({}); } }); });

const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/__ping') { lastPing = Date.now(); res.writeHead(204).end(); return; }

    if (path.startsWith('/__hcfr/') || path === '/__events') {
      if (!hostOk(req) || (req.method === 'POST' && req.headers['x-windas'] !== '1')) { res.writeHead(403).end(); return; }
      const json = (code, obj) => res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(obj));
      if (path === '/__events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        res.write(`data: ${JSON.stringify({ type: 'state', ...(emu?.status() ?? { running: false, clients: 0 }) })}\n\n`);
        sse.add(res); req.on('close', () => sse.delete(res));
        return;
      }
      if (path === '/__hcfr/status') return json(200, { ...(emu?.status() ?? { running: false, clients: 0 }), hcfr: hcfrPaths().find(existsSync) ?? null });
      if (path === '/__hcfr/start') {
        try { return json(200, await hcfrStart(await body(req))); }
        catch (e) {
          const why = e.code === 'EADDRINUSE' ? 'Port 85 or UDP 1977 is already in use (is a real PGenerator or another copy running?).' : e.code === 'EACCES' ? 'Windows would not let this program listen on port 85.' : e.message;
          return json(500, { error: why });
        }
      }
      if (path === '/__hcfr/stop') { emu?.stop(); return json(200, { running: false }); }
      if (path === '/__hcfr/configure') {
        try { return json(200, hcfrConfigure((await body(req)).generator || 'Raspberry Pi')); } catch (e) { return json(400, { error: e.message }); }
      }
      if (path === '/__hcfr/restore') {
        try { return json(200, hcfrRestore()); } catch (e) { return json(400, { error: e.message }); }
      }
      if (path === '/__hcfr/launch') {
        const exe = hcfrPaths().find(existsSync);
        if (!exe) return json(404, { error: 'HCFR was not found in Program Files. Set HCFR_PATH to ColorHCFR.exe.' });
        spawn(exe, [], { cwd: dirname(exe), detached: true, stdio: 'ignore' }).unref();
        return json(200, { launched: exe });
      }
      return json(404, { error: 'unknown endpoint' });
    }

    let base = here;
    if (windas && path.startsWith('/__windas/')) { base = windas; path = path.slice('/__windas'.length); }
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(base, path));
    if (!file.startsWith(normalize(base))) { res.writeHead(403).end(); return; }
    const data = await readFile(file); // read first so a missing file becomes a clean 404
    res.writeHead(200, { 'content-type': types[extname(file).toLowerCase()] ?? 'application/octet-stream' }).end(data);
  } catch { res.writeHead(404).end('not found'); }
});
// Already running (second launch)? Then the first instance serves the window; just exit.
server.on('error', (e) => { if (e.code === 'EADDRINUSE') process.exit(0); throw e; });
server.listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}`));
