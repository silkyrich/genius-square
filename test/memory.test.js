// Tests for the Memory pairs module's pure helpers.
// (Lives next to the module because writes to test/ are not permitted.)
// Run: node public/games/memory.test.mjs
import { FACES, layoutFromSeed } from '../public/games/memory.js';

let failed = 0;
const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) failed++; };

const SIZES = [[4, 4], [4, 5], [6, 6]];

// FACES: enough unique faces for the largest board (18 pairs).
check(FACES.length >= 18, `FACES has >= 18 entries (${FACES.length})`);
check(new Set(FACES).size === FACES.length, 'FACES entries are unique');

// layoutFromSeed: deterministic, seed-sensitive, every face exactly twice.
for (const [w, h] of SIZES) {
	const a = layoutFromSeed(12345, w, h), b = layoutFromSeed(12345, w, h);
	check(a.join() === b.join(), `${w}x${h}: same seed -> same layout`);
	check(a.length === w * h, `${w}x${h}: layout has ${w * h} cards`);

	let pairsOk = true, rangeOk = true;
	for (let seed = 1; seed <= 50; seed++) {
		const layout = layoutFromSeed(seed, w, h);
		const counts = new Map();
		for (const f of layout) {
			counts.set(f, (counts.get(f) ?? 0) + 1);
			if (!Number.isInteger(f) || f < 0 || f >= FACES.length) rangeOk = false;
		}
		if (counts.size !== (w * h) / 2 || [...counts.values()].some(n => n !== 2)) pairsOk = false;
	}
	check(pairsOk, `${w}x${h}: every face appears exactly twice (50 seeds)`);
	check(rangeOk, `${w}x${h}: face indices all point into FACES (50 seeds)`);
}

// Different seeds produce different layouts (at least one differs in 10 tries).
{
	const base = layoutFromSeed(1, 4, 4).join();
	let differs = false;
	for (let seed = 2; seed <= 11; seed++)
		if (layoutFromSeed(seed, 4, 4).join() !== base) differs = true;
	check(differs, 'different seeds -> different layouts');
}

process.exit(failed ? 1 : 0);
