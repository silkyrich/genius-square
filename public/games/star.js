// Genius Star — the triangular sequel to Genius Square, as a party game
// module. A six-pointed star of 48 unit triangles; 7 pearl blockers; first
// player to tile the other 41 triangles with the 11 polyiamonds wins.
//
// Lattice: cell = (row, col); triangle points UP when (row+col) is even.
// Adjacency: (r,c-1) and (r,c+1) always; an UP cell also borders (r+1,c)
// BELOW it, a DOWN cell also borders (r-1,c) ABOVE it.
//
// The hexagram is the union of an up size-6 triangle (apex row 0, col 6)
// and a down size-6 triangle (apex row 7, col 6); they overlap in the
// side-2 central hexagon (24 cells), so 36 + 36 - 24 = 48. Column spans:
//   row:   0     1     2      3      4      5      6     7
//   cols:  6..6  5..7  1..11  2..10  2..10  1..11  5..7  6..6
// 180° rotation is (r,c) -> (7-r, 12-c); note it flips up/down parity.

// ---------- board ----------
const ROWSPEC = [[6, 6], [5, 7], [1, 11], [2, 10], [2, 10], [1, 11], [5, 7], [6, 6]];
export const STAR_CELLS = [];
const CELL_INDEX = new Map();
ROWSPEC.forEach(([lo, hi], r) => {
	for (let c = lo; c <= hi; c++) {
		CELL_INDEX.set(r + ',' + c, STAR_CELLS.length);
		STAR_CELLS.push([r, c]);
	}
});
export const idxAt = (r, c) => CELL_INDEX.get(r + ',' + c) ?? -1;
const isUp = (r, c) => ((r + c) & 1) === 0;

// ---------- pieces ----------
// Orientations are generated from each base shape by closing over a 60°
// rotation and a mirror. rot60 works geometrically: map each triangle to
// its centroid, rotate about a lattice vertex, map back (exact up to fp).
// Vertices sit at half-odd x (cell (r,c) spans x = c/2 .. c/2+1, apex at
// (c+1)/2), so rotate about the vertex (0.5, 0) — i.e. shift x by -0.5.
const RT = Math.sqrt(3) / 2;
function rot60(cells) {
	return cells.map(([r, c]) => {
		const x = c / 2, y = (r + (isUp(r, c) ? 2 / 3 : 1 / 3)) * RT;
		const x2 = 0.5 * x - RT * y, y2 = RT * x + 0.5 * y;
		const r2 = Math.floor(y2 / RT + 1e-6);
		const c2 = Math.round(2 * x2);
		if (isUp(r2, c2) !== (y2 / RT - r2 > 0.5)) throw new Error('rot60 parity');
		return [r2, c2];
	});
}
const mirror = cells => cells.map(([r, c]) => [r, -c]);
// Translations must keep (r+c) parity, so columns normalize to min 0 OR 1.
function normalize(cells) {
	const tr = -Math.min(...cells.map(p => p[0]));
	let tc = -Math.min(...cells.map(p => p[1]));
	if ((tr + tc) & 1) tc++;
	return cells.map(([r, c]) => [r + tr, c + tc]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}
const shapeKey = cells => cells.map(p => p.join(',')).join(';');
function orientationsOf(base) {
	const seen = new Map();
	let cur = base;
	for (let i = 0; i < 6; i++) {
		for (const v of [cur, mirror(cur)]) {
			const n = normalize(v);
			seen.set(shapeKey(n), n);
		}
		cur = rot60(cur);
	}
	return [...seen.values()];
}

// 11 pieces, sizes 1+2+3+3+4+4+4+5+5+5+5 = 41: every free polyiamond up to
// size 5, plus a second copy of the (unique) triamond — like the real set,
// the gold single triangle is the star piece.
const SHAPES = [
	['single', '#facc15', [[0, 0]]],
	['rhomb',  '#b45309', [[0, 0], [0, 1]]],
	['tri3a',  '#fb7185', [[0, 0], [0, 1], [0, 2]]],
	['tri3b',  '#94a3b8', [[0, 0], [0, 1], [0, 2]]],
	['bigtri', '#22c55e', [[0, 0], [1, -1], [1, 0], [1, 1]]],
	['bar4',   '#3b82f6', [[0, 0], [0, 1], [0, 2], [0, 3]]],
	['hook4',  '#a855f7', [[0, 0], [0, 1], [0, 2], [1, 0]]],
	['bar5',   '#ef4444', [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]]],
	['hook5',  '#0ea5e9', [[0, 0], [0, 1], [0, 2], [0, 3], [1, 0]]],
	['peak5',  '#14b8a6', [[0, 0], [1, -1], [1, 0], [1, 1], [1, 2]]],
	['crown5', '#e879f9', [[0, 0], [0, 1], [0, 2], [1, 0], [1, 2]]],
];
export const PIECES = SHAPES.map(([key, color, cells]) =>
	({ key, color, size: cells.length, orients: orientationsOf(cells) }));
export const PIECE_INDEX = Object.fromEntries(PIECES.map((p, i) => [p.key, i]));
const TRI3A = PIECE_INDEX.tri3a, TRI3B = PIECE_INDEX.tri3b;

// ---------- placements + solver (48-bit BigInt masks) ----------
const BIT = Array.from({ length: 48 }, (_, i) => 1n << BigInt(i));
const maskOf = cells => cells.reduce((m, c) => m | BIT[c], 0n);

// placements[pieceIdx] = every in-star translation of every orientation.
export const placements = PIECES.map((piece, pi) => {
	const out = [];
	for (const orient of piece.orients) {
		const [ar, ac] = orient[0];
		for (const [r0, c0] of STAR_CELLS) {
			if (((r0 + c0) & 1) !== ((ar + ac) & 1)) continue;	// parity-safe shift
			const cells = [];
			for (const [r, c] of orient) {
				const j = idxAt(r0 + r - ar, c0 + c - ac);
				if (j < 0) break;
				cells.push(j);
			}
			if (cells.length === orient.length)
				out.push({ piece: pi, cells, mask: maskOf(cells) });
		}
	}
	return out;
});

// DFS fills the lowest empty cell each step; index placements by cell,
// bigger pieces first. The duplicate triamond is symmetry-broken (tri3b
// only after tri3a) so identical tilings are not visited twice.
const byCell = Array.from({ length: 48 }, () => []);
for (const list of placements)
	for (const pl of list)
		for (const c of pl.cells) byCell[c].push(pl);
for (const list of byCell) list.sort((a, b) => PIECES[b.piece].size - PIECES[a.piece].size);

// Find one tiling. 'fixed' pins player-placed pieces: { pieceIdx: cells }.
// Returns { pieceIdx: cells } for all 11 pieces, or null.
export function solve(blockers, fixed = {}) {
	let used = maskOf(blockers);
	let have = 0;
	const result = {};
	for (const [k, cells] of Object.entries(fixed)) {
		const m = maskOf(cells);
		if (used & m) return null;
		used |= m; have |= 1 << +k;
		result[+k] = cells;
	}
	const stack = [];
	function dfs(used, have, from) {
		let at = from;
		while (at < 48 && (used & BIT[at])) at++;
		if (at === 48) return true;
		for (const pl of byCell[at]) {
			const pb = 1 << pl.piece;
			if ((have & pb) || (used & pl.mask)) continue;
			if (pl.piece === TRI3B && !(have & (1 << TRI3A))) continue;
			stack.push(pl);
			if (dfs(used | pl.mask, have | pb, at + 1)) return true;
			stack.pop();
		}
		return false;
	}
	if (!dfs(used, have, 0)) return null;
	for (const pl of stack) result[pl.piece] = pl.cells;
	return result;
}

// Count tilings, stopping at 'cap'. Exact below the cap.
export function countSolutions(blockers, cap = 300) {
	const blocked = maskOf(blockers);
	let count = 0;
	function dfs(used, have, from) {
		let at = from;
		while (at < 48 && (used & BIT[at])) at++;
		if (at === 48) return ++count >= cap;
		for (const pl of byCell[at]) {
			const pb = 1 << pl.piece;
			if ((have & pb) || (used & pl.mask)) continue;
			if (pl.piece === TRI3B && !(have & (1 << TRI3A))) continue;
			if (dfs(used | pl.mask, have | pb, at + 1)) return true;
		}
		return false;
	}
	dfs(blocked, 0, 0);
	return count;
}

// ---------- puzzle generation ----------
// Bands calibrated against capped counts (cap 300) of 300 random 7-blocker
// sets: 0 sols 35%, 1-39 ~6%, 40-199 ~10%, cap ~49%. So 'hard' here means
// 1-39 tilings — counts under 6 are too rare to rejection-sample in budget.
const COUNT_CAP = 300;
const BANDS = { easy: [200, Infinity], medium: [40, 199], hard: [1, 39] };
const TIER_LABELS = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

function sampleBlockers(rng) {
	const out = [];
	while (out.length < 7) {
		const c = Math.floor(rng() * 48);
		if (!out.includes(c)) out.push(c);
	}
	return out.sort((a, b) => a - b);
}

// Cheap prefilter: blockers often strand a star tip. If the empty cells'
// component sizes cannot be partitioned into sums of piece sizes, count = 0.
const NEIGHBORS = STAR_CELLS.map(([r, c]) =>
	[[r, c - 1], [r, c + 1], isUp(r, c) ? [r + 1, c] : [r - 1, c]]
		.map(([nr, nc]) => idxAt(nr, nc)).filter(i => i >= 0));
const PIECE_SIZES = PIECES.map(p => p.size).sort((a, b) => b - a);
function componentSizes(blockers) {
	const seen = new Set(blockers), sizes = [];
	for (let i = 0; i < 48; i++) {
		if (seen.has(i)) continue;
		let size = 0;
		const queue = [i];
		seen.add(i);
		while (queue.length) {
			size++;
			for (const j of NEIGHBORS[queue.pop()])
				if (!seen.has(j)) { seen.add(j); queue.push(j); }
		}
		sizes.push(size);
	}
	return sizes;
}
function sizesFeasible(sizes, avail = PIECE_SIZES) {
	if (!sizes.length) return true;
	const [s, ...rest] = sizes;
	const used = new Set();
	const pick = (i, need) => {
		if (need === 0) return sizesFeasible(rest, avail.filter((_, j) => !used.has(j)));
		if (need < 0 || i >= avail.length) return false;
		used.add(i);
		if (pick(i + 1, need - avail[i])) return true;
		used.delete(i);
		let j = i;
		while (j < avail.length && avail[j] === avail[i]) j++;	// skip equal sizes
		return pick(j, need);
	};
	return pick(0, s);
}

// Rejection-sample until the capped count lands in the difficulty band.
export function generateBlockers(difficulty, rng = Math.random, budgetMs = 1700) {
	const [lo, hi] = BANDS[difficulty] || BANDS.medium;
	const t0 = Date.now();
	let best = null, bestGap = Infinity;
	for (let tries = 0; tries < 4000; tries++) {
		const blockers = sampleBlockers(rng);
		if (!sizesFeasible(componentSizes(blockers))) continue;
		const n = countSolutions(blockers, COUNT_CAP);
		if (n >= lo && n <= hi) return blockers;
		if (n > 0) {
			const gap = n < lo ? lo - n : n - hi;
			if (gap < bestGap) { bestGap = gap; best = blockers; }
		}
		if (Date.now() - t0 > budgetMs && best) break;
	}
	return best;	// closest solvable fallback if the budget runs out
}

// ---------- SVG geometry ----------
const S = 60, HY = S * RT;	// triangle side / row height in svg units
const PAD = 6;
const VIEW = `${0.5 * S - PAD} ${-PAD} ${6 * S + 2 * PAD} ${8 * HY + 2 * PAD}`;
function triPoints(r, c) {
	const xl = c / 2 * S, xm = (c + 1) / 2 * S, xr = (c + 2) / 2 * S;
	const yt = r * HY, yb = (r + 1) * HY;
	return isUp(r, c) ? `${xm},${yt} ${xl},${yb} ${xr},${yb}` : `${xl},${yt} ${xr},${yt} ${xm},${yb}`;
}
const centroid = (r, c) => [(c + 1) / 2 * S, (r + (isUp(r, c) ? 2 / 3 : 1 / 3)) * HY];

const NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}) => {
	const el = document.createElementNS(NS, tag);
	for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
	return el;
};

// Per-piece fixed viewBox (max bbox over ALL orientations) so a tray tile
// never resizes when the piece rotates — same lesson as the square game.
function orientBox(orient) {
	const xs = [], ys = [];
	for (const [r, c] of orient) {
		xs.push(c / 2 * S, (c + 2) / 2 * S);
		ys.push(r * HY, (r + 1) * HY);
	}
	const x = Math.min(...xs), y = Math.min(...ys);
	return [x, y, Math.max(...xs) - x, Math.max(...ys) - y];
}
const pieceBox = PIECES.map(p => {
	let w = 0, h = 0;
	for (const o of p.orients) {
		const [, , ow, oh] = orientBox(o);
		w = Math.max(w, ow); h = Math.max(h, oh);
	}
	return [w, h];
});

let styled = false;
function injectStyles() {
	if (styled) return; styled = true;
	const css = `
.st-wrap { display: flex; flex-direction: column; gap: .7rem; align-items: center; }
.st-board {
	width: min(92vw, 440px); height: auto; display: block; box-sizing: border-box;
	background: var(--board-bg); border-radius: 14px; padding: 8px;
	touch-action: manipulation;
}
.st-cell { stroke: var(--board-bg); stroke-width: 2.5; stroke-linejoin: round; cursor: pointer; }
.st-cell.ghost-ok { fill: var(--ok) !important; fill-opacity: .75; }
.st-cell.ghost-bad { fill: var(--bad) !important; fill-opacity: .75; }
.st-tray { display: flex; gap: .45rem; flex-wrap: wrap; justify-content: center; max-width: min(92vw, 470px); }
.st-piece {
	background: var(--surface-2); border: 2px solid transparent; border-radius: 10px;
	padding: 4px; cursor: pointer; line-height: 0;
}
.st-piece.selected { border-color: var(--accent); }
.st-piece.placed { opacity: .22; }
.st-buttons { display: flex; gap: .5rem; }
`;
	const el = document.createElement('style');
	el.dataset.game = 'star';
	el.textContent = css;
	document.head.appendChild(el);
}

export default {
	key: 'star',
	name: 'Genius Star',
	icon: '⭐',
	blurb: 'Tile the six-pointed star around seven pearls. First to fill it wins.',
	scoreMode: 'race',
	durationMs: 0,
	optionDefs: [
		{ key: 'difficulty', label: 'Difficulty', type: 'select', default: 'medium',
		  choices: Object.entries(TIER_LABELS).map(([value, label]) => ({ value, label })) },
	],

	async createPuzzle(options) {
		const tier = options.difficulty in BANDS ? options.difficulty : 'medium';
		const blockers = generateBlockers(tier);
		return { blockers, tier, summary: `Genius Star — ${TIER_LABELS[tier]}` };
	},

	mount(root, ctx) {
		injectStyles();
		const blockers = ctx.payload.blockers;
		const placed = new Map();	// pieceIdx -> [cell indices]
		let selected = null, orientIdx = 0, hoverCell = -1, armedCell = -1;
		let done = false, lastStuck = false;

		root.innerHTML = `<div class="st-wrap">
			<div class="st-board-slot"></div>
			<div class="st-tray" aria-label="piece tray"></div>
			<div class="st-buttons">
				<button class="st-rotate">⟳ rotate</button>
				<button class="st-clear">clear board</button>
			</div>
		</div>`;
		const trayEl = root.querySelector('.st-tray');

		const board = svgEl('svg', { class: 'st-board', viewBox: VIEW, 'aria-label': 'game board' });
		const defs = svgEl('defs');
		const grad = svgEl('radialGradient', { id: 'st-pearl', cx: '35%', cy: '30%', r: '75%' });
		grad.appendChild(svgEl('stop', { offset: '0%', 'stop-color': '#fff' }));
		grad.appendChild(svgEl('stop', { offset: '70%', 'stop-color': '#c9c4b8' }));
		grad.appendChild(svgEl('stop', { offset: '100%', 'stop-color': '#a39d8f' }));
		defs.appendChild(grad);
		board.appendChild(defs);

		const cellEls = STAR_CELLS.map(([r, c], i) => {
			const poly = svgEl('polygon', { class: 'st-cell', points: triPoints(r, c) });
			poly.addEventListener('pointerdown', ev => onCellPointer(i, ev), { passive: true });
			poly.addEventListener('mouseenter', () => { hoverCell = i; renderGhost(); });
			poly.addEventListener('mouseleave', () => { if (armedCell < 0) { hoverCell = -1; renderGhost(); } });
			board.appendChild(poly);
			return poly;
		});
		for (const b of blockers) {
			const [cx, cy] = centroid(...STAR_CELLS[b]);
			board.appendChild(svgEl('circle', {
				cx, cy, r: S * 0.21, fill: 'url(#st-pearl)', 'pointer-events': 'none',
			}));
		}
		root.querySelector('.st-board-slot').replaceWith(board);

		const pieceAt = cell => {
			for (const [pi, cs] of placed) if (cs.includes(cell)) return pi;
			return null;
		};
		const isEmpty = i => !blockers.includes(i) && pieceAt(i) === null;

		// Anchor the current orientation so the tapped triangle is one of the
		// piece's cells (parity must match); prefer a fully-empty placement.
		function ghostCells() {
			if (selected === null || hoverCell < 0 || placed.has(selected)) return null;
			const orients = PIECES[selected].orients;
			const orient = orients[orientIdx % orients.length];
			const [tr, tc] = STAR_CELLS[hoverCell];
			let fallback = null;
			for (const [or, oc] of orient) {
				if (((or + oc) & 1) !== ((tr + tc) & 1)) continue;
				const cells = orient.map(([r, c]) => idxAt(r + tr - or, c + tc - oc));
				if (cells.includes(-1)) continue;
				if (cells.every(isEmpty)) return cells;
				fallback ??= cells;
			}
			return fallback;
		}
		const ghostValid = cs => !!cs && cs.every(isEmpty);

		function renderGhost() {
			for (const el of cellEls) el.classList.remove('ghost-ok', 'ghost-bad');
			const cs = ghostCells();
			if (!cs) return;
			const cls = ghostValid(cs) ? 'ghost-ok' : 'ghost-bad';
			for (const i of cs) cellEls[i].classList.add(cls);
		}

		function renderBoard() {
			for (let i = 0; i < 48; i++) {
				const pi = pieceAt(i);
				cellEls[i].style.fill = pi !== null ? PIECES[pi].color : 'var(--cell)';
			}
			renderTray();
		}

		function renderTray() {
			trayEl.innerHTML = '';
			PIECES.forEach((piece, pi) => {
				const orients = piece.orients;
				const orient = orients[(pi === selected ? orientIdx : 0) % orients.length];
				const [bw, bh] = pieceBox[pi];
				const tile = svgEl('svg', {
					width: Math.round(bw / S * 26) + 10, height: Math.round(bh / S * 26) + 10,
					viewBox: `${-PAD} ${-PAD} ${bw + 2 * PAD} ${bh + 2 * PAD}`,
				});
				const [ox, oy, ow, oh] = orientBox(orient);
				const g = svgEl('g', { transform: `translate(${(bw - ow) / 2 - ox} ${(bh - oh) / 2 - oy})` });
				for (const [r, c] of orient)
					g.appendChild(svgEl('polygon', { points: triPoints(r, c), fill: piece.color }));
				tile.appendChild(g);
				const el = document.createElement('div');
				el.className = 'st-piece' + (pi === selected ? ' selected' : '') + (placed.has(pi) ? ' placed' : '');
				el.appendChild(tile);
				el.addEventListener('click', () => {
					if (placed.has(pi)) return;
					if (selected === pi) orientIdx++;	// tap again = rotate
					else { selected = pi; orientIdx = 0; }
					armedCell = -1;
					renderTray(); renderGhost();
				});
				trayEl.appendChild(el);
			});
		}

		function rotate() { orientIdx++; renderTray(); renderGhost(); }
		root.addEventListener('contextmenu', e => {	// right-click spins the held piece
			if (selected === null) return;
			e.preventDefault();
			rotate();
		});
		root.querySelector('.st-rotate').addEventListener('click', rotate);
		const onKey = e => {
			if (e.key === 'r' || e.key === 'R' || e.key === 'f' || e.key === 'F') rotate();
		};
		document.addEventListener('keydown', onKey);

		function onCellPointer(i, ev) {
			if (done) return;
			const onPiece = pieceAt(i);
			const haveSelection = selected !== null && !placed.has(selected);
			if (!haveSelection) {
				if (onPiece !== null) pickUp(onPiece);
				return;
			}
			hoverCell = i;
			if (ev.pointerType === 'touch') {
				// Two-tap on touch: first tap previews, second tap on the same
				// cell places. A second tap on an occupied cell picks THAT up.
				if (armedCell === i) {
					if (ghostValid(ghostCells())) placeSelected();
					else if (onPiece !== null) pickUp(onPiece);
					return;
				}
				armedCell = i;
				renderGhost();
				return;
			}
			if (ghostValid(ghostCells())) placeSelected();
			else if (onPiece !== null) pickUp(onPiece);
		}

		function placeSelected() {
			placed.set(selected, ghostCells());
			selected = null; armedCell = -1;
			afterChange();
		}

		function pickUp(pi) {
			const cs = placed.get(pi);
			placed.delete(pi);
			selected = pi;
			orientIdx = orientIndexFor(pi, cs);
			armedCell = -1;
			afterChange();
		}

		function orientIndexFor(pi, cells) {
			const k = shapeKey(normalize(cells.map(i => STAR_CELLS[i])));
			const at = PIECES[pi].orients.findIndex(o => shapeKey(o) === k);
			return at < 0 ? 0 : at;
		}

		root.querySelector('.st-clear').addEventListener('click', () => {
			if (done) return;
			placed.clear();
			selected = null; armedCell = -1;
			afterChange();
		});

		function afterChange() {
			renderBoard(); renderGhost();
			const covered = [...placed.values()].reduce((n, cs) => n + cs.length, 0);
			ctx.progress({ type: 'star', placed: Object.fromEntries(placed), pct: covered / 41 });
			if (covered === 41 && !done) {
				done = true;
				ctx.setStatus('★ solved!', 'won');
				ctx.finish();
				return;
			}
			if (!done) {
				const solvable = !!solve(blockers, Object.fromEntries(placed));
				ctx.setStatus(solvable ? '● solvable' : '● dead end', solvable ? 'ok' : 'bad');
				if (!solvable !== lastStuck) {
					lastStuck = !solvable;
					ctx.sendStuck(!solvable);
				}
			}
		}

		renderBoard();
		ctx.setStatus('● solvable', 'ok');
		ctx.progress({ type: 'star', placed: {}, pct: 0 });	// announce presence

		return {
			destroy() {
				done = true;
				document.removeEventListener('keydown', onKey);
			},
		};
	},

	renderMini(el, progress, payload) {
		el.innerHTML = '';
		const svg = svgEl('svg', { width: 64, height: Math.round(64 * 8 * HY / (6 * S)), viewBox: VIEW });
		const byCellColor = {};
		for (const [pi, cs] of Object.entries(progress?.placed || {}))
			for (const c of cs) byCellColor[c] = PIECES[pi].color;
		STAR_CELLS.forEach(([r, c], i) => {
			let fill = 'var(--cell, #d9d9d9)';
			if (payload?.blockers?.includes(i)) fill = '#999';
			else if (byCellColor[i]) fill = byCellColor[i];
			const poly = svgEl('polygon', { points: triPoints(r, c) });
			poly.style.fill = fill;
			svg.appendChild(poly);
		});
		el.appendChild(svg);
	},
};
