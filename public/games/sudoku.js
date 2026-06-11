// Sudoku game module — race mode, first correct grid wins.
// Pure puzzle logic up top (node-testable, no DOM at import time); UI in mount().

const DIFFICULTY = {
	easy:   { clues: 38, label: 'Easy' },
	medium: { clues: 30, label: 'Medium' },
	hard:   { clues: 25, label: 'Hard' },
};

// box index per cell, cell index = row * 9 + col
const BOX = Uint8Array.from({ length: 81 }, (_, i) => ((i / 27) | 0) * 3 + (((i % 9) / 3) | 0));

const parseGrid = s => Uint8Array.from(s, ch => ch >= '1' && ch <= '9' ? ch.charCodeAt(0) - 48 : 0);
const gridString = cells => Array.from(cells).join('');

function shuffle(arr, rng) {
	for (let i = arr.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[arr[i], arr[j]] = [arr[j], arr[i]];
	}
	return arr;
}

// Count completions of a partial grid, stopping at 'cap'. Exact below cap.
// Bitmask candidates + most-constrained-cell ordering; mutates and restores 'cells'.
function countCells(cells, cap) {
	const rows = new Int16Array(9), cols = new Int16Array(9), boxes = new Int16Array(9);
	for (let i = 0; i < 81; i++) {
		const v = cells[i];
		if (!v) continue;
		const bit = 1 << (v - 1), r = (i / 9) | 0, c = i % 9, b = BOX[i];
		if ((rows[r] | cols[c] | boxes[b]) & bit) return 0;	// givens conflict
		rows[r] |= bit; cols[c] |= bit; boxes[b] |= bit;
	}
	let count = 0;
	(function dfs() {
		let best = -1, bestMask = 0, bestN = 10;
		for (let i = 0; i < 81; i++) {
			if (cells[i]) continue;
			const mask = ~(rows[(i / 9) | 0] | cols[i % 9] | boxes[BOX[i]]) & 0x1ff;
			let n = 0;
			for (let m = mask; m; m &= m - 1) n++;
			if (n < bestN) { bestN = n; best = i; bestMask = mask; if (n <= 1) break; }
		}
		if (best === -1) { count++; return; }
		const r = (best / 9) | 0, c = best % 9, b = BOX[best];
		cells[best] = 1;	// placeholder; only emptiness matters while counting
		for (let m = bestMask; m && count < cap; m &= m - 1) {
			const bit = m & -m;
			rows[r] |= bit; cols[c] |= bit; boxes[b] |= bit;
			dfs();
			rows[r] ^= bit; cols[c] ^= bit; boxes[b] ^= bit;
		}
		cells[best] = 0;
	})();
	return count;
}

export function countSolutions(givens, cap = 2) {
	return countCells(parseGrid(givens), cap);
}

// Full random solution grid by sequential backtracking with shuffled digits.
function generateSolved(rng) {
	const cells = new Uint8Array(81);
	const rows = new Int16Array(9), cols = new Int16Array(9), boxes = new Int16Array(9);
	function dfs(i) {
		if (i === 81) return true;
		const r = (i / 9) | 0, c = i % 9, b = BOX[i];
		for (const v of shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9], rng)) {
			const bit = 1 << (v - 1);
			if ((rows[r] | cols[c] | boxes[b]) & bit) continue;
			cells[i] = v; rows[r] |= bit; cols[c] |= bit; boxes[b] |= bit;
			if (dfs(i + 1)) return true;
			rows[r] ^= bit; cols[c] ^= bit; boxes[b] ^= bit;
		}
		cells[i] = 0;
		return false;
	}
	dfs(0);
	return cells;
}

// Carve clues out of a full grid in random order, keeping the solution unique
// (count-to-2 check per removal). May stop above target if uniqueness breaks.
export function generateSudoku(difficulty, rng = Math.random) {
	const target = (DIFFICULTY[difficulty] ?? DIFFICULTY.medium).clues;
	const solution = generateSolved(rng);
	const cells = Uint8Array.from(solution);
	let clues = 81;
	for (const i of shuffle(Array.from({ length: 81 }, (_, k) => k), rng)) {
		if (clues <= target) break;
		const v = cells[i];
		cells[i] = 0;
		if (countCells(cells, 2) === 1) clues--;
		else cells[i] = v;
	}
	return { givens: gridString(cells), solution: gridString(solution) };
}

const CSS = `
.sd-wrap { display: flex; flex-direction: column; align-items: center; gap: .7rem; }
.sd-grid {
	display: grid; grid-template-columns: repeat(9, 1fr); grid-template-rows: repeat(9, 1fr);
	width: min(92vw, 380px); aspect-ratio: 1;
	background: var(--surface); border: 2px solid var(--board-bg); border-radius: 8px;
	overflow: hidden; touch-action: manipulation;
}
.sd-cell {
	display: flex; align-items: center; justify-content: center;
	background: var(--cell); color: var(--text);
	font-size: clamp(1rem, 4.5vw, 1.35rem); cursor: pointer; user-select: none;
	border-right: 1px solid var(--border); border-bottom: 1px solid var(--border);
}
.sd-cell:nth-child(9n) { border-right: none; }
.sd-cell:nth-child(n+73) { border-bottom: none; }
.sd-cell.sd-r3 { border-right: 2px solid var(--board-bg); }
.sd-cell.sd-b3 { border-bottom: 2px solid var(--board-bg); }
.sd-cell.sd-given { font-weight: 700; }
.sd-cell.sd-entry { color: var(--accent); }
.sd-cell.sd-same { background: color-mix(in srgb, var(--accent) 14%, var(--cell)); }
.sd-cell.sd-sel {
	outline: 2px solid var(--accent); outline-offset: -2px;
	background: color-mix(in srgb, var(--accent) 24%, var(--cell));
}
.sd-cell.sd-conflict { color: var(--bad); background: color-mix(in srgb, var(--bad) 14%, var(--cell)); }
.sd-pad { display: grid; grid-template-columns: repeat(5, 1fr); gap: .35rem; width: min(100%, 92vw, 380px); }
.sd-key {
	padding: .55rem 0; font: inherit; font-size: 1.1rem;
	background: var(--surface-2); color: var(--text);
	border: 1px solid var(--border); border-radius: 8px; cursor: pointer;
}
.sd-key:active { background: color-mix(in srgb, var(--accent) 20%, var(--surface-2)); }
.sd-mini { display: inline-flex; align-items: center; gap: .4rem; width: 100%; font-size: .8rem; color: var(--muted); }
.sd-mini-bar {
	flex: 1; min-width: 36px; height: 6px; overflow: hidden;
	background: var(--surface-2); border: 1px solid var(--border); border-radius: 3px;
}
.sd-mini-fill { display: block; height: 100%; background: var(--accent); }
.sd-mini-board { display: inline-grid; gap: 1px; padding: 2px; background: var(--board-bg); border-radius: 4px; }
.sd-mini-c { background: color-mix(in srgb, var(--cell) 40%, transparent); }
.sd-mini-n { display: block; font-size: .75rem; color: var(--muted); margin-top: 3px; }
`;

function injectStyles() {
	if (document.querySelector('style[data-game="sudoku"]')) return;
	const style = document.createElement('style');
	style.dataset.game = 'sudoku';
	style.textContent = CSS;
	document.head.appendChild(style);
}

export default {
	key: 'sudoku',
	name: 'Sudoku',
	icon: '🔢',
	blurb: 'Classic 9×9. First correct grid wins.',
	scoreMode: 'race',
	durationMs: 0,
	optionDefs: [
		{ key: 'difficulty', label: 'Difficulty', type: 'select', default: 'medium',
		  choices: [
			{ value: 'easy', label: 'Easy (38 clues)' },
			{ value: 'medium', label: 'Medium (30 clues)' },
			{ value: 'hard', label: 'Hard (25 clues)' },
		  ] },
	],

	async createPuzzle(options) {
		const difficulty = options?.difficulty ?? 'medium';
		const { givens, solution } = generateSudoku(difficulty);
		const clues = 81 - [...givens].filter(ch => ch === '0').length;
		const label = (DIFFICULTY[difficulty] ?? DIFFICULTY.medium).label;
		return { givens, solution, summary: `${label} Sudoku — ${clues} clues` };
	},

	mount(root, ctx) {
		injectStyles();
		const { givens, solution } = ctx.payload;
		const entries = Array.from(givens, Number);
		const isGiven = Array.from(givens, ch => ch !== '0');
		const total = isGiven.filter(g => !g).length;
		let selected = -1, done = false;

		const wrap = document.createElement('div');
		wrap.className = 'sd-wrap';
		const grid = document.createElement('div');
		grid.className = 'sd-grid';
		const cellEls = [];
		for (let i = 0; i < 81; i++) {
			const cell = document.createElement('div');
			cell.className = 'sd-cell ' + (isGiven[i] ? 'sd-given' : 'sd-entry');
			if (i % 9 === 2 || i % 9 === 5) cell.classList.add('sd-r3');
			const r = (i / 9) | 0;
			if (r === 2 || r === 5) cell.classList.add('sd-b3');
			cell.addEventListener('click', () => { selected = i; render(); });
			cellEls.push(cell);
			grid.appendChild(cell);
		}
		const pad = document.createElement('div');
		pad.className = 'sd-pad';
		for (let d = 1; d <= 10; d++) {
			const key = document.createElement('button');
			key.type = 'button';
			key.className = 'sd-key';
			key.textContent = d <= 9 ? String(d) : '⌫';
			key.addEventListener('click', () => enter(d <= 9 ? d : 0));
			pad.appendChild(key);
		}
		wrap.append(grid, pad);
		root.appendChild(wrap);

		// Every cell that duplicates a filled digit in its row/col/box.
		function conflictSet() {
			const seen = new Map(), bad = new Set();
			for (let i = 0; i < 81; i++) {
				const v = entries[i];
				if (!v) continue;
				for (const key of [`r${(i / 9) | 0}.${v}`, `c${i % 9}.${v}`, `b${BOX[i]}.${v}`]) {
					if (seen.has(key)) { bad.add(i); bad.add(seen.get(key)); }
					else seen.set(key, i);
				}
			}
			return bad;
		}

		function render() {
			const bad = conflictSet();
			const selVal = selected >= 0 ? entries[selected] : 0;
			for (let i = 0; i < 81; i++) {
				const el = cellEls[i];
				el.textContent = entries[i] ? String(entries[i]) : '';
				el.classList.toggle('sd-sel', i === selected);
				el.classList.toggle('sd-same', selVal > 0 && i !== selected && entries[i] === selVal);
				el.classList.toggle('sd-conflict', bad.has(i));
			}
			return bad;
		}

		function report(bad) {
			let filled = 0;
			for (let i = 0; i < 81; i++) if (!isGiven[i] && entries[i]) filled++;
			ctx.progress({ type: 'sudoku', filled, total, pct: total ? filled / total : 1,
				mini: { w: 9, h: 9, p: ['#6b7280', '#2563eb'],
					c: entries.map((v, i) => isGiven[i] ? 0 : v ? 1 : -1) } });
			ctx.sendStuck?.(bad.size > 0);
			if (entries.join('') === solution) {
				done = true;
				ctx.setStatus('Solved!', 'won');
				ctx.finish();
			} else if (bad.size) ctx.setStatus(`${bad.size} conflict${bad.size > 1 ? 's' : ''}`, 'bad');
			else if (filled) ctx.setStatus('Looking good', 'ok');
			else ctx.setStatus('', '');
		}

		function enter(v) {
			if (done || selected < 0 || isGiven[selected] || entries[selected] === v) return;
			entries[selected] = v;
			report(render());
		}

		function onKey(e) {
			if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
			if (e.key >= '1' && e.key <= '9') enter(Number(e.key));
			else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') { enter(0); e.preventDefault(); }
			else if (e.key.startsWith('Arrow') && selected >= 0) {
				const next = selected + { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -9, ArrowDown: 9 }[e.key];
				if (next >= 0 && next < 81) { selected = next; render(); }
				e.preventDefault();
			}
		}
		document.addEventListener('keydown', onKey);
		report(render());	// initial paint + empty-board snapshot for spectators

		return { destroy() {
			document.removeEventListener('keydown', onKey);
			wrap.remove();
		} };
	},

	renderMini(el, progress, payload) {
		injectStyles();
		const total = progress?.total
			?? (payload ? [...payload.givens].filter(ch => ch === '0').length : 0);
		const filled = progress?.filled ?? 0;
		const m = progress?.mini;
		if (m) {	// live board snapshot
			const s = m.w > 10 ? 5 : 7;
			el.innerHTML = `<div class="sd-mini-board" style="grid-template-columns: repeat(${m.w}, ${s}px); grid-auto-rows: ${s}px;">`
				+ m.c.map(v => `<div class="sd-mini-c"${v >= 0 ? ` style="background:${m.p[v]}"` : ''}></div>`).join('')
				+ `</div><span class="sd-mini-n">${filled}/${total}</span>`;
			return;
		}
		const pct = total ? Math.round(filled / total * 100) : 0;
		el.innerHTML = `<span class="sd-mini"><span class="sd-mini-bar">`
			+ `<span class="sd-mini-fill" style="width:${pct}%"></span></span>${filled}/${total}</span>`;
	},
};
