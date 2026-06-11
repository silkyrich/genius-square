// Genius Star module tests: board mask, piece set, solver, generator.
// Lives next to the module because test/ is not writable in this sandbox.
// Run: node public/games/star.test.mjs   (STAR_CALIBRATE=1 dumps count stats)
import star, { STAR_CELLS, PIECES, placements, solve, countSolutions, generateBlockers } from '../public/games/star.js';

let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) failed++; };

// ----- board mask -----
check(STAR_CELLS.length === 48, 'star mask has 48 cells');
const cellSet = new Set(STAR_CELLS.map(([r, c]) => r + ',' + c));
check(cellSet.size === 48, 'mask cells are distinct');
check(STAR_CELLS.every(([r, c]) => cellSet.has((7 - r) + ',' + (12 - c))),
	'mask symmetric under 180° rotation');

// ----- pieces -----
check(PIECES.length === 11, '11 pieces');
check(PIECES.reduce((n, p) => n + p.size, 0) === 41, 'pieces total 41 triangles');

// Lattice adjacency: (r,c±1) always; up cells border below, down cells above.
const isUp = (r, c) => ((r + c) & 1) === 0;
function connected(cells) {
	const have = new Set(cells.map(p => p.join(',')));
	const queue = [cells[0]], seen = new Set([cells[0].join(',')]);
	while (queue.length) {
		const [r, c] = queue.pop();
		for (const [nr, nc] of [[r, c - 1], [r, c + 1], isUp(r, c) ? [r + 1, c] : [r - 1, c]]) {
			const k = nr + ',' + nc;
			if (have.has(k) && !seen.has(k)) { seen.add(k); queue.push([nr, nc]); }
		}
	}
	return seen.size === cells.length;
}
for (const p of PIECES) {
	const ok = p.orients.length > 0 && p.orients.every(o =>
		o.length === p.size
		&& new Set(o.map(q => q.join(','))).size === p.size
		&& connected(o)
		&& Math.min(...o.map(q => q[0])) === 0
		&& [0, 1].includes(Math.min(...o.map(q => q[1]))));
	check(ok, `piece ${p.key}: ${p.orients.length} orientations, all sized/connected/normalized`);
}

// Every placement must be a parity-preserving translation of a known
// orientation (so its up/down pattern matches), and lie inside the star.
{
	const orientKeys = PIECES.map(p =>
		new Set(p.orients.map(o => o.map(q => q.join(',')).sort().join(';'))));
	let ok = true;
	placements.forEach((list, pi) => {
		for (const pl of list) {
			if (pl.cells.some(i => i < 0 || i > 47)) { ok = false; continue; }
			const o = pl.cells.map(i => STAR_CELLS[i]);
			const tr = -Math.min(...o.map(q => q[0]));
			let tc = -Math.min(...o.map(q => q[1]));
			if ((tr + tc) & 1) tc++;	// parity-preserving normalization
			const k = o.map(([r, c]) => (r + tr) + ',' + (c + tc)).sort().join(';');
			if (!orientKeys[pi].has(k)) ok = false;
		}
	});
	check(ok, 'all placements are parity-consistent translations of known orientations');
}

// Free-shape distinctness: the four 5s and three 4s are genuinely different
// pieces; only the triamond is duplicated (tri3a/tri3b), so 10 unique shapes.
const canon = p => p.orients.map(o => o.map(q => q.join(',')).join(';')).sort()[0];
check(new Set(PIECES.map(canon)).size === 10, 'piece shapes distinct (only the triamond duplicated)');

// ----- solver -----
// Empty-minus-blockers board from the generator solves; tiling is exact.
{
	const blockers = generateBlockers('medium');
	const sol = solve(blockers);
	const all = Object.values(sol ?? {}).flat().concat(blockers);
	check(!!sol && all.length === 48 && new Set(all).size === 48,
		'generated board solves and the tiling is exact (41 + 7 = 48)');
	// pinned pieces respected
	const keys = Object.keys(sol);
	const pin = { [keys[0]]: sol[keys[0]], [keys[3]]: sol[keys[3]] };
	const re = solve(blockers, pin);
	check(!!re && re[keys[0]].join() === sol[keys[0]].join(), 'pinned pieces respected');
}
// Blocking (1,6) and (2,5) strands BOTH (0,6) and (1,5) as size-1 islands;
// there is only one single piece, so the board is unsolvable.
check(countSolutions([2, 8, 24, 30, 40, 45, 47], 2) === 0, 'two isolated cells are unsolvable');

// ----- generator: every difficulty yields solvable 7-blocker puzzles -----
for (const tier of ['easy', 'medium', 'hard']) {
	let ok = true;
	const t0 = Date.now();
	for (let i = 0; i < 5; i++) {
		const blockers = generateBlockers(tier);
		if (!blockers || blockers.length !== 7 || new Set(blockers).size !== 7
			|| countSolutions(blockers, 2) < 1) ok = false;
	}
	check(ok, `5 generated ${tier} puzzles each have 7 blockers and a solution (${Date.now() - t0}ms)`);
}

// createPuzzle payload + generation speed: 3 puzzles well under 6s.
{
	const t0 = Date.now();
	let ok = true;
	for (const tier of ['easy', 'medium', 'hard']) {
		const p = await star.createPuzzle({ difficulty: tier });
		if (!Array.isArray(p.blockers) || p.blockers.length !== 7
			|| p.summary !== `Genius Star — ${tier[0].toUpperCase()}${tier.slice(1)}`) ok = false;
	}
	const ms = Date.now() - t0;
	check(ok, 'createPuzzle payload shape');
	check(ms < 6000, `3 puzzles generated in ${ms}ms (< 6000ms)`);
}

// ----- optional calibration dump (STAR_CALIBRATE=1) -----
if (process.env.STAR_CALIBRATE || process.env.npm_config_star_calibrate) {
	const t0 = Date.now();
	const counts = [];
	for (let i = 0; i < 300; i++) {
		const blockers = [];
		while (blockers.length < 7) {
			const c = Math.floor(Math.random() * 48);
			if (!blockers.includes(c)) blockers.push(c);
		}
		counts.push(countSolutions(blockers, 300));
	}
	counts.sort((a, b) => a - b);
	const band = (lo, hi) => counts.filter(n => n >= lo && n <= hi).length;
	console.log(`calibrate: 300 samples in ${Date.now() - t0}ms`);
	console.log(`  zero=${band(0, 0)} 1-5=${band(1, 5)} 6-20=${band(6, 20)} 21-39=${band(21, 39)} 40-199=${band(40, 199)} cap(300)=${band(200, 1e9)}`);
	console.log(`  median=${counts[150]} p25=${counts[75]} p75=${counts[225]}`);
}

process.exit(failed ? 1 : 0);
