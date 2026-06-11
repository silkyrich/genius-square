// Boggle game module — 4x4 letter grid, find words before time runs out.
// Pure helpers (DICE, gridFromSeed, canForm, scoreWord) are exported for
// tests; nothing touches the DOM or network until mount().

// The 16 classic (1992) Boggle dice. Q face is 'qu'.
export const DICE = [
	['a','a','e','e','g','n'],
	['a','b','b','j','o','o'],
	['a','c','h','o','p','s'],
	['a','f','f','k','p','s'],
	['a','o','o','t','t','w'],
	['c','i','m','o','t','u'],
	['d','e','i','l','r','x'],
	['d','e','l','r','v','y'],
	['d','i','s','t','t','y'],
	['e','e','g','h','n','w'],
	['e','e','i','n','s','u'],
	['e','h','r','t','v','w'],
	['e','i','o','s','s','t'],
	['e','l','r','t','t','y'],
	['h','i','m','n','qu','u'],
	['h','l','n','n','r','z'],
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

// Shuffle dice positions, then pick a face per die. -> 16 face strings.
export function gridFromSeed(seed) {
	const rng = mulberry32(seed >>> 0);
	const order = DICE.map((_, i) => i);
	for (let i = order.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[order[i], order[j]] = [order[j], order[i]];
	}
	return order.map(d => DICE[d][Math.floor(rng() * 6)]);
}

// 8-neighbour adjacency for the 4x4 grid, cell index = row * 4 + col.
const ADJ = Array.from({ length: 16 }, (_, i) => {
	const r = i >> 2, c = i & 3, out = [];
	for (let dr = -1; dr <= 1; dr++)
		for (let dc = -1; dc <= 1; dc++) {
			const nr = r + dr, nc = c + dc;
			if ((dr || dc) && nr >= 0 && nr < 4 && nc >= 0 && nc < 4)
				out.push(nr * 4 + nc);
		}
	return out;
});

// Can 'word' be traced on the grid? DFS, no cell reuse, 'qu' face spans
// the two letters "qu".
export function canForm(grid, word) {
	word = String(word).toLowerCase();
	if (!word) return false;
	const used = new Array(16).fill(false);
	function dfs(cell, i) {
		const face = grid[cell];
		if (!word.startsWith(face, i)) return false;
		if (i + face.length === word.length) return true;
		used[cell] = true;
		for (const n of ADJ[cell])
			if (!used[n] && dfs(n, i + face.length)) { used[cell] = false; return true; }
		used[cell] = false;
		return false;
	}
	for (let c = 0; c < 16; c++) if (dfs(c, 0)) return true;
	return false;
}

// Classic scoring: 3-4 letters = 1, 5 = 2, 6 = 3, 7 = 5, 8+ = 11.
export function scoreWord(word) {
	const n = word.length;
	if (n < 3) return 0;
	return n <= 4 ? 1 : n === 5 ? 2 : n === 6 ? 3 : n === 7 ? 5 : 11;
}

const CSS = `
.bg-wrap { display: flex; flex-direction: column; gap: 10px; max-width: 360px; margin: 0 auto; }
.bg-grid {
	display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px;
	padding: 8px; background: var(--board-bg); border-radius: 14px;
}
.bg-cell {
	aspect-ratio: 1; display: flex; align-items: center; justify-content: center;
	font-size: 1.5rem; font-weight: 700; text-transform: uppercase;
	background: var(--cell); color: var(--text); border: none; border-radius: 8px;
	cursor: pointer; user-select: none; -webkit-user-select: none; touch-action: manipulation;
}
.bg-cell.bg-on { background: var(--accent); color: #fff; }
.bg-cell.bg-head { outline: 3px solid var(--ok); outline-offset: -3px; }
.bg-word {
	min-height: 1.5em; text-align: center; font-size: 1.2rem; font-weight: 700;
	letter-spacing: .1em; text-transform: uppercase; color: var(--text);
}
.bg-row { display: flex; gap: 8px; }
.bg-btn {
	flex: 1; padding: .55rem; border-radius: 8px; border: 1px solid var(--border);
	background: var(--surface); color: var(--text); font-weight: 600; cursor: pointer;
}
.bg-btn:active { background: var(--surface-2); }
.bg-btn.bg-primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.bg-input {
	flex: 1; min-width: 0; padding: .55rem; border-radius: 8px;
	border: 1px solid var(--border); background: var(--surface-2); color: var(--text);
}
.bg-found {
	display: flex; flex-wrap: wrap; gap: 6px; padding: 8px; min-height: 2.2em;
	background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px;
}
.bg-chip {
	padding: 2px 8px; border-radius: 999px; background: var(--surface);
	border: 1px solid var(--border); color: var(--text); font-size: .85rem;
}
.bg-chip b { color: var(--ok); }
.bg-total { text-align: right; font-weight: 700; color: var(--text); }
.bg-total span { color: var(--muted); font-weight: 400; }
`;

function injectStyles() {
	if (document.querySelector('style[data-game="boggle"]')) return;
	const s = document.createElement('style');
	s.dataset.game = 'boggle';
	s.textContent = CSS;
	document.head.appendChild(s);
}

function durationLabel(secs) {
	return secs === 60 ? '1 minute' : secs === 180 ? '3 minutes' : `${secs} seconds`;
}

export default {
	key: 'boggle',
	name: 'Boggle',
	icon: '🔤',
	blurb: 'Find words in the letter grid before time runs out.',
	scoreMode: 'points',
	durationMs: 90000,
	optionDefs: [
		{ key: 'duration', label: 'Round length', type: 'select', default: '90',
		  choices: [{value:'60',label:'1 minute'},{value:'90',label:'90 seconds'},{value:'180',label:'3 minutes'}] },
	],

	// Runs once on the proposer's machine; everyone else replays the seed.
	async createPuzzle(options) {
		const seed = (Math.random() * 0x100000000) >>> 0;
		const secs = Number(options?.duration ?? 90);
		return {
			seed,
			grid: gridFromSeed(seed),
			duration: secs * 1000,
			summary: `Boggle — ${durationLabel(secs)}`,
		};
	},

	mount(root, ctx) {
		injectStyles();
		const grid = ctx.payload.grid;
		const found = new Map();	// word -> points
		let dict = null, path = [], total = 0;

		root.innerHTML = `
			<div class="bg-wrap">
				<div class="bg-word">&nbsp;</div>
				<div class="bg-grid">${grid.map((f, i) =>
					`<button type="button" class="bg-cell" data-i="${i}">${f}</button>`).join('')}</div>
				<div class="bg-row">
					<button type="button" class="bg-btn" data-act="clear">Clear</button>
					<button type="button" class="bg-btn bg-primary" data-act="submit">Submit</button>
				</div>
				<div class="bg-row">
					<input class="bg-input" type="text" placeholder="…or type a word" autocomplete="off"
						autocapitalize="none" spellcheck="false" enterkeyhint="send">
				</div>
				<div class="bg-found"></div>
				<div class="bg-total">0 pts <span>· 0 words</span></div>
			</div>`;

		const cells = [...root.querySelectorAll('.bg-cell')];
		const wordEl = root.querySelector('.bg-word');
		const input = root.querySelector('.bg-input');
		const foundEl = root.querySelector('.bg-found');
		const totalEl = root.querySelector('.bg-total');

		ctx.setStatus('loading words…');
		fetch('/data/words-en.txt')
			.then(r => r.text())
			.then(t => { dict = new Set(t.split('\n')); ctx.setStatus('go!', 'ok'); })
			.catch(() => ctx.setStatus('failed to load word list', 'bad'));

		function paint() {
			const head = path[path.length - 1];
			cells.forEach((el, i) => {
				el.classList.toggle('bg-on', path.includes(i));
				el.classList.toggle('bg-head', i === head);
			});
			wordEl.innerHTML = path.length ? path.map(i => grid[i]).join('') : '&nbsp;';
		}

		function tap(i) {
			const k = path.indexOf(i);
			if (k === path.length - 1) path.pop();	// tap head again to undo
			else if (k >= 0) return;	// already used
			else if (path.length && !ADJ[path[path.length - 1]].includes(i)) return;	// not adjacent
			else path.push(i);
			paint();
		}

		function clearPath() { path = []; paint(); }

		function submit(word) {
			word = String(word).trim().toLowerCase();
			if (!word) return;
			if (!dict) return ctx.setStatus('still loading words…', 'bad');
			if (word.length < 3) return ctx.setStatus('too short — 3 letters minimum', 'bad');
			if (!canForm(grid, word)) return ctx.setStatus(`"${word}" isn't on the board`, 'bad');
			if (!dict.has(word)) return ctx.setStatus(`"${word}" isn't a word`, 'bad');
			if (found.has(word)) return ctx.setStatus(`already found "${word}"`, 'bad');
			const pts = scoreWord(word);
			found.set(word, pts);
			total += pts;
			const chip = document.createElement('span');
			chip.className = 'bg-chip';
			chip.innerHTML = `${word} <b>+${pts}</b>`;
			foundEl.prepend(chip);
			totalEl.innerHTML = `${total} pts <span>· ${found.size} word${found.size === 1 ? '' : 's'}</span>`;
			ctx.progress({ type: 'boggle', words: found.size, score: total });
			ctx.setStatus(`${total} pts`, 'ok');
			clearPath();
			input.value = '';
		}

		root.querySelector('.bg-wrap').addEventListener('click', e => {
			const cell = e.target.closest('.bg-cell');
			if (cell) return tap(Number(cell.dataset.i));
			const act = e.target.closest('[data-act]')?.dataset.act;
			if (act === 'clear') clearPath();
			if (act === 'submit') submit(path.map(i => grid[i]).join(''));
		});
		input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(input.value); });

		return {
			destroy() { root.innerHTML = ''; },	// no document-level listeners to remove
			endRound() { return { points: total }; },
		};
	},

	renderMini(el, progress) {
		el.textContent = progress
			? `${progress.words} words · ${progress.score} pts`
			: 'no words yet';
	},
};
