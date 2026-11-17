// Escaleras y Serpientes – First Aid and Injuries
// Servidor multijugador sin dependencias (Node 18+). Ejecutar: node server.js
// Variables opcionales: PORT (3000), QUESTION_TIME (segundos, 20)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const DEFAULT_TIME = Number(process.env.QUESTION_TIME) || 20;
const FEEDBACK_MS = 4500; // tiempo para leer la explicación antes del siguiente turno
const QUESTIONS = JSON.parse(fs.readFileSync(path.join(__dirname, 'questions.json'), 'utf8'));
const INDEX = path.join(__dirname, 'index.html');

const LADDERS = { 4: 14, 9: 31, 21: 42, 28: 84, 51: 67, 72: 91, 80: 99 };
const SNAKES = { 17: 7, 54: 34, 62: 19, 64: 60, 87: 24, 93: 73, 95: 75, 98: 79 };
const COLORS = ['#e63946', '#1d7ff2', '#2a9d4b', '#f4a100', '#8e44ad', '#e67e22', '#16a3a3', '#d6336c'];

const rooms = new Map();
const rid = (n = 8) => crypto.randomBytes(n).toString('hex');

function getRoom(code) {
  code = String(code || 'AULA').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || 'AULA';
  if (!rooms.has(code)) {
    rooms.set(code, {
      code, players: [], turn: 0, status: 'lobby', hostId: null, questionTime: DEFAULT_TIME,
      question: null, timer: null, lastEvent: null, winner: null, deck: [], busyUntil: 0,
      clients: new Set(), log: [],
    });
  }
  return rooms.get(code);
}

function drawQuestion(r) {
  if (!r.deck.length) r.deck = QUESTIONS.map((_, i) => i).sort(() => Math.random() - 0.5);
  return QUESTIONS[r.deck.pop()];
}

function publicState(r) {
  const q = r.question;
  return {
    code: r.code, status: r.status, turn: r.turn, hostId: r.hostId, questionTime: r.questionTime,
    players: r.players.map(p => ({ id: p.id, name: p.name, color: p.color, pos: p.pos, online: p.conns > 0 })),
    // La respuesta correcta NUNCA se envía mientras la pregunta está abierta
    question: q && { text: q.q.text, options: q.q.options, kind: q.kind, from: q.from, to: q.to,
      playerId: q.playerId, deadline: q.deadline },
    lastEvent: r.lastEvent, winner: r.winner, busyUntil: r.busyUntil, log: r.log.slice(-10),
    ladders: LADDERS, snakes: SNAKES, serverNow: Date.now(),
  };
}

function broadcast(r) {
  const data = `data: ${JSON.stringify(publicState(r))}\n\n`;
  for (const c of r.clients) c.res.write(data);
}

function log(r, msg) { r.log.push(msg); if (r.log.length > 50) r.log.shift(); }
const current = r => r.players[r.turn];

function nextTurn(r) {
  if (!r.players.length) return;
  for (let i = 0; i < r.players.length; i++) {
    r.turn = (r.turn + 1) % r.players.length;
    if (r.players[r.turn].conns > 0) return; // salta jugadores desconectados
  }
}

function roll(r, p) {
  const dice = 1 + crypto.randomInt(6);
  const from = p.pos;
  const target = from + dice;
  r.lastEvent = { type: 'roll', playerId: p.id, dice, from, to: target > 100 ? from : target, t: Date.now() };
  if (target > 100) {
    log(r, `${p.name} saca ${dice}: necesita exacto para llegar a 100, se queda en ${from}.`);
    nextTurn(r);
    return;
  }
  p.pos = target;
  log(r, `${p.name} saca ${dice} y avanza de ${from} a ${target}.`);
  if (target === 100) return win(r, p);

  const kind = LADDERS[target] ? 'ladder' : SNAKES[target] ? 'snake' : null;
  if (!kind) return nextTurn(r);

  const to = kind === 'ladder' ? LADDERS[target] : SNAKES[target];
  r.status = 'question';
  r.question = { q: drawQuestion(r), kind, from: target, to, playerId: p.id, deadline: Date.now() + r.questionTime * 1000 };
  log(r, kind === 'ladder'
    ? `🪜 ${p.name} cae en una escalera (${target}→${to}). ¡Pregunta!`
    : `🐍 ${p.name} cae en una serpiente (${target}→${to}). ¡Pregunta!`);
  r.timer = setTimeout(() => { answer(r, p, null); broadcast(r); }, r.questionTime * 1000 + 300);
}

function answer(r, p, choice) {
  const Q = r.question;
  if (!Q) return;
  clearTimeout(r.timer);
  const correct = choice === Q.q.answer;
  const timeout = choice === null;
  let finalPos = Q.from;
  if (Q.kind === 'ladder' && correct) finalPos = Q.to;
  if (Q.kind === 'snake' && !correct) finalPos = Q.to;
  p.pos = finalPos;

  r.lastEvent = {
    type: 'answer', playerId: p.id, kind: Q.kind, from: Q.from, to: Q.to, finalPos, correct, timeout, choice,
    correctIndex: Q.q.answer, text: Q.q.text, options: Q.q.options, explanation: Q.q.explanation, t: Date.now(),
  };
  const how = timeout ? 'se le acaba el tiempo' : correct ? 'responde bien' : 'responde mal';
  const res = Q.kind === 'ladder'
    ? (correct ? `sube a ${finalPos}` : `se queda en ${finalPos}`)
    : (correct ? `esquiva la serpiente y se queda en ${finalPos}` : `baja a ${finalPos}`);
  log(r, `${p.name} ${how} y ${res}.`);

  r.question = null;
  r.status = 'playing';
  r.busyUntil = Date.now() + FEEDBACK_MS;
  if (finalPos === 100) return win(r, p);
  nextTurn(r);
}

function win(r, p) {
  r.status = 'finished';
  r.winner = p.id;
  log(r, `🏆 ¡${p.name} llega a la casilla 100 y gana!`);
}

// ---------- HTTP ----------
function readJSON(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', c => { b += c; if (b.length > 1e4) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (e) { reject(e); } });
  });
}
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return fs.createReadStream(INDEX).pipe(res);
  }

  if (req.method === 'GET' && url.pathname === '/events') {
    const r = getRoom(url.searchParams.get('room'));
    const p = r.players.find(x => x.token === url.searchParams.get('token'));
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const client = { res, p };
    r.clients.add(client);
    if (p) p.conns++;
    broadcast(r);
    const hb = setInterval(() => res.write(': ping\n\n'), 20000);
    req.on('close', () => {
      clearInterval(hb); r.clients.delete(client);
      if (p) p.conns--;
      broadcast(r);
    });
    return;
  }

  if (req.method !== 'POST' || !url.pathname.startsWith('/api/')) { res.writeHead(404); return res.end(); }

  let body;
  try { body = await readJSON(req); } catch { return send(res, 400, { error: 'JSON no válido' }); }
  const r = getRoom(body.room);
  const action = url.pathname.slice(5);

  if (action === 'join') {
    const name = String(body.name || '').trim().slice(0, 16);
    if (!name) return send(res, 400, { error: 'Escribe un nombre' });
    const existing = r.players.find(x => x.token === body.token);
    if (existing) return send(res, 200, { token: existing.token, id: existing.id, room: r.code });
    if (r.status !== 'lobby') return send(res, 409, { error: 'La partida ya ha empezado' });
    if (r.players.length >= COLORS.length) return send(res, 409, { error: 'Sala llena (máx. 8)' });
    const p = { id: rid(4), token: rid(16), name, color: COLORS[r.players.length], pos: 1, conns: 0 };
    r.players.push(p);
    if (!r.hostId) r.hostId = p.id;
    log(r, `${name} se une a la partida.`);
    broadcast(r);
    return send(res, 200, { token: p.token, id: p.id, room: r.code });
  }

  const p = r.players.find(x => x.token === body.token);
  if (!p) return send(res, 403, { error: 'Jugador no reconocido' });
  const isHost = p.id === r.hostId;

  switch (action) {
    case 'start': {
      if (!isHost) return send(res, 403, { error: 'Solo el anfitrión puede empezar' });
      if (r.status === 'question') return send(res, 409, { error: 'Hay una pregunta abierta' });
      const t = Math.round(Number(body.questionTime));
      r.questionTime = t >= 5 && t <= 120 ? t : r.questionTime;
      r.players.forEach(x => (x.pos = 1));
      Object.assign(r, { status: 'playing', turn: 0, winner: null, lastEvent: null, busyUntil: 0 });
      log(r, `Empieza la partida. Tiempo por pregunta: ${r.questionTime} s.`);
      break;
    }
    case 'roll': {
      if (r.status !== 'playing') return send(res, 409, { error: 'No se puede tirar ahora' });
      if (current(r) !== p) return send(res, 403, { error: 'No es tu turno' });
      if (Date.now() < r.busyUntil) return send(res, 409, { error: 'Espera un momento' });
      roll(r, p);
      break;
    }
    case 'answer': {
      if (r.status !== 'question' || !r.question) return send(res, 409, { error: 'No hay pregunta abierta' });
      if (r.question.playerId !== p.id) return send(res, 403, { error: 'Solo responde el jugador del turno' });
      const c = Number(body.choice);
      if (![0, 1, 2, 3].includes(c)) return send(res, 400, { error: 'Opción no válida' });
      if (Date.now() > r.question.deadline) { answer(r, p, null); break; }
      answer(r, p, c);
      break;
    }
    case 'skip': {
      if (!isHost) return send(res, 403, { error: 'Solo el anfitrión' });
      if (r.status === 'question') { const q = r.players.find(x => x.id === r.question.playerId); answer(r, q, null); }
      else if (r.status === 'playing') { log(r, `El anfitrión salta el turno de ${current(r).name}.`); nextTurn(r); }
      break;
    }
    case 'reset': {
      if (!isHost) return send(res, 403, { error: 'Solo el anfitrión' });
      clearTimeout(r.timer);
      r.players.forEach(x => (x.pos = 1));
      Object.assign(r, { status: 'lobby', question: null, winner: null, lastEvent: null, turn: 0 });
      log(r, 'La partida vuelve a la sala de espera.');
      break;
    }
    default: return send(res, 404, { error: 'Acción desconocida' });
  }
  broadcast(r);
  send(res, 200, { ok: true });
});

server.listen(PORT, () => console.log(`Escaleras y Serpientes en http://localhost:${PORT}  (${QUESTIONS.length} preguntas)`));
