import { PIECES, PIECE_INDEX, cellIndex, nameToIndex, solve, countSolutions, enumerateSolutions } from '/solver.js';
import qrcode from '/vendor/qrcode.mjs';

const $ = id => document.getElementById(id);
const boardEl = $('board'), trayEl = $('tray'), playersEl = $('players');

// ---------- theme ----------
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

// ---------- room & connection ----------
let ws = null, roomCode = null, myId = null, game = null, players = [];
let kicked = false;

async function enterRoom(code) {
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
	$('room-label').textContent = `ROOM ${roomCode}`;
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
	const data = { title: 'Genius Square', text: `Race me at Genius Square — room ${roomCode}`, url: roomUrl() };
	if (navigator.share) { try { await navigator.share(data); } catch {} }
	else {
		await navigator.clipboard.writeText(roomUrl());
		$('btn-share').textContent = 'Copied!';
		setTimeout(() => $('btn-share').textContent = 'Share room', 1500);
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

// ---------- puzzles & difficulty ----------
let puzzleData = null;
fetch('/data/puzzles.json').then(r => r.json()).then(d => {
	puzzleData = d;
	const sel = $('tier-select');
	sel.innerHTML = '';
	for (const t of d.tiers) {
		const o = document.createElement('option');
		o.value = t.key;
		o.textContent = `${t.label} (${t.min === 1 && t.max === 1 ? 'one solution' : t.max ? `${t.min}–${t.max} solutions` : `${t.min}+ solutions`})`;
		sel.appendChild(o);
	}
	sel.value = 'medium';
});

$('btn-propose').addEventListener('click', () => {
	if (!puzzleData) return;
	const tier = $('tier-select').value;
	const bank = puzzleData.banks[tier];
	const cells = bank[Math.floor(Math.random() * bank.length)].split(' ').map(nameToIndex);
	const count = countSolutions(cells, 25000);
	send({ t: 'propose', puzzle: {
		cells, tier, count,
		showCount: $('show-count').checked,
		showDead: $('show-deadend').checked,
		explore: $('explore-mode').checked,
	} });
});
$('btn-agree').addEventListener('click', () => send({ t: 'agree' }));
$('btn-force').addEventListener('click', () => send({ t: 'start' }));
$('btn-end-round').addEventListener('click', () => send({ t: 'endRound' }));
$('btn-clear-room').addEventListener('click', () => send({ t: 'clearRound' }));
$('btn-reset-scores').addEventListener('click', () => {
	if (confirm('Reset all scores to zero?')) send({ t: 'resetScores' });
});

// ---------- local play state ----------
let blockers = [];
let placed = new Map();
let selected = null, orientIdx = 0, hoverCell = -1, armedCell = -1;
let startTime = 0, timerHandle = 0, finishedLocal = false;
let lastPhase = null;
// solution-space explorer
let exploreSols = [], exploreIdx = 0, exploreTimer = 0, autoCompleting = false;
const EXPLORE_CAP = 256;

const tierLabel = key => puzzleData?.tiers.find(t => t.key === key)?.label || key;

// ---------- board ----------
const cellEls = [];
for (let i = 0; i < 36; i++) {
	const el = document.createElement('div');
	el.className = 'cell';
	el.addEventListener('pointerdown', ev => onCellPointer(i, ev), { passive: true });
	el.addEventListener('mouseenter', () => { hoverCell = i; renderGhost(); });
	el.addEventListener('mouseleave', () => { if (armedCell < 0) { hoverCell = -1; renderGhost(); } });
	boardEl.appendChild(el);
	cellEls.push(el);
}

const pieceAt = cell => {
	for (const [key, cells] of placed) if (cells.includes(cell)) return key;
	return null;
};

function ghostCells() {
	// Anchor the piece around the touched cell (not its top-left corner) and
	// clamp inside the board, so a tap lands the piece under your finger and
	// edge taps still produce an in-board preview.
	if (selected === null || hoverCell < 0 || placed.has(selected)) return null;
	const orients = PIECES[PIECE_INDEX[selected]].orients;
	const orient = orients[orientIdx % orients.length];
	const maxR = Math.max(...orient.map(o => o[0])), maxC = Math.max(...orient.map(o => o[1]));
	let r = Math.floor(hoverCell / 6) - (maxR >> 1), c = hoverCell % 6 - (maxC >> 1);
	r = Math.max(0, Math.min(5 - maxR, r));
	c = Math.max(0, Math.min(5 - maxC, c));
	return orient.map(([dr, dc]) => cellIndex(r + dr, c + dc));
}
const ghostValid = cells =>
	cells && cells.every(i => i >= 0 && !blockers.includes(i) && !pieceAt(i));

function renderGhost() {
	cellEls.forEach(el => el.classList.remove('ghost-ok', 'ghost-bad'));
	const cells = ghostCells();
	if (!cells) return;
	const valid = ghostValid(cells);
	for (const i of cells) if (i >= 0) cellEls[i].classList.add(valid ? 'ghost-ok' : 'ghost-bad');
}

function renderBoard() {
	for (let i = 0; i < 36; i++) {
		const el = cellEls[i];
		el.classList.toggle('blocker', blockers.includes(i));
		const key = pieceAt(i);
		el.style.background = key ? PIECES[PIECE_INDEX[key]].color : '';
	}
	renderExploreOverlay();
	renderTray();
}

// ---------- solution-space explorer ----------
// The board cycles through the solutions that are still possible, drawn as
// translucent piece colors on the empty cells. Placing a piece narrows the
// space; at exactly one remaining solution the board finishes itself.
function exploreActive() {
	return game?.phase === 'playing' && game.puzzle?.explore && !finishedLocal;
}

function renderExploreOverlay() {
	if (!exploreActive() || !exploreSols.length) return;
	const sol = exploreSols[exploreIdx % exploreSols.length];
	for (const [key, cells] of Object.entries(sol)) {
		if (placed.has(key)) continue;
		for (const i of cells)
			if (!blockers.includes(i) && !pieceAt(i))
				cellEls[i].style.background = PIECES[PIECE_INDEX[key]].color + '55';
	}
}

function updateExplore() {
	if (!exploreActive()) return;
	exploreSols = enumerateSolutions(blockers, Object.fromEntries(placed), EXPLORE_CAP);
	exploreIdx = 0;
	const n = exploreSols.length;
	$('difficulty-label').textContent =
		`${tierLabel(game.puzzle.tier)} — exploring ${n}${n >= EXPLORE_CAP ? '+' : ''} solution${n === 1 ? '' : 's'}`;
	if (n === 1 && placed.size > 0 && !autoCompleting) autoComplete(exploreSols[0]);
}

function autoComplete(sol) {
	autoCompleting = true;
	const rest = Object.entries(sol).filter(([key]) => !placed.has(key));
	const step = () => {
		if (game?.phase !== 'playing' || finishedLocal) { autoCompleting = false; return; }
		const next = rest.shift();
		if (!next) { autoCompleting = false; return; }
		const [key, cells] = next;
		placed.set(key, cells);
		send({ t: 'place', piece: key, cells });
		selected = null; armedCell = -1;
		afterChange();
		setTimeout(step, 280);
	};
	step();
}

function renderTray() {
	// Every piece sits in a fixed 4x4 box so rotating never resizes a tile
	// or reflows the tray — the piece just spins in place, centered.
	trayEl.innerHTML = '';
	for (const piece of PIECES) {
		const orients = piece.orients;
		const orient = orients[piece.key === selected ? orientIdx % orients.length : 0];
		const maxR = Math.max(...orient.map(o => o[0])), maxC = Math.max(...orient.map(o => o[1]));
		const offR = Math.floor((4 - (maxR + 1)) / 2), offC = Math.floor((4 - (maxC + 1)) / 2);
		const el = document.createElement('div');
		el.className = 'tray-piece' + (piece.key === selected ? ' selected' : '') + (placed.has(piece.key) ? ' placed' : '');
		for (let r = 0; r < 4; r++)
			for (let c = 0; c < 4; c++) {
				const d = document.createElement('div');
				d.className = 'pc';
				d.style.background = orient.some(([dr, dc]) => dr + offR === r && dc + offC === c) ? piece.color : 'transparent';
				el.appendChild(d);
			}
		el.addEventListener('click', () => {
			if (placed.has(piece.key)) return;
			if (selected === piece.key) orientIdx++;	// tap again = rotate
			else { selected = piece.key; orientIdx = 0; }
			armedCell = -1;
			renderTray(); renderGhost();
		});
		trayEl.appendChild(el);
	}
}

function rotate() { orientIdx++; renderTray(); renderGhost(); }
$('btn-rotate').addEventListener('click', rotate);
document.addEventListener('keydown', e => {
	if (e.key === 'r' || e.key === 'R' || e.key === 'f' || e.key === 'F') rotate();
});

function onCellPointer(i, ev) {
	if (game?.phase !== 'playing' || finishedLocal) return;
	const onPiece = pieceAt(i);
	const haveSelection = selected !== null && !placed.has(selected);

	// Nothing selected: tapping a placed piece picks it up (and re-selects it
	// in its current orientation, ready to move).
	if (!haveSelection) {
		if (onPiece) pickUp(onPiece);
		return;
	}

	hoverCell = i;
	if (ev.pointerType === 'touch') {
		// Two-tap on touch: first tap previews, second tap on the same cell
		// places. While a piece is selected, a tap never steals a placed
		// piece — except a deliberate second tap on an occupied cell, which
		// means "no, I want THAT one back".
		if (armedCell === i) {
			if (ghostValid(ghostCells())) placeSelected();
			else if (onPiece) pickUp(onPiece);
			return;
		}
		armedCell = i;
		renderGhost();
		return;
	}
	// mouse: hover already previews
	if (ghostValid(ghostCells())) placeSelected();
	else if (onPiece) pickUp(onPiece);
}

function pickUp(key) {
	const cells = placed.get(key);
	placed.delete(key);
	send({ t: 'remove', piece: key });
	finishedLocal = false;
	selected = key;
	orientIdx = orientIndexFor(key, cells);
	armedCell = -1;
	afterChange();
}

// Which orientation index matches an already-placed set of cells?
function orientIndexFor(key, cells) {
	const r0 = Math.min(...cells.map(c => Math.floor(c / 6)));
	const c0 = Math.min(...cells.map(c => c % 6));
	const got = new Set(cells.map(c => (Math.floor(c / 6) - r0) * 6 + (c % 6 - c0)));
	const orients = PIECES[PIECE_INDEX[key]].orients;
	for (let k = 0; k < orients.length; k++) {
		const minR = Math.min(...orients[k].map(o => o[0]));
		const minC = Math.min(...orients[k].map(o => o[1]));
		if (orients[k].every(([dr, dc]) => got.has((dr - minR) * 6 + (dc - minC)))) return k;
	}
	return 0;
}

function placeSelected() {
	const cells = ghostCells();
	placed.set(selected, cells);
	send({ t: 'place', piece: selected, cells });
	selected = null; armedCell = -1;
	afterChange();
}

$('btn-clear').addEventListener('click', () => {
	placed.clear(); finishedLocal = false;
	send({ t: 'clear' });
	afterChange();
});

let lastStuckSent = false;

function afterChange() {
	updateExplore();
	renderBoard(); renderGhost();
	const ind = $('solvable-indicator');
	const covered = [...placed.values()].flat().length + blockers.length === 36;
	if (covered && !finishedLocal) {
		finishedLocal = true;
		clearInterval(timerHandle);
		ind.className = 'won';
		send({ t: 'finish', ms: Math.round(performance.now() - startTime) });
		celebrate();
		return;
	}
	if (!finishedLocal) {
		// Always compute solvability and tell the room when we're stuck —
		// opponents get to enjoy that. Whether WE get warned is the puzzle
		// master's call (showDead), because the warning is a big hint.
		const solvable = !!solve(blockers, Object.fromEntries(placed));
		ind.className = game?.puzzle?.showDead === false ? '' : (solvable ? 'ok' : 'dead');
		if (!solvable !== lastStuckSent) {
			lastStuckSent = !solvable;
			send({ t: 'stuck', stuck: !solvable });
		}
	}
}

// ---------- celebration ----------
function celebrate() {
	boardEl.classList.add('board-pop');
	boardEl.addEventListener('animationend', () => boardEl.classList.remove('board-pop'), { once: true });
	const burst = document.createElement('div');
	burst.id = 'confetti';
	for (let k = 0; k < 90; k++) {
		const d = document.createElement('i');
		d.style.setProperty('--dx', ((Math.random() * 2 - 1) * 55).toFixed(1) + 'vw');
		d.style.setProperty('--up', (25 + Math.random() * 60).toFixed(1) + 'vh');
		d.style.setProperty('--rot', ((Math.random() * 2 - 1) * 900).toFixed(0) + 'deg');
		d.style.setProperty('--t', (1.7 + Math.random() * 1.3).toFixed(2) + 's');
		d.style.background = PIECES[k % PIECES.length].color;
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

	// round transitions
	if (playing && lastPhase !== 'playing') {
		blockers = g.puzzle.cells;
		placed = new Map(); selected = null; armedCell = -1; finishedLocal = false;
		lastStuckSent = false; autoCompleting = false;
		startTime = performance.now();
		clearInterval(timerHandle);
		timerHandle = setInterval(() =>
			$('timer').textContent = ((performance.now() - startTime) / 1000).toFixed(1) + 's', 100);
		$('solvable-indicator').className = '';
		$('timer').textContent = '0.0s';
		const hint = g.puzzle.showCount ? ` — ${g.puzzle.count.toLocaleString()} solutions` : '';
		$('difficulty-label').textContent = `${tierLabel(g.puzzle.tier)}${hint}`;
		updateExplore();
		renderBoard(); renderGhost();
		clearInterval(exploreTimer);
		if (g.puzzle.explore)
			exploreTimer = setInterval(() => {
				if (!exploreActive() || exploreSols.length < 2) return;
				exploreIdx++;
				renderBoard(); renderGhost();
			}, 700);
	}
	if (!playing) { clearInterval(timerHandle); clearInterval(exploreTimer); }
	lastPhase = g.phase;

	$('play-area').hidden = !playing;
	$('lobby').hidden = playing;
	$('lobby-title').textContent = proposed ? `Round ${g.round + 1}` :
		(g.round === 0 ? 'New game' : `Round ${g.round} finished`);
	$('master-controls').hidden = !(inLobby && isMaster);
	if (inLobby && !isMaster)
		$('lobby-title').textContent += ` — waiting for ${g.master} to set the puzzle`;

	// proposal / agreement
	$('proposal-card').hidden = !proposed;
	if (proposed) {
		const bits = [];
		if (g.proposal.showCount) bits.push(`${g.proposal.count.toLocaleString()} solutions`);
		if (g.proposal.explore) bits.push('explorer mode');
		if (g.proposal.showDead === false) bits.push('no dead-end warnings — good luck');
		const hint = bits.length ? ` (${bits.join(', ')})` : '';
		$('proposal-text').textContent = `${g.master} proposes: ${tierLabel(g.proposal.tier)}${hint}`;
		$('btn-agree').hidden = g.agreed.includes(me.name);
		$('btn-force').hidden = !isMaster;
		$('agreed-list').textContent = `ready: ${g.agreed.join(', ')} (${g.agreed.length}/${[...new Set(ps.map(p => p.name))].length})`;
	}

	// winner banner
	const banner = $('banner');
	if (inLobby && g.lastResult && g.lastResult.winner) {
		banner.hidden = false;
		banner.textContent = `🏆 ${g.lastResult.winner} wins round ${g.lastResult.round}! ` +
			g.lastResult.order.map(o => `${o.name} ${(o.ms / 1000).toFixed(1)}s +${o.points}`).join(' · ');
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
	const sorted = [...ps].sort((a, b) => (g.scores[b.name] || 0) - (g.scores[a.name] || 0));
	for (const p of sorted) {
		const el = document.createElement('div');
		el.className = 'player';
		const mini = document.createElement('div');
		mini.className = 'mini-board';
		const byCell = {};
		for (const [key, cells] of Object.entries(p.placements || {}))
			for (const c of cells) byCell[c] = PIECES[PIECE_INDEX[key]].color;
		for (let i = 0; i < 36; i++) {
			const d = document.createElement('div');
			d.className = 'mc';
			if (g.puzzle && g.puzzle.cells.includes(i)) d.style.background = '#999';
			else if (byCell[i]) d.style.background = byCell[i];
			mini.appendChild(d);
		}
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
		time.textContent = p.finishedMs != null ? (p.finishedMs / 1000).toFixed(1) + 's' : '';
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

// ---------- go ----------
$('btn-start').addEventListener('click', () => enterRoom());
$('btn-join').addEventListener('click', () => {
	const code = $('join-code').value.trim().toUpperCase();
	if (/^[A-Z]{4}$/.test(code)) enterRoom(code);
});

const urlRoom = location.pathname.match(/^\/r\/([A-Za-z]{4})$/);
if (urlRoom) await enterRoom(urlRoom[1].toUpperCase());	// shared link: straight in
else $('landing').hidden = false;			// fresh visit: landing page
