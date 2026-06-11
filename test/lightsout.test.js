// Tests for the Lights Out module's pure helpers.
// Run: node public/games/lightsout.test.mjs
import { solutionFromSeed, press, litCount } from '../public/games/lightsout.js';

let failed = 0;
const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) failed++; };

// solutionFromSeed: deterministic, seed-sensitive.
{
	const a = solutionFromSeed(12345, 5, 12), b = solutionFromSeed(12345, 5, 12), c = solutionFromSeed(54321, 5, 12);
	check(a.board.join() === b.board.join(), 'same seed -> same board');
	check(a.presses.join() === b.presses.join(), 'same seed -> same presses');
	check(a.board.join() !== c.board.join(), 'different seed -> different board');
}

// Never all-off at the start, across sizes and scramble counts, 50 seeds each.
for (const n of [5, 6]) {
	for (const p of [8, 12, 20]) {
		let neverOff = true, distinctOk = true;
		for (let seed = 1; seed <= 50; seed++) {
			const { board, presses } = solutionFromSeed(seed, n, p);
			if (litCount(board) === 0) neverOff = false;
			if (new Set(presses).size !== presses.length) distinctOk = false;
		}
		check(neverOff, `${n}x${n}, ${p} scrambles: never all-off at start`);
		check(distinctOk, `${n}x${n}, ${p} scrambles: presses are distinct`);
	}
}

// press: pure (input untouched), pressing twice is identity.
{
	const n = 5, zero = new Array(n * n).fill(0);
	let identityOk = true;
	for (let i = 0; i < n * n; i++) {
		const once = press(zero, n, i);
		if (press(once, n, i).join() !== zero.join()) identityOk = false;
	}
	check(identityOk, 'press twice = identity for every cell');
	const before = zero.join();
	press(zero, n, 12);
	check(zero.join() === before, 'press does not mutate its input');
}

// A press toggles 3 cells in a corner, 4 on an edge, 5 in the centre.
{
	const n = 5, zero = new Array(n * n).fill(0);
	check(litCount(press(zero, n, 0)) === 3, 'corner press toggles 3 cells');
	check(litCount(press(zero, n, 2)) === 4, 'edge press toggles 4 cells');
	check(litCount(press(zero, n, 12)) === 5, 'centre press toggles 5 cells');
}

// Replaying solutionFromSeed's presses turns the board all-off.
{
	let solveOk = true;
	for (const n of [5, 6]) {
		for (let seed = 1; seed <= 50; seed++) {
			let { board, presses } = solutionFromSeed(seed, n, 12);
			for (const i of presses) board = press(board, n, i);
			if (litCount(board) !== 0) solveOk = false;
		}
	}
	check(solveOk, 'replaying the solution presses turns the board all-off');
}

process.exit(failed ? 1 : 0);
