// Party state: one hook owns the WebSocket, identity, toasts and party
// lifecycle. Components read the server's state blob verbatim — the server
// remains the single source of truth, React just renders it.
import { useEffect, useRef, useState, useCallback } from 'react';

// Game modules stay plain ES modules outside the bundle, loaded by path.
export const GAME_FILES = {
	gs: 'genius-square.js', star: 'star.js', sudoku: 'sudoku.js',
	kenken: 'kenken.js', boggle: 'boggle.js', pipes: 'pipes.js',
	nonogram: 'nonogram.js', lightsout: 'lightsout.js', mines: 'mines.js',
	wordsearch: 'wordsearch.js', memory: 'memory.js', trio: 'trio.js',
	g2048: 'g2048.js',
};
export const GAMES = {};		// key -> module default export, filled at boot
export async function loadGames() {
	const mods = await Promise.all(Object.values(GAME_FILES).map(file =>
		import(/* @vite-ignore */ `/games/${file}`)));
	Object.keys(GAME_FILES).forEach((key, i) => { GAMES[key] = mods[i].default; });	// stable shelf order
	return GAMES;
}

// Per-game help shown under the board (auto-open first time).
export const HELP = {
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

const EVENT_TEXT = {
	stuck: '🚧 hit a dead end',
	boom: '💥 hit a mine',
	near: '⚡ is nearly done!',
	mistake: '❌ slipped up',
};

let toastSeq = 0;

export function usePartyState() {
	const [me, setMe] = useState({ name: null, email: null });
	const [needName, setNeedName] = useState(false);
	const [roomCode, setRoomCode] = useState(null);
	const [game, setGame] = useState(null);		// server state blob
	const [players, setPlayers] = useState([]);
	const [myId, setMyId] = useState(null);
	const [toasts, setToasts] = useState([]);
	const wsRef = useRef(null);
	const kickedRef = useRef(false);
	const nameWaiter = useRef(null);
	const eventsSeen = useRef({ primed: false, ts: 0 });
	const meRef = useRef(me);
	meRef.current = me;

	const toast = useCallback(text => {
		const id = ++toastSeq;
		setToasts(t => [...t, { id, text }]);
		setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000);
	}, []);

	const send = useCallback(msg => {
		const ws = wsRef.current;
		if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
	}, []);

	async function ensureIdentity() {
		let name = null, email = null;
		try {
			const d = await (await fetch('/api/me')).json();
			if (d.email) { email = d.email; name = d.email; }
		} catch {}
		if (!name) name = localStorage.getItem('gs-name');
		if (!name) {
			setNeedName(true);
			name = await new Promise(res => { nameWaiter.current = res; });
			setNeedName(false);
			localStorage.setItem('gs-name', name);
		}
		const id = { name, email };
		setMe(id);
		return id;
	}
	const submitName = name => nameWaiter.current?.(name.trim() || 'anonymous');

	function connect(code, name) {
		const proto = location.protocol === 'https:' ? 'wss' : 'ws';
		const ws = new WebSocket(`${proto}://${location.host}/ws/${code}?name=${encodeURIComponent(name)}`);
		wsRef.current = ws;
		ws.addEventListener('message', ev => {
			const m = JSON.parse(ev.data);
			if (m.t === 'state') {
				setMyId(m.you);
				setGame(m.game);
				setPlayers(m.players);
				rememberParty(code, m.game, meRef.current);
				showEvents(m.game);
			}
			if (m.t === 'kicked') {
				kickedRef.current = true;
				ws.close();
				toast(m.reason + ' — taking you home…');
				setTimeout(() => location.href = '/', 1800);
			}
		});
		ws.addEventListener('close', () => {
			if (!kickedRef.current) setTimeout(() => connect(code, name), 1500);
		});
	}

	function showEvents(g) {
		const evs = g.events || [];
		const seen = eventsSeen.current;
		if (!seen.primed) {	// don't replay history on join
			seen.primed = true;
			seen.ts = Math.max(0, ...evs.map(e => e.ts));
			return;
		}
		for (const e of evs) {
			if (e.ts <= seen.ts || e.name === meRef.current.name) continue;
			toast(`${e.name} ${EVENT_TEXT[e.kind] || e.kind}`);
		}
		if (evs.length) seen.ts = Math.max(seen.ts, ...evs.map(e => e.ts));
	}

	const enterParty = useCallback(async code => {
		if (!code) {
			const r = await (await fetch('/api/rooms', { method: 'POST' })).json();
			code = r.code;
		}
		history.replaceState(null, '', `/r/${code}`);
		setRoomCode(code);
		const id = await ensureIdentity();
		connect(code, id.name);
	}, []);

	// Shared link: straight into the party. Fresh visit: landing page.
	useEffect(() => {
		const m = location.pathname.match(/^\/r\/([A-Za-z]{4})$/);
		if (m) enterParty(m[1].toUpperCase());
	}, [enterParty]);

	return {
		me, needName, submitName,
		roomCode, game, players, myId,
		inParty: !!roomCode,
		isMaster: !!game && game.master === me.name,
		enterParty, send, toast, toasts,
	};
}

// ---------- party history (localStorage) ----------
function rememberParty(code, g, me) {
	const list = JSON.parse(localStorage.getItem('gs-parties') || '[]')
		.filter(p => p.code !== code);
	list.unshift({ code, name: g.name || '', host: g.master,
		mine: g.master === me.name, ts: Date.now() });
	localStorage.setItem('gs-parties', JSON.stringify(list.slice(0, 12)));
}
export function myParties() {
	return JSON.parse(localStorage.getItem('gs-parties') || '[]');
}
export function forgetParty(code) {
	localStorage.setItem('gs-parties',
		JSON.stringify(myParties().filter(p => p.code !== code)));
}

// ---------- celebration ----------
export function celebrate() {
	const colors = ['#2563eb', '#9a3412', '#f97316', '#16a34a', '#9333ea', '#0ea5e9', '#dc2626', '#eab308'];
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
