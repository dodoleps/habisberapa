// Server lokal untuk mencoba aplikasi di komputer: node tools/serve.js
// POST /api menjalankan Code.gs dengan Google Sheets tiruan (PIN 123456), untuk uji layar PIN & alur server.
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', 'web');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png',
  '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.svg': 'image/svg+xml' };
const port = Number(process.env.PORT) || 5173;
let fake = null;
http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api') {
    fake = fake || require('./fake-backend.js');
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(fake(body))); });
    return;
  }
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(root, p);
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(port, () => console.log('habisberapa di http://localhost:' + port));
