// 2048 Sprint game module — classic 4x4 merge game, highest score wins.
// Pure helpers (slide, moveGrid) are exported for tests; nothing touches
// the DOM or network until mount().

// Small deterministic PRNG so every player's first spawns match the seed.
function mulberry32(a) {
	return function () {
		a = (a + 0x6D2B79F5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// Slide+merge one row toward index 0. Each tile merges at most once.
// -> { row, gained } where gained is the sum of merged tile values.
export function slide(row) {
	const vals = row.filter(v => v);
	const out = [];
	let gained = 0;
	for (let i = 0; i < vals.length; i++) {
		if (i + 1 < vals.length && vals[i] === vals[i + 1]) {
			out.push(vals[i] * 2);
			gained += vals[i] * 2;
			i++;	// skip the merged partner; no double-merge
		} else out.push(vals[i]);
	}
	while (out.length < row.length) out.push(0);
	return { row: out, gained };
}

// Apply a move to a 16-array grid. dir 0-3 = left/up/right/down.
// -> { grid, gained, moved }; input grid is not mutated.
export function moveGrid(grid, dir) {
	const next = grid.slice();
	let gained = 0, moved = false;
	for (let k = 0; k < 4; k++) {
		const idx = [];	// cell indices of line k, in slide order
		for (let j = 0; j < 4; j++) {
			if (dir === 0) idx.push(k * 4 + j);
			else if (dir === 1) idx.push(j * 4 + k);
			else if (dir === 2) idx.push(k * 4 + (3 - j));
			else idx.push((3 - j) * 4 + k);
		}
		const r = slide(idx.map(i => grid[i]));
		gained += r.gained;
		idx.forEach((cell, j) => {
			if (next[cell] !== r.row[j]) moved = true;
			next[cell] = r.row[j];
		});
	}
	return { grid: next, gained, moved };
}

const CSS = `
.g2-wrap { display: flex; flex-direction: column; gap: 10px; align-items: center; }
.g2-board {
	display: grid; grid-template-columns: repeat(4, 1fr); grid-template-rows: repeat(4, 1fr);
	gap: 8px; padding: 8px; width: min(92vw, 380px); aspect-ratio: 1;
	background: var(--board-bg); border-radius: 14px; touch-action: none; user-select: none;
}
.g2-cell {
	display: flex; align-items: center; justify-content: center;
	font-weight: 800; font-size: 1.4rem; border-radius: 8px;
	background: var(--cell); color: var(--text);
	transition: background .12s ease, color .12s ease;
}
.g2-cell.g2-big { font-size: 1.05rem; }
.g2-t2 { background: color-mix(in srgb, var(--gold) 12%, var(--cell)); }
.g2-t4 { background: color-mix(in srgb, var(--gold) 24%, var(--cell)); }
.g2-t8 { background: color-mix(in srgb, var(--gold) 40%, var(--cell)); }
.g2-t16 { background: color-mix(in srgb, var(--gold) 58%, var(--cell)); }
.g2-t32 { background: color-mix(in srgb, var(--gold) 78%, var(--cell)); color: #3a2a00; }
.g2-t64 { background: var(--gold); color: #3a2a00; }
.g2-t128 { background: color-mix(in srgb, var(--accent) 30%, var(--gold)); color: #fff; }
.g2-t256 { background: color-mix(in srgb, var(--accent) 50%, var(--gold)); color: #fff; }
.g2-t512 { background: color-mix(in srgb, var(--accent) 70%, var(--gold)); color: #fff; }
.g2-t1024 { background: color-mix(in srgb, var(--accent) 88%, var(--gold)); color: #fff; }
.g2-thi { background: var(--accent); color: #fff; }
.g2-score { font-weight: 700; color: var(--text); }
.g2-score span { color: var(--muted); font-weight: 400; }
.g2-hint { color: var(--muted); font-size: .85rem; }
`;

function injectStyles() {
	if (document.querySelector('style[data-game="g2048"]')) return;
	const s = document.createElement('style');
	s.dataset.game = 'g2048';
	s.textContent = CSS;
	document.head.appendChild(s);
}

// '3420' -> '3 420' (thin space thousands groups).
function fmt(n) {
	return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export default {
	key: 'g2048',
	name: '2048 Sprint',
	icon: '🎰',
	blurb: 'Merge tiles. Highest score when the clock stops.',
	scoreMode: 'points',
	durationMs: 120000,
	optionDefs: [
		{ key: 'duration', label: 'Round length', type: 'select', default: '120',
		  choices: [{value:'90',label:'90 seconds'},{value:'120',label:'2 minutes'},{value:'180',label:'3 minutes'}] },
	],

	// Runs once on the proposer's machine; everyone else replays the seed.
	async createPuzzle(options) {
		const seed = (Math.random() * 0x100000000) >>> 0;
		const secs = Number(options?.duration ?? 120);
		return {
			seed,
			duration: secs * 1000,
			summary: `2048 Sprint — ${secs} seconds`,
		};
	},

	mount(root, ctx) {
		injectStyles();
		const rng = mulberry32(ctx.payload.seed >>> 0);
		let grid = new Array(16).fill(0);
		let score = 0;

		// Drop a 2 (90%) or 4 (10%) into a random empty cell. The first two
		// spawns are seed-identical for everyone; later ones diverge with play.
		function spawn() {
			const empty = grid.map((v, i) => v ? -1 : i).filter(i => i >= 0);
			if (!empty.length) return;
			const cell = empty[Math.floor(rng() * empty.length)];
			grid[cell] = rng() < 0.9 ? 2 : 4;
		}
		spawn();
		spawn();

		root.innerHTML = `
			<div class="g2-wrap">
				<div class="g2-score">0 pts <span>· best 2</span></div>
				<div class="g2-board">${grid.map(() => '<div class="g2-cell"></div>').join('')}</div>
				<div class="g2-hint">swipe or use arrow keys</div>
			</div>`;

		const cells = [...root.querySelectorAll('.g2-cell')];
		const scoreEl = root.querySelector('.g2-score');
		const board = root.querySelector('.g2-board');

		function paint() {
			grid.forEach((v, i) => {
				const el = cells[i];
				el.textContent = v ? String(v) : '';
				el.className = 'g2-cell'
					+ (v ? (v <= 1024 ? ` g2-t${v}` : ' g2-thi') : '')
					+ (v >= 1000 ? ' g2-big' : '');
			});
			const best = Math.max(0, ...grid);
			scoreEl.innerHTML = `${fmt(score)} pts <span>· best ${best}</span>`;
		}

		function stuck() {
			return [0, 1, 2, 3].every(d => !moveGrid(grid, d).moved);
		}

		function move(dir) {
			const r = moveGrid(grid, dir);
			if (!r.moved) return;
			grid = r.grid;
			score += r.gained;
			spawn();
			paint();
			const best = Math.max(...grid);
			ctx.progress({ type: 'g2048', score, best });
			if (stuck()) ctx.setStatus('stuck — board full!', 'bad');
			else ctx.setStatus(`${fmt(score)} pts · best ${best}`, 'ok');
		}

		const onKey = e => {
			const dir = { ArrowLeft: 0, ArrowUp: 1, ArrowRight: 2, ArrowDown: 3 }[e.key];
			if (dir === undefined) return;
			e.preventDefault();
			move(dir);
		};
		document.addEventListener('keydown', onKey);

		let start = null;
		board.addEventListener('pointerdown', e => { start = { x: e.clientX, y: e.clientY }; });
		board.addEventListener('pointerup', e => {
			if (!start) return;
			const dx = e.clientX - start.x, dy = e.clientY - start.y;
			start = null;
			if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
			move(Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 2 : 0) : (dy > 0 ? 3 : 1));
		});

		paint();
		ctx.setStatus('go!', 'ok');

		return {
			destroy() {
				document.removeEventListener('keydown', onKey);
				root.innerHTML = '';
			},
			endRound() { return { points: score }; },
		};
	},

	renderMini(el, progress) {
		el.textContent = progress
			? `${progress.best} best · ${fmt(progress.score)} pts`
			: 'no moves yet';
	},
};
