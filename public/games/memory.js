// Memory pairs game module — flip cards two at a time, match all the pairs
// first. The layout is derived deterministically from the seed so every
// player races on the same shuffle. Pure helpers (FACES, layoutFromSeed)
// are exported for tests; nothing touches the DOM until mount().

// Card faces — distinct, visually clear emoji.
export const FACES = [
	'🐶','🐱','🦊','🐼','🐸','🐵','🦁','🐷','🐮','🐔',
	'🦉','🐙','🦀','🐢','🦋','🍎','🍌','🍇','🍓','🍉',
];

// Small deterministic PRNG so every player derives the same layout from seed.
function mulberry32(a) {
	return function () {
		a = (a + 0x6D2B79F5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// Pick w*h/2 faces from a seeded shuffle of FACES, duplicate, shuffle the
// deck. -> array of w*h face indices, each appearing exactly twice.
export function layoutFromSeed(seed, w, h) {
	const rng = mulberry32(seed >>> 0);
	const shuffle = arr => {
		for (let i = arr.length - 1; i > 0; i--) {
			const j = Math.floor(rng() * (i + 1));
			[arr[i], arr[j]] = [arr[j], arr[i]];
		}
		return arr;
	};
	const pool = shuffle(FACES.map((_, i) => i)).slice(0, (w * h) / 2);
	return shuffle([...pool, ...pool]);
}

const SIZES = {
	'4x4': { w: 4, h: 4 },
	'4x5': { w: 4, h: 5 },
	'6x6': { w: 6, h: 6 },
};

const CSS = `
.mm-wrap { display: flex; flex-direction: column; gap: 10px; width: min(92vw, 410px); margin: 0 auto; }
.mm-board {
	display: grid; gap: 6px; padding: 8px;
	background: var(--board-bg); border-radius: 14px;
}
.mm-card {
	aspect-ratio: 1; padding: 0; border: none; background: none;
	perspective: 600px; cursor: pointer;
	user-select: none; -webkit-user-select: none; touch-action: manipulation;
}
.mm-in {
	position: relative; width: 100%; height: 100%;
	transform-style: preserve-3d; transition: transform .3s ease;
}
.mm-card.mm-up .mm-in { transform: rotateY(180deg); }
.mm-face {
	position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
	border: 1px solid var(--border); border-radius: 8px; backface-visibility: hidden;
}
.mm-back { background: var(--cell); color: var(--muted); font-size: .9em; }
.mm-front { background: var(--surface-2); transform: rotateY(180deg); }
.mm-card.mm-done { cursor: default; }
.mm-card.mm-done .mm-front { background: color-mix(in srgb, var(--ok) 22%, var(--surface-2)); border-color: var(--ok); }
.mm-moves { text-align: center; font-weight: 700; color: var(--text); }
.mm-hint { text-align: center; color: var(--muted); font-size: .85rem; }
.mm-mini-bar { height: 4px; border-radius: 2px; background: var(--border); overflow: hidden; margin-top: 3px; }
.mm-mini-fill { height: 100%; background: var(--accent); }
.mm-mini { display: grid; gap: 1px; padding: 2px; background: var(--board-bg); border-radius: 4px; width: max-content; }
.mm-mini div { width: 7px; height: 7px; }
.mm-mini .mm-dim { background: var(--cell); opacity: .35; }
`;

function injectStyles() {
	if (document.querySelector('style[data-game="memory"]')) return;
	const s = document.createElement('style');
	s.dataset.game = 'memory';
	s.textContent = CSS;
	document.head.appendChild(s);
}

export default {
	key: 'memory',
	name: 'Memory pairs',
	icon: '🎴',
	blurb: 'Same shuffled cards for everyone. Match all the pairs first.',
	scoreMode: 'race',
	durationMs: 0,
	optionDefs: [
		{ key: 'size', label: 'Board size', type: 'select', default: '4x4',
		  choices: [{value:'4x4',label:'4×4 — 8 pairs'},{value:'4x5',label:'4×5 — 10 pairs'},{value:'6x6',label:'6×6 — 18 pairs'}] },
	],

	// Runs once on the proposer's machine; everyone else replays the seed.
	async createPuzzle(options) {
		const seed = (Math.random() * 0x100000000) >>> 0;
		const { w, h } = SIZES[options?.size] ?? SIZES['4x4'];
		return { seed, w, h, summary: `Memory pairs — ${w}×${h}, ${(w * h) / 2} pairs` };
	},

	mount(root, ctx) {
		injectStyles();
		const w = Number(ctx.payload.w ?? 4), h = Number(ctx.payload.h ?? 4);
		const layout = layoutFromSeed(ctx.payload.seed >>> 0, w, h);
		const total = (w * h) / 2;
		let first = -1, matched = 0, moves = 0;
		let locked = false, done = false, peekTimer = 0;
		const matchedCells = new Set();	// card indices already paired

		root.innerHTML = `
			<div class="mm-wrap">
				<div class="mm-board" style="grid-template-rows: repeat(${h}, 1fr); grid-template-columns: repeat(${w}, 1fr); font-size: ${w >= 6 ? '1.4rem' : '2rem'};">${layout.map((f, i) =>
					`<button type="button" class="mm-card" data-i="${i}" aria-label="card ${i + 1}">
						<span class="mm-in"><span class="mm-face mm-back">?</span><span class="mm-face mm-front">${FACES[f]}</span></span>
					</button>`).join('')}</div>
				<div class="mm-moves">0/${total} pairs · 0 moves</div>
				<div class="mm-hint">Tap two cards. Match every pair to win.</div>
			</div>`;

		const cards = [...root.querySelectorAll('.mm-card')];
		const movesEl = root.querySelector('.mm-moves');

		// Tiny board snapshot for renderMini: matched cards in palette 0.
		function miniSnap() {
			return { w, h, p: ['#16a34a'], c: layout.map((_, i) => matchedCells.has(i) ? 0 : -1) };
		}

		// Both flips done: report progress, maybe win. Called for every pair.
		function resolve() {
			movesEl.textContent = `${matched}/${total} pairs · ${moves} moves`;
			ctx.progress({ type: 'memory', matched, total, moves, pct: matched / total, mini: miniSnap() });
			if (matched === total) {
				done = true;	// lock input; finish only once
				ctx.setStatus('★ all matched!', 'won');
				ctx.finish();
			} else {
				ctx.setStatus(`${matched}/${total} pairs · ${moves} moves`, 'ok');
			}
		}

		root.querySelector('.mm-board').addEventListener('click', e => {
			const card = e.target.closest('.mm-card');
			if (!card || locked || done) return;
			const i = Number(card.dataset.i);
			if (i === first || card.classList.contains('mm-done')) return;
			card.classList.add('mm-up');
			if (first < 0) { first = i; return; }
			const a = cards[first];
			first = -1;
			moves++;
			if (layout[Number(a.dataset.i)] === layout[i]) {
				a.classList.add('mm-done');
				card.classList.add('mm-done');
				matchedCells.add(Number(a.dataset.i)).add(i);
				matched++;
				resolve();
			} else {
				locked = true;	// let both faces show during the peek
				peekTimer = setTimeout(() => {
					a.classList.remove('mm-up');
					card.classList.remove('mm-up');
					locked = false;
					resolve();
				}, 700);
			}
		});

		ctx.setStatus(`0/${total} pairs · 0 moves`, 'ok');
		ctx.progress({ type: 'memory', matched: 0, total, moves: 0, pct: 0, mini: miniSnap() });	// announce presence
		return {
			destroy() {
				clearTimeout(peekTimer);
				root.innerHTML = '';
			},
		};
	},

	renderMini(el, progress) {
		if (!progress) { el.textContent = 'not started'; return; }
		if (progress.mini) {
			const { w, p, c } = progress.mini;
			el.innerHTML = `<div class="mm-mini" style="grid-template-columns: repeat(${w}, 7px);">${
				c.map(v => v < 0 ? '<div class="mm-dim"></div>' : `<div style="background:${p[v]}"></div>`).join('')
			}</div>${progress.matched}/${progress.total}`;
			return;
		}
		const pct = progress.total ? Math.round(100 * progress.matched / progress.total) : 0;
		el.innerHTML = `${progress.matched}/${progress.total} · ${progress.moves ?? 0} moves
			<div class="mm-mini-bar"><div class="mm-mini-fill" style="width:${pct}%"></div></div>`;
	},
};
