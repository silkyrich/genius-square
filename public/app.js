// Puzzle Party orchestrator: identity, party lifecycle, lobby (game picker,
// themes, discoverability), round flow and scoring. Gameplay itself lives in
// game modules (public/games/*) behind a tiny shared interface.
import gs from '/games/genius-square.js';
import sudoku from '/games/sudoku.js';
import boggle from '/games/boggle.js';
import pipes from '/games/pipes.js';
import star from '/games/star.js';
import qrcode from '/vendor/qrcode.mjs';

const GAMES = Object.fromEntries([gs, star, sudoku, boggle, pipes].map(m => [m.key, m]));

const THEMES = {
	classic: { label: '🎲 Classic' },
	pokemon: { label: '⚡ Pokémon' },
	tigertea: { label: '🐯 Tiger Tea' },
};

const $ = id => document.getElementById(id);
const playersEl = $('players');

// ---------- theme (light/dark is personal; the skin is the party's) ----------
const themePref = localStorage.getItem('gs-theme')
	|| (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
document.documentElement.dataset.theme = themePref;
$('btn-theme').addEventListener('click', () => {
	const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
	document.documentElement.dataset.theme = next;
	localStorage.setItem('gs-theme', next);
});

// ---------- identity ----------
let me = { name: null, email: null };

async function ensureIdentity() {
	try {
		const d = await (await fetch('/api/me')).json();
		if (d.email) { me.email = d.email; me.name = d.email; }
	} catch {}
	if (!me.name) me.name = localStorage.getItem('gs-name');
	if (!me.name) {
		const modal = $('name-modal');
		modal.showModal();
		await new Promise(res => modal.addEventListener('close', res, { once: true }));
		me.name = $('name-input').value.trim() || 'anonymous';
		localStorage.setItem('gs-name', me.name);
	}
	$('identity').textContent = me.name + (me.email ? '' : ' (guest)');
	$('btn-login').hidden = !!me.email;
}
const signIn = () => location.href = '/login?next=' + encodeURIComponent(location.pathname);
$('btn-login').addEventListener('click', signIn);
$('btn-google').addEventListener('click', signIn);
$('btn-logout').addEventListener('click', () => {
	localStorage.removeItem('gs-name');
	location.href = '/logout';
});

// ---------- party & connection ----------
let ws = null, roomCode = null, myId = null, game = null, players = [];
let kicked = false;

async function enterParty(code) {
	if (code) roomCode = code;
	else {
		const r = await (await fetch('/api/rooms', { method: 'POST' })).json();
		roomCode = r.code;
	}
	history.replaceState(null, '', `/r/${roomCode}`);
	$('landing').hidden = true;
	$('room-strip').hidden = false;
	$('players-panel').hidden = false;
	$('chat-panel').hidden = false;
	$('room-label').textContent = `PARTY ${roomCode}`;
	await ensureIdentity();
	connect();
}

function connect() {
	const proto = location.protocol === 'https:' ? 'wss' : 'ws';
	ws = new WebSocket(`${proto}://${location.host}/ws/${roomCode}?name=${encodeURIComponent(me.name)}`);
	ws.addEventListener('message', ev => {
		const m = JSON.parse(ev.data);
		if (m.t === 'state') { myId = m.you; applyState(m.game, m.players); }
		if (m.t === 'kicked') {
			kicked = true;
			ws.close();
			$('room-label').textContent = m.reason;
		}
	});
	ws.addEventListener('close', () => {
		if (!kicked) setTimeout(connect, 1500);	// auto-reconnect
	});
}
const send = msg => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); };

// ---------- share ----------
const roomUrl = () => `${location.origin}/r/${roomCode}`;
$('btn-share').addEventListener('click', async () => {
	const data = { title: 'Puzzle Party', text: `Join my Puzzle Party — code ${roomCode}`, url: roomUrl() };
	if (navigator.share) { try { await navigator.share(data); } catch {} }
	else {
		await navigator.clipboard.writeText(roomUrl());
		$('btn-share').textContent = 'Copied!';
		setTimeout(() => $('btn-share').textContent = 'Share party', 1500);
	}
});
$('btn-qr').addEventListener('click', () => {
	const qr = qrcode(0, 'M');
	qr.addData(roomUrl());
	qr.make();
	$('qr-box').innerHTML = qr.createSvgTag({ cellSize: 8, margin: 4, scalable: true });
	$('qr-link').textContent = roomUrl();
	$('qr-modal').showModal();
});

// ---------- lobby: game picker + options ----------
let pickedGame = localStorage.getItem('gs-game') || 'gs';

function renderGameCards() {
	const wrap = $('game-cards');
	wrap.innerHTML = '';
	for (const mod of Object.values(GAMES)) {
		const card = document.createElement('button');
		card.type = 'button';
		card.className = 'game-card' + (mod.key === pickedGame ? ' picked' : '');
		card.innerHTML = `<span class="gc-icon">${mod.icon}</span><b>${mod.name}</b><small>${mod.blurb}</small>`;
		card.addEventListener('click', () => {
			pickedGame = mod.key;
			localStorage.setItem('gs-game', mod.key);
			renderGameCards();
		});
		wrap.appendChild(card);
	}
	renderGameOptions();
}

function renderGameOptions() {
	const mod = GAMES[pickedGame];
	const box = $('game-options');
	box.innerHTML = '';
	for (const def of mod.optionDefs || []) {
		const label = document.createElement('label');
		label.className = 'opt-' + def.type;
		if (def.type === 'select') {
			label.textContent = def.label + ' ';
			const sel = document.createElement('select');
			sel.dataset.opt = def.key;
			for (const c of def.choices) {
				const o = document.createElement('option');
				o.value = c.value; o.textContent = c.label;
				sel.appendChild(o);
			}
			sel.value = def.default;
			label.appendChild(sel);
		} else {	// toggle
			const cb = document.createElement('input');
			cb.type = 'checkbox';
			cb.dataset.opt = def.key;
			cb.checked = !!def.default;
			label.append(cb, ' ' + def.label);
		}
		box.appendChild(label);
	}
}

function readOptions() {
	const out = {};
	for (const el of $('game-options').querySelectorAll('[data-opt]'))
		out[el.dataset.opt] = el.type === 'checkbox' ? el.checked : el.value;
	return out;
}

$('btn-propose').addEventListener('click', async () => {
	const mod = GAMES[pickedGame];
	$('btn-propose').disabled = true;
	try {
		const payload = await mod.createPuzzle(readOptions());
		send({ t: 'propose', puzzle: {
			game: mod.key,
			summary: payload.summary,
			scoreMode: mod.scoreMode,
			durationMs: payload.duration || mod.durationMs || 0,
			payload,
		} });
	} finally {
		$('btn-propose').disabled = false;
	}
});
$('btn-agree').addEventListener('click', () => send({ t: 'agree' }));
$('btn-force').addEventListener('click', () => send({ t: 'start' }));
$('btn-end-round').addEventListener('click', () => send({ t: 'endRound' }));
$('btn-clear-room').addEventListener('click', () => send({ t: 'clearRound' }));
$('btn-reset-scores').addEventListener('click', () => {
	if (confirm('Reset all scores to zero?')) send({ t: 'resetScores' });
});

// party settings (master)
{
	const sel = $('theme-select');
	for (const [key, t] of Object.entries(THEMES)) {
		const o = document.createElement('option');
		o.value = key; o.textContent = t.label;
		sel.appendChild(o);
	}
	sel.addEventListener('change', () => send({ t: 'theme', key: sel.value }));
	$('public-toggle').addEventListener('change', ev => send({ t: 'visibility', public: ev.target.checked }));
}

// ---------- round lifecycle ----------
let handle = null;			// mounted game module instance
let startTime = 0, timerHandle = 0, finishedLocal = false;
let lastPhase = null, lastRound = 0;

function setStatus(text, tone = '') {
	const el = $('game-status');
	el.textContent = text || '';
	el.className = tone;
}

function startRoundUI(g) {
	finishedLocal = false;
	const mod = GAMES[g.puzzle.game];
	$('game-root').innerHTML = '';
	setStatus('');
	$('round-game-label').textContent = g.puzzle.summary || mod?.name || g.puzzle.game;
	startTime = performance.now();
	clearInterval(timerHandle);

	const points = g.puzzle.scoreMode === 'points';
	const deadline = startTime + (g.puzzle.durationMs || mod?.durationMs || 0);
	timerHandle = setInterval(() => {
		if (points) {
			const left = Math.max(0, deadline - performance.now());
			$('timer').textContent = (left / 1000).toFixed(0) + 's';
			if (left <= 0 && !finishedLocal) {
				finishedLocal = true;
				clearInterval(timerHandle);
				const result = handle?.endRound?.() || { points: 0 };
				send({ t: 'finish', points: result.points });
				setStatus(`time! ${result.points} pts`, 'won');
			}
		} else if (!finishedLocal) {
			$('timer').textContent = ((performance.now() - startTime) / 1000).toFixed(1) + 's';
		}
	}, 100);
	$('timer').textContent = points ? ((g.puzzle.durationMs || 0) / 1000).toFixed(0) + 's' : '0.0s';

	if (!mod) { setStatus(`unknown game "${g.puzzle.game}" — update your app?`, 'bad'); return; }
	handle = mod.mount($('game-root'), {
		payload: g.puzzle.payload,
		options: {},
		finish() {
			if (finishedLocal) return;
			finishedLocal = true;
			clearInterval(timerHandle);
			send({ t: 'finish', ms: Math.round(performance.now() - startTime) });
			celebrate();
		},
		progress(blob) { send({ t: 'progress', data: blob }); },
		setStatus,
		sendStuck(stuck) { send({ t: 'stuck', stuck: !!stuck }); },
	});
}

function endRoundUI() {
	clearInterval(timerHandle);
	handle?.destroy?.();
	handle = null;
	$('game-root').innerHTML = '';
}

// ---------- celebration ----------
function celebrate() {
	const root = $('game-root');
	root.classList.add('board-pop');
	root.addEventListener('animationend', () => root.classList.remove('board-pop'), { once: true });
	const colors = ['#2563eb', '#9a3412', '#f59e0b', '#16a34a', '#9333ea', '#0ea5e9', '#dc2626', '#eab308'];
	const burst = document.createElement('div');
	burst.id = 'confetti';
	for (let k = 0; k < 90; k++) {
		const d = document.createElement('i');
		d.style.setProperty('--dx', ((Math.random() * 2 - 1) * 55).toFixed(1) + 'vw');
		d.style.setProperty('--up', (25 + Math.random() * 60).toFixed(1) + 'vh');
		d.style.setProperty('--rot', ((Math.random() * 2 - 1) * 900).toFixed(0) + 'deg');
		d.style.setProperty('--t', (1.7 + Math.random() * 1.3).toFixed(2) + 's');
		d.style.background = colors[k % colors.length];
		d.style.left = (50 + (Math.random() * 2 - 1) * 12).toFixed(1) + '%';
		burst.appendChild(d);
	}
	document.body.appendChild(burst);
	setTimeout(() => burst.remove(), 3200);
}

// ---------- server state -> UI ----------
function applyState(g, ps) {
	game = g; players = ps;
	const isMaster = g.master === me.name;
	const inLobby = g.phase === 'lobby', proposed = g.phase === 'proposed', playing = g.phase === 'playing';

	document.documentElement.dataset.skin = g.theme || 'classic';

	// round transitions
	if (playing && (lastPhase !== 'playing' || g.round !== lastRound)) startRoundUI(g);
	if (!playing && lastPhase === 'playing') {
		endRoundUI();
		// celebrate a points-mode win when the podium lands
		if (g.lastResult?.winner === me.name && g.lastResult.order[0]?.points != null) celebrate();
	}
	lastPhase = g.phase; lastRound = g.round;

	$('play-area').hidden = !playing;
	$('lobby').hidden = playing;
	$('lobby-title').textContent = proposed ? `Round ${g.round + 1}` :
		(g.round === 0 ? 'New party' : `Round ${g.round} finished`);
	$('master-controls').hidden = !(inLobby && isMaster);
	$('party-settings').hidden = !isMaster;
	if (isMaster) {
		$('theme-select').value = g.theme || 'classic';
		$('public-toggle').checked = !!g.isPublic;
	}
	if (inLobby && isMaster && !$('game-cards').childElementCount) renderGameCards();
	if (inLobby && !isMaster)
		$('lobby-title').textContent += ` — waiting for ${g.master} to pick a game`;

	// proposal / agreement
	$('proposal-card').hidden = !proposed;
	if (proposed) {
		const mod = GAMES[g.proposal.game];
		$('proposal-text').textContent = `${g.master} proposes: ${mod?.icon || ''} ${g.proposal.summary}`;
		$('btn-agree').hidden = g.agreed.includes(me.name);
		$('btn-force').hidden = !isMaster;
		$('agreed-list').textContent = `ready: ${g.agreed.join(', ')} (${g.agreed.length}/${[...new Set(ps.map(p => p.name))].length})`;
	}

	// winner banner
	const banner = $('banner');
	if (inLobby && g.lastResult && g.lastResult.winner) {
		const mod = GAMES[g.lastResult.game];
		banner.hidden = false;
		banner.textContent = `🏆 ${g.lastResult.winner} wins round ${g.lastResult.round}${mod ? ` (${mod.name})` : ''}! ` +
			g.lastResult.order.map(o =>
				`${o.name} ${o.ms != null ? (o.ms / 1000).toFixed(1) + 's' : (o.points || 0) + ' pts'} +${o.awarded ?? 0}`).join(' · ');
	} else banner.hidden = true;

	// scores & players
	$('round-label').textContent = g.round ? `round ${g.round}` : '';
	$('master-room-controls').hidden = !isMaster;
	$('btn-end-round').hidden = !playing;
	renderPlayers(g, ps);
	renderChat(g.chat);
}

function renderPlayers(g, ps) {
	playersEl.innerHTML = '';
	const mod = g.puzzle ? GAMES[g.puzzle.game] : null;
	const sorted = [...ps].sort((a, b) => (g.scores[b.name] || 0) - (g.scores[a.name] || 0));
	for (const p of sorted) {
		const el = document.createElement('div');
		el.className = 'player';
		const mini = document.createElement('div');
		mini.className = 'pmini';
		if (mod) mod.renderMini(mini, p.progress, g.puzzle.payload);
		const name = document.createElement('span');
		name.className = 'pname';
		name.textContent = p.name + (p.id === myId ? ' (you)' : '');
		const crown = document.createElement('span');
		crown.className = 'crown';
		crown.textContent = p.name === g.master ? '👑' : '';
		// Stuck flag: shown on OTHER players only — half the fun is knowing
		// they're at a dead end when they might not know it themselves.
		const stuck = document.createElement('span');
		stuck.className = 'stuck-badge';
		if (g.phase === 'playing' && p.stuck && p.id !== myId && p.finishedMs == null) {
			stuck.textContent = '🚧 dead end';
			el.classList.add('stuck');
		}
		const time = document.createElement('span');
		time.className = 'ptime';
		time.textContent = p.finishedMs != null ? (p.finishedMs / 1000).toFixed(1) + 's'
			: p.finishedPts != null ? p.finishedPts + ' pts' : '';
		const pts = document.createElement('span');
		pts.className = 'pts';
		pts.textContent = g.scores[p.name] ?? 0;
		el.append(mini, name, crown, stuck, time, pts);
		playersEl.appendChild(el);
	}
}

// ---------- chat ----------
$('chat-form').addEventListener('submit', ev => {
	ev.preventDefault();
	const text = $('chat-input').value.trim();
	if (!text) return;
	send({ t: 'chat', text });
	$('chat-input').value = '';
});

let lastChatLen = -1;
function renderChat(chat = []) {
	if (chat.length === lastChatLen) return;
	lastChatLen = chat.length;
	const box = $('chat-log');
	box.innerHTML = '';
	for (const m of chat) {
		const row = document.createElement('div');
		row.className = 'chat-msg' + (m.name === me.name ? ' mine' : '');
		const who = document.createElement('b');
		who.textContent = m.name;
		row.append(who, document.createTextNode(' ' + m.text));
		box.appendChild(row);
	}
	box.scrollTop = box.scrollHeight;
}

// ---------- public parties on the landing page ----------
let partiesTimer = 0;
async function refreshParties() {
	if ($('landing').hidden) { clearInterval(partiesTimer); return; }
	try {
		const list = await (await fetch('/api/parties')).json();
		const box = $('public-parties');
		box.innerHTML = '';
		$('parties-head').hidden = !list.length;
		for (const p of list) {
			const mod = GAMES[p.game];
			const card = document.createElement('button');
			card.type = 'button';
			card.className = 'party-card';
			card.innerHTML = `<b>${THEMES[p.theme]?.label?.split(' ')[0] || '🎲'} ${p.code}</b>
				<span>${p.host || 'someone'} · ${p.players} player${p.players === 1 ? '' : 's'}</span>
				<small>${p.phase === 'playing' ? `playing ${mod?.name || p.game}` : 'in the lobby'}</small>`;
			card.addEventListener('click', () => enterParty(p.code));
			box.appendChild(card);
		}
	} catch {}
}

// ---------- go ----------
$('btn-start').addEventListener('click', () => enterParty());
$('btn-join').addEventListener('click', () => {
	const code = $('join-code').value.trim().toUpperCase();
	if (/^[A-Z]{4}$/.test(code)) enterParty(code);
});

const urlRoom = location.pathname.match(/^\/r\/([A-Za-z]{4})$/);
if (urlRoom) await enterParty(urlRoom[1].toUpperCase());	// shared link: straight in
else {
	$('landing').hidden = false;			// fresh visit: landing page
	refreshParties();
	partiesTimer = setInterval(refreshParties, 10000);
}
