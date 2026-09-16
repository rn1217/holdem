'use strict';
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const {Rooms} = require('./server/rooms.js');

function createServer(options = {}) {
  const rooms = new Rooms(options);
  const limits = new Map();
  const assets = new Map([
    ['/', ['index.html', 'text/html']], ['/index.html', ['index.html', 'text/html']],
    ['/style.css', ['style.css', 'text/css']], ['/js/ui.js', ['js/ui.js', 'text/javascript']]
  ]);
  const send = (res, status, data) => {
    res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8'});
    res.end(JSON.stringify(data));
  };
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && assets.has(url.pathname)) {
        const [file, mime] = assets.get(url.pathname);
        res.writeHead(200, {'Content-Type': `${mime}; charset=utf-8`});
        res.end(await fs.readFile(path.join(__dirname, file)));
        return;
      }
      if (!url.pathname.startsWith('/api/')) { send(res, 404, {error: '찾을 수 없습니다.'}); return; }
      if (!['GET', 'POST'].includes(req.method)) { send(res, 405, {error: '지원하지 않는 메서드입니다.'}); return; }
      // Reject cross-origin browser writes; session tokens are never stored in cookies or URLs.
      if (req.method === 'POST' && req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) {
        send(res, 403, {error: '다른 출처의 요청은 허용하지 않습니다.'}); return;
      }
      const address = req.socket.remoteAddress;
      const now = Date.now();
      let limit = limits.get(address);
      if (!limit || now - limit.since > 60000) { limit = {since: now, count: 0}; limits.set(address, limit); }
      if (++limit.count > 1200) { send(res, 429, {error: '요청이 너무 많습니다. 잠시 후 다시 시도하세요.'}); return; }
      let body = {};
      if (req.method === 'POST') {
        if (!String(req.headers['content-type']).startsWith('application/json')) { send(res, 415, {error: 'JSON 요청이 필요합니다.'}); return; }
        let raw = '';
        for await (const chunk of req) {
          raw += chunk;
          if (Buffer.byteLength(raw) > 4096) { send(res, 413, {error: '요청이 너무 큽니다.'}); return; }
        }
        try { body = JSON.parse(raw); } catch { send(res, 400, {error: '잘못된 JSON입니다.'}); return; }
        if (!body || typeof body !== 'object' || Array.isArray(body)) { send(res, 400, {error: '잘못된 요청입니다.'}); return; }
      }
      if (req.method === 'POST' && url.pathname === '/api/create') { send(res, 201, rooms.create(body.count)); return; }
      if (req.method === 'POST' && url.pathname === '/api/join') { send(res, 201, rooms.join(body.code)); return; }
      if ((req.method === 'GET' && url.pathname === '/api/state') || (req.method === 'POST' && url.pathname === '/api/command')) {
        const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
        const {room, member} = rooms.authenticate(url.searchParams.get('code'), token);
        if (req.method === 'POST') rooms.command(room, member, body);
        send(res, 200, rooms.view(room, member)); return;
      }
      send(res, 404, {error: 'API를 찾을 수 없습니다.'});
    } catch (error) {
      if (!res.headersSent) send(res, error.status || 400, {error: error.status || error.message ? error.message : '요청을 처리하지 못했습니다.'});
      else res.end();
    }
  });
  server.requestTimeout = 10000;
  const timer = setInterval(() => {
    rooms.sweep();
    for (const [key, value] of limits) if (Date.now() - value.since > 60000) limits.delete(key);
  }, 1000);
  timer.unref();
  server.on('close', () => clearInterval(timer));
  return {server, rooms};
}
if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '0.0.0.0';
  const {server} = createServer();
  server.listen(port, host, () => console.log(`Hold'em server: http://localhost:${port} (bind ${host})`));
}
module.exports = {createServer};
