// Trio hunt game module — spot trios where every feature matches or differs.
// Pure helpers (deckFromSeed, isTrio, findTrio) are exported for tests;
// nothing touches the DOM or network until mount().

// 4 features x 3 values each; a card stores the value index (0-2) per feature.
const FEATURES = ['count', 'shape', 'fill', 'color'];
const COLORS = ['#dc2626', '#16a34a', '#9333ea'];

// Small deterministic PRNG so every player derives the same deck from seed.
function mulberry32(a) {
	return function () {
		a = (a + 0x6D2B79F5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// All 81 cards in a seeded shuffle. Card = feature index triples 0-2 + id.
export function deckFromSeed(seed) {
	const deck = [];
	for (let i = 0; i < 81; i++) {
		deck.push({
			id: i,
			count: i % 3,
			shape: (i / 3 | 0) % 3,
			fill: (i / 9 | 0) % 3,
			color: (i / 27 | 0) % 3,
		});
	}
	const rng = mulberry32(seed >>> 0);
	for (let i = deck.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[deck[i], deck[j]] = [deck[j], deck[i]];
	}
	return deck;
}

// Name of the first feature that is neither all-same nor all-different,
// or null if the three cards form a valid trio. Values 0-2 are all-same or
// all-different exactly when their sum is divisible by 3.
function trioFault(a, b, c) {
	for (const f of FEATURES)
		if ((a[f] + b[f] + c[f]) % 3 !== 0) return f;
	return null;
}

export function isTrio(a, b, c) {
	return trioFault(a, b, c) === null;
}

// First valid trio among cards -> [i, j, k] indices, or null.
export function findTrio(cards) {
	for (let i = 0; i < cards.length; i++)
		for (let j = i + 1; j < cards.length; j++)
			for (let k = j + 1; k < cards.length; k++)
				if (isTrio(cards[i], cards[j], cards[k])) return [i, j, k];
	return null;
}

// One symbol (triangle / circle / square) as an inline SVG. Striped fill
// references a per-color <pattern> injected once alongside the styles.
function symbolSVG(card) {
	const color = COLORS[card.color];
	const fill = card.fill === 0 ? color
		: card.fill === 1 ? 'none'
		: `url(#th-stripe-${card.color})`;
	const body = card.shape === 0 ? `<polygon points="12,3 22,21 2,21"`
		: card.shape === 1 ? `<circle cx="12" cy="12" r="9.5"`
		: `<rect x="3" y="3" width="18" height="18" rx="2"`;
	return `<svg class="th-sym" viewBox="0 0 24 24" aria-hidden="true">
		${body} fill="${fill}" stroke="${color}" stroke-width="2"/></svg>`;
}

function cardHTML(card, i) {
	const syms = card ? Array(card.count + 1).fill(symbolSVG(card)).join('') : '';
	return `<button type="button" class="th-card${card ? '' : ' th-empty'}"
		data-i="${i}" ${card ? '' : 'disabled'}>${syms}</button>`;
}

const CSS = `
.th-wrap { display: flex; flex-direction: column; gap: 10px; max-width: 420px; margin: 0 auto; }
.th-grid {
	display: grid; grid-template-columns: repeat(3, 1fr); grid-template-rows: repeat(4, 1fr);
	gap: 6px; padding: 8px; background: var(--board-bg); border-radius: 14px;
}
.th-card {
	display: flex; align-items: center; justify-content: center; gap: 4px;
	min-height: 58px; padding: 6px; background: var(--cell);
	border: 2px solid var(--border); border-radius: 10px; cursor: pointer;
	user-select: none; -webkit-user-select: none; touch-action: manipulation;
}
.th-card.th-empty { background: transparent; border-style: dashed; cursor: default; }
.th-card.th-sel { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent) inset; }
.th-card.th-ok { border-color: var(--ok); box-shadow: 0 0 0 2px var(--ok) inset; }
.th-card.th-hint { border-color: var(--gold); box-shadow: 0 0 0 2px var(--gold) inset; }
.th-sym { width: 26px; height: 26px; flex: 0 0 auto; }
.th-row { display: flex; gap: 8px; }
.th-btn {
	flex: 1; padding: .55rem; border-radius: 8px; border: 1px solid var(--border);
	background: var(--surface); color: var(--text); font-weight: 600; cursor: pointer;
}
.th-btn:active { background: var(--surface-2); }
.th-total { text-align: right; font-weight: 700; color: var(--text); }
.th-total span { color: var(--muted); font-weight: 400; }
`;

// Hidden defs for the striped fill, one pattern per color.
const DEFS = `<svg width="0" height="0" style="position:absolute"><defs>${
	COLORS.map((c, i) =>
		`<pattern id="th-stripe-${i}" patternUnits="userSpaceOnUse" width="4" height="4">
			<rect width="4" height="2" fill="${c}"/>
		</pattern>`).join('')
}</defs></svg>`;

function injectStyles() {
	if (document.querySelector('style[data-game="trio"]')) return;
	const s = document.createElement('style');
	s.dataset.game = 'trio';
	s.textContent = CSS;
	document.head.appendChild(s);
}

export default {
	key: 'trio',
	name: 'Trio hunt',
	icon: '🃏',
	blurb: 'Spot trios where every feature matches or differs.',
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
			summary: `Trio hunt — ${secs} seconds`,
		};
	},

	mount(root, ctx) {
		injectStyles();
		// Same seeded deck for every player. The "replace first card until a
		// trio exists" rule is deterministic for a given board+deck state, so
		// players see identical boards until their finds diverge — after the
		// first find, divergence is expected and fine.
		const deck = deckFromSeed(ctx.payload.seed);
		const board = deck.slice(0, 12);	// 12 visible slots; null when deck is spent
		let deckPos = 12, sel = [], score = 0, found = 0;
		let done = false, lock = false, flashTimer = 0;

		root.innerHTML = `
			<div class="th-wrap">
				${DEFS}
				<div class="th-grid"></div>
				<div class="th-row">
					<button type="button" class="th-btn" data-act="hint">Hint (−2)</button>
				</div>
				<div class="th-total">0 pts <span>· 0 trios</span></div>
			</div>`;
		const gridEl = root.querySelector('.th-grid');
		const totalEl = root.querySelector('.th-total');

		// Valid trio among visible cards -> board positions, or null.
		function visibleTrio() {
			const pos = [], cards = [];
			board.forEach((c, i) => { if (c) { pos.push(i); cards.push(c); } });
			const hit = findTrio(cards);
			return hit && hit.map(i => pos[i]);
		}

		// Guarantee a trio is always on the board: cycle the first slot
		// through the deck until one appears, or declare the deck done.
		function ensureTrio() {
			while (!visibleTrio() && deckPos < deck.length)
				board[0] = deck[deckPos++];
			if (!visibleTrio()) {
				done = true;
				ctx.setStatus('deck done!', 'won');
			}
		}

		function render() {
			gridEl.innerHTML = board.map(cardHTML).join('');
			gridEl.querySelectorAll('.th-card').forEach((el, i) =>
				el.classList.toggle('th-sel', sel.includes(i)));
		}

		function setTotal() {
			totalEl.innerHTML = `${score} pts <span>· ${found} trio${found === 1 ? '' : 's'}</span>`;
		}

		function resolve() {
			const [a, b, c] = sel.map(i => board[i]);
			const fault = trioFault(a, b, c);
			if (fault) {
				score = Math.max(0, score - 1);
				sel = [];
				setTotal();
				render();
				return ctx.setStatus(`not a trio — ${fault} is two-and-one`, 'bad');
			}
			found++;
			score += 3;
			lock = true;
			sel.forEach(i => gridEl.querySelector(`[data-i="${i}"]`)?.classList.add('th-ok'));
			setTotal();
			ctx.progress({ type: 'trio', found, score });
			ctx.setStatus(`${score} pts · ${found} trios`, 'ok');
			flashTimer = setTimeout(() => {
				sel.forEach(i => { board[i] = deckPos < deck.length ? deck[deckPos++] : null; });
				sel = [];
				lock = false;
				ensureTrio();
				render();
			}, 350);
		}

		function tap(i) {
			if (done || lock || !board[i]) return;
			const k = sel.indexOf(i);
			if (k >= 0) sel.splice(k, 1);
			else sel.push(i);
			render();
			if (sel.length === 3) resolve();
		}

		function hint() {
			if (done || lock) return;
			const hit = visibleTrio();
			if (!hit) return;
			score = Math.max(0, score - 2);
			setTotal();
			ctx.setStatus(`hint — ${score} pts`, 'bad');
			const el = gridEl.querySelector(`[data-i="${hit[0]}"]`);
			el?.classList.add('th-hint');
			setTimeout(() => el?.classList.remove('th-hint'), 900);
		}

		root.querySelector('.th-wrap').addEventListener('click', e => {
			const card = e.target.closest('.th-card');
			if (card && !card.disabled) return tap(Number(card.dataset.i));
			if (e.target.closest('[data-act="hint"]')) hint();
		});

		ensureTrio();
		render();
		if (!done) ctx.setStatus('find a trio!', 'ok');

		return {
			destroy() { clearTimeout(flashTimer); root.innerHTML = ''; },
			endRound() { return { points: score }; },
		};
	},

	renderMini(el, progress) {
		el.textContent = progress
			? `${progress.found} trios · ${progress.score} pts`
			: 'no trios yet';
	},
};
