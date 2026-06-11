// Tests for the Minesweeper module's pure helpers.
// Lives next to the module because test/ was not writable in this session.
// Run: node public/games/mines.test.mjs
import { mineSetFromSeed, counts, floodReveal } from '../public/games/mines.js';

let failed = 0;
const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) failed++; };
const sorted = s => [...s].sort((a, b) => a - b).join();

// mineSetFromSeed: deterministic, exact count, start's 3×3 kept mine-free.
const W = 10, H = 10, M = 18, START = 55;	// centre-ish of a 10×10
const m1 = mineSetFromSeed(12345, W, H, M, START);
const m2 = mineSetFromSeed(12345, W, H, M, START);
const m3 = mineSetFromSeed(54321, W, H, M, START);
check(sorted(m1) === sorted(m2), 'same seed -> same mines');
check(sorted(m1) !== sorted(m3), 'different seed -> different mines');
check(m1.size === M, `exactly ${M} mines placed`);
check([...m1].every(i => i >= 0 && i < W * H), 'all mines inside the grid');
const startZone = [44, 45, 46, 54, 55, 56, 64, 65, 66];	// START and its 8 neighbours
check(startZone.every(i => !m1.has(i)), "start cell's 3×3 is mine-free");

// Corner start: the (smaller) exclusion zone still holds.
const c1 = mineSetFromSeed(777, W, H, M, 0);
check([0, 1, 10, 11].every(i => !c1.has(i)), "corner start's neighbourhood is mine-free");

// counts on a handcrafted 4×4 with mines at 0 (r0c0) and 5 (r1c1):
//   *  2  1  0
//   2  *  1  0
//   1  1  1  0
//   0  0  0  0
const mines4 = new Set([0, 5]);
const n4 = counts(mines4, 4, 4);
check(n4.join() === [1,2,1,0, 2,1,1,0, 1,1,1,0, 0,0,0,0].join(),
	`counts correct on handcrafted 4×4 (got ${n4.join()})`);

// floodReveal from the zero region (tap 15): reveals every connected zero
// plus the numeric border, and never a mine.
const f = floodReveal(mines4, n4, 4, 4, 15);
check(sorted(f) === '2,3,6,7,8,9,10,11,12,13,14,15', `flood from 15 -> zero region + border (got ${sorted(f)})`);
check([...f].every(i => !mines4.has(i)), 'flood never reveals a mine');
check([3, 7, 11, 12, 13, 14, 15].every(i => f.has(i)), 'flood covers the whole zero region');

// floodReveal on a numbered cell reveals just that cell; on a mine, nothing.
check(sorted(floodReveal(mines4, n4, 4, 4, 1)) === '1', 'flood from numbered cell -> only itself');
check(floodReveal(mines4, n4, 4, 4, 5).size === 0, 'flood from a mine -> empty set');

process.exit(failed ? 1 : 0);
