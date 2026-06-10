// Verifies the JS solver against ground-truth counts from the C++ tool
// (silkyrich/gsqsolve). Run: npm test
import { solve, countSolutions, enumerateSolutions, nameToIndex } from '../public/solver.js';

const board = s => s.split(' ').map(nameToIndex);
const cases = [
	['A3 A5 B4 C6 E2 E6 F1', 11],		// hardest official dice roll
	['B3 B4 F1 F2 F3 F4 F6', 22317],	// easiest official dice roll
	['A4 B3 B5 C1 C2 C4 C6', 1],		// unique-solution board from the sweep
	['A2 B1 F5 E6 C3 C4 D2', 0],		// unsolvable: two isolated corner cells
];

let failed = 0;
for (const [b, expect] of cases) {
	const n = countSolutions(board(b), 30000);
	const s = solve(board(b));
	const ok = n === expect && (expect > 0) === !!s;
	console.log(`${ok ? 'PASS' : 'FAIL'} ${b} -> ${n} (expected ${expect})`);
	if (!ok) failed++;
}

// A solution must tile the board exactly: 9 pieces + 7 blockers = 36 cells.
const b = board('A4 B3 B5 C1 C2 C4 C6');
const all = Object.values(solve(b)).flat().concat(b);
const exact = new Set(all).size === 36 && all.length === 36;
console.log(`${exact ? 'PASS' : 'FAIL'} solution tiles the board exactly`);
if (!exact) failed++;

// Pinned-piece completion: solver must respect pieces the player placed.
const sol = solve(board('A3 A5 B4 C6 E2 E6 F1'));
const pinned = solve(board('A3 A5 B4 C6 E2 E6 F1'), { line4: sol.line4, tblock: sol.tblock });
const respected = pinned && pinned.line4.join() === sol.line4.join();
console.log(`${respected ? 'PASS' : 'FAIL'} pinned pieces respected`);
if (!respected) failed++;

// Explorer enumeration: collected solutions agree with the counter, honor
// pins, and each tiles the board exactly.
const eb = board('A3 A5 B4 C6 E2 E6 F1');
const sols = enumerateSolutions(eb, {}, 400);
const enumOk = sols.length === 11
	&& sols.every(s2 => new Set(Object.values(s2).flat().concat(eb)).size === 36)
	&& enumerateSolutions(eb, { line4: sols[0].line4 }, 400)
		.every(s2 => s2.line4.join() === sols[0].line4.join());
console.log(`${enumOk ? 'PASS' : 'FAIL'} enumerateSolutions matches count, pins, tiles`);
if (!enumOk) failed++;

process.exit(failed ? 1 : 0);
