const app = document.getElementById('app');
let session = null;
let state = null;
let events = null;
let localError = '';
let busy = false;
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const playerName = id => state?.players.find(p => p.id === id)?.name || 'Crewmate';
function save() { localStorage.setItem('sync-or-sink-session', JSON.stringify(session)); }
async function request(route, body) {
  const response = await fetch('/api/' + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Something went wrong.');
  return result;
}
function showError(e) {
  localError = e.message || String(e);
  render();
}
async function connect() {
  if (events) events.close();
  if (!session) return;
  try {
    state = await request('state', session);
    render();
  } catch (e) {
    session = null;
    state = null;
    localStorage.removeItem('sync-or-sink-session');
    localError = 'That room is no longer available. Create a new one.';
    render();
    return;
  }
  const q = new URLSearchParams(session);
  events = new EventSource('/events?' + q);
  events.onmessage = event => { state = JSON.parse(event.data); localError = ''; render(); };
  events.onerror = () => { localError = 'Connection interrupted. Trying to reconnect…'; render(); };
}
function home() {
  app.innerHTML = `<div class="grid">
    <section class="intro"><div class="eyebrow">COOPERATIVE MISSION / 2–8 PLAYERS</div><h1>SYNC<br><span>OR SINK.</span></h1>
      <p>The ship is failing. Your crew has 90 seconds per round to talk, coordinate, and repair it. Each player sees a different piece of the puzzle.</p>
      <div class="tip">One crewmate gets the secret instruction. Another has the controls. Speak up before the clock runs out.</div>
    </section>
    <section class="card" aria-label="Join a game"><div class="card-title">START A MISSION</div>
      <label for="name">YOUR CALLSIGN</label><input id="name" maxlength="18" autocomplete="nickname" placeholder="Enter your name">
      <div style="height:17px"></div><button class="btn primary full" id="create">Create room</button>
      <div class="divider">OR JOIN A CREW</div>
      <label for="code">ROOM CODE</label><div class="join-row"><input id="code" maxlength="6" placeholder="6-LETTER CODE" autocomplete="off"><button class="btn secondary" id="join">Join room</button></div>
      <div class="notice" role="alert">${esc(localError)}</div>
    </section></div>`;
  document.getElementById('create').onclick = () => enter('create');
  document.getElementById('join').onclick = () => enter('join');
}
async function leaveRoom() {
  if (session) {
    try { await request('leave', session); } catch {}
  }
  events?.close();
  events = null;
  session = null;
  state = null;
  localError = '';
  localStorage.removeItem('sync-or-sink-session');
  render();
}
async function enter(kind) {
  if (busy) return;
  const name = document.getElementById('name').value.trim();
  const code = document.getElementById('code').value.trim().toUpperCase();
  if (!name) return showError(new Error('Enter your callsign first.'));
  if (kind === 'join' && code.length !== 6) return showError(new Error('Enter the 6-character room code.'));
  busy = true;
  try {
    session = await request(kind, { name, code });
    save();
    connect();
  } catch (e) { showError(e); }
  busy = false;
}
async function command(route, extra = {}) {
  if (busy) return;
  busy = true;
  try { await request(route, { ...session, ...extra }); }
  catch (e) { showError(e); }
  busy = false;
}
function lobby() {
  app.innerHTML = `<div class="room-layout">
    <section class="card">
      <div class="room-header"><div><div class="eyebrow">MISSION LOBBY</div><h2>Assemble your crew.</h2></div><span class="pill">${state.players.length} / 8 PLAYERS</span></div>
      <div class="room-code"><small>SHARE THIS ROOM CODE</small>${esc(state.code)}</div>
      <div class="crew">${state.players.map(p => `<div class="member"><span class="${p.online?'online':'offline'}">${esc(p.name)}${p.id===state.you.id?' (you)':''}</span></div>`).join('')}</div>
      ${state.you.host ? `<button class="btn primary full" id="start" ${state.players.filter(p => p.online).length<2?'disabled':''}>Launch mission →</button>` : '<div class="waiting">Waiting for the captain to launch the mission.</div>'}
      <button class="btn secondary full" id="leave" style="margin-top:12px">Leave this room</button>
      <div class="notice" role="alert">${esc(localError)}</div>
    </section>
    <aside class="card"><div class="card-title">BRIEFING / HOW TO PLAY</div>
      <p><b>01.</b> Share the code. Everyone joins on their own device.</p>
      <p><b>02.</b> The instruction holder tells the operator which control to press.</p>
      <p><b>03.</b> Finish 3 repairs in each of 3 rounds. Wrong controls damage the ship and cost 5 seconds.</p>
      <div class="tip">You have 3 hull points. Each round has a fresh 90-second timer.</div>
    </aside></div>`;
  document.getElementById('start')?.addEventListener('click', () => command('start'));
  document.getElementById('leave').addEventListener('click', leaveRoom);
}
function game() {
  const task = state.task;
  const seconds = Math.max(0, Math.ceil((state.deadline - Date.now()) / 1000));
  const info = task.isClueHolder
    ? `<div class="secret"><div class="eyebrow">YOUR PRIVATE INSTRUCTION · TELL ${esc(task.operator).toUpperCase()}</div><strong>${esc(task.instruction)}</strong><div>at ${esc(task.station)}</div></div>`
    : task.isOperator
    ? `<div class="controls">${task.options.map(option => `<button class="btn secondary action" data-action="${esc(option)}">${esc(option)}</button>`).join('')}</div><div class="tip" style="margin-top:18px">Ask ${esc(task.clueHolder)} which control to press.</div>`
    : `<div class="waiting">Stand by. ${esc(task.clueHolder)} is guiding ${esc(task.operator)}. Your turn is coming.</div>`;
  app.innerHTML = `<div class="room-layout hud">
    <section class="card">
      <div class="hud-head"><div><div class="eyebrow">MISSION ACTIVE / ROUND ${state.round} OF 3</div><h2>Repair the ship.</h2></div><span class="pill">ROOM ${esc(state.code)}</span></div>
      <div class="metrics"><div class="metric"><span class="micro">TIME LEFT</span><strong class="${seconds<=20?'warning':''}" id="seconds">${seconds}s</strong></div>
      <div class="metric"><span class="micro">HULL</span><strong>${'♥'.repeat(state.health)}<span style="opacity:.25">${'♥'.repeat(3-state.health)}</span></strong></div>
      <div class="metric"><span class="micro">SCORE</span><strong>${state.score}</strong></div></div>
      <div class="micro">REPAIRS IN THIS ROUND</div><div class="steps">${[0,1,2].map(i => `<span class="step ${i<state.step?'done':i===state.step?'current':''}"></span>`).join('')}</div>
      <div class="eyebrow">CURRENT STATION</div><div class="task-title">${esc(task.station)}</div>
      <div class="role"><span>Instruction holder</span><b>${esc(task.clueHolder)}</b></div>
      <div class="role"><span>Control operator</span><b>${esc(task.operator)}</b></div>
      ${info}<div class="status-line">${esc(state.message)}</div>
      <div class="notice" role="alert">${esc(localError)}</div>
    </section>
    <aside class="card"><div class="card-title">CREW CHANNEL</div>
      <p>Talk aloud or use a call with your crew. Private instructions appear only on the assigned player's screen.</p>
      <div class="crew">${state.players.map(p => `<div class="member"><span class="${p.online?'online':'offline'}">${esc(p.name)}${p.id===state.you.id?' (you)':''}</span></div>`).join('')}</div>
      <div class="tip">Each correct repair earns 100 points. Finishing a round adds 2 points for every second left.</div>
    </aside></div>`;
  app.querySelectorAll('.action').forEach(button => button.addEventListener('click', () => {
    app.querySelectorAll('.action').forEach(b => b.disabled = true);
    command('action', { action: button.dataset.action });
  }));
}
function result() {
  const win = state.phase === 'won';
  app.innerHTML = `<div class="result"><div class="symbol">${win?'✧':'⌁'}</div><div class="eyebrow">MISSION ${win?'COMPLETE':'FAILED'} · ROOM ${esc(state.code)}</div>
    <h1>${win?'SHIP SAVED.':'SHIP LOST.'}</h1><p>${esc(state.message)}</p>
    <div class="micro">CREW SCORE</div><div class="score">${state.score}</div>
    <p>${win?'You cleared all three rounds. Ready for another mission?':'Try again with a new sequence of repairs.'}</p>
    ${state.you.host?'<button class="btn primary" id="again">Play again →</button>':'<div class="waiting">Waiting for the captain to start another mission.</div>'}
    <div style="margin-top:12px"><button class="btn secondary" id="leave">Leave this room</button></div>
    <div class="notice" role="alert">${esc(localError)}</div></div>`;
  document.getElementById('again')?.addEventListener('click', () => command('start'));
  document.getElementById('leave').addEventListener('click', leaveRoom);
}
function render() {
  if (!state) return home();
  if (state.phase === 'lobby') return lobby();
  if (state.phase === 'playing') return game();
  return result();
}
try { session = JSON.parse(localStorage.getItem('sync-or-sink-session') || 'null'); } catch {}
render();
if (session) connect();
setInterval(() => {
  if (state?.phase === 'playing') {
    const display = document.getElementById('seconds');
    if (display) display.textContent = Math.max(0, Math.ceil((state.deadline - Date.now()) / 1000)) + 's';
  }
}, 200);
