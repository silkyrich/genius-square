import {
	PIECES, PIECE_INDEX, cellIndex, cellName, nameToIndex,
	solve, countSolutions, rollDice,
} from '/solver.js';

const $ = id => document.getElementById(id);
const boardEl = $('board'), trayEl = $('tray'), playersEl = $('players');

// ---------- state ----------
let blockers = [];			// 7 cell indexes
let placed = new Map();			// pieceKey -> cells[]
let selected = null;			// pieceKey
let orientIdx = 0;
let hoverCell = -1;
let startTime = 0, timerHandle = 0, finishedMs = null;
let ws = null, roomCode = null, myId = null;
let me = { name: 'guest-' + Math.random().toString(36).slice(2, 6) };
let uniqueData = null;

// ---------- identity ----------
fetch('/api/me').then(r => r.json()).then(d => {
	if (d.email) me.name = d.email;
	$('identity').textContent = d.email ? `signed in as ${d.email}` : `playing as ${me.name} (no login)`;
}).catch(() => { $('identity').textContent = `playing as ${me.name}`; });

fetch('/data/unique.json').then(r => r.json()).then(d => { uniqueData = d; });

// ---------- board rendering ----------
const cellEls = [];
for (let i = 0; i < 36; i++) {
	const el = document.createElement('div');
	el.className = 'cell';
	el.dataset.idx = i;
	el.addEventListener('mouseenter', () => { hoverCell = i; renderGhost(); });
	el.addEventListener('mouseleave', () => { hoverCell = -1; renderGhost(); });
	el.addEventListener('click', () => onCellClick(i));
	boardEl.appendChild(el);
	cellEls.push(el);
}

function pieceAt(cell) {
	for (const [key, cells] of placed) if (cells.includes(cell)) return key;
	return null;
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

function ghostCells() {
	if (selected === null || hoverCell < 0 || placed.has(selected)) return null;
	const orient = PIECES[PIECE_INDEX[selected]].orients[orientIdx % PIECES[PIECE_INDEX[selected]].orients.length];
	const r = Math.floor(hoverCell / 6), c = hoverCell % 6;
	const cells = orient.map(([dr, dc]) => (r + dr < 6 && c + dc < 6) ? cellIndex(r + dr, c + dc) : -1);
	return cells;
}

function renderGhost() {
	cellEls.forEach(el => el.classList.remove('ghost-ok', 'ghost-bad'));
	const cells = ghostCells();
	if (!cells) return;
	const valid = cells.every(i => i >= 0 && !blockers.includes(i) && !pieceAt(i));
	for (const i of cells) if (i >= 0) cellEls[i].classList.add(valid ? 'ghost-ok' : 'ghost-bad');
}

// ---------- tray ----------
function renderTray() {
	trayEl.innerHTML = '';
	for (const piece of PIECES) {
		const orient = piece.orients[piece.key === selected ? orientIdx % piece.orients.length : 0];
		const maxR = Math.max(...orient.map(o => o[0])), maxC = Math.max(...orient.map(o => o[1]));
		const el = document.createElement('div');
		el.className = 'tray-piece' + (piece.key === selected ? ' selected' : '') + (placed.has(piece.key) ? ' placed' : '');
		el.style.gridTemplateColumns = `repeat(${maxC + 1}, 16px)`;
		for (let r = 0; r <= maxR; r++)
			for (let c = 0; c <= maxC; c++) {
				const d = document.createElement('div');
				d.className = 'pc';
				d.style.background = orient.some(([dr, dc]) => dr === r && dc === c) ? piece.color : 'transparent';
				el.appendChild(d);
			}
		el.addEventListener('click', () => {
			if (placed.has(piece.key)) return;
			if (selected === piece.key) orientIdx++;	// click again = rotate
			else { selected = piece.key; orientIdx = 0; }
			renderTray(); renderGhost();
		});
		trayEl.appendChild(el);
	}
}

// ---------- interaction ----------
function onCellClick(i) {
	if (finishedMs !== null) return;
	const onPiece = pieceAt(i);
	if (onPiece) {						// pick a piece back up
		placed.delete(onPiece);
		send({ t: 'remove', piece: onPiece });
		afterChange();
		return;
	}
	const cells = ghostCells();
	if (!cells) return;
	if (!cells.every(c => c >= 0 && !blockers.includes(c) && !pieceAt(c))) return;
	placed.set(selected, cells);
	send({ t: 'place', piece: selected, cells });
	selected = null;
	afterChange();
}

document.addEventListener('keydown', e => {
	if (e.key === 'r' || e.key === 'R' || e.key === 'f' || e.key === 'F') {
		orientIdx++; renderTray(); renderGhost();
	}
});

function afterChange() {
	renderBoard(); renderGhost();
	const covered = placed.size && [...placed.values()].flat().length + blockers.length === 36;
	const ind = $('solvable-indicator');
	if (covered) {
		finishedMs = performance.now() - startTime;
		clearInterval(timerHandle);
		ind.className = 'won';
		send({ t: 'finish', ms: Math.round(finishedMs) });
		return;
	}
	// live solvability check: can the remaining pieces still complete the board?
	const fixed = Object.fromEntries(placed);
	ind.className = solve(blockers, fixed) ? 'ok' : 'dead';
}

// ---------- puzzles ----------
function setPuzzle(cells, { broadcast = true } = {}) {
	blockers = cells;
	placed.clear(); selected = null; finishedMs = null;
	startTime = performance.now();
	clearInterval(timerHandle);
	timerHandle = setInterval(() =>
		$('timer').textContent = ((performance.now() - startTime) / 1000).toFixed(1) + 's', 100);
	$('solvable-indicator').className = '';
	const n = countSolutions(blockers, 25000);
	$('difficulty').textContent = `${n.toLocaleString()} solution${n === 1 ? '' : 's'} — blockers: ${blockers.map(cellName).join(' ')}`;
	renderBoard(); renderGhost();
	if (broadcast) send({ t: 'puzzle', blockers: cells });
}

function newPuzzle() {
	const mode = $('difficulty-select').value;
	if (mode === 'dice' || !uniqueData) {
		setPuzzle(rollDice());
	} else if (mode === 'unique') {
		const b = uniqueData.uniqueBoards[Math.floor(Math.random() * uniqueData.uniqueBoards.length)];
		setPuzzle(b.map(nameToIndex));
	} else {	// 'hard': random boards until one with 2..10 solutions (harder than any dice roll)
		for (;;) {
			const cells = [];
			while (cells.length < 7) {
				const c = Math.floor(Math.random() * 36);
				if (!cells.includes(c)) cells.push(c);
			}
			const n = countSolutions(cells, 11);
			if (n >= 2 && n <= 10) { setPuzzle(cells); break; }
		}
	}
}

$('btn-new').addEventListener('click', newPuzzle);
$('btn-clear').addEventListener('click', () => { placed.clear(); send({ t: 'clear' }); afterChange(); });
$('btn-hint').addEventListener('click', () => {
	const sol = solve(blockers, Object.fromEntries(placed));
	if (!sol) { alert('No completion exists from here — pick a piece back up first.'); return; }
	const key = PIECES.map(p => p.key).find(k => !placed.has(k) && sol[k]);
	if (!key) return;
	placed.set(key, sol[key]);
	send({ t: 'place', piece: key, cells: sol[key] });
	afterChange();
});
$('btn-solve').addEventListener('click', () => {
	const sol = solve(blockers);
	if (!sol) return;
	placed = new Map(Object.entries(sol));
	send({ t: 'board', placements: Object.fromEntries(placed) });
	afterChange();
});

// ---------- multiplayer ----------
function send(msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }

function connect(code) {
	const proto = location.protocol === 'https:' ? 'wss' : 'ws';
	ws = new WebSocket(`${proto}://${location.host}/ws/${code}?name=${encodeURIComponent(me.name)}`);
	ws.addEventListener('open', () => {
		roomCode = code;
		$('room-status').textContent = `room ${code}`;
	});
	ws.addEventListener('message', ev => {
		const m = JSON.parse(ev.data);
		if (m.t === 'state') {
			myId = m.you;
			if (m.puzzle && m.puzzle.length) setPuzzle(m.puzzle, { broadcast: false });
			renderPlayers(m.players);
		}
		if (m.t === 'puzzle') setPuzzle(m.blockers, { broadcast: false });
		if (m.t === 'kicked') {
			ws.close();
			$('room-status').textContent = m.reason;
		}
	});
	ws.addEventListener('close', () => { $('room-status').textContent = 'disconnected'; });
}

function renderPlayers(players) {
	playersEl.innerHTML = '';
	for (const p of players) {
		const el = document.createElement('div');
		el.className = 'player';
		const name = document.createElement('div');
		name.className = 'pname';
		name.innerHTML = `<span>${p.name}${p.id === myId ? ' (you)' : ''}</span>` +
			(p.finishedMs != null ? `<span class="ptime">${(p.finishedMs / 1000).toFixed(1)}s</span>` : '');
		const mini = document.createElement('div');
		mini.className = 'mini-board';
		const byCell = {};
		for (const [key, cells] of Object.entries(p.placements || {}))
			for (const c of cells) byCell[c] = PIECES[PIECE_INDEX[key]].color;
		for (let i = 0; i < 36; i++) {
			const d = document.createElement('div');
			d.className = 'mc';
			if (blockers.includes(i)) d.style.background = '#888';
			else if (byCell[i]) d.style.background = byCell[i];
			mini.appendChild(d);
		}
		el.append(name, mini);
		playersEl.appendChild(el);
	}
}

$('btn-create-room').addEventListener('click', async () => {
	const r = await fetch('/api/rooms', { method: 'POST' });
	const { code } = await r.json();
	$('room-code-input').value = code;
	connect(code);
});
$('btn-join-room').addEventListener('click', () => {
	const code = $('room-code-input').value.trim().toUpperCase();
	if (code.length === 4) connect(code);
});

// ---------- go ----------
newPuzzle();
