// Generates public/data/puzzles.json — banks of boards per difficulty tier,
// classified by exact solution count (dice are dead; difficulty is truth).
// Brutal (1 solution) comes from the exhaustive gsqsolve sweep; other tiers
// are random-sampled and verified with the solver.
import { countSolutions, cellName } from '../public/solver.js';
import { readFileSync, writeFileSync } from 'node:fs';

export const TIERS = [
	{ key: 'brutal',   label: 'Brutal',    min: 1,  max: 1,        want: 800 },
	{ key: 'veryhard', label: 'Very hard', min: 2,  max: 5,        want: 400 },
	{ key: 'hard',     label: 'Hard',      min: 6,  max: 15,       want: 600 },
	{ key: 'medium',   label: 'Medium',    min: 16, max: 31,       want: 600 },
	{ key: 'easy',     label: 'Easy',      min: 32, max: Infinity, want: 800 },
];

const unique = JSON.parse(readFileSync('public/data/unique.json', 'utf8'));
const banks = { brutal: unique.uniqueBoards.map(b => b.join(' ')) };

const randomBoard = () => {
	const cells = new Set();
	while (cells.size < 7) cells.add(Math.floor(Math.random() * 36));
	return [...cells];
};

for (const tier of TIERS.slice(1)) {
	const seen = new Set(), bank = [];
	let tries = 0;
	while (bank.length < tier.want && tries < 5_000_000) {
		tries++;
		const cells = randomBoard();
		const n = countSolutions(cells, 32);
		if (n >= tier.min && n <= Math.min(tier.max, 32)) {
			const key = cells.slice().sort((a, b) => a - b).map(cellName).join(' ');
			if (!seen.has(key)) { seen.add(key); bank.push(key); }
		}
	}
	banks[tier.key] = bank;
	console.log(`${tier.key}: ${bank.length} boards (${tries} samples)`);
}

writeFileSync('public/data/puzzles.json', JSON.stringify({
	tiers: TIERS.map(({ key, label, min, max }) =>
		({ key, label, min, max: max === Infinity ? null : max })),
	banks,
}));
console.log('wrote public/data/puzzles.json');
