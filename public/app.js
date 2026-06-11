// Puzzle Party orchestrator: identity, party lifecycle, lobby (game picker,
// themes, discoverability), round flow and scoring. Gameplay itself lives in
// game modules (public/games/*) behind a tiny shared interface.
import gs from '/games/genius-square.js';
import sudoku from '/games/sudoku.js';
import boggle from '/games/boggle.js';
import pipes from '/games/pipes.js';
import lightsout from '/games/lightsout.js';
import star from '/games/star.js';
import mines from '/games/mines.js';
import nonogram from '/games/nonogram.js';
import wordsearch from '/games/wordsearch.js';
import memory from '/games/memory.js';
import trio from '/games/trio.js';
import g2048 from '/games/g2048.js';
import kenken from '/games/kenken.js';
import qrcode from '/vendor/qrcode.mjs';

const GAMES = Object.fromEntries([gs, star, sudoku, kenken, boggle, pipes, nonogram, lightsout, mines, wordsearch, memory, trio, g2048].map(m => [m.key, m]));

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
			$('room-label').textContent = m.reason + ' — taking you home…';
			setTimeout(() => location.href = '/', 1800);
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
$('btn-leave').addEventListener('click', () => location.href = '/');
$('btn-rename').addEventListener('click', () => {
	const name = prompt('Name this party', game?.name || '');
	if (name !== null) send({ t: 'rename', name: name.trim() });
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
	$('master-controls').appendChild($('card-panel'));	// rescue before wipe
	wrap.innerHTML = '';
	let pickedEl = null;
	const locked = new Set(game?.lockedGames || []);
	if (locked.has(pickedGame)) pickedGame = Object.keys(GAMES).find(k => !locked.has(k)) || 'gs';
	for (const mod of Object.values(GAMES)) {
		const card = document.createElement('button');
		card.type = 'button';
		card.className = 'game-card' + (mod.key === pickedGame ? ' picked' : '') + (locked.has(mod.key) ? ' locked' : '');
		card.innerHTML = `<span class="gc-icon">${mod.icon}</span><b>${mod.name}</b><small>${mod.blurb}</small>`;
		card.addEventListener('click', () => {
			if (locked.has(mod.key)) return;
			pickedGame = mod.key;
			localStorage.setItem('gs-game', mod.key);
			renderGameCards();
		});
		// host can lock a game off the shelf for this party
		const lk = document.createElement('span');
		lk.className = 'gc-lock';
		lk.textContent = locked.has(mod.key) ? '🔒' : '🔓';
		lk.title = locked.has(mod.key) ? 'unlock this game' : 'lock this game';
		lk.addEventListener('click', ev => {
			ev.stopPropagation();
			const next = new Set(locked);
			next.has(mod.key) ? next.delete(mod.key) : next.add(mod.key);
			send({ t: 'lockGames', keys: [...next] });
		});
		card.appendChild(lk);
		wrap.appendChild(card);
		if (mod.key === pickedGame) pickedEl = card;
	}
	// options live right under the selected card's row, not at the bottom
	if (pickedEl) pickedEl.insertAdjacentElement('afterend', $('card-panel'));
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
$('btn-add-playlist').addEventListener('click', () => {
	const mod = GAMES[pickedGame];
	if (!mod || (game?.lockedGames || []).includes(mod.key)) return;
	const item = { game: mod.key, options: readOptions(), label: mod.name };
	send({ t: 'playlist', list: [...(game?.playlist || []), item], idx: game?.playlistIdx || 0 });
});

async function proposeFromPlaylist() {
	const item = game?.playlist[game.playlistIdx];
	const mod = item && GAMES[item.game];
	if (!mod) return;
	const payload = await mod.createPuzzle(item.options || {});
	send({ t: 'propose', puzzle: {
		game: mod.key, summary: payload.summary, scoreMode: mod.scoreMode,
		durationMs: payload.duration || mod.durationMs || 0, payload,
		playlistIdx: game.playlistIdx,
	} });
}

function renderPlaylist(g, isMaster) {
	const box = $('playlist-box');
	box.innerHTML = '';
	box.hidden = !g.playlist.length;
	g.playlist.forEach((it, i) => {
		const row = document.createElement('div');
		row.className = 'pl-item' + (i < g.playlistIdx ? ' done' : i === g.playlistIdx ? ' next' : '');
		const mark = document.createElement('span');
		mark.className = 'pl-mark';
		mark.textContent = i < g.playlistIdx ? '✓' : i === g.playlistIdx ? '▶' : String(i + 1);
		const label = document.createElement('span');
		label.className = 'pl-label';
		label.textContent = `${GAMES[it.game]?.icon || ''} ${it.label}`;
		row.append(mark, label);
		if (isMaster) {
			const x = document.createElement('button');
			x.className = 'pl-x';
			x.textContent = '✕';
			x.addEventListener('click', () => send({ t: 'playlist',
				list: g.playlist.filter((_, j) => j !== i),
				idx: g.playlistIdx > i ? g.playlistIdx - 1 : g.playlistIdx }));
			row.appendChild(x);
		}
		box.appendChild(row);
	});
}

let autoNextTimer = 0, autoNextCancelled = false;
function updateNextUp(g, isMaster, inLobby, proposed) {
	const next = inLobby && !proposed ? g.playlist[g.playlistIdx] : null;
	$('next-up').hidden = !next;
	if (!next) { clearInterval(autoNextTimer); autoNextTimer = 0; return; }
	$('next-up-label').textContent = `Next up: ${GAMES[next.game]?.icon || ''} ${next.label}`;
	$('btn-play-next').hidden = !isMaster;
	$('btn-cancel-auto').hidden = !isMaster || !autoNextTimer;
	if (!isMaster) { $('next-up-count').textContent = ''; return; }
	// after the first round the playlist runs itself, with a grace countdown
	if (g.round > 0 && !autoNextTimer && !autoNextCancelled) {
		let left = 6;
		$('next-up-count').textContent = `auto-starting in ${left}s`;
		autoNextTimer = setInterval(() => {
			if (--left <= 0) {
				clearInterval(autoNextTimer); autoNextTimer = 0;
				$('next-up-count').textContent = '';
				proposeFromPlaylist();
			} else $('next-up-count').textContent = `auto-starting in ${left}s`;
		}, 1000);
		$('btn-cancel-auto').hidden = false;
	}
}
$('btn-play-next').addEventListener('click', () => {
	clearInterval(autoNextTimer); autoNextTimer = 0;
	proposeFromPlaylist();
});
$('btn-cancel-auto').addEventListener('click', () => {
	autoNextCancelled = true;
	clearInterval(autoNextTimer); autoNextTimer = 0;
	$('next-up-count').textContent = 'paused — host starts manually';
	$('btn-cancel-auto').hidden = true;
});

$('btn-agree').addEventListener('click', () => send({ t: 'agree' }));
$('btn-force').addEventListener('click', () => send({ t: 'start' }));
$('btn-end-round').addEventListener('click', () => send({ t: 'endRound' }));
$('btn-clear-room').addEventListener('click', () => send({ t: 'clearRound' }));
$('btn-reset-scores').addEventListener('click', () => {
	if (confirm('Reset all scores to zero?')) send({ t: 'resetScores' });
});
$('btn-end-party').addEventListener('click', () => {
	if (!confirm('End the party for everyone? Scores and chat are wiped.')) return;
	localStorage.setItem('gs-parties', JSON.stringify(
		JSON.parse(localStorage.getItem('gs-parties') || '[]').filter(q => q.code !== roomCode)));
	send({ t: 'endParty' });
});

// party settings (master)
$('public-toggle').addEventListener('change', ev => send({ t: 'visibility', public: ev.target.checked }));

// ---------- how to play ----------
const HELP = {
	gs: 'Fit all nine pieces around the pearl blockers. Tap a piece to pick it up (tap it again, right-click, or hit ⟳/R to rotate), tap the board to preview, tap the same spot to confirm. Tap a placed piece to take it back. First to fill every cell wins.',
	star: 'Same idea, but triangles: tile the whole star around the seven pearls with all 11 pieces. Tap a piece, tap again (or right-click / ⟳) to rotate, two-tap the board to place. First to fill the star wins.',
	sudoku: 'Every row, column and 3×3 box must contain 1–9 exactly once. Tap a cell, then a number on the pad (⌫ erases). Conflicts get highlighted. First correct grid wins.',
	kenken: 'Fill the grid with 1–N: no repeats in any row or column, and each outlined cage must combine to its little target using the shown operation (− and ÷ in either order). First correct grid wins.',
	boggle: 'Build words of 3+ letters from adjacent tiles (diagonals count, no reusing a tile): tap letters then Submit, or just type a word and press Enter. Longer words score more. Highest score when time runs out.',
	pipes: 'Every tile is a bit of pipe. Tap a tile to rotate it. Reconnect everything into one network with no open ends — connected pipe lights up as you go. First to restore the network wins.',
	nonogram: 'The numbers are runs of filled cells in that row/column, in order — "2 1" means 2 filled, a gap, then 1. Tap to fill, tap again for an ✕ note (just a note), again to clear. First to satisfy every clue wins.',
	lightsout: 'Tapping a light toggles it AND its four neighbours. Turn every light off — first to a dark board wins.',
	mines: 'Numbers count the mines touching that square. Tap to reveal; use the flag toggle (or long-press) to mark suspected mines. Hitting a mine costs a 10-second lockout. First to reveal every safe square wins.',
	wordsearch: 'Every word on the list below is hidden in the grid — across, down or diagonally, forwards or backwards. The list is the complete set. Tap a word\'s first and last letter to claim it; find them all for a +10 bonus. Highest score when time runs out.',
	memory: 'Tap two cards: a pair stays up, a miss flips back. Everyone has the same shuffle, so it\'s pure memory. First to match every pair wins.',
	trio: 'A trio is 3 cards where each feature — count, shape, fill, colour — is all-same or all-different. Tap 3 cards to claim one (+3; a wrong guess is −1, a hint costs 2). Highest score when time runs out.',
	g2048: 'Swipe or use arrow keys to slide the tiles; equal tiles merge and score. No game over — just rack up the biggest score before the clock stops.',
};

function showHelp(gameKey) {
	const el = $('game-help');
	$('game-help-text').textContent = HELP[gameKey] || '';
	el.hidden = !HELP[gameKey];
	// auto-open the first time you ever play each game
	const seen = JSON.parse(localStorage.getItem('gs-help-seen') || '{}');
	el.open = !seen[gameKey];
	seen[gameKey] = true;
	localStorage.setItem('gs-help-seen', JSON.stringify(seen));
}

// ---------- round lifecycle ----------
let handle = null;			// mounted game module instance
let startTime = 0, timerHandle = 0, finishedLocal = false;
let lastPhase = null, lastRound = 0, lastCardsKey = '';

function setStatus(text, tone = '') {
	const el = $('game-status');
	el.textContent = text || '';
	el.className = tone;
}

function startRoundUI(g) {
	finishedLocal = false;
	autoNextCancelled = false;
	let nearSent = false, lastStuckEventAt = 0;
	const mod = GAMES[g.puzzle.game];
	$('game-root').innerHTML = '';
	setStatus('');
	$('round-game-label').textContent = g.puzzle.summary || mod?.name || g.puzzle.game;
	showHelp(g.puzzle.game);
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
		progress(blob) {
			// a player crossing 80% is news the room enjoys
			if (blob && typeof blob.pct === 'number' && blob.pct >= 0.8 && !nearSent && !finishedLocal) {
				nearSent = true;
				send({ t: 'event', kind: 'near' });
			}
			send({ t: 'progress', data: blob });
		},
		setStatus,
		sendStuck(stuck) {
			send({ t: 'stuck', stuck: !!stuck });
			if (stuck && Date.now() - lastStuckEventAt > 15000) {
				lastStuckEventAt = Date.now();
				send({ t: 'event', kind: 'stuck' });
			}
		},
		event(kind) { send({ t: 'event', kind }); },
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

// ---------- my parties (local history) ----------
function rememberParty(g) {
	if (!roomCode) return;
	const list = JSON.parse(localStorage.getItem('gs-parties') || '[]')
		.filter(p => p.code !== roomCode);
	list.unshift({ code: roomCode, name: g.name || '', host: g.master,
		mine: g.master === me.name, ts: Date.now() });
	localStorage.setItem('gs-parties', JSON.stringify(list.slice(0, 12)));
}

function renderMyParties() {
	const list = JSON.parse(localStorage.getItem('gs-parties') || '[]');
	$('my-parties-head').hidden = !list.length;
	const box = $('my-parties');
	box.innerHTML = '';
	for (const p of list) {
		const card = document.createElement('button');
		card.type = 'button';
		card.className = 'party-card';
		const when = new Date(p.ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
		card.innerHTML = `<b>${p.mine ? '👑 ' : ''}${p.code}${p.name ? ' · ' + p.name : ''}</b>
			<small>${p.mine ? 'your party' : 'host: ' + (p.host || '?')} · last visited ${when}</small>`;
		card.addEventListener('click', () => enterParty(p.code));
		const x = document.createElement('span');
		x.className = 'party-x';
		x.textContent = '✕';
		x.title = 'forget this party';
		x.addEventListener('click', ev => {
			ev.stopPropagation();
			localStorage.setItem('gs-parties', JSON.stringify(
				JSON.parse(localStorage.getItem('gs-parties') || '[]').filter(q => q.code !== p.code)));
			renderMyParties();
		});
		card.appendChild(x);
		box.appendChild(card);
	}
}

// ---------- event toasts ----------
let lastEventTs = 0, eventsPrimed = false;
const EVENT_TEXT = {
	stuck: '🚧 hit a dead end',
	boom: '💥 hit a mine',
	near: '⚡ is nearly done!',
	mistake: '❌ slipped up',
};
function showEvents(g) {
	const evs = g.events || [];
	if (!eventsPrimed) {	// don't replay history on join
		eventsPrimed = true;
		lastEventTs = Math.max(0, ...evs.map(e => e.ts));
		return;
	}
	for (const e of evs) {
		if (e.ts <= lastEventTs || e.name === me.name) continue;
		toast(`${e.name} ${EVENT_TEXT[e.kind] || e.kind}`);
	}
	if (evs.length) lastEventTs = Math.max(lastEventTs, ...evs.map(e => e.ts));
}
function toast(text) {
	let box = $('toasts');
	if (!box) {
		box = document.createElement('div');
		box.id = 'toasts';
		document.body.appendChild(box);
	}
	const t = document.createElement('div');
	t.className = 'toast';
	t.textContent = text;
	box.appendChild(t);
	setTimeout(() => t.classList.add('out'), 3400);
	setTimeout(() => t.remove(), 4000);
}

// ---------- server state -> UI ----------
function applyState(g, ps) {
	game = g; players = ps;
	const isMaster = g.master === me.name;
	const inLobby = g.phase === 'lobby', proposed = g.phase === 'proposed', playing = g.phase === 'playing';

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
	if (isMaster) $('public-toggle').checked = !!g.isPublic;
	const cardsKey = JSON.stringify(g.lockedGames || []);
	if (inLobby && isMaster && (!$('game-cards').childElementCount || cardsKey !== lastCardsKey)) {
		lastCardsKey = cardsKey;
		renderGameCards();
	}
	renderPlaylist(g, isMaster);
	updateNextUp(g, isMaster, inLobby, proposed);
	showEvents(g);
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
	$('room-label').textContent = `PARTY ${roomCode}${g.name ? ' · ' + g.name : ''}`;
	$('btn-rename').hidden = !isMaster;
	rememberParty(g);
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
		if (g.master === me.name && p.name !== me.name) {
			const boot = document.createElement('button');
			boot.className = 'boot';
			boot.textContent = '✕';
			boot.title = 'remove from party';
			boot.addEventListener('click', () => {
				if (!confirm(`Remove ${p.name} from the party?`)) return;
				send({ t: 'kick', name: p.name, ban: confirm('Also block them from rejoining? OK = block, Cancel = just remove.') });
			});
			el.appendChild(boot);
		}
		playersEl.appendChild(el);
	}
}

// ---------- feedback -> Linear ----------
let fbShotData = null;
$('btn-feedback').addEventListener('click', async () => {
	fbShotData = null;
	$('fb-shot').hidden = true;
	$('fb-status').textContent = 'capturing screenshot…';
	$('feedback-modal').showModal();
	try {
		// lazy-load the renderer; capture happens before the dialog paints over much
		const { default: html2canvas } = await import('/vendor/html2canvas.mjs');
		$('feedback-modal').close();	// don't capture the dialog itself
		await new Promise(r => setTimeout(r, 60));
		const canvas = await html2canvas(document.body, {
			windowWidth: innerWidth, windowHeight: innerHeight,
			x: scrollX, y: scrollY, width: innerWidth, height: innerHeight,
			logging: false,
		});
		fbShotData = canvas.toDataURL('image/jpeg', 0.55);
		$('fb-shot').src = fbShotData;
		$('fb-shot').hidden = false;
	} catch { fbShotData = null; }
	$('fb-status').textContent = '';
	$('feedback-modal').showModal();
});
$('fb-cancel').addEventListener('click', () => $('feedback-modal').close());
$('fb-send').addEventListener('click', async () => {
	const text = $('fb-text').value.trim();
	if (!text) { $('fb-status').textContent = 'say a little something first'; return; }
	$('fb-send').disabled = true;
	$('fb-status').textContent = 'sending…';
	try {
		const r = await (await fetch('/api/feedback', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				text,
				image: $('fb-attach').checked ? fbShotData : null,
				meta: {
					url: location.href,
					party: roomCode || '',
					game: game?.phase === 'playing' ? game.puzzle?.game : '',
					phase: game?.phase || 'landing',
					player: me.name || '',
					ua: navigator.userAgent,
				},
			}),
		})).json();
		$('fb-text').value = '';
		$('feedback-modal').close();
		toast(r.issue ? `🐞 filed as ${r.issue} — thank you!` : '🐞 feedback sent — thank you!');
	} catch {
		$('fb-status').textContent = 'failed to send — try again?';
	}
	$('fb-send').disabled = false;
});

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
		row.append(who, document.createTextNode(' '));
		// URLs become real links; everything else stays inert text
		for (const part of m.text.split(/(https?:\/\/[^\s]+)/g)) {
			if (/^https?:\/\//.test(part)) {
				const a = document.createElement('a');
				a.href = part; a.textContent = part;
				a.target = '_blank'; a.rel = 'noopener noreferrer';
				row.appendChild(a);
			} else if (part) row.appendChild(document.createTextNode(part));
		}
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
		if (!list.length) {
			box.innerHTML = '<p class="muted">No open parties right now — start one and flip on “discoverable”.</p>';
			return;
		}
		for (const p of list) {
			const mod = GAMES[p.game];
			const card = document.createElement('button');
			card.type = 'button';
			card.className = 'party-card';
			card.innerHTML = `<b>🎲 ${p.code}${p.name ? ' · ' + p.name : ''}</b>
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
	renderMyParties();
	refreshParties();
	partiesTimer = setInterval(refreshParties, 10000);
}
