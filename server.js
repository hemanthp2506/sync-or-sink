import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4173);
const rooms = new Map();
const stations = [
  { name: 'Reactor', actions: ['Vent core', 'Seal core', 'Pulse core'] },
  { name: 'Shields', actions: ['Raise shields', 'Cycle shields', 'Ground shields'] },
  { name: 'Navigation', actions: ['Align beacon', 'Plot jump', 'Reverse thrusters'] },
  { name: 'Oxygen', actions: ['Purge air', 'Open reserve', 'Balance pressure'] },
  { name: 'Comms', actions: ['Send ping', 'Scramble signal', 'Lock frequency'] },
  { name: 'Engine', actions: ['Prime drive', 'Cool drive', 'Cut ignition'] },
];
const names = ['ATLAS', 'NOVA', 'ORBIT', 'ECHO', 'PULSE', 'COMET', 'VECTO', 'SOLAR'];
const token = () => randomBytes(16).toString('hex');
const code = () => randomBytes(4).toString('hex').slice(0, 6).toUpperCase();
const pick = list => list[Math.floor(Math.random() * list.length)];
const json = (res, status, value) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
};
const error = (message, status = 400) => ({ error: message, status });
function makeTasks(room) {
  const players = room.players.filter(p => p.clients.size > 0);
  const count = players.length;
  return Array.from({ length: 3 }, (_, i) => {
    const station = pick(stations);
    const operator = players[((room.round - 1) * 3 + i) % count].id;
    const clue = players[((room.round - 1) * 3 + i + 1) % count].id;
    return { station: station.name, options: station.actions, action: pick(station.actions), operator, clue };
  });
}
function remaining(room) {
  return Math.max(0, Math.ceil((room.deadline - Date.now()) / 1000));
}
function expire(room) {
  if (room.phase === 'playing' && Date.now() >= room.deadline) {
    room.phase = 'lost';
    room.message = 'Time ran out. The ship is lost.';
    broadcast(room);
  }
}
function snapshot(room, player) {
  const task = room.phase === 'playing' ? room.tasks[room.step] : null;
  return {
    code: room.code, phase: room.phase, round: room.round, step: room.step,
    health: room.health, score: room.score, deadline: room.deadline,
    message: room.message, you: { id: player.id, name: player.name, host: room.host === player.id },
    players: room.players.map(p => ({ id: p.id, name: p.name, online: p.clients.size > 0 })),
    task: task ? {
      station: task.station,
      operator: room.players.find(p => p.id === task.operator)?.name,
      clueHolder: room.players.find(p => p.id === task.clue)?.name,
      options: player.id === task.operator ? task.options : null,
      instruction: player.id === task.clue ? task.action : null,
      isOperator: player.id === task.operator,
      isClueHolder: player.id === task.clue,
    } : null,
  };
}
function send(res, data) {
  res.write('data: ' + JSON.stringify(data) + '\n\n');
}
function broadcast(room) {
  for (const player of room.players) {
    const data = snapshot(room, player);
    for (const res of player.clients) {
      try { send(res, data); } catch { player.clients.delete(res); }
    }
  }
}
function auth(body) {
  const room = rooms.get(String(body.code || '').toUpperCase());
  const player = room?.players.find(p => p.id === body.playerId && p.secret === body.secret);
  if (!player) throw error('Room or player session not found. Join again.', 403);
  return { room, player };
}
async function readBody(req) {
  let value = '';
  for await (const chunk of req) {
    value += chunk;
    if (value.length > 4096) throw error('Request is too large.', 413);
  }
  try { return JSON.parse(value || '{}'); } catch { throw error('Invalid request.'); }
}
function start(room) {
  if (room.players.filter(p => p.clients.size > 0).length < 2) throw error('At least 2 connected players are needed.');
  room.phase = 'playing';
  room.round = 1;
  room.step = 0;
  room.health = 3;
  room.score = 0;
  room.tasks = makeTasks(room);
  room.deadline = Date.now() + 90_000;
  room.message = 'Round 1 is live. Talk to your crew!';
  broadcast(room);
}
async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/app.js' || url.pathname === '/style.css')) {
    const filename = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const types = { 'index.html': 'text/html', 'app.js': 'text/javascript', 'style.css': 'text/css' };
    const contents = await readFile(path.join(root, 'public', filename));
    res.writeHead(200, { 'content-type': types[filename] + '; charset=utf-8', 'cache-control': 'no-store' });
    res.end(contents);
    return;
  }
  if (req.method === 'GET' && url.pathname === '/events') {
    const { room, player } = auth(Object.fromEntries(url.searchParams));
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    player.clients.add(res);
    send(res, snapshot(room, player));
    broadcast(room);
    req.on('close', () => { player.clients.delete(res); broadcast(room); });
    return;
  }
  if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
    const body = await readBody(req);
    if (url.pathname === '/api/create') {
      const name = String(body.name || '').trim().slice(0, 18);
      if (!name) throw error('Enter your name.');
      let roomCode;
      do { roomCode = code(); } while (rooms.has(roomCode));
      const player = { id: token(), secret: token(), name, clients: new Set() };
      const room = { code: roomCode, players: [player], host: player.id, phase: 'lobby', round: 0, step: 0, health: 3, score: 0, tasks: [], deadline: 0, message: 'Waiting for the crew.', created: Date.now() };
      rooms.set(roomCode, room);
      json(res, 200, { code: roomCode, playerId: player.id, secret: player.secret });
      return;
    }
    if (url.pathname === '/api/join') {
      const room = rooms.get(String(body.code || '').trim().toUpperCase());
      if (!room) throw error('Room not found. Check the code.');
      if (room.phase !== 'lobby') throw error('This mission has already started.');
      if (room.players.length >= 8) throw error('This room is full.');
      const name = String(body.name || '').trim().slice(0, 18);
      if (!name) throw error('Enter your name.');
      if (room.players.some(p => p.name.toLowerCase() === name.toLowerCase())) throw error('That name is already taken in this room.');
      const player = { id: token(), secret: token(), name, clients: new Set() };
      room.players.push(player);
      broadcast(room);
      json(res, 200, { code: room.code, playerId: player.id, secret: player.secret });
      return;
    }
    const { room, player } = auth(body);
    expire(room);
    if (url.pathname === '/api/state') {
      json(res, 200, snapshot(room, player));
      return;
    }
    if (url.pathname === '/api/leave') {
      if (room.phase === 'playing') throw error('Finish the current mission before leaving.');
      for (const client of player.clients) client.end();
      room.players = room.players.filter(p => p.id !== player.id);
      if (!room.players.length) rooms.delete(room.code);
      else {
        if (room.host === player.id) room.host = room.players[0].id;
        broadcast(room);
      }
      json(res, 200, { ok: true });
      return;
    }
    if (url.pathname === '/api/start') {
      if (room.host !== player.id) throw error('Only the captain can start.');
      if (room.phase !== 'lobby' && room.phase !== 'won' && room.phase !== 'lost') throw error('Mission already in progress.');
      start(room);
      json(res, 200, { ok: true });
      return;
    }
    if (url.pathname === '/api/action') {
      if (room.phase !== 'playing') throw error('The mission is not active.');
      const task = room.tasks[room.step];
      if (task.operator !== player.id) throw error('This control belongs to another player.');
      if (!task.options.includes(body.action)) throw error('Invalid control.');
      if (body.action === task.action) {
        room.score += 100;
        room.step++;
        if (room.step === 3) {
          const bonus = remaining(room) * 2;
          room.score += bonus;
          if (room.round === 3) {
            room.phase = 'won';
            room.message = 'Ship saved! All systems stabilized.';
          } else {
            room.round++;
            room.step = 0;
            room.tasks = makeTasks(room);
            room.deadline = Date.now() + 90_000;
            room.message = 'Systems repaired! +' + bonus + ' time bonus. Round ' + room.round + ' begins.';
          }
        } else {
          room.message = task.station + ' repaired. Next station is ready.';
        }
      } else {
        room.health--;
        room.deadline -= 5000;
        room.message = 'Wrong control! Hull integrity -1, timer -5 seconds.';
        if (room.health <= 0 || remaining(room) <= 0) {
          room.phase = 'lost';
          room.message = 'The ship could not hold together.';
        }
      }
      broadcast(room);
      json(res, 200, { ok: true });
      return;
    }
  }
  throw error('Not found.', 404);
}
const server = http.createServer((req, res) => {
  handle(req, res).catch(e => json(res, e.status || 500, { error: e.status ? e.error : 'Server error.' }));
});
setInterval(() => {
  for (const room of rooms.values()) {
    expire(room);
    if (room.phase === 'playing') broadcast(room);
    if (Date.now() - room.created > 24 * 60 * 60 * 1000 && room.players.every(p => p.clients.size === 0)) rooms.delete(room.code);
  }
}, 1000);
server.listen(port, '0.0.0.0', () => console.log('SYNC OR SINK local server: http://localhost:' + port));
