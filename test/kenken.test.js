// KenKen generator sanity: deterministic, latin, well-formed cages, fast.
// Run: node public/games/kenken.test.mjs
// (Lives beside the module: writing to test/ was denied in this environment.)
import { puzzleFromSeed, cageSatisfied, isLatin } from '../public/games/kenken.js';

let failed = 0;
const ok = (cond, label) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${label}`); if (!cond) failed++; };

const SEEDS = [1, 42, 1234, 99999, 0xDEADBEEF];

// Same seed + size -> identical puzzle.
{
	const a = puzzleFromSeed(42, 5), b = puzzleFromSeed(42, 5);
	ok(JSON.stringify(a) === JSON.stringify(b), 'determinism: identical puzzle from same seed');
}

const evalCage = (vals, op) => {
	if (op === '=') return vals[0];
	if (op === '+') return vals.reduce((s, v) => s + v, 0);
	if (op === '×') return vals.reduce((p, v) => p * v, 1);
	if (op === '−') return Math.abs(vals[0] - vals[1]);
	if (op === '÷') return Math.max(...vals) / Math.min(...vals);
	return NaN;
};

for (const n of [4, 5, 6]) {
	let latin = true, partition = true, targets = true, sizesOk = true, opsOk = true;
	for (const seed of SEEDS) {
		const { square, cages } = puzzleFromSeed(seed, n);
		if (!isLatin(square, n)) latin = false;
		const all = cages.flatMap(c => c.cells).sort((a, b) => a - b);
		if (all.length !== n * n || all.some((v, i) => v !== i)) partition = false;
		for (const { cells, op, target } of cages) {
			const vals = cells.map(i => square[i]);
			if (evalCage(vals, op) !== target) targets = false;
			if (cells.length < 1 || cells.length > 4) sizesOk = false;
			if ((op === '−' || op === '÷') && cells.length !== 2) opsOk = false;
			if (op === '=' && cells.length !== 1) opsOk = false;
			if (op === '÷' && !Number.isInteger(target)) opsOk = false;
			if (!cageSatisfied(vals, op, target)) targets = false;	// solution satisfies its own cages
		}
	}
	ok(latin, `n=${n}: hidden square is latin for ${SEEDS.length} seeds`);
	ok(partition, `n=${n}: cages partition all ${n * n} cells exactly once`);
	ok(targets, `n=${n}: every cage target matches the hidden square`);
	ok(sizesOk, `n=${n}: cage sizes within 1-4`);
	ok(opsOk, `n=${n}: ops legal for cage sizes`);
}

// cageSatisfied truth table.
ok(cageSatisfied([3], '=', 3), "'=' hit");
ok(!cageSatisfied([2], '=', 3), "'=' miss");
ok(cageSatisfied([2, 3, 4], '+', 9), "'+' hit");
ok(!cageSatisfied([2, 3, 4], '+', 8), "'+' miss");
ok(cageSatisfied([1, 4], '−', 3) && cageSatisfied([4, 1], '−', 3), "'−' hit either order");
ok(!cageSatisfied([2, 4], '−', 3), "'−' miss");
ok(cageSatisfied([2, 3, 4], '×', 24), "'×' hit");
ok(!cageSatisfied([2, 3, 4], '×', 25), "'×' miss");
ok(cageSatisfied([2, 6], '÷', 3) && cageSatisfied([6, 2], '÷', 3), "'÷' hit either order");
ok(!cageSatisfied([2, 5], '÷', 3), "'÷' miss");
ok(!cageSatisfied([0, 3], '+', 3), 'blank cell never satisfies');
ok(!cageSatisfied([], '+', 0), 'empty values never satisfy');

// isLatin checks.
ok(isLatin([1, 2, 2, 1], 2), 'isLatin accepts 2x2 latin square');
ok(!isLatin([1, 1, 2, 3, 1, 2, 3, 4, 2, 3, 4, 1, 3, 4, 1, 2], 4), 'isLatin rejects duplicate in a row');
ok(!isLatin([1, 2, 3, 4, 1, 3, 4, 2, 1, 4, 2, 3, 1, 2, 4, 3], 4), 'isLatin rejects duplicate in a column');
ok(!isLatin([1, 2, 0, 1], 2), 'isLatin rejects out-of-range digit');
ok(!isLatin([1, 2, 2], 2), 'isLatin rejects wrong length');

// Generation speed: every puzzle well under 200ms.
{
	let worst = 0;
	for (const n of [4, 5, 6]) for (let s = 0; s < 20; s++) {
		const t0 = performance.now();
		puzzleFromSeed(s * 7919 + n, n);
		worst = Math.max(worst, performance.now() - t0);
	}
	ok(worst < 200, `generation fast: worst of 60 puzzles ${worst.toFixed(2)}ms < 200ms`);
}

process.exit(failed ? 1 : 0);
