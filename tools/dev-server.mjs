// Локальний сервер для тестів з емулятором Firebase (firebase.json у корені).
// Віддає сайт як є, лише в index.html дозволяє сторінці звертатися до емулятора
// (справжня політика безпеки сторінки цього не дозволяє — і на сайті не має).
//   node tools/dev-server.mjs [порт]   →  http://alice.localhost:8769/?emu=alice
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = +process.argv[2] || 8769;
const EMU = ' http://127.0.0.1:9099 http://127.0.0.1:8080';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };

createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = normalize(join(ROOT, p));
    if (!file.startsWith(ROOT)) throw new Error('outside');
    let body = await readFile(file);
    if (file.endsWith('index.html')) body = Buffer.from(String(body).replace(/(connect-src [^;"]*)/, '$1' + EMU));
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
}).listen(PORT, '127.0.0.1', () => console.log(`http://localhost:${PORT}/`));
