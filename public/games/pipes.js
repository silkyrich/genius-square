// Pipes (Net) game module — rotate tiles to reconnect a pipe network.
// The layout is a random spanning tree over the N×N grid, derived
// deterministically from the seed, so every player races on the same board.
// Pure helpers (boardFromSeed, scramble, rotated, isSolved, connectedCount)
// are exported for tests; nothing touches the DOM until mount().

// Stub bitmask order: bit 0=N, 1=E, 2=S, 3=W.

// Small deterministic PRNG so every player derives the same board from seed.
function mulberry32(a) {
	return function () {
		a = (a + 0x6D2B79F5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// Rotate a stub mask k×90° clockwise (N->E->S->W).
export function rotated(mask, k) {
	k = ((k % 4) + 4) % 4;
	return ((mask << k) | (mask >>> (4 - k))) & 15;
}

// Random spanning tree via randomized DFS. -> n*n stub masks (solved layout).
export function boardFromSeed(seed, n) {
	const rng = mulberry32(seed >>> 0);
	const total = n * n;
	const masks = new Array(total).fill(0);
	const seen = new Array(total).fill(false);
	const stack = [Math.floor(rng() * total)];
	seen[stack[0]] = true;
	while (stack.length) {
		const cell = stack[stack.length - 1];
		const r = Math.floor(cell / n), c = cell % n;
		const opts = [];
		if (r > 0 && !seen[cell - n]) opts.push([0, cell - n]);
		if (c < n - 1 && !seen[cell + 1]) opts.push([1, cell + 1]);
		if (r < n - 1 && !seen[cell + n]) opts.push([2, cell + n]);
		if (c > 0 && !seen[cell - 1]) opts.push([3, cell - 1]);
		if (!opts.length) { stack.pop(); continue; }
		const [d, nb] = opts[Math.floor(rng() * opts.length)];
		masks[cell] |= 1 << d;
		masks[nb] |= 1 << ((d + 2) % 4);	// matching stub back
		seen[nb] = true;
		stack.push(nb);
	}
	return masks;
}

// Effective masks after applying rotations.
function effective(board, rots) {
	return board.map((m, i) => rotated(m, rots[i]));
}

// Does tile i's every stub meet a matching stub on the neighbour?
function matched(m, i, n) {
	const r = Math.floor(i / n), c = i % n;
	return (!(m[i] & 1) || (r > 0 && (m[i - n] & 4)))
		&& (!(m[i] & 2) || (c < n - 1 && (m[i + 1] & 8)))
		&& (!(m[i] & 4) || (r < n - 1 && (m[i + n] & 1)))
		&& (!(m[i] & 8) || (c > 0 && (m[i - 1] & 2)));
}

// Solved when every stub on every tile matches (none dangles or exits grid).
export function isSolved(board, rots) {
	const n = Math.round(Math.sqrt(board.length));
	const m = effective(board, rots);
	for (let i = 0; i < m.length; i++) if (!matched(m, i, n)) return false;
	return true;
}

// Tiles reachable from tile 0 across mutually matching stubs.
function reach(m, n) {
	const seen = new Array(m.length).fill(false);
	const q = [0];
	seen[0] = true;
	while (q.length) {
		const i = q.pop();
		const r = Math.floor(i / n), c = i % n;
		const step = j => { if (!seen[j]) { seen[j] = true; q.push(j); } };
		if ((m[i] & 1) && r > 0 && (m[i - n] & 4)) step(i - n);
		if ((m[i] & 2) && c < n - 1 && (m[i + 1] & 8)) step(i + 1);
		if ((m[i] & 4) && r < n - 1 && (m[i + n] & 1)) step(i + n);
		if ((m[i] & 8) && c > 0 && (m[i - 1] & 2)) step(i - 1);
	}
	return seen;
}

// Tiles connected to the network (from tile 0) AND with all stubs matched.
export function connectedCount(board, rots) {
	const n = Math.round(Math.sqrt(board.length));
	const m = effective(board, rots);
	const seen = reach(m, n);
	let count = 0;
	for (let i = 0; i < m.length; i++)
		if (seen[i] && matched(m, i, n)) count++;
	return count;
}

// Random rotation per tile; if the scramble lands solved, break one tile.
export function scramble(board, seed) {
	const rng = mulberry32(seed >>> 0);
	const rots = board.map(() => Math.floor(rng() * 4));
	if (isSolved(board, rots)) {
		const i = board.findIndex(mask => mask !== 15);	// 15 is rotation-invariant
		rots[i] = (rots[i] + 1) & 3;
	}
	return rots;
}

// One SVG per tile: a stub per set bit + centre dot; rotated as a whole.
function tileSvg(mask) {
	let d = '';
	if (mask & 1) d += 'M50 50 50 0 ';
	if (mask & 2) d += 'M50 50 100 50 ';
	if (mask & 4) d += 'M50 50 50 100 ';
	if (mask & 8) d += 'M50 50 0 50 ';
	return `<svg viewBox="0 0 100 100" aria-hidden="true"><path d="${d.trim()}"/><circle cx="50" cy="50" r="13"/></svg>`;
}

const CSS = `
.pp-wrap { display: flex; flex-direction: column; gap: 10px; width: min(92vw, 410px); margin: 0 auto; }
.pp-board {
	display: grid; gap: 2px; padding: 6px;
	background: var(--board-bg); border-radius: 14px;
}
.pp-tile {
	aspect-ratio: 1; padding: 0; border: none; border-radius: 4px;
	background: var(--cell); cursor: pointer; overflow: hidden;
	user-select: none; -webkit-user-select: none; touch-action: manipulation;
}
.pp-tile svg { display: block; width: 100%; height: 100%; color: var(--muted); transition: transform .18s ease; }
.pp-tile svg path { stroke: currentColor; stroke-width: 20; fill: none; }
.pp-tile svg circle { fill: currentColor; }
.pp-tile.pp-live svg { color: var(--accent); }
.pp-board.pp-won .pp-tile svg { color: var(--ok); }
.pp-board.pp-won .pp-tile { cursor: default; }
.pp-hint { text-align: center; color: var(--muted); font-size: .85rem; }
.pp-mini-bar { height: 4px; border-radius: 2px; background: var(--border); overflow: hidden; margin-top: 3px; }
.pp-mini-fill { height: 100%; background: var(--accent); }
`;

function injectStyles() {
	if (document.querySelector('style[data-game="pipes"]')) return;
	const s = document.createElement('style');
	s.dataset.game = 'pipes';
	s.textContent = CSS;
	document.head.appendChild(s);
}

export default {
	key: 'pipes',
	name: 'Pipes',
	icon: '🔧',
	blurb: 'Rotate the tiles to reconnect the network.',
	scoreMode: 'race',
	durationMs: 0,
	optionDefs: [
		{ key: 'size', label: 'Grid size', type: 'select', default: '6',
		  choices: [{value:'5',label:'5×5 — quick'},{value:'6',label:'6×6'},{value:'8',label:'8×8 — tough'}] },
	],

	// Runs once on the proposer's machine; everyone else replays the seed.
	async createPuzzle(options) {
		const seed = (Math.random() * 0x100000000) >>> 0;
		const size = Number(options?.size ?? 6);
		return { seed, size, summary: `Pipes — ${size}×${size}` };
	},

	mount(root, ctx) {
		injectStyles();
		const seed = ctx.payload.seed >>> 0;
		const n = Number(ctx.payload.size ?? ctx.options?.size ?? 6);
		const total = n * n;
		const board = boardFromSeed(seed, n);
		const rots = scramble(board, seed);	// rots[i] grows past 3 for smooth cw spins
		let done = false;

		root.innerHTML = `
			<div class="pp-wrap">
				<div class="pp-board" style="grid-template-columns: repeat(${n}, 1fr);">${board.map((m, i) =>
					`<button type="button" class="pp-tile" data-i="${i}">${tileSvg(m)}</button>`).join('')}</div>
				<div class="pp-hint">Tap a tile to rotate it. Reconnect every pipe to win.</div>
			</div>`;

		const tiles = [...root.querySelectorAll('.pp-tile')];
		const boardEl = root.querySelector('.pp-board');
		const svgs = tiles.map(el => el.querySelector('svg'));
		svgs.forEach((svg, i) => { svg.style.transform = `rotate(${rots[i] * 90}deg)`; });

		function refresh(report) {
			const m = effective(board, rots);
			const seen = reach(m, n);
			let connected = 0;
			tiles.forEach((el, i) => {
				const on = seen[i] && matched(m, i, n);
				if (on) connected++;
				el.classList.toggle('pp-live', seen[i]);
			});
			ctx.setStatus(`${connected}/${total} connected`, connected === total ? 'won' : 'ok');
			if (report) ctx.progress({ type: 'pipes', connected, total });
			if (connected === total && !done) {
				done = true;
				boardEl.classList.add('pp-won');
				ctx.finish();
			}
		}

		boardEl.addEventListener('click', e => {
			const tile = e.target.closest('.pp-tile');
			if (!tile || done) return;
			const i = Number(tile.dataset.i);
			rots[i]++;
			svgs[i].style.transform = `rotate(${rots[i] * 90}deg)`;
			refresh(true);
		});

		refresh(false);	// initial connectivity paint + status
		return {
			destroy() { root.innerHTML = ''; },	// no document-level listeners to remove
		};
	},

	renderMini(el, progress) {
		if (!progress) { el.textContent = 'not started'; return; }
		const pct = progress.total ? Math.round(100 * progress.connected / progress.total) : 0;
		el.innerHTML = `${progress.connected}/${progress.total}
			<div class="pp-mini-bar"><div class="pp-mini-fill" style="width:${pct}%"></div></div>`;
	},
};
