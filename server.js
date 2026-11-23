// Escaleras y Serpientes – First Aid and Injuries (modo Kahoot)
// El profe crea la partida en /profe y proyecta el tablero.
// Los alumnos entran en / con el código y juegan desde el móvil.
// Sin dependencias (Node 18+). Ejecutar: node server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const DEFAULT_TIME = Number(process.env.QUESTION_TIME) || 20;
const FEEDBACK_MS = 5000; // tiempo para leer la explicación antes del siguiente turno
const QUESTIONS = JSON.parse(fs.readFileSync(path.join(__dirname, 'questions.json'), 'utf8'));
const PAGES = { '/': 'alumno.html', '/profe': 'profe.html' };

const LADDERS = { 4: 14, 9: 31, 21: 42, 28: 84, 51: 67, 72: 91, 80: 99 };
const SNAKES = { 17: 7, 54: 34, 62: 19, 64: 60, 87: 24, 93: 73, 95: 75, 98: 79 };
const COLORS = ['#e21b3c', '#1368ce', '#26890c', '#d89e00', '#8e44ad', '#e67e22', '#16a3a3', '#d6336c',
  '#5d4037', '#2c3e50', '#7cb342', '#ff5fa2', '#00acc1', '#6d4c41', '#3949ab', '#c0ca33'];
const MAX_PLAYERS = COLORS.length;

const rooms = new Map();
const rid = (n = 8) => crypto.randomBytes(n).toString('hex');
const cleanCode = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);

function newCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c;
  do { c = Array.from({ length: 5 }, () => abc[crypto.randomInt(abc.length)]).join(''); } while (rooms.has(c));
  return c;
}

function drawQuestion(r) {
  if (!r.deck.length) r.deck = QUESTIONS.map((_, i) => i).sort(() => Math.random() - 0.5);
  return QUESTIONS[r.deck.pop()];
}

function publicState(r) {
  const q = r.question;
  return {
    code: r.code, status: r.status, turn: r.turn, questionTime: r.questionTime, hostOnline: r.hostConns > 0,
    players: r.players.map(p => ({ id: p.id, name: p.name, color: p.color, pos: p.pos, online: p.conns > 0 })),
    // La respuesta correcta NUNCA se envía mientras la pregunta está abierta
    question: q && { text: q.q.text, options: q.q.options, kind: q.kind, from: q.from, to: q.to,
      playerId: q.playerId, deadline: q.deadline },
    lastEvent: r.lastEvent, winner: r.winner, busyUntil: r.busyUntil, log: r.log.slice(-12),
    ladders: LADDERS, snakes: SNAKES, serverNow: Date.now(),
  };
}

function broadcast(r) {
  r.touched = Date.now();
  const data = `data: ${JSON.stringify(publicState(r))}\n\n`;
  for (const c of r.clients) c.res.write(data);
}

function log(r, msg) { r.log.push(msg); if (r.log.length > 60) r.log.shift(); }
const current = r => r.players[r.turn];

function nextTurn(r) {
  if (!r.players.length) return;
  for (let i = 0; i < r.players.length; i++) {
    r.turn = (r.turn + 1) % r.players.length;
    if (r.players[r.turn].conns > 0) return; // salta alumnos desconectados
  }
}

function roll(r, p) {
  const dice = 1 + crypto.randomInt(6);
  const from = p.pos;
  const target = from + dice;
  r.lastEvent = { type: 'roll', playerId: p.id, dice, from, to: target > 100 ? from : target, t: Date.now() };
  r.busyUntil = Date.now() + 1500; // deja ver el dado
  if (target > 100) {
    log(r, `${p.name} saca ${dice}: necesita el número exacto para llegar a 100.`);
    return nextTurn(r);
  }
  p.pos = target;
  log(r, `${p.name} saca ${dice} y avanza de ${from} a ${target}.`);
  if (target === 100) return win(r, p);

  const kind = LADDERS[target] ? 'ladder' : SNAKES[target] ? 'snake' : null;
  if (!kind) return nextTurn(r);

  const to = kind === 'ladder' ? LADDERS[target] : SNAKES[target];
  r.status = 'question';
  r.question = { q: drawQuestion(r), kind, from: target, to, playerId: p.id,
    deadline: Date.now() + 1500 + r.questionTime * 1000 };
  log(r, kind === 'ladder'
    ? `🪜 ${p.name} cae en una escalera (${target}→${to}). ¡Pregunta!`
    : `🐍 ${p.name} cae en una serpiente (${target}→${to}). ¡Pregunta!`);
  r.timer = setTimeout(() => { answer(r, p, null); broadcast(r); }, r.question.deadline - Date.now() + 300);
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
  const how = timeout ? 'se queda sin tiempo' : correct ? 'acierta' : 'falla';
  const res = Q.kind === 'ladder'
    ? (correct ? `sube a ${finalPos}` : `se queda en ${finalPos}`)
    : (correct ? `esquiva la serpiente (${finalPos})` : `baja a ${finalPos}`);
  log(r, `${p.name} ${how} y ${res}.`);

  r.question = null;
  r.status = 'playing';
  r.busyUntil = Date.now() + FEEDBACK_MS;
  nextTurn(r);
}

function win(r, p) {
  r.status = 'finished';
  r.winner = p.id;
  log(r, `🏆 ¡${p.name} llega a la casilla 100 y gana!`);
}

// Borra salas abandonadas (más de 6 h sin actividad)
setInterval(() => {
  for (const [code, r] of rooms) if (Date.now() - r.touched > 6 * 3600e3 && !r.clients.size) rooms.delete(code);
}, 600e3);

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
  const page = PAGES[url.pathname.replace(/\/+$/, '') || '/'];

  if (req.method === 'GET' && page) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    return fs.createReadStream(path.join(__dirname, page)).pipe(res);
  }

  if (req.method === 'GET' && url.pathname === '/events') {
    const r = rooms.get(cleanCode(url.searchParams.get('room')));
    if (!r) { res.writeHead(404); return res.end(); }
    const token = url.searchParams.get('token');
    const p = r.players.find(x => x.token === token);
    const isHost = token && token === r.hostToken;
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const client = { res };
    r.clients.add(client);
    if (p) p.conns++;
    if (isHost) r.hostConns++;
    broadcast(r);
    const hb = setInterval(() => res.write(': ping\n\n'), 20000);
    req.on('close', () => {
      clearInterval(hb); r.clients.delete(client);
      if (p) p.conns--;
      if (isHost) r.hostConns--;
      broadcast(r);
    });
    return;
  }

  if (req.method !== 'POST' || !url.pathname.startsWith('/api/')) { res.writeHead(404); return res.end(); }

  let body;
  try { body = await readJSON(req); } catch { return send(res, 400, { error: 'JSON no válido' }); }
  const action = url.pathname.slice(5);

  // El profe crea la partida
  if (action === 'create') {
    const code = newCode();
    const t = Math.round(Number(body.questionTime));
    const r = {
      code, hostToken: rid(16), hostConns: 0, players: [], turn: 0, status: 'lobby',
      questionTime: t >= 5 && t <= 120 ? t : DEFAULT_TIME,
      question: null, timer: null, lastEvent: null, winner: null, deck: [], busyUntil: 0,
      clients: new Set(), log: [], touched: Date.now(),
    };
    rooms.set(code, r);
    log(r, `Partida ${code} creada. Esperando alumnos…`);
    return send(res, 200, { room: code, hostToken: r.hostToken });
  }

  const r = rooms.get(cleanCode(body.room));
  if (!r) return send(res, 404, { error: 'No existe ninguna partida con ese código' });

  // Un alumno entra
  if (action === 'join') {
    const existing = r.players.find(x => x.token === body.token);
    if (existing) return send(res, 200, { token: existing.token, id: existing.id, room: r.code });
    const name = String(body.name || '').trim().slice(0, 16);
    if (!name) return send(res, 400, { error: 'Escribe tu nombre' });
    if (r.status !== 'lobby') return send(res, 409, { error: 'La partida ya ha empezado' });
    if (r.players.length >= MAX_PLAYERS) return send(res, 409, { error: `Partida llena (máx. ${MAX_PLAYERS})` });
    if (r.players.some(x => x.name.toLowerCase() === name.toLowerCase())) return send(res, 409, { error: 'Ese nombre ya está cogido' });
    const p = { id: rid(4), token: rid(16), name, color: COLORS[r.players.length], pos: 1, conns: 0 };
    r.players.push(p);
    log(r, `${name} se ha unido.`);
    broadcast(r);
    return send(res, 200, { token: p.token, id: p.id, room: r.code });
  }

  const isHost = body.token === r.hostToken;
  const p = r.players.find(x => x.token === body.token);
  if (!isHost && !p) return send(res, 403, { error: 'No autorizado' });

  switch (action) {
    // ----- Acciones del profe -----
    case 'start': {
      if (!isHost) return send(res, 403, { error: 'Solo el profe puede empezar' });
      if (!r.players.length) return send(res, 409, { error: 'Todavía no hay alumnos' });
      clearTimeout(r.timer);
      const t = Math.round(Number(body.questionTime));
      if (t >= 5 && t <= 120) r.questionTime = t;
      r.players.forEach(x => (x.pos = 1));
      Object.assign(r, { status: 'playing', turn: 0, question: null, winner: null, lastEvent: null, busyUntil: 0 });
      if (r.players[0].conns === 0) nextTurn(r);
      log(r, `¡Empieza la partida! Tiempo por pregunta: ${r.questionTime} s.`);
      break;
    }
    case 'skip': {
      if (!isHost) return send(res, 403, { error: 'Solo el profe' });
      if (r.status === 'question') answer(r, r.players.find(x => x.id === r.question.playerId), null);
      else if (r.status === 'playing') { log(r, `Se salta el turno de ${current(r).name}.`); r.busyUntil = 0; nextTurn(r); }
      break;
    }
    case 'kick': {
      if (!isHost) return send(res, 403, { error: 'Solo el profe' });
      if (r.status !== 'lobby') return send(res, 409, { error: 'Solo antes de empezar' });
      r.players = r.players.filter(x => x.id !== body.playerId);
      r.players.forEach((x, i) => (x.color = COLORS[i]));
      break;
    }
    case 'lobby': {
      if (!isHost) return send(res, 403, { error: 'Solo el profe' });
      clearTimeout(r.timer);
      r.players.forEach(x => (x.pos = 1));
      Object.assign(r, { status: 'lobby', question: null, winner: null, lastEvent: null, turn: 0 });
      log(r, 'Vuelta a la sala de espera: pueden entrar más alumnos.');
      break;
    }
    // ----- Acciones del alumno -----
    case 'roll': {
      if (!p) return send(res, 403, { error: 'Solo los alumnos tiran' });
      if (r.status !== 'playing') return send(res, 409, { error: 'Ahora no se puede tirar' });
      if (current(r) !== p) return send(res, 403, { error: 'No es tu turno' });
      if (Date.now() < r.busyUntil) return send(res, 409, { error: 'Espera un momento' });
      roll(r, p);
      break;
    }
    case 'answer': {
      if (!p) return send(res, 403, { error: 'Solo los alumnos responden' });
      if (r.status !== 'question' || !r.question) return send(res, 409, { error: 'No hay pregunta abierta' });
      if (r.question.playerId !== p.id) return send(res, 403, { error: 'Solo responde el alumno del turno' });
      const c = Number(body.choice);
      if (![0, 1, 2, 3].includes(c)) return send(res, 400, { error: 'Opción no válida' });
      answer(r, p, Date.now() > r.question.deadline ? null : c);
      break;
    }
    default: return send(res, 404, { error: 'Acción desconocida' });
  }
  broadcast(r);
  send(res, 200, { ok: true });
});

server.listen(PORT, () => console.log(`Escaleras y Serpientes en http://localhost:${PORT}  ·  profe: /profe  (${QUESTIONS.length} preguntas)`));
