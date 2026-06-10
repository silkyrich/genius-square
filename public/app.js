import { PIECES, PIECE_INDEX, cellIndex, nameToIndex, solve, countSolutions } from '/solver.js';
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
}
$('btn-logout').addEventListener('click', () => {
	localStorage.removeItem('gs-name');
	if (me.email) location.href = '/cdn-cgi/access/logout';
	else location.reload();
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
	send({ t: 'propose', puzzle: { cells, tier, count, showCount: $('show-count').checked } });
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
	if (selected === null || hoverCell < 0 || placed.has(selected)) return null;
	const orients = PIECES[PIECE_INDEX[selected]].orients;
	const orient = orients[orientIdx % orients.length];
	const r = Math.floor(hoverCell / 6), c = hoverCell % 6;
	return orient.map(([dr, dc]) => (r + dr < 6 && c + dc < 6) ? cellIndex(r + dr, c + dc) : -1);
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
	renderTray();
}

function renderTray() {
	trayEl.innerHTML = '';
	for (const piece of PIECES) {
		const orients = piece.orients;
		const orient = orients[piece.key === selected ? orientIdx % orients.length : 0];
		const maxR = Math.max(...orient.map(o => o[0])), maxC = Math.max(...orient.map(o => o[1]));
		const el = document.createElement('div');
		el.className = 'tray-piece' + (piece.key === selected ? ' selected' : '') + (placed.has(piece.key) ? ' placed' : '');
		el.style.gridTemplateColumns = `repeat(${maxC + 1}, 15px)`;
		for (let r = 0; r <= maxR; r++)
			for (let c = 0; c <= maxC; c++) {
				const d = document.createElement('div');
				d.className = 'pc';
				d.style.background = orient.some(([dr, dc]) => dr === r && dc === c) ? piece.color : 'transparent';
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
	if (onPiece) {					// pick a placed piece back up
		placed.delete(onPiece);
		send({ t: 'remove', piece: onPiece });
		finishedLocal = false;
		afterChange();
		return;
	}
	if (ev.pointerType === 'touch') {
		// two-tap on touch: first tap previews, second tap on same cell places
		hoverCell = i;
		if (armedCell === i && ghostValid(ghostCells())) placeSelected();
		else { armedCell = i; renderGhost(); }
		return;
	}
	if (ghostValid(ghostCells())) placeSelected();	// mouse: hover already previews
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

function afterChange() {
	renderBoard(); renderGhost();
	const ind = $('solvable-indicator');
	const covered = [...placed.values()].flat().length + blockers.length === 36;
	if (covered && !finishedLocal) {
		finishedLocal = true;
		clearInterval(timerHandle);
		ind.className = 'won';
		send({ t: 'finish', ms: Math.round(performance.now() - startTime) });
		return;
	}
	if (!finishedLocal)
		ind.className = solve(blockers, Object.fromEntries(placed)) ? 'ok' : 'dead';
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
		startTime = performance.now();
		clearInterval(timerHandle);
		timerHandle = setInterval(() =>
			$('timer').textContent = ((performance.now() - startTime) / 1000).toFixed(1) + 's', 100);
		$('solvable-indicator').className = '';
		$('timer').textContent = '0.0s';
		const hint = g.puzzle.showCount ? ` — ${g.puzzle.count.toLocaleString()} solutions` : '';
		$('difficulty-label').textContent = `${tierLabel(g.puzzle.tier)}${hint}`;
		renderBoard(); renderGhost();
	}
	if (!playing) clearInterval(timerHandle);
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
		const hint = g.proposal.showCount ? ` (${g.proposal.count.toLocaleString()} solutions)` : '';
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
		const time = document.createElement('span');
		time.className = 'ptime';
		time.textContent = p.finishedMs != null ? (p.finishedMs / 1000).toFixed(1) + 's' : '';
		const pts = document.createElement('span');
		pts.className = 'pts';
		pts.textContent = g.scores[p.name] ?? 0;
		el.append(mini, name, crown, time, pts);
		playersEl.appendChild(el);
	}
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
