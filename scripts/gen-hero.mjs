// Generates public/hero.svg — the landing hero / OG artwork.
// A mid-game board (real piece shapes and colors from the solver), one
// ghost preview, and a piece "in hand", next to the wordmark.
// Rasterize for og.jpg with: npm run hero && qlmanage -t -s 1200 ...
import { writeFileSync } from 'node:fs';
import { solve, nameToIndex, PIECES, PIECE_INDEX } from '../public/solver.js';

const W = 1200, H = 630;
const CELL = 56, GAP = 6, PAD = 16;
const BOARD = 6 * CELL + 5 * GAP + 2 * PAD;	// 394
const BX = 86, BY = (H - BOARD) / 2;

const COLORS = Object.fromEntries(PIECES.map(p => [p.key, p.color]));

// A REAL mid-game position: solve an actual board, draw the solution with
// the purple L (in hand), the sky L and the single still to play. The ghost
// previews exactly where the held purple piece belongs. Legal by construction.
const rc = i => [Math.floor(i / 6), i % 6];
const blockers = 'A3 A5 B4 C6 E2 E6 F1'.split(' ').map(nameToIndex).map(rc);
const solution = solve('A3 A5 B4 C6 E2 E6 F1'.split(' ').map(nameToIndex));
const PENDING = ['lblock2', 'lblock3', 'single'];	// not on the board yet
const pieces = Object.entries(solution)
	.filter(([key]) => !PENDING.includes(key))
	.map(([key, cells]) => [key, cells.map(rc)]);
const ghost = solution.lblock2.map(rc);	// where the held piece goes

const xy = (r, c) => [BX + PAD + c * (CELL + GAP), BY + PAD + r * (CELL + GAP)];

let cells = '';
for (let r = 0; r < 6; r++)
	for (let c = 0; c < 6; c++) {
		const [x, y] = xy(r, c);
		cells += `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="9" fill="#3a352e"/>\n`;
	}

let placed = '';
for (const [key, cs] of pieces)
	for (const [r, c] of cs) {
		const [x, y] = xy(r, c);
		placed += `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="9" fill="${COLORS[key]}"/>\n`;
		placed += `<rect x="${x + 4}" y="${y + 4}" width="${CELL - 8}" height="${CELL / 2 - 4}" rx="6" fill="#ffffff" opacity=".14"/>\n`;
	}

let pearls = '';
for (const [r, c] of blockers) {
	const [x, y] = xy(r, c);
	const cx = x + CELL / 2, cy = y + CELL / 2;
	pearls += `<circle cx="${cx}" cy="${cy}" r="${CELL * .31}" fill="url(#pearl)"/>\n`;
}

let ghostRects = '';
for (const [r, c] of ghost) {
	const [x, y] = xy(r, c);
	ghostRects += `<rect x="${x + 2}" y="${y + 2}" width="${CELL - 4}" height="${CELL - 4}" rx="8" fill="none" stroke="#16a34a" stroke-width="4" stroke-dasharray="10 7"/>\n`;
}

// purple lblock2 "in hand", tilted, hovering off the board edge
const HC = 62;
let hand = `<g transform="translate(${BX + BOARD - 26}, ${BY + BOARD - 150}) rotate(14)" filter="url(#drop)">`;
for (const [r, c] of [[0,1],[1,0],[1,1]])
	hand += `<rect x="${c * (HC + 6)}" y="${r * (HC + 6)}" width="${HC}" height="${HC}" rx="10" fill="${COLORS.lblock2}"/>` +
		`<rect x="${c * (HC + 6) + 5}" y="${r * (HC + 6) + 5}" width="${HC - 10}" height="${HC / 2 - 5}" rx="7" fill="#ffffff" opacity=".16"/>`;
hand += '</g>';

const TX = BX + BOARD + 120;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif">
<defs>
	<radialGradient id="bg" cx="32%" cy="40%" r="95%">
		<stop offset="0%" stop-color="#2b2620"/>
		<stop offset="60%" stop-color="#1a1714"/>
		<stop offset="100%" stop-color="#0e0c0a"/>
	</radialGradient>
	<radialGradient id="pearl" cx="38%" cy="32%" r="80%">
		<stop offset="0%" stop-color="#ffffff"/>
		<stop offset="70%" stop-color="#cfc9bc"/>
		<stop offset="100%" stop-color="#a9a294"/>
	</radialGradient>
	<filter id="drop" x="-40%" y="-40%" width="180%" height="180%">
		<feDropShadow dx="0" dy="14" stdDeviation="14" flood-color="#000" flood-opacity=".5"/>
	</filter>
	<filter id="boardShadow" x="-20%" y="-20%" width="140%" height="140%">
		<feDropShadow dx="0" dy="10" stdDeviation="18" flood-color="#000" flood-opacity=".55"/>
	</filter>
</defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/>
<g filter="url(#boardShadow)">
	<rect x="${BX}" y="${BY}" width="${BOARD}" height="${BOARD}" rx="26" fill="#23201b"/>
</g>
${cells}${placed}${pearls}${ghostRects}${hand}
<text x="${TX}" y="${BY + 118}" font-size="78" font-weight="800" fill="#f3ede2" letter-spacing="-1">Puzzle</text>
<text x="${TX}" y="${BY + 200}" font-size="78" font-weight="800" fill="#f3ede2" letter-spacing="-1">Party</text>
<text x="${TX}" y="${BY + 262}" font-size="30" fill="#b9b1a3">Race your friends —</text>
<text x="${TX}" y="${BY + 302}" font-size="30" fill="#b9b1a3">any puzzle, one party.</text>
<g transform="translate(${TX}, ${BY + 352})">
	<text x="0" y="9" font-size="24" fill="#8d8576">Genius Square · Genius Star · Sudoku</text>
	<text x="0" y="45" font-size="24" fill="#8d8576">Boggle · Pipes — more to come</text>
</g>
</svg>
`;
writeFileSync(new URL('../public/hero.svg', import.meta.url), svg);
console.log('wrote public/hero.svg');
