// Word Search game module — find hidden words in a 12x12 letter grid.
// Pure helpers (WORDS, layoutFromSeed, lineCells) are exported for tests;
// nothing touches the DOM or network until mount().

// Curated kid-friendly words, 4-8 letters: animals, food, household.
export const WORDS = [
	// animals
	'bear','lion','tiger','zebra','horse','sheep','goat','rabbit','mouse','otter',
	'panda','koala','camel','moose','deer','wolf','eagle','robin','goose','duck',
	'swan','frog','toad','snake','gecko','shark','whale','dolphin','octopus','crab',
	'snail','spider','beetle','donkey','monkey','gorilla','giraffe','penguin','parrot','turtle',
	'lizard','hamster','badger','beaver','weasel','ferret','falcon','pigeon','salmon','trout',
	'walrus','hedgehog','squirrel','elephant','kangaroo','flamingo',
	// food
	'apple','bread','grape','lemon','mango','melon','peach','plum','pear','kiwi',
	'rice','corn','bean','cake','milk','soup','taco','pasta','pizza','salad',
	'onion','olive','bacon','honey','sugar','butter','cheese','tomato','potato','carrot',
	'banana','cherry','orange','waffle','muffin','noodle','pickle','pepper','yogurt','biscuit',
	'pancake','pretzel','sandwich','broccoli','cucumber','porridge',
	// household
	'chair','table','couch','shelf','lamp','sofa','door','sink','oven','fork',
	'bowl','spoon','plate','clock','mirror','pillow','blanket','curtain','carpet','window',
	'garden','kitchen','bedroom','kettle','toaster','fridge','bucket','broom','towel','soap',
	'brush','candle','drawer','ladder','hammer','basket','garage','doormat','cupboard','wardrobe',
];

// Small deterministic PRNG so every player derives the same grid from seed.
function mulberry32(a) {
	return function () {
		a = (a + 0x6D2B79F5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// The 8 straight directions a word may run in.
const DIRS = [[0,1],[0,-1],[1,0],[-1,0],[1,1],[1,-1],[-1,1],[-1,-1]];

// Seeded-shuffle WORDS, place up to 14 in a size x size grid (overlaps on
// matching letters allowed, conflicts skipped), fill gaps with seeded letters.
// -> { grid: string[size*size], placed: [{ word, cells }] }
export function layoutFromSeed(seed, size = 12) {
	const rng = mulberry32(seed >>> 0);
	const pool = WORDS.slice();
	for (let i = pool.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[pool[i], pool[j]] = [pool[j], pool[i]];
	}
	const grid = new Array(size * size).fill('');
	const placed = [];
	for (const word of pool) {
		if (placed.length === 14) break;
		for (let t = 0; t < 80; t++) {
			const [dr, dc] = DIRS[Math.floor(rng() * 8)];
			const rLo = dr < 0 ? word.length - 1 : 0;
			const rHi = dr > 0 ? size - word.length : size - 1;
			const cLo = dc < 0 ? word.length - 1 : 0;
			const cHi = dc > 0 ? size - word.length : size - 1;
			const r = rLo + Math.floor(rng() * (rHi - rLo + 1));
			const c = cLo + Math.floor(rng() * (cHi - cLo + 1));
			const cells = [];
			let ok = true;
			for (let k = 0; k < word.length; k++) {
				const i = (r + dr * k) * size + (c + dc * k);
				if (grid[i] && grid[i] !== word[k]) { ok = false; break; }
				cells.push(i);
			}
			if (!ok) continue;
			cells.forEach((i, k) => { grid[i] = word[k]; });
			placed.push({ word, cells });
			break;
		}
	}
	for (let i = 0; i < grid.length; i++)
		if (!grid[i]) grid[i] = String.fromCharCode(97 + Math.floor(rng() * 26));
	return { grid, placed };
}

// Cells on the straight line from a to b (inclusive), or null if the pair
// isn't aligned horizontally, vertically, or diagonally.
export function lineCells(a, b, size) {
	const r1 = Math.floor(a / size), c1 = a % size;
	const r2 = Math.floor(b / size), c2 = b % size;
	const dr = r2 - r1, dc = c2 - c1;
	if (dr !== 0 && dc !== 0 && Math.abs(dr) !== Math.abs(dc)) return null;
	const n = Math.max(Math.abs(dr), Math.abs(dc));
	const sr = Math.sign(dr), sc = Math.sign(dc);
	const out = [];
	for (let k = 0; k <= n; k++) out.push((r1 + sr * k) * size + (c1 + sc * k));
	return out;
}

const CSS = `
.ws-wrap { display: flex; flex-direction: column; gap: 10px; max-width: 440px; margin: 0 auto; }
.ws-grid {
	display: grid; gap: 2px; padding: 6px;
	background: var(--board-bg); border-radius: 12px;
	touch-action: none; user-select: none; -webkit-user-select: none;
}
.ws-cell {
	aspect-ratio: 1; display: flex; align-items: center; justify-content: center;
	font-size: .95rem; font-weight: 600; text-transform: uppercase;
	background: var(--cell); color: var(--text); border-radius: 4px;
	cursor: pointer;
}
.ws-cell.ws-sel { background: var(--accent); color: #fff; }
.ws-cell.ws-f0 { background: #f9c4d2; color: #333; }
.ws-cell.ws-f1 { background: #c4e2f9; color: #333; }
.ws-cell.ws-f2 { background: #cdf2c4; color: #333; }
.ws-cell.ws-f3 { background: #f6e7ae; color: #333; }
.ws-words { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; }
.ws-chip {
	padding: 2px 10px; border-radius: 999px; background: var(--surface-2);
	border: 1px solid var(--border); color: var(--text); font-size: .85rem;
}
.ws-chip.ws-done { text-decoration: line-through; color: var(--muted); }
.ws-mini { display: grid; gap: 1px; padding: 2px; background: var(--board-bg); border-radius: 4px; width: max-content; }
.ws-mini div { width: 7px; height: 7px; }
.ws-mini .ws-dim { background: var(--cell); opacity: .35; }
`;

function injectStyles() {
	if (document.querySelector('style[data-game="wordsearch"]')) return;
	const s = document.createElement('style');
	s.dataset.game = 'wordsearch';
	s.textContent = CSS;
	document.head.appendChild(s);
}

function durationLabel(secs) {
	return secs === 120 ? '2 minutes' : secs === 180 ? '3 minutes' : `${secs} seconds`;
}

export default {
	key: 'wordsearch',
	name: 'Word Search',
	icon: '🔎',
	blurb: 'Find the hidden words before the clock runs out.',
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
		const { placed } = layoutFromSeed(seed, 12);
		return {
			seed,
			size: 12,
			duration: secs * 1000,
			summary: `Word Search — ${placed.length} words, ${durationLabel(secs)}`,
		};
	},

	mount(root, ctx) {
		injectStyles();
		const size = ctx.payload.size;
		const { grid, placed } = layoutFromSeed(ctx.payload.seed, size);
		const foundIdx = new Set();	// indices into placed
		let score = 0, anchor = null, dragging = false;

		root.innerHTML = `
			<div class="ws-wrap">
				<div class="ws-grid" style="grid-template-rows: repeat(${size}, 1fr); grid-template-columns: repeat(${size}, 1fr);">
					${grid.map((ch, i) => `<div class="ws-cell" data-i="${i}">${ch}</div>`).join('')}
				</div>
				<div class="ws-words">${placed.map((p, i) =>
					`<span class="ws-chip" data-w="${i}">${p.word}</span>`).join('')}</div>
			</div>`;

		const gridEl = root.querySelector('.ws-grid');
		const cells = [...root.querySelectorAll('.ws-cell')];

		// Tiny board snapshot for renderMini: found-word cells in palette 0.
		function miniSnap() {
			const c = new Array(size * size).fill(-1);
			for (const k of foundIdx) for (const i of placed[k].cells) c[i] = 0;
			return { w: size, h: size, p: ['#f59e0b'], c };
		}
		function report() {
			ctx.progress({
				type: 'wordsearch', found: foundIdx.size, total: placed.length, score,
				pct: foundIdx.size / (placed.length || 1), mini: miniSnap(),
			});
		}
		report();	// announce presence immediately

		function paintSel(sel) {
			cells.forEach((el, i) => el.classList.toggle('ws-sel', sel.includes(i)));
		}

		function cellAt(e) {
			const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('.ws-cell');
			return el ? Number(el.dataset.i) : null;
		}

		function complete(i) {
			const line = lineCells(anchor, i, size);
			anchor = null;
			paintSel([]);
			if (!line) return ctx.setStatus('not a straight line', 'bad');
			const letters = line.map(c => grid[c]).join('');
			const rev = [...letters].reverse().join('');
			const hit = placed.findIndex((p, k) =>
				!foundIdx.has(k) && (p.word === letters || p.word === rev));
			if (hit < 0) return ctx.setStatus('not one of the hidden words', 'bad');
			foundIdx.add(hit);
			const tint = `ws-f${foundIdx.size % 4}`;
			line.forEach(c => {
				cells[c].classList.remove('ws-f0', 'ws-f1', 'ws-f2', 'ws-f3');
				cells[c].classList.add(tint);
			});
			root.querySelector(`.ws-chip[data-w="${hit}"]`).classList.add('ws-done');
			score += placed[hit].word.length;
			report();
			if (foundIdx.size === placed.length) ctx.setStatus('★ all found!', 'won');
			else ctx.setStatus(`${score} pts · ${foundIdx.size}/${placed.length}`, 'ok');
		}

		gridEl.addEventListener('pointerdown', e => {
			const i = cellAt(e);
			if (i === null) return;
			e.preventDefault();
			if (anchor === null) { anchor = i; dragging = true; paintSel([i]); }
			else if (i === anchor) { anchor = null; paintSel([]); }	// tap again to cancel
			else complete(i);
		});
		gridEl.addEventListener('pointermove', e => {
			if (!dragging || anchor === null) return;
			const i = cellAt(e);
			if (i !== null) paintSel(lineCells(anchor, i, size) || [anchor]);
		});
		gridEl.addEventListener('pointerup', e => {
			if (!dragging) return;
			dragging = false;
			const i = cellAt(e);
			if (anchor !== null && i !== null && i !== anchor) complete(i);	// drag release
			else if (anchor !== null) paintSel([anchor]);	// plain tap: wait for second tap
		});

		return {
			destroy() { root.innerHTML = ''; },	// no document-level listeners to remove
			// Points mode: the app calls this at the bell. +10 bonus for a clean sweep.
			endRound() { return { points: score + (foundIdx.size === placed.length ? 10 : 0) }; },
		};
	},

	renderMini(el, progress) {
		if (progress?.mini) {
			const { w, p, c } = progress.mini;
			el.innerHTML = `<div class="ws-mini" style="grid-template-columns: repeat(${w}, 7px);">${
				c.map(v => v < 0 ? '<div class="ws-dim"></div>' : `<div style="background:${p[v]}"></div>`).join('')
			}</div>${progress.found}/${progress.total}`;
			return;
		}
		el.textContent = progress
			? `${progress.found}/${progress.total} · ${progress.score} pts`
			: 'no words yet';
	},
};
