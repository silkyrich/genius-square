// Tests for the Nonogram module's pure helpers.
// Run: node public/games/nonogram.test.mjs
import { pictureFromSeed, cluesFor, satisfies } from '../public/games/nonogram.js';

let failed = 0;
const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) failed++; };

// pictureFromSeed: deterministic, seed-sensitive.
const p1 = pictureFromSeed(12345, 10), p2 = pictureFromSeed(12345, 10), p3 = pictureFromSeed(54321, 10);
check(p1.join('') === p2.join(''), 'same seed -> same picture');
check(p1.join('') !== p3.join(''), 'different seed -> different picture');
check(p1.length === 100 && p1.every(v => v === 0 || v === 1), 'picture is n*n zeros and ones');

// Fill ratio in [45%, 60%] over 20 seeds, all sizes.
for (const n of [5, 10, 15]) {
	let ok = true;
	for (let seed = 1; seed <= 20; seed++) {
		const fill = pictureFromSeed(seed, n).reduce((s, v) => s + v, 0) / (n * n);
		if (fill < 0.45 || fill > 0.60) ok = false;
	}
	check(ok, `${n}x${n}: fill ratio in 45-60% over 20 seeds`);
}

// cluesFor on a handcrafted 4x4 picture.
const pic = [
	1, 1, 0, 1,
	1, 0, 0, 0,
	0, 1, 1, 1,
	0, 0, 0, 0,
];
const clues = cluesFor(pic, 4);
check(JSON.stringify(clues.rows) === JSON.stringify([[2, 1], [1], [3], [0]]), 'handcrafted row clues');
check(JSON.stringify(clues.cols) === JSON.stringify([[2], [1, 1], [1], [1, 1]]), 'handcrafted col clues');

// The generating picture always satisfies its own clues.
{
	let ok = true;
	for (const n of [5, 10, 15])
		for (let seed = 1; seed <= 5; seed++) {
			const p = pictureFromSeed(seed, n);
			if (!satisfies(p, cluesFor(p, n), n)) ok = false;
		}
	check(ok, 'satisfies(picture, cluesFor(picture)) is true');
}

// Flipping any single cell breaks satisfaction (picture has no empty lines).
const dense = [
	1, 1, 0, 1,
	0, 1, 1, 0,
	1, 0, 1, 1,
	1, 1, 0, 1,
];
const dc = cluesFor(dense, 4);
check(satisfies(dense, dc, 4), 'dense picture satisfies its clues');
{
	let ok = true;
	for (let i = 0; i < 16; i++) {
		const g = dense.slice();
		g[i] = g[i] ? 0 : 1;
		if (satisfies(g, dc, 4)) ok = false;
	}
	check(ok, 'flipping any one cell breaks satisfaction');
}

// 15x15 stays fast: generate + clue + verify, 20 times.
{
	const t0 = Date.now();
	for (let seed = 100; seed < 120; seed++) {
		const p = pictureFromSeed(seed, 15);
		satisfies(p, cluesFor(p, 15), 15);
	}
	const ms = Date.now() - t0;
	check(ms < 500, `15x15 x20 generate+verify in ${ms}ms (< 500ms)`);
}

process.exit(failed ? 1 : 0);
