// KAVU - server. Run: npm install && node server.js
const http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require('ws');
const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, 'public');
const mime = { '.html': 'text/html', '.js': 'text/javascript' };

const srv = http.createServer((q, r) => {
  let u = q.url.split('?')[0]; if (u === '/') u = '/index.html';
  const f = path.join(PUB, u);
  if (!f.startsWith(PUB)) { r.writeHead(403); return r.end(); }
  fs.readFile(f, (e, d) => {
    if (e) { r.writeHead(404); return r.end('404'); }
    r.writeHead(200, { 'Content-Type': mime[path.extname(f)] || 'text/plain' }); r.end(d);
  });
});
const wss = new WebSocketServer({ server: srv });
const rooms = {};
const CH = [{n:3,d:[0,0],sp:2.0},{n:4,d:[26,-20],sp:2.5},{n:4,d:[-18,-6],sp:3.0},{n:5,d:[0,-36],sp:3.4},{n:5,d:[0,0],sp:3.9}];

function fresh(R, ch) {
  if (ch !== undefined) R.ch = ch; R.ch = R.ch || 0;
  const C = CH[R.ch]; R.lamps = [];
  for (let i = 0; i < C.n; i++) { const a = i * (6.283 / C.n) + Math.random() * 0.5, d = 20 + Math.random() * 18; R.lamps.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, s: 0 }); }
  R.y = { x: 32, z: 32 }; R.st = 'play'; R.lit = 0; R.ev = R.ev || [];
  for (const p of Object.values(R.players || {})) { p.alive = true; p.carry = -1; p.x = (Math.random() - .5) * 6; p.z = 8; }
}

wss.on('connection', ws => {
  let R = null, P = null;
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'join') {
      const code = String(m.room || 'KAVU').toUpperCase().slice(0, 12);
      R = rooms[code] || (rooms[code] = { players: {}, seed: Math.floor(Math.random() * 1e9), n: 0 });
      if (!R.lamps) fresh(R, 0);
      P = { id: ++R.n, name: String(m.name || 'Player').slice(0, 14), x: 0, z: 8, ry: 0, alive: R.st === 'play', carry: -1, ws };
      R.players[P.id] = P;
      ws.send(JSON.stringify({ t: 'init', id: P.id, seed: R.seed }));
    } else if (m.t === 'pos' && P && P.alive) {
      if ([m.x, m.z, m.ry].every(Number.isFinite)) { P.x = m.x; P.z = m.z; P.ry = m.ry; }
    }
  });
  ws.on('close', () => {
    if (!R || !P) return;
    if (P.carry >= 0) { const l = R.lamps[P.carry]; l.s = 0; l.x = P.x; l.z = P.z; }
    delete R.players[P.id];
  });
});

setInterval(() => {
  for (const k in rooms) {
    const R = rooms[k], ps = Object.values(R.players);
    if (!ps.length) { delete rooms[k]; continue; }
    if (R.st === 'play') {
      let tgt = null, bd = 1e9;
      for (const p of ps) { if (!p.alive) continue; const d = Math.hypot(p.x - R.y.x, p.z - R.y.z); if (d < bd) { bd = d; tgt = p; } }
      if (tgt) {
        const sp = (CH[R.ch].sp + R.lit * 0.15) * 0.05;
        R.y.x += (tgt.x - R.y.x) / bd * sp; R.y.z += (tgt.z - R.y.z) / bd * sp;
        if (bd < 1.3) {
          tgt.alive = false; R.ev.push(['caught', tgt.id, tgt.name]);
          if (tgt.carry >= 0) { const l = R.lamps[tgt.carry]; l.s = 0; l.x = tgt.x; l.z = tgt.z; tgt.carry = -1; }
        }
      }
      for (const p of ps) {
        if (!p.alive) continue;
        if (p.carry < 0) {
          R.lamps.forEach((l, i) => {
            if (l.s === 0 && p.carry < 0 && Math.hypot(l.x - p.x, l.z - p.z) < 1.8) { l.s = 1; p.carry = i; R.ev.push(['pick', p.id, i]); }
          });
        } else if (Math.hypot(p.x - CH[R.ch].d[0], p.z - CH[R.ch].d[1]) < 3.5) { R.lamps[p.carry].s = 2; p.carry = -1; R.lit++; R.ev.push(['lit', p.id]); }
      }
      if (R.lit >= CH[R.ch].n) { if (R.ch < CH.length - 1) { R.ch++; fresh(R); R.ev.push(['chap', R.ch]); } else { R.st = 'win'; R.end = Date.now(); } }
      else if (!ps.some(p => p.alive)) { R.st = 'lose'; R.end = Date.now(); }
    } else if (Date.now() - R.end > 8000) fresh(R, R.st === 'win' ? 0 : undefined);

    const msg = JSON.stringify({
      t: 's', st: R.st, lit: R.lit, ev: R.ev, ch: R.ch, n: CH[R.ch].n, d: CH[R.ch].d,
      p: ps.map(p => [p.id, p.name, p.x, p.z, p.ry, p.alive, p.carry]),
      y: [R.y.x, R.y.z], l: R.lamps.map(l => [l.x, l.z, l.s])
    });
    R.ev = [];
    for (const p of ps) if (p.ws.readyState === 1) p.ws.send(msg);
  }
}, 50);

srv.listen(PORT, () => console.log('KAVU running on port ' + PORT));
