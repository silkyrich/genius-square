// Minesweeper race game module — everyone clears the same seeded minefield.
// Hitting a mine costs a 10s lockout (not elimination); first to reveal every
// safe cell wins. Pure helpers (mineSetFromSeed, counts, floodReveal) are
// exported for tests; nothing touches the DOM until mount().

const DIFFS = {
	easy: { w: 8, h: 8, mines: 10 },
	medium: { w: 10, h: 10, mines: 18 },
	hard: { w: 12, h: 12, mines: 30 },
};

// Small deterministic PRNG so every player derives the same field from seed.
function mulberry32(a) {
	return function () {
		a = (a + 0x6D2B79F5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// 8-neighbour indices of cell i on a w×h grid.
function neighbours(i, w, h) {
	const r = Math.floor(i / w), c = i % w, out = [];
	for (let dr = -1; dr <= 1; dr++)
		for (let dc = -1; dc <= 1; dc++) {
			const nr = r + dr, nc = c + dc;
			if ((dr || dc) && nr >= 0 && nr < h && nc >= 0 && nc < w)
				out.push(nr * w + nc);
		}
	return out;
}

// Mine positions as a Set of indices. The start cell and its 8 neighbours
// are kept mine-free so the opening tap always flood-reveals.
export function mineSetFromSeed(seed, w, h, mines, start) {
	const rng = mulberry32(seed >>> 0);
	const safe = new Set([start, ...neighbours(start, w, h)]);
	const pool = [];
	for (let i = 0; i < w * h; i++) if (!safe.has(i)) pool.push(i);
	for (let i = pool.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[pool[i], pool[j]] = [pool[j], pool[i]];
	}
	return new Set(pool.slice(0, mines));
}

// Adjacent-mine count per cell. -> array of w*h numbers.
export function counts(mineSet, w, h) {
	const out = new Array(w * h).fill(0);
	for (let i = 0; i < out.length; i++)
		for (const n of neighbours(i, w, h))
			if (mineSet.has(n)) out[i]++;
	return out;
}

// Cells revealed by tapping i: just i if numbered, the whole connected zero
// region plus its numeric border if i counts zero. Never includes a mine.
export function floodReveal(mineSet, countsArr, w, h, i) {
	if (mineSet.has(i)) return new Set();
	const out = new Set([i]);
	const queue = countsArr[i] === 0 ? [i] : [];
	while (queue.length) {
		for (const n of neighbours(queue.pop(), w, h)) {
			if (out.has(n) || mineSet.has(n)) continue;
			out.add(n);
			if (countsArr[n] === 0) queue.push(n);
		}
	}
	return out;
}

const CSS = `
.ms-wrap { display: flex; flex-direction: column; gap: 10px; align-items: center; }
.ms-grid {
	display: grid; gap: 2px; padding: 6px;
	background: var(--board-bg); border-radius: 14px;
}
.ms-cell {
	width: 100%; height: 100%; padding: 0; border: none; border-radius: 3px;
	background: var(--cell); color: var(--text); font-weight: 700;
	font-size: calc(var(--ms-c) * .5); line-height: 1; cursor: pointer;
	user-select: none; -webkit-user-select: none; touch-action: manipulation;
}
.ms-cell.ms-open { background: var(--surface-2); cursor: default; }
.ms-cell.ms-boom { background: var(--bad); cursor: default; }
.ms-cell[data-n="1"] { color: #1976d2; }
.ms-cell[data-n="2"] { color: #388e3c; }
.ms-cell[data-n="3"] { color: #d32f2f; }
.ms-cell[data-n="4"] { color: #303f9f; }
.ms-cell[data-n="5"] { color: #8b1a1a; }
.ms-cell[data-n="6"] { color: #00838f; }
.ms-cell[data-n="7"] { color: #212121; }
.ms-cell[data-n="8"] { color: #616161; }
.ms-row { display: flex; gap: 8px; width: min(92vw, 410px); }
.ms-btn {
	flex: 1; padding: .55rem; border-radius: 8px; border: 1px solid var(--border);
	background: var(--surface); color: var(--text); font-weight: 600; cursor: pointer;
}
.ms-btn.ms-on { background: var(--accent); border-color: var(--accent); color: #fff; }
.ms-hint { text-align: center; color: var(--muted); font-size: .85rem; }
.ms-mini-bar { height: 4px; border-radius: 2px; background: var(--border); overflow: hidden; margin-top: 3px; }
.ms-mini-fill { height: 100%; background: var(--accent); }
`;

function injectStyles() {
	if (document.querySelector('style[data-game="mines"]')) return;
	const s = document.createElement('style');
	s.dataset.game = 'mines';
	s.textContent = CSS;
	document.head.appendChild(s);
}

export default {
	key: 'mines',
	name: 'Minesweeper',
	icon: '💣',
	blurb: 'Same minefield for everyone. First to clear it wins.',
	scoreMode: 'race',
	durationMs: 0,
	optionDefs: [
		{ key: 'difficulty', label: 'Difficulty', type: 'select', default: 'medium',
		  choices: [{value:'easy',label:'Easy — 8×8, 10 mines'},{value:'medium',label:'Medium — 10×10, 18 mines'},{value:'hard',label:'Hard — 12×12, 30 mines'}] },
	],

	// Runs once on the proposer's machine; everyone else replays the seed.
	async createPuzzle(options) {
		const seed = (Math.random() * 0x100000000) >>> 0;
		const { w, h, mines } = DIFFS[options?.difficulty] ?? DIFFS.medium;
		const start = (h >> 1) * w + (w >> 1);	// centre-ish guaranteed-safe opening
		return { seed, w, h, mines, start, summary: `Minesweeper — ${w}×${h}, ${mines} mines` };
	},

	mount(root, ctx) {
		injectStyles();
		const { seed, w, h, mines, start } = ctx.payload;
		const totalSafe = w * h - mines;
		const mineSet = mineSetFromSeed(seed >>> 0, w, h, mines, start);
		const nums = counts(mineSet, w, h);
		const revealed = new Set(), flagged = new Set(), exploded = new Set();
		let booms = 0, done = false, locked = false, flagMode = false;
		let lockTimer = null, pressTimer = null, longPressed = false;

		root.innerHTML = `
			<div class="ms-wrap">
				<div class="ms-grid" style="--ms-c: calc(min(92vw, 410px) / ${w});
					grid-template-columns: repeat(${w}, var(--ms-c));
					grid-template-rows: repeat(${h}, var(--ms-c));">${nums.map((_, i) =>
					`<button type="button" class="ms-cell" data-i="${i}"></button>`).join('')}</div>
				<div class="ms-row">
					<button type="button" class="ms-btn" data-act="flag">🚩 Flag mode: off</button>
				</div>
				<div class="ms-hint">Tap to reveal · long-press or flag mode to flag · mines cost 10s</div>
			</div>`;

		const cells = [...root.querySelectorAll('.ms-cell')];
		const gridEl = root.querySelector('.ms-grid');
		const flagBtn = root.querySelector('[data-act="flag"]');

		function paint(i) {
			const el = cells[i];
			if (exploded.has(i)) { el.className = 'ms-cell ms-boom'; el.textContent = '💥'; return; }
			if (revealed.has(i)) {
				el.className = 'ms-cell ms-open';
				el.textContent = nums[i] || '';
				if (nums[i]) el.dataset.n = nums[i];
				return;
			}
			el.textContent = flagged.has(i) ? '🚩' : '';
		}

		const report = () => ctx.progress({ type: 'mines', cleared: revealed.size, total: totalSafe, booms });
		const tally = () => ctx.setStatus(`${revealed.size}/${totalSafe} cleared`, 'ok');

		function reveal(i) {
			if (mineSet.has(i)) return boom(i);
			for (const j of floodReveal(mineSet, nums, w, h, i)) { revealed.add(j); paint(j); }
			report();
			if (revealed.size === totalSafe && !done) {
				done = true;
				ctx.setStatus('★ cleared!', 'won');
				ctx.finish();
			} else tally();
		}

		function boom(i) {
			exploded.add(i);
			flagged.delete(i);
			paint(i);
			booms++;
			report();
			locked = true;
			let left = 10;
			ctx.setStatus(`boom! ${left}s…`, 'bad');
			lockTimer = setInterval(() => {
				if (--left > 0) return ctx.setStatus(`boom! ${left}s…`, 'bad');
				clearInterval(lockTimer);
				lockTimer = null;
				locked = false;
				tally();
			}, 1000);
		}

		function flag(i) {
			if (revealed.has(i) || exploded.has(i)) return;
			flagged.has(i) ? flagged.delete(i) : flagged.add(i);
			paint(i);
		}

		gridEl.addEventListener('click', e => {
			const cell = e.target.closest('.ms-cell');
			if (longPressed) { longPressed = false; return; }	// click after long-press flag
			if (!cell || done || locked) return;
			const i = Number(cell.dataset.i);
			if (revealed.has(i) || exploded.has(i)) return;
			if (flagMode) return flag(i);
			if (!flagged.has(i)) reveal(i);
		});
		gridEl.addEventListener('pointerdown', e => {
			longPressed = false;	// fresh press; stale flag must not swallow this tap
			const cell = e.target.closest('.ms-cell');
			if (!cell || done || locked) return;
			pressTimer = setTimeout(() => { longPressed = true; flag(Number(cell.dataset.i)); }, 350);
		});
		for (const ev of ['pointerup', 'pointercancel', 'pointerleave'])
			gridEl.addEventListener(ev, () => clearTimeout(pressTimer));
		gridEl.addEventListener('contextmenu', e => e.preventDefault());
		flagBtn.addEventListener('click', () => {
			flagMode = !flagMode;
			flagBtn.classList.toggle('ms-on', flagMode);
			flagBtn.textContent = `🚩 Flag mode: ${flagMode ? 'on' : 'off'}`;
		});

		reveal(start);	// pre-reveal the guaranteed-safe opening (zero-floods)
		return {
			destroy() {
				clearInterval(lockTimer);
				clearTimeout(pressTimer);
				root.innerHTML = '';
			},
		};
	},

	renderMini(el, progress) {
		if (!progress) { el.textContent = 'not started'; return; }
		const pct = progress.total ? Math.round(100 * progress.cleared / progress.total) : 0;
		el.innerHTML = `${progress.cleared}/${progress.total} · ${progress.booms ?? 0}💥
			<div class="ms-mini-bar"><div class="ms-mini-fill" style="width:${pct}%"></div></div>`;
	},
};
