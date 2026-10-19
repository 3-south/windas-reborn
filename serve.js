// Tiny static server for local use: `npm start`. Set WINDAS_DIR to also expose your WinDAS folder at /__windas/ (dev/testing only).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const windas = process.env.WINDAS_DIR;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
const port = Number(process.env.PORT ?? 8080);

// The page pings every few seconds; once it has pinged, exit shortly after it goes quiet (window closed).
let lastPing = 0;
setInterval(() => { if (lastPing && Date.now() - lastPing > 20000) process.exit(0); }, 5000).unref();

const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/__ping') { lastPing = Date.now(); res.writeHead(204).end(); return; }
    let base = here;
    if (windas && path.startsWith('/__windas/')) { base = windas; path = path.slice('/__windas'.length); }
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(base, path));
    if (!file.startsWith(normalize(base))) { res.writeHead(403).end(); return; }
    const body = await readFile(file); // read first so a missing file becomes a clean 404
    res.writeHead(200, { 'content-type': types[extname(file).toLowerCase()] ?? 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end('not found'); }
});
// Already running (second launch)? Then the first instance serves the window; just exit.
server.on('error', (e) => { if (e.code === 'EADDRINUSE') process.exit(0); throw e; });
server.listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}`));
