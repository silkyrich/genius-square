// Tests for the Word Search module's pure helpers.
// (Lives next to the module because writing to test/ was not permitted.)
// Run: node public/games/wordsearch.test.mjs
import { WORDS, layoutFromSeed, lineCells } from '../public/games/wordsearch.js';

let failed = 0;
const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) failed++; };

// Embedded list: ~120 unique lowercase words, 4-8 letters each.
check(WORDS.length >= 100, `word list has ${WORDS.length} words (>= 100)`);
check(WORDS.every(w => /^[a-z]{4,8}$/.test(w)), 'all words match ^[a-z]{4,8}$');
check(new Set(WORDS).size === WORDS.length, 'no duplicate words');

// layoutFromSeed: deterministic.
const a1 = layoutFromSeed(12345, 12), a2 = layoutFromSeed(12345, 12), b = layoutFromSeed(54321, 12);
check(a1.grid.join() === a2.grid.join(), 'same seed -> same grid');
check(a1.placed.map(p => p.word).join() === a2.placed.map(p => p.word).join(), 'same seed -> same placed words');
check(a1.grid.join() !== b.grid.join(), 'different seed -> different grid');

// Over 20 seeds: >= 10 words placed, every placed word's cells spell it,
// cells lie on a straight line, grid is fully filled with a-z.
let minPlaced = Infinity, spellOk = true, lineOk = true, fillOk = true;
for (let seed = 1; seed <= 20; seed++) {
	const { grid, placed } = layoutFromSeed(seed * 7919, 12);
	minPlaced = Math.min(minPlaced, placed.length);
	for (const p of placed) {
		if (p.cells.map(i => grid[i]).join('') !== p.word) spellOk = false;
		const line = lineCells(p.cells[0], p.cells[p.cells.length - 1], 12);
		if (!line || line.join() !== p.cells.join()) lineOk = false;
	}
	if (!(grid.length === 144 && grid.every(ch => /^[a-z]$/.test(ch)))) fillOk = false;
}
check(minPlaced >= 10, `>= 10 words placed over 20 seeds (min ${minPlaced})`);
check(spellOk, "each placed word's cells spell the word");
check(lineOk, 'each placed word lies on a straight line');
check(fillOk, 'grid is 144 cells, all a-z');

// lineCells on a 12-wide grid (index = row * 12 + col).
check(lineCells(0, 3, 12).join() === '0,1,2,3', 'horizontal line');
check(lineCells(3, 0, 12).join() === '3,2,1,0', 'horizontal line, reversed');
check(lineCells(0, 36, 12).join() === '0,12,24,36', 'vertical line');
check(lineCells(0, 39, 12).join() === '0,13,26,39', 'diagonal line (down-right)');
check(lineCells(3, 25, 12).join() === '3,14,25', 'diagonal line (down-left)');
check(lineCells(0, 14, 12) === null, 'bent pair (knight move) -> null');
check(lineCells(0, 25, 12) === null, 'bent pair (off-diagonal) -> null');
check(lineCells(5, 5, 12).join() === '5', 'same cell -> single-cell line');

process.exit(failed ? 1 : 0);
