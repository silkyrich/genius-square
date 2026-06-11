// Sudoku generator sanity: valid unique-solution puzzles at each tier.
// Run: node test/sudoku.test.js
import { generateSudoku, countSolutions } from '../public/games/sudoku.js';

let failed = 0;
const ok = (cond, label) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${label}`); if (!cond) failed++; };

const validSolved = s => {
	if (!/^[1-9]{81}$/.test(s)) return false;
	const seen = u => new Set(u).size === 9;
	for (let i = 0; i < 9; i++) {
		const row = [], col = [], box = [];
		for (let j = 0; j < 9; j++) {
			row.push(s[i * 9 + j]);
			col.push(s[j * 9 + i]);
			box.push(s[(Math.floor(i / 3) * 3 + Math.floor(j / 3)) * 9 + (i % 3) * 3 + j % 3]);
		}
		if (!seen(row) || !seen(col) || !seen(box)) return false;
	}
	return true;
};

const ranges = { easy: [34, 45], medium: [28, 36], hard: [23, 32] };
const t0 = performance.now();
for (const diff of ['easy', 'medium', 'hard']) {
	const { givens, solution } = generateSudoku(diff);
	ok(validSolved(solution), `${diff}: solution is a valid grid`);
	ok([...givens].every((c, i) => c === '0' || c === solution[i]), `${diff}: givens subset of solution`);
	const clues = [...givens].filter(c => c !== '0').length;
	const [lo, hi] = ranges[diff];
	ok(clues >= lo && clues <= hi, `${diff}: ${clues} clues in [${lo},${hi}]`);
	ok(countSolutions(givens, 2) === 1, `${diff}: unique solution`);
}
ok(performance.now() - t0 < 6000, `3 generations under 6s (${Math.round(performance.now() - t0)}ms)`);

process.exit(failed ? 1 : 0);
