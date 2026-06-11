// Tests for the Pipes module's pure helpers.
// Run: node public/games/pipes.test.mjs
import { boardFromSeed, scramble, rotated, isSolved, connectedCount } from '../public/games/pipes.js';

let failed = 0;
const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) failed++; };
const popcount = m => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);

// rotated: 90° cw moves N->E, full turn is identity, inverse works.
check(rotated(0b0001, 1) === 0b0010, 'rotated moves N stub to E');
check(rotated(0b1001, 1) === 0b0011, 'rotated wraps W stub to N');
let cycleOk = true, invOk = true;
for (let m = 0; m < 16; m++) {
	if (rotated(m, 4) !== m) cycleOk = false;
	if (rotated(rotated(m, 1), 3) !== m) invOk = false;
}
check(cycleOk, 'rotated(m, 4) === m for all masks');
check(invOk, 'rotated by 1 then 3 is identity');

// boardFromSeed: deterministic, seed-sensitive.
const b1 = boardFromSeed(12345, 6), b2 = boardFromSeed(12345, 6), b3 = boardFromSeed(54321, 6);
check(b1.join() === b2.join(), 'same seed -> same board');
check(b1.join() !== b3.join(), 'different seed -> different board');

// Tree property + solved-as-generated, across sizes and seeds.
for (const n of [5, 6, 8]) {
	let treeOk = true, solvedOk = true, connOk = true;
	for (let seed = 1; seed <= 25; seed++) {
		const b = boardFromSeed(seed, n);
		const zero = b.map(() => 0);
		if (b.length !== n * n) treeOk = false;
		if (b.reduce((s, m) => s + popcount(m), 0) !== 2 * (n * n - 1)) treeOk = false;
		if (!isSolved(b, zero)) solvedOk = false;
		if (connectedCount(b, zero) !== n * n) connOk = false;	// all tiles reachable
	}
	check(treeOk, `${n}x${n}: stub total is 2*(n*n-1) (spanning tree)`);
	check(solvedOk, `${n}x${n}: generated board is solved at zero rotations`);
	check(connOk, `${n}x${n}: all tiles connected at zero rotations`);
}

// scramble: deterministic, never hands out an already-solved board (guard),
// and rotating every tile back to a multiple of 4 solves it again.
{
	const b = boardFromSeed(777, 6);
	check(scramble(b, 99).join() === scramble(b, 99).join(), 'same seed -> same scramble');
	let neverSolved = true, undoOk = true, rangeOk = true;
	for (let seed = 1; seed <= 100; seed++) {
		const bb = boardFromSeed(seed, 5);
		const rots = scramble(bb, seed);
		if (rots.some(r => r < 0 || r > 3)) rangeOk = false;
		if (isSolved(bb, rots)) neverSolved = false;
		const back = rots.map(r => r + ((4 - (r & 3)) & 3));	// extra cw taps to 0 mod 4
		if (!isSolved(bb, back)) undoOk = false;
	}
	check(rangeOk, 'scramble rotations are all in 0..3');
	check(neverSolved, 'scrambled board is never already solved');
	check(undoOk, 'rotating each tile back to 0 mod 4 solves it');
}

// connectedCount drops after breaking one tile of a solved board.
{
	const b = boardFromSeed(4242, 6);
	const rots = b.map(() => 0);
	const i = b.findIndex(m => m !== 15);
	rots[i] = 1;
	check(connectedCount(b, rots) < 36, 'breaking one tile lowers connectedCount');
	check(!isSolved(b, rots), 'breaking one tile unsolves the board');
}

process.exit(failed ? 1 : 0);
