// Tests for the 2048 Sprint module's pure helpers.
// Run: node public/games/g2048.test.mjs
import { slide, moveGrid } from '../public/games/g2048.js';

let failed = 0;
const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) failed++; };
const eq = (a, b) => a.join() === b.join();

// slide: basic merge pairs, left-packing, gained = sum of merge values.
{
	const r = slide([2, 2, 4, 4]);
	check(eq(r.row, [4, 8, 0, 0]) && r.gained === 12, 'slide [2,2,4,4] -> [4,8,0,0] gained 12');
}
{
	const r = slide([2, 0, 2, 2]);
	check(eq(r.row, [4, 2, 0, 0]) && r.gained === 4, 'slide [2,0,2,2] -> [4,2,0,0] gained 4');
}

// slide: a merged tile may not merge again in the same move.
{
	const r = slide([4, 4, 8, 0]);
	check(eq(r.row, [8, 8, 0, 0]) && r.gained === 8, 'no double-merge: [4,4,8,0] -> [8,8,0,0] not [16,...]');
}

// moveGrid: all four directions on a handcrafted grid.
// 2 2 0 0
// 0 4 0 4
// 0 0 0 0
// 2 0 0 2
const G = [
	2, 2, 0, 0,
	0, 4, 0, 4,
	0, 0, 0, 0,
	2, 0, 0, 2,
];
{
	const r = moveGrid(G, 0);	// left
	check(eq(r.grid, [4,0,0,0, 8,0,0,0, 0,0,0,0, 4,0,0,0]) && r.gained === 16 && r.moved,
		'moveGrid left merges each row');
}
{
	const r = moveGrid(G, 2);	// right
	check(eq(r.grid, [0,0,0,4, 0,0,0,8, 0,0,0,0, 0,0,0,4]) && r.gained === 16 && r.moved,
		'moveGrid right merges each row');
}
{
	const r = moveGrid(G, 1);	// up
	check(eq(r.grid, [4,2,0,4, 0,4,0,2, 0,0,0,0, 0,0,0,0]) && r.gained === 4 && r.moved,
		'moveGrid up merges the first column');
}
{
	const r = moveGrid(G, 3);	// down
	check(eq(r.grid, [0,0,0,0, 0,0,0,0, 0,2,0,4, 4,4,0,2]) && r.gained === 4 && r.moved,
		'moveGrid down merges the first column');
}

// moveGrid: moved=false when nothing changes, grid untouched.
{
	const fixed = [
		2, 4, 8, 16,
		0, 0, 0, 0,
		0, 0, 0, 0,
		0, 0, 0, 0,
	];
	const r = moveGrid(fixed, 0);	// already packed left, no merges
	check(!r.moved && r.gained === 0 && eq(r.grid, fixed), 'moved=false when nothing changes');
	const before = G.join();
	moveGrid(G, 0);
	check(G.join() === before, 'moveGrid does not mutate its input');
}

process.exit(failed ? 1 : 0);
