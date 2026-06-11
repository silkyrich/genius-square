// Lights Out game module — tap a light to toggle it and its orthogonal
// neighbours; race to turn the whole board off. The board is derived
// deterministically from the seed so every player races on the same puzzle.
// Pure helpers (solutionFromSeed, press, litCount) are exported for tests;
// nothing touches the DOM until mount().

// Small deterministic PRNG so every player derives the same board from seed.
function mulberry32(a) {
	return function () {
		a = (a + 0x6D2B79F5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// Toggle cell i and its orthogonal neighbours. -> new board array (0/1).
export function press(board, n, i) {
	const out = board.slice();
	const r = Math.floor(i / n), c = i % n;
	const flip = j => { out[j] = out[j] ? 0 : 1; };
	flip(i);
	if (r > 0) flip(i - n);
	if (r < n - 1) flip(i + n);
	if (c > 0) flip(i - 1);
	if (c < n - 1) flip(i + 1);
	return out;
}

export function litCount(board) {
	return board.reduce((s, v) => s + (v ? 1 : 0), 0);
}

// Scramble all-off with `presses` distinct random presses, so the board is
// always solvable (a press is its own inverse and order doesn't matter).
// If the presses happen to cancel to all-off, add one more distinct press.
// -> { board, presses: [indices] } — replaying the presses solves the board.
export function solutionFromSeed(seed, n, presses) {
	const rng = mulberry32(seed >>> 0);
	const total = n * n;
	const picked = [];
	const used = new Array(total).fill(false);
	while (picked.length < Math.min(presses, total)) {
		const i = Math.floor(rng() * total);
		if (used[i]) continue;
		used[i] = true;
		picked.push(i);
	}
	let board = new Array(total).fill(0);
	for (const i of picked) board = press(board, n, i);
	if (litCount(board) === 0) {	// rare GF(2) cancellation
		let extra = Math.floor(rng() * total);
		while (used[extra]) extra = (extra + 1) % total;
		picked.push(extra);
		board = press(board, n, extra);
	}
	return { board, presses: picked };
}

const CSS = `
.lo-wrap { display: flex; flex-direction: column; gap: 10px; width: min(92vw, 400px); margin: 0 auto; }
.lo-board {
	display: grid; gap: 6px; padding: 8px;
	background: var(--board-bg); border-radius: 14px;
}
.lo-cell {
	aspect-ratio: 1; padding: 0; border: 1px solid var(--border); border-radius: 10px;
	background: var(--cell); cursor: pointer;
	transition: background .2s ease, box-shadow .2s ease;
	user-select: none; -webkit-user-select: none; touch-action: manipulation;
}
.lo-cell.lo-lit {
	background: var(--gold); border-color: var(--gold);
	box-shadow: 0 0 14px var(--gold);
}
.lo-board.lo-won .lo-cell { cursor: default; }
.lo-moves { text-align: center; font-weight: 700; color: var(--text); }
.lo-hint { text-align: center; color: var(--muted); font-size: .85rem; }
.lo-mini-board { display: inline-grid; gap: 1px; padding: 2px; background: var(--board-bg); border-radius: 4px; }
.lo-mini-c { background: color-mix(in srgb, var(--cell) 40%, transparent); }
.lo-mini-n { display: block; font-size: .75rem; color: var(--muted); margin-top: 3px; }
`;

function injectStyles() {
	if (document.querySelector('style[data-game="lightsout"]')) return;
	const s = document.createElement('style');
	s.dataset.game = 'lightsout';
	s.textContent = CSS;
	document.head.appendChild(s);
}

export default {
	key: 'lightsout',
	name: 'Lights Out',
	icon: '💡',
	blurb: 'Tap to toggle a cross of lights. Turn them all off.',
	scoreMode: 'race',
	durationMs: 0,
	optionDefs: [
		{ key: 'size', label: 'Grid size', type: 'select', default: '5',
		  choices: [{value:'5',label:'5×5'},{value:'6',label:'6×6 — harder'}] },
		{ key: 'scrambles', label: 'Scrambles', type: 'select', default: '12',
		  choices: [{value:'8',label:'gentle'},{value:'12',label:'standard'},{value:'20',label:'chaotic'}] },
	],

	// Runs once on the proposer's machine; everyone else replays the seed.
	async createPuzzle(options) {
		const seed = (Math.random() * 0x100000000) >>> 0;
		const size = Number(options?.size ?? 5);
		const presses = Number(options?.scrambles ?? 12);
		return { seed, size, presses, summary: `Lights Out — ${size}×${size}, ${presses} scrambles` };
	},

	mount(root, ctx) {
		injectStyles();
		const seed = ctx.payload.seed >>> 0;
		const n = Number(ctx.payload.size ?? ctx.options?.size ?? 5);
		const presses = Number(ctx.payload.presses ?? 12);
		const total = n * n;
		let board = solutionFromSeed(seed, n, presses).board;
		let moves = 0, done = false;

		root.innerHTML = `
			<div class="lo-wrap">
				<div class="lo-board" style="grid-template-rows: repeat(${n}, 1fr); grid-template-columns: repeat(${n}, 1fr);">${board.map((v, i) =>
					`<button type="button" class="lo-cell${v ? ' lo-lit' : ''}" data-i="${i}" aria-label="light ${i}"></button>`).join('')}</div>
				<div class="lo-moves">0 moves</div>
				<div class="lo-hint">Tap a light to toggle it and its neighbours. Turn them all off.</div>
			</div>`;

		const cells = [...root.querySelectorAll('.lo-cell')];
		const boardEl = root.querySelector('.lo-board');
		const movesEl = root.querySelector('.lo-moves');

		const report = lit => ctx.progress({ type: 'lightsout', lit, total, moves, pct: 1 - lit / total,
			mini: { w: n, h: n, p: ['#eab308'], c: board.map(v => v ? 0 : -1) } });

		boardEl.addEventListener('click', e => {
			const cell = e.target.closest('.lo-cell');
			if (!cell || done) return;
			board = press(board, n, Number(cell.dataset.i));
			moves++;
			cells.forEach((el, i) => el.classList.toggle('lo-lit', !!board[i]));
			movesEl.textContent = `${moves} move${moves === 1 ? '' : 's'}`;
			const lit = litCount(board);
			report(lit);
			if (lit === 0) {
				done = true;	// lock input; finish only once
				boardEl.classList.add('lo-won');
				ctx.setStatus('★ all out!', 'won');
				ctx.finish();
			} else {
				ctx.setStatus(`${lit} lit · ${moves} moves`, 'ok');
			}
		});

		ctx.setStatus(`${litCount(board)} lit · 0 moves`, 'ok');
		report(litCount(board));	// initial snapshot for spectators
		return {
			destroy() { root.innerHTML = ''; },	// no document-level listeners to remove
		};
	},

	renderMini(el, progress) {
		injectStyles();
		const m = progress?.mini;
		if (m) {	// live board snapshot
			const s = m.w > 10 ? 5 : 7;
			el.innerHTML = `<div class="lo-mini-board" style="grid-template-columns: repeat(${m.w}, ${s}px); grid-auto-rows: ${s}px;">`
				+ m.c.map(v => `<div class="lo-mini-c"${v >= 0 ? ` style="background:${m.p[v]}"` : ''}></div>`).join('')
				+ `</div><span class="lo-mini-n">${progress.lit} lit · ${progress.moves} moves</span>`;
			return;
		}
		el.textContent = progress
			? `${progress.lit} lit · ${progress.moves} moves`
			: 'not started';
	},
};
