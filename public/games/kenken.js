// KenKen (calcudoku) game module — race mode, first valid grid wins.
// Pure puzzle logic up top (node-testable, no DOM at import time); UI in mount().
// NOTE: puzzles are not guaranteed unique — *any* latin square that satisfies
// every cage counts as a win, so all players race toward the same fair target.

// Small deterministic PRNG so every player derives the same puzzle from seed.
function mulberry32(a) {
	return function () {
		a = (a + 0x6D2B79F5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function shuffle(arr, rng) {
	for (let i = arr.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[arr[i], arr[j]] = [arr[j], arr[i]];
	}
	return arr;
}

// Random latin square (flat array, digits 1..n): permute the rows, columns
// and digits of the cyclic square, then a few intercalate (2x2) swaps —
// every step preserves latin-ness.
function latinSquare(rng, n) {
	const rows = shuffle([...Array(n).keys()], rng);
	const cols = shuffle([...Array(n).keys()], rng);
	const digs = shuffle([...Array(n).keys()], rng);
	const g = new Array(n * n);
	for (let r = 0; r < n; r++)
		for (let c = 0; c < n; c++)
			g[r * n + c] = digs[(rows[r] + cols[c]) % n] + 1;
	for (let k = 0; k < n * 3; k++) {	// swap a b / b a sub-rectangles when found
		const r1 = Math.floor(rng() * n), r2 = Math.floor(rng() * n);
		const c1 = Math.floor(rng() * n), c2 = Math.floor(rng() * n);
		if (r1 === r2 || c1 === c2) continue;
		const a = g[r1 * n + c1], b = g[r1 * n + c2];
		if (a === g[r2 * n + c2] && b === g[r2 * n + c1]) {
			g[r1 * n + c1] = b; g[r1 * n + c2] = a;
			g[r2 * n + c1] = a; g[r2 * n + c2] = b;
		}
	}
	return g;
}

// Orthogonal neighbours of flat cell i in an n x n grid.
function neighbors(i, n) {
	const r = Math.floor(i / n), c = i % n, out = [];
	if (r > 0) out.push(i - n);
	if (r < n - 1) out.push(i + n);
	if (c > 0) out.push(i - 1);
	if (c < n - 1) out.push(i + 1);
	return out;
}

// Partition all cells into cages by seeded flood growth, sizes 1-4 (mostly 2-3).
function buildCages(rng, n) {
	const total = n * n;
	const cageOf = new Array(total).fill(-1);
	const cages = [];
	for (const start of shuffle([...Array(total).keys()], rng)) {
		if (cageOf[start] >= 0) continue;
		const id = cages.length, cells = [start];
		cageOf[start] = id;
		const r = rng();	// size weights: 2 45%, 3 35%, 4 12%, 1 8%
		const want = r < 0.45 ? 2 : r < 0.80 ? 3 : r < 0.92 ? 4 : 1;
		while (cells.length < want) {
			const opts = [];
			for (const c of cells)
				for (const nb of neighbors(c, n)) if (cageOf[nb] < 0) opts.push(nb);
			if (!opts.length) break;
			const pick = opts[Math.floor(rng() * opts.length)];
			cageOf[pick] = id;
			cells.push(pick);
		}
		cages.push(cells);
	}
	// Fold most stranded singletons into a small neighbouring cage.
	for (const cage of cages) {
		if (cage.length !== 1 || rng() < 0.3) continue;
		const host = neighbors(cage[0], n)
			.map(nb => cages[cageOf[nb]])
			.find(c => c.length > 1 && c.length < 4);
		if (host) { cageOf[cage[0]] = cages.indexOf(host); host.push(cage.pop()); }
	}
	return cages.filter(c => c.length).map(c => c.sort((a, b) => a - b));
}

// Seeded op + target for a cage's hidden values. '−'/'÷' size-2 only;
// '−' = |a−b|, '÷' = max/min (only when it divides evenly).
function pickOp(rng, vals) {
	if (vals.length === 1) return { op: '=', target: vals[0] };
	if (vals.length === 2) {
		const hi = Math.max(...vals), lo = Math.min(...vals);
		if (hi % lo === 0 && rng() < 0.5) return { op: '÷', target: hi / lo };
		const r = rng();
		if (r < 0.4) return { op: '−', target: hi - lo };
		if (r < 0.7) return { op: '+', target: vals[0] + vals[1] };
		return { op: '×', target: vals[0] * vals[1] };
	}
	return rng() < 0.55
		? { op: '+', target: vals.reduce((s, v) => s + v, 0) }
		: { op: '×', target: vals.reduce((p, v) => p * v, 1) };
}

// Full puzzle from seed: hidden latin square + cage list. Deterministic.
export function puzzleFromSeed(seed, n) {
	const rng = mulberry32(seed >>> 0);
	const square = latinSquare(rng, n);
	const cages = buildCages(rng, n).map(cells => {
		const { op, target } = pickOp(rng, cells.map(i => square[i]));
		return { cells, op, target };
	});
	return { square, cages };
}

// Do these (fully entered) values satisfy the cage? False on any blank/0.
export function cageSatisfied(values, op, target) {
	if (!values.length || values.some(v => !(v >= 1))) return false;
	switch (op) {
		case '=': return values.length === 1 && values[0] === target;
		case '+': return values.reduce((s, v) => s + v, 0) === target;
		case '×': return values.reduce((p, v) => p * v, 1) === target;
		case '−': return values.length === 2 && Math.abs(values[0] - values[1]) === target;
		case '÷': return values.length === 2
			&& Math.max(...values) === target * Math.min(...values);
	}
	return false;
}

// Is the flat n x n grid a latin square (digits 1..n, no row/col repeats)?
export function isLatin(grid, n) {
	if (!grid || grid.length !== n * n) return false;
	for (let i = 0; i < n; i++) {
		const row = new Set(), col = new Set();
		for (let j = 0; j < n; j++) {
			const a = grid[i * n + j], b = grid[j * n + i];
			if (!(a >= 1 && a <= n) || row.has(a) || col.has(b)) return false;
			row.add(a); col.add(b);
		}
	}
	return true;
}

const CSS = `
.kk-wrap { display: flex; flex-direction: column; align-items: center; gap: .7rem; }
.kk-grid {
	display: grid; width: min(92vw, 380px); aspect-ratio: 1;
	background: var(--surface); border: 2px solid var(--board-bg); border-radius: 8px;
	overflow: hidden; touch-action: manipulation;
}
.kk-cell {
	position: relative; display: flex; align-items: center; justify-content: center;
	background: var(--cell); color: var(--accent);
	font-size: clamp(1.05rem, 5vw, 1.5rem); cursor: pointer; user-select: none;
	border-top: 1px solid var(--border); border-left: 1px solid var(--border);
}
.kk-cell.kk-ct { border-top: 2px solid var(--board-bg); }
.kk-cell.kk-cl { border-left: 2px solid var(--board-bg); }
.kk-lab {
	position: absolute; top: 1px; left: 3px;
	font-size: clamp(.5rem, 2.4vw, .68rem); font-weight: 700; color: var(--muted);
	pointer-events: none;
}
.kk-cell.kk-ok { background: color-mix(in srgb, var(--ok) 12%, var(--cell)); }
.kk-cell.kk-bad { color: var(--bad); background: color-mix(in srgb, var(--bad) 16%, var(--cell)); }
.kk-cell.kk-sel {
	outline: 2px solid var(--accent); outline-offset: -2px;
	background: color-mix(in srgb, var(--accent) 24%, var(--cell));
}
.kk-pad { display: grid; gap: .35rem; width: min(92vw, 380px); }
.kk-key {
	padding: .55rem 0; font: inherit; font-size: 1.1rem;
	background: var(--surface-2); color: var(--text);
	border: 1px solid var(--border); border-radius: 8px; cursor: pointer;
}
.kk-key:active { background: color-mix(in srgb, var(--accent) 20%, var(--surface-2)); }
.kk-mini { display: inline-flex; align-items: center; gap: .4rem; width: 100%; font-size: .8rem; color: var(--muted); }
.kk-mini-bar {
	flex: 1; min-width: 36px; height: 6px; overflow: hidden;
	background: var(--surface-2); border: 1px solid var(--border); border-radius: 3px;
}
.kk-mini-fill { display: block; height: 100%; background: var(--accent); }
.kk-mini-board { display: inline-grid; gap: 1px; padding: 2px; background: var(--board-bg); border-radius: 4px; }
.kk-mini-c { background: color-mix(in srgb, var(--cell) 40%, transparent); }
.kk-mini-n { display: block; font-size: .75rem; color: var(--muted); margin-top: 3px; }
`;

function injectStyles() {
	if (document.querySelector('style[data-game="kenken"]')) return;
	const style = document.createElement('style');
	style.dataset.game = 'kenken';
	style.textContent = CSS;
	document.head.appendChild(style);
}

export default {
	key: 'kenken',
	name: 'KenKen',
	icon: '➗',
	blurb: 'Fill the grid so every cage computes. No repeats in rows or columns.',
	scoreMode: 'race',
	durationMs: 0,
	optionDefs: [
		{ key: 'size', label: 'Grid size', type: 'select', default: '4',
		  choices: [
			{ value: '4', label: '4×4' },
			{ value: '5', label: '5×5' },
			{ value: '6', label: '6×6 — fierce' },
		  ] },
	],

	// Runs once on the proposer's machine; everyone else replays the seed.
	async createPuzzle(options) {
		const size = ['4', '5', '6'].includes(String(options?.size)) ? Number(options.size) : 4;
		const seed = (Math.random() * 0x100000000) >>> 0;
		const { cages } = puzzleFromSeed(seed, size);
		return { seed, size, summary: `KenKen ${size}×${size} — ${cages.length} cages` };
	},

	mount(root, ctx) {
		injectStyles();
		const { seed, size: n } = ctx.payload;
		const { cages } = puzzleFromSeed(seed, n);	// hidden square not needed in UI
		const total = n * n;
		const cageOf = new Array(total);
		cages.forEach((cg, k) => cg.cells.forEach(i => { cageOf[i] = k; }));
		const entries = new Array(total).fill(0);
		let selected = -1, done = false;

		const wrap = document.createElement('div');
		wrap.className = 'kk-wrap';
		const grid = document.createElement('div');
		grid.className = 'kk-grid';
		grid.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
		grid.style.gridTemplateRows = `repeat(${n}, 1fr)`;
		const cellEls = [], valEls = [];
		for (let i = 0; i < total; i++) {
			const cell = document.createElement('div');
			cell.className = 'kk-cell';
			// thick top/left edge wherever the neighbour belongs to another cage
			if (i >= n && cageOf[i - n] !== cageOf[i]) cell.classList.add('kk-ct');
			if (i % n && cageOf[i - 1] !== cageOf[i]) cell.classList.add('kk-cl');
			const cg = cages[cageOf[i]];
			if (cg.cells[0] === i) {	// cage label in its top-left (lowest-index) cell
				const lab = document.createElement('span');
				lab.className = 'kk-lab';
				lab.textContent = cg.op === '=' ? String(cg.target) : `${cg.target}${cg.op}`;
				cell.appendChild(lab);
			}
			const val = document.createElement('span');
			cell.appendChild(val);
			cell.addEventListener('click', () => { if (!done) { selected = i; render(); } });
			cellEls.push(cell); valEls.push(val);
			grid.appendChild(cell);
		}
		const pad = document.createElement('div');
		pad.className = 'kk-pad';
		pad.style.gridTemplateColumns = `repeat(${n + 1}, 1fr)`;
		for (let d = 1; d <= n + 1; d++) {
			const key = document.createElement('button');
			key.type = 'button';
			key.className = 'kk-key';
			key.textContent = d <= n ? String(d) : '⌫';
			key.addEventListener('click', () => enter(d <= n ? d : 0));
			pad.appendChild(key);
		}
		wrap.append(grid, pad);
		root.appendChild(wrap);

		// Every filled cell that duplicates a digit in its row or column.
		function conflictSet() {
			const seen = new Map(), bad = new Set();
			for (let i = 0; i < total; i++) {
				const v = entries[i];
				if (!v) continue;
				for (const key of [`r${Math.floor(i / n)}.${v}`, `c${i % n}.${v}`]) {
					if (seen.has(key)) { bad.add(i); bad.add(seen.get(key)); }
					else seen.set(key, i);
				}
			}
			return bad;
		}

		const cageDone = cg => cageSatisfied(cg.cells.map(i => entries[i]), cg.op, cg.target);

		function render() {
			const bad = conflictSet();
			const okCells = new Set();
			for (const cg of cages)
				if (cageDone(cg)) for (const i of cg.cells) okCells.add(i);
			for (let i = 0; i < total; i++) {
				valEls[i].textContent = entries[i] ? String(entries[i]) : '';
				cellEls[i].classList.toggle('kk-sel', i === selected);
				cellEls[i].classList.toggle('kk-bad', bad.has(i));
				cellEls[i].classList.toggle('kk-ok', okCells.has(i) && !bad.has(i));
			}
			return bad;
		}

		function report() {
			const filled = entries.filter(v => v).length;
			const cagesDone = cages.filter(cageDone).length;
			ctx.progress({ type: 'kenken', filled, total, cagesDone, cages: cages.length,
				pct: filled / total,
				mini: { w: n, h: n, p: ['#16a34a'], c: entries.map(v => v ? 0 : -1) } });
			if (cagesDone === cages.length && isLatin(entries, n)) {
				done = true;
				selected = -1;
				render();
				ctx.setStatus('★ solved!', 'won');
				ctx.finish();	// once: 'done' locks all further input
			} else ctx.setStatus(`${cagesDone}/${cages.length} cages`, 'ok');
		}

		function enter(v) {
			if (done || selected < 0 || entries[selected] === v) return;
			entries[selected] = v;
			render();
			report();
		}

		function onKey(e) {
			if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
			if (done) return;
			if (e.key >= '1' && e.key <= String(n)) enter(Number(e.key));
			else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') { enter(0); e.preventDefault(); }
			else if (e.key.startsWith('Arrow') && selected >= 0) {
				const next = selected + { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -n, ArrowDown: n }[e.key];
				if (next >= 0 && next < total) { selected = next; render(); }
				e.preventDefault();
			}
		}
		document.addEventListener('keydown', onKey);
		render();
		report();	// initial empty-board snapshot for spectators

		return { destroy() {
			document.removeEventListener('keydown', onKey);
			wrap.remove();
		} };
	},

	renderMini(el, progress) {
		injectStyles();
		const done = progress?.cagesDone ?? 0;
		const total = progress?.cages ?? 0;
		const m = progress?.mini;
		if (m) {	// live board snapshot
			const s = m.w > 10 ? 5 : 7;
			el.innerHTML = `<div class="kk-mini-board" style="grid-template-columns: repeat(${m.w}, ${s}px); grid-auto-rows: ${s}px;">`
				+ m.c.map(v => `<div class="kk-mini-c"${v >= 0 ? ` style="background:${m.p[v]}"` : ''}></div>`).join('')
				+ `</div><span class="kk-mini-n">${done}/${total} cages</span>`;
			return;
		}
		const pct = total ? Math.round(done / total * 100) : 0;
		el.innerHTML = `<span class="kk-mini"><span class="kk-mini-bar">`
			+ `<span class="kk-mini-fill" style="width:${pct}%"></span></span>${done}/${total} cages</span>`;
	},
};
