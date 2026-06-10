// Genius Square solver — JS port of mitchblank/gsqsolve (bitmask DFS).
//
// The board is 6x6 = 36 cells, cell index = row * 6 + col. JS bitwise ops
// are 32-bit, so a board mask is a pair of ints: lo = cells 0..31,
// hi = cells 32..35. Masks are passed around as 2-element arrays [lo, hi].

export const ROWS = 6, COLS = 6, CELLS = 36;

export function cellIndex(row, col) { return row * 6 + col; }
export function cellName(idx) { return 'ABCDEF'[Math.floor(idx / 6)] + (idx % 6 + 1); }
export function nameToIndex(name) {
	const row = 'ABCDEF'.indexOf(name[0].toUpperCase());
	const col = Number(name[1]) - 1;
	if (row < 0 || !(col >= 0 && col < 6) || name.length !== 2) return -1;
	return cellIndex(row, col);
}

export function maskFromCells(cells) {
	let lo = 0, hi = 0;
	for (const c of cells) {
		if (c < 32) lo |= 1 << c; else hi |= 1 << (c - 32);
	}
	return [lo >>> 0, hi >>> 0];
}
export function cellsFromMask([lo, hi]) {
	const cells = [];
	for (let c = 0; c < 32; c++) if (lo & (1 << c)) cells.push(c);
	for (let c = 32; c < 36; c++) if (hi & (1 << (c - 32))) cells.push(c);
	return cells;
}
export const overlaps = (a, b) => ((a[0] & b[0]) | (a[1] & b[1])) !== 0;
export const union = (a, b) => [(a[0] | b[0]) >>> 0, (a[1] | b[1]) >>> 0];

// The nine pieces. Orientations are lists of [dr, dc] offsets from the
// bounding-box top-left; they match the placement sets in gsqsolve.cpp.
export const PIECES = [
	{ key: 'single',   color: '#2563eb', orients: [[[0,0]]] },
	{ key: 'line2',    color: '#9a3412', orients: [[[0,0],[0,1]], [[0,0],[1,0]]] },
	{ key: 'line3',    color: '#f59e0b', orients: [[[0,0],[0,1],[0,2]], [[0,0],[1,0],[2,0]]] },
	{ key: 'line4',    color: '#6b7280', orients: [[[0,0],[0,1],[0,2],[0,3]], [[0,0],[1,0],[2,0],[3,0]]] },
	{ key: 'square',   color: '#16a34a', orients: [[[0,0],[0,1],[1,0],[1,1]]] },
	{ key: 'lblock2',  color: '#9333ea', orients: [
		[[0,1],[1,0],[1,1]], [[0,0],[1,0],[1,1]], [[0,0],[0,1],[1,1]], [[0,0],[0,1],[1,0]] ] },
	{ key: 'lblock3',  color: '#0ea5e9', orients: [
		[[0,2],[1,0],[1,1],[1,2]], [[0,0],[1,0],[1,1],[1,2]],
		[[0,0],[0,1],[0,2],[1,2]], [[0,0],[0,1],[0,2],[1,0]],
		[[0,1],[1,1],[2,0],[2,1]], [[0,0],[1,0],[2,0],[2,1]],
		[[0,0],[0,1],[1,1],[2,1]], [[0,0],[0,1],[1,0],[2,0]] ] },
	{ key: 'zblock',   color: '#dc2626', orients: [
		[[0,0],[0,1],[1,1],[1,2]], [[0,1],[0,2],[1,0],[1,1]],
		[[1,0],[2,0],[0,1],[1,1]], [[0,0],[1,0],[1,1],[2,1]] ] },
	{ key: 'tblock',   color: '#eab308', orients: [
		[[0,0],[0,1],[0,2],[1,1]], [[0,1],[1,0],[1,1],[1,2]],
		[[0,0],[1,0],[2,0],[1,1]], [[0,1],[1,0],[1,1],[2,1]] ] },
];
export const PIECE_INDEX = Object.fromEntries(PIECES.map((p, i) => [p.key, i]));

// All legal placements of every piece, as masks.
// placements[pieceIdx] = array of { mask, cells }
export const placements = PIECES.map(piece => {
	const out = [];
	for (const orient of piece.orients) {
		const maxR = Math.max(...orient.map(o => o[0]));
		const maxC = Math.max(...orient.map(o => o[1]));
		for (let r = 0; r + maxR < ROWS; r++)
			for (let c = 0; c + maxC < COLS; c++) {
				const cells = orient.map(([dr, dc]) => cellIndex(r + dr, c + dc));
				out.push({ mask: maskFromCells(cells), cells });
			}
	}
	return out;
});

// Search order: biggest pieces first (same heuristic as the C++ solver).
// 'single' is never searched — its position is the one leftover cell.
const ORDER = ['line4', 'square', 'lblock3', 'zblock', 'tblock', 'line3', 'lblock2', 'line2']
	.map(k => PIECE_INDEX[k]);

const FULL = maskFromCells(Array.from({ length: CELLS }, (_, i) => i));

// Find one solution given the blockers. Returns { pieceKey: cells } for all
// nine pieces, or null. 'fixed' optionally pins pieces the player has
// already placed (map pieceKey -> cells) — the solver completes around them.
export function solve(blockerCells, fixed = {}) {
	let used = maskFromCells(blockerCells);
	const result = {};
	for (const [key, cells] of Object.entries(fixed)) {
		const m = maskFromCells(cells);
		if (overlaps(used, m)) return null;
		used = union(used, m);
		result[key] = cells;
	}
	const open = ORDER.filter(p => !(PIECES[p].key in result));
	const lists = open.map(p => placements[p].filter(pl => !overlaps(pl.mask, used)));

	function dfs(k, usedLo, usedHi) {
		if (k === open.length) return true;
		for (const pl of lists[k]) {
			const [lo, hi] = pl.mask;
			if (((lo & usedLo) | (hi & usedHi)) === 0) {
				result[PIECES[open[k]].key] = pl.cells;
				if (dfs(k + 1, (usedLo | lo) >>> 0, (usedHi | hi) >>> 0)) return true;
			}
		}
		return false;
	}
	if (!dfs(0, used[0], used[1])) return null;

	if (!('single' in result)) {
		let lo = used[0], hi = used[1];
		for (const key of Object.keys(result))
			if (ORDER.includes(PIECE_INDEX[key])) {
				const m = maskFromCells(result[key]);
				lo = (lo | m[0]) >>> 0; hi = (hi | m[1]) >>> 0;
			}
		const leftover = cellsFromMask([(~lo & FULL[0]) >>> 0, (~hi & FULL[1]) >>> 0]);
		if (leftover.length !== 1) return null;	// fixed pieces left a bad gap
		result.single = leftover;
	}
	return result;
}

// Count solutions for a blocker set, stopping at 'cap'. Exact below cap.
export function countSolutions(blockerCells, cap = Infinity) {
	const blockers = maskFromCells(blockerCells);
	const lists = ORDER.map(p => placements[p].filter(pl => !overlaps(pl.mask, blockers)));
	let count = 0;
	function dfs(k, usedLo, usedHi) {
		if (k === ORDER.length) { count++; return count >= cap; }
		for (const pl of lists[k]) {
			const [lo, hi] = pl.mask;
			if (((lo & usedLo) | (hi & usedHi)) === 0)
				if (dfs(k + 1, (usedLo | lo) >>> 0, (usedHi | hi) >>> 0)) return true;
		}
		return false;
	}
	dfs(0, blockers[0], blockers[1]);
	return count;
}

// Collect whole solutions (up to 'cap'), honoring pinned pieces — used by
// the solution-space explorer to show every way the board could still end.
// Returns an array of { pieceKey: cells } maps including the pinned pieces.
export function enumerateSolutions(blockerCells, fixed = {}, cap = 400) {
	let used = maskFromCells(blockerCells);
	const pinned = {};
	for (const [key, cells] of Object.entries(fixed)) {
		const m = maskFromCells(cells);
		if (overlaps(used, m)) return [];
		used = union(used, m);
		pinned[key] = cells;
	}
	const open = ORDER.filter(p => !(PIECES[p].key in pinned));
	const lists = open.map(p => placements[p].filter(pl => !overlaps(pl.mask, used)));
	const out = [];
	const current = {};
	function dfs(k, usedLo, usedHi) {
		if (k === open.length) {
			const sol = { ...pinned, ...current };
			if (!('single' in sol)) {
				const leftover = cellsFromMask([(~usedLo & FULL[0]) >>> 0, (~usedHi & FULL[1]) >>> 0]);
				if (leftover.length !== 1) return false;
				sol.single = leftover;
			}
			out.push(sol);
			return out.length >= cap;
		}
		for (const pl of lists[k]) {
			const [lo, hi] = pl.mask;
			if (((lo & usedLo) | (hi & usedHi)) === 0) {
				current[PIECES[open[k]].key] = pl.cells;
				if (dfs(k + 1, (usedLo | lo) >>> 0, (usedHi | hi) >>> 0)) return true;
			}
		}
		return false;
	}
	dfs(0, used[0], used[1]);
	return out;
}

// The seven official dice (same source as gsqsolve.cpp).
export const DICE = [
	['A1','C1','D1','D2','E2','F3'],
	['A2','B2','C2','A3','B1','B3'],
	['C3','D3','E3','B4','C4','D4'],
	['E1','F2','F2','B6','A5','A5'],
	['A4','B5','C6','C5','D6','F6'],
	['E4','F4','E5','F5','D5','E6'],
	['F1','F1','F1','A6','A6','A6'],
];

export function rollDice(rng = Math.random) {
	return DICE.map(d => nameToIndex(d[Math.floor(rng() * d.length)]));
}
