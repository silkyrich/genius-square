// Nonogram (Picross) game module — paint the picture from the number clues.
// The picture is derived deterministically from the seed (random noise +
// cellular-automata smoothing, nudged to 45-60% fill), so every player races
// on the same puzzle. Pure helpers (pictureFromSeed, cluesFor, satisfies)
// are exported for tests; nothing touches the DOM until mount().

// Small deterministic PRNG so every player derives the same picture from seed.
function mulberry32(a) {
	return function () {
		a = (a + 0x6D2B79F5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// Filled orthogonal neighbours of cell i — used to grow/shrink blob edges.
function orthoFilled(pic, n, i) {
	const r = Math.floor(i / n), c = i % n;
	let k = 0;
	if (r > 0 && pic[i - n]) k++;
	if (r < n - 1 && pic[i + n]) k++;
	if (c > 0 && pic[i - 1]) k++;
	if (c < n - 1 && pic[i + 1]) k++;
	return k;
}

// Random 50% noise, two majority-vote smoothing passes (organic blobs), then
// grow/shrink along blob edges until fill lands in [45%, 60%]. -> n*n 0/1s.
export function pictureFromSeed(seed, n) {
	const rng = mulberry32(seed >>> 0);
	const total = n * n;
	let pic = Array.from({ length: total }, () => rng() < 0.5 ? 1 : 0);
	for (let pass = 0; pass < 2; pass++) {
		const next = new Array(total);
		for (let r = 0; r < n; r++)
			for (let c = 0; c < n; c++) {
				let filled = 0, cells = 0;
				for (let dr = -1; dr <= 1; dr++)
					for (let dc = -1; dc <= 1; dc++) {
						const nr = r + dr, nc = c + dc;
						if (nr < 0 || nr >= n || nc < 0 || nc >= n) continue;
						cells++;
						filled += pic[nr * n + nc];
					}
				next[r * n + c] = filled * 2 >= cells ? 1 : 0;	// majority, ties fill
			}
		pic = next;
	}
	const lo = Math.ceil(total * 0.45), hi = Math.floor(total * 0.60);
	let fill = pic.reduce((s, v) => s + v, 0);
	while (fill < lo) {	// fill the empty cell hugging the most blob edge
		let best = -1, bestScore = -1;
		for (let i = 0; i < total; i++) {
			if (pic[i]) continue;
			const score = orthoFilled(pic, n, i) + rng();	// rng breaks ties
			if (score > bestScore) { bestScore = score; best = i; }
		}
		pic[best] = 1;
		fill++;
	}
	while (fill > hi) {	// erase the loneliest filled cell
		let best = -1, bestScore = 9;
		for (let i = 0; i < total; i++) {
			if (!pic[i]) continue;
			const score = orthoFilled(pic, n, i) + rng();
			if (score < bestScore) { bestScore = score; best = i; }
		}
		pic[best] = 0;
		fill--;
	}
	return pic;
}

// Run lengths of consecutive filled cells; empty line is the [0] clue.
function lineRuns(line) {
	const runs = [];
	let run = 0;
	for (const v of line) {
		if (v) run++;
		else if (run) { runs.push(run); run = 0; }
	}
	if (run) runs.push(run);
	return runs.length ? runs : [0];
}

function sameRuns(a, b) {
	return a.length === b.length && a.every((v, i) => v === b[i]);
}

function rowLine(grid, n, r) { return grid.slice(r * n, r * n + n); }
function colLine(grid, n, c) {
	const line = [];
	for (let r = 0; r < n; r++) line.push(grid[r * n + c]);
	return line;
}

// Clues for a picture: run lengths per row and per column.
export function cluesFor(picture, n) {
	const rows = [], cols = [];
	for (let r = 0; r < n; r++) rows.push(lineRuns(rowLine(picture, n, r)));
	for (let c = 0; c < n; c++) cols.push(lineRuns(colLine(picture, n, c)));
	return { rows, cols };
}

// Does the (truthy = filled) grid satisfy every row and column clue?
// Any matching grid wins, not just the generating picture.
export function satisfies(grid, clues, n) {
	for (let r = 0; r < n; r++)
		if (!sameRuns(lineRuns(rowLine(grid, n, r)), clues.rows[r])) return false;
	for (let c = 0; c < n; c++)
		if (!sameRuns(lineRuns(colLine(grid, n, c)), clues.cols[c])) return false;
	return true;
}

const CSS = `
.nn-wrap { display: flex; flex-direction: column; gap: 10px; width: min(94vw, 430px); margin: 0 auto; }
.nn-board { display: grid; gap: 1px; padding: 6px; background: var(--board-bg); border-radius: 14px; }
.nn-clue {
	display: flex; align-items: center; justify-content: flex-end; gap: 3px;
	padding: 1px 4px; color: #e8e2d6; font-size: .68rem; font-weight: 700; line-height: 1.15;
	user-select: none; -webkit-user-select: none;
}
.nn-clue.nn-col { flex-direction: column; justify-content: flex-end; gap: 0; padding: 4px 0 2px; }
.nn-clue.nn-done { color: #8d8576; opacity: .75; }
.nn-board[data-n="15"] .nn-clue { font-size: .56rem; padding: 1px 3px; }
.nn-cell {
	aspect-ratio: 1; padding: 0; border: none; border-radius: 2px;
	background: var(--cell); color: var(--muted); font-size: .7rem; font-weight: 700;
	cursor: pointer; user-select: none; -webkit-user-select: none; touch-action: manipulation;
}
.nn-cell.nn-fill { background: var(--accent); color: transparent; }
.nn-thick-l { border-left: 2px solid var(--board-bg); }
.nn-thick-t { border-top: 2px solid var(--board-bg); }
.nn-board.nn-won .nn-cell { cursor: default; }
.nn-board.nn-won .nn-cell.nn-fill { background: var(--ok); }
.nn-hint { text-align: center; color: var(--muted); font-size: .85rem; }
.nn-mini-bar { height: 4px; border-radius: 2px; background: var(--border); overflow: hidden; margin-top: 3px; }
.nn-mini-fill { height: 100%; background: var(--accent); }
`;

function injectStyles() {
	if (document.querySelector('style[data-game="nonogram"]')) return;
	const s = document.createElement('style');
	s.dataset.game = 'nonogram';
	s.textContent = CSS;
	document.head.appendChild(s);
}

export default {
	key: 'nonogram',
	name: 'Nonogram',
	icon: '🧩',
	blurb: 'Paint the picture from the number clues.',
	scoreMode: 'race',
	durationMs: 0,
	optionDefs: [
		{ key: 'size', label: 'Grid size', type: 'select', default: '10',
		  choices: [{value:'5',label:'5×5 — quick'},{value:'10',label:'10×10'},{value:'15',label:'15×15 — epic'}] },
	],

	// Runs once on the proposer's machine; everyone else replays the seed.
	async createPuzzle(options) {
		const seed = (Math.random() * 0x100000000) >>> 0;
		const size = Number(options?.size ?? 10);
		return { seed, size, summary: `Nonogram — ${size}×${size}` };
	},

	mount(root, ctx) {
		injectStyles();
		const seed = ctx.payload.seed >>> 0;
		const n = Number(ctx.payload.size ?? ctx.options?.size ?? 10);
		const clues = cluesFor(pictureFromSeed(seed, n), n);
		const state = new Array(n * n).fill(0);	// 0 empty, 1 filled, 2 ✕ mark
		let done = false;

		// Explicit row AND column tracks: implicit rows clip the board.
		const thickL = c => c > 0 && c % 5 === 0 ? ' nn-thick-l' : '';
		const thickT = r => r > 0 && r % 5 === 0 ? ' nn-thick-t' : '';
		let cells = '<div></div>' + clues.cols.map((clue, c) =>
			`<div class="nn-clue nn-col${thickL(c)}" data-col="${c}">${clue.map(x => `<span>${x}</span>`).join('')}</div>`).join('');
		for (let r = 0; r < n; r++) {
			cells += `<div class="nn-clue${thickT(r)}" data-row="${r}">${clues.rows[r].join(' ')}</div>`;
			for (let c = 0; c < n; c++)
				cells += `<button type="button" class="nn-cell${thickL(c)}${thickT(r)}" data-i="${r * n + c}"></button>`;
		}
		root.innerHTML = `
			<div class="nn-wrap">
				<div class="nn-board" data-n="${n}" style="grid-template-columns: auto repeat(${n}, 1fr); grid-template-rows: auto repeat(${n}, 1fr);">${cells}</div>
				<div class="nn-hint">Tap to cycle: fill → ✕ note → clear. ✕ is just a note.</div>
			</div>`;

		const boardEl = root.querySelector('.nn-board');
		const rowClues = [...root.querySelectorAll('[data-row]')];
		const colClues = [...root.querySelectorAll('[data-col]')];

		function refresh(report) {
			const grid = state.map(v => v === 1 ? 1 : 0);	// ✕ marks don't count
			let lines = 0;
			for (let r = 0; r < n; r++) {
				const ok = sameRuns(lineRuns(rowLine(grid, n, r)), clues.rows[r]);
				if (ok) lines++;
				rowClues[r].classList.toggle('nn-done', ok);
			}
			for (let c = 0; c < n; c++) {
				const ok = sameRuns(lineRuns(colLine(grid, n, c)), clues.cols[c]);
				if (ok) lines++;
				colClues[c].classList.toggle('nn-done', ok);
			}
			if (report) ctx.progress({ type: 'nonogram', done: lines, total: 2 * n });
			if (lines === 2 * n && !done) {
				done = true;
				boardEl.classList.add('nn-won');
				ctx.setStatus('★ solved!', 'won');
				ctx.finish();
			} else if (!done) {
				ctx.setStatus(`${lines}/${2 * n} lines`, 'ok');
			}
		}

		boardEl.addEventListener('click', e => {
			const cell = e.target.closest('.nn-cell');
			if (!cell || done) return;
			const i = Number(cell.dataset.i);
			state[i] = (state[i] + 1) % 3;
			cell.classList.toggle('nn-fill', state[i] === 1);
			cell.textContent = state[i] === 2 ? '✕' : '';
			refresh(true);
		});

		refresh(false);	// initial clue highlighting + status
		return {
			destroy() { root.innerHTML = ''; },	// no document-level listeners to remove
		};
	},

	renderMini(el, progress) {
		if (!progress) { el.textContent = 'not started'; return; }
		const done = progress.done || 0;
		const pct = progress.total ? Math.round(100 * done / progress.total) : 0;
		el.innerHTML = `${done}/${progress.total} lines
			<div class="nn-mini-bar"><div class="nn-mini-fill" style="width:${pct}%"></div></div>`;
	},
};
