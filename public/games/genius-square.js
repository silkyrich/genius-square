// Genius Square as a party game module. Owns the board/tray UI, the live
// solvability + explorer logic; the app owns timers, scores and networking.
import { PIECES, PIECE_INDEX, cellIndex, nameToIndex, solve, countSolutions, enumerateSolutions } from '/solver.js';

const EXPLORE_CAP = 256;
let puzzleData = null;
const puzzles = async () =>
	puzzleData ??= await (await fetch('/data/puzzles.json')).json();

const TIER_LABELS = {
	brutal: 'Brutal (one solution)', veryhard: 'Very hard', hard: 'Hard',
	medium: 'Medium', easy: 'Easy',
};

let styled = false;
function injectStyles() {
	if (styled) return; styled = true;
	const css = `
.gs-board {
	display: grid; grid-template-columns: repeat(6, 1fr); grid-template-rows: repeat(6, 1fr);
	gap: 3px; padding: 7px; background: var(--board-bg); border-radius: 14px;
	width: min(92vw, 410px); aspect-ratio: 1; touch-action: manipulation;
}
.gs-board .cell { background: var(--cell); border-radius: 5px; position: relative; cursor: pointer; }
.gs-board .cell.blocker { cursor: default; }
.gs-board .cell.blocker::after {
	content: ''; position: absolute; inset: 22%; border-radius: 50%;
	background: radial-gradient(circle at 35% 30%, #fff, #c9c4b8 70%);
	box-shadow: inset 0 -2px 4px rgba(0,0,0,.25);
}
.gs-board .cell.ghost-ok { outline: 3px solid var(--ok); outline-offset: -3px; }
.gs-board .cell.ghost-bad { outline: 3px solid var(--bad); outline-offset: -3px; }
.gs-tray { display: flex; gap: .45rem; flex-wrap: wrap; justify-content: center; }
.gs-piece {
	display: grid; gap: 2px; padding: 6px; border-radius: 10px; cursor: pointer;
	grid-template-columns: repeat(4, 13px); grid-template-rows: repeat(4, 13px);
	background: var(--surface-2); border: 2px solid transparent;
}
.gs-piece.selected { border-color: var(--accent); }
.gs-piece.placed { opacity: .22; }
.gs-piece .pc { width: 13px; height: 13px; border-radius: 3px; }
.gs-wrap { display: flex; flex-direction: column; gap: .7rem; align-items: center; }
.gs-buttons { display: flex; gap: .5rem; }
`;
	const el = document.createElement('style');
	el.dataset.game = 'gs';
	el.textContent = css;
	document.head.appendChild(el);
}

export default {
	key: 'gs',
	name: 'Genius Square',
	icon: '🟩',
	blurb: 'Fit nine pieces around the blockers. First to fill the board wins.',
	scoreMode: 'race',
	durationMs: 0,
	optionDefs: [
		{ key: 'difficulty', label: 'Difficulty', type: 'select', default: 'medium',
		  choices: Object.entries(TIER_LABELS).map(([value, label]) => ({ value, label })).reverse() },
		{ key: 'showCount', label: 'show solution count as a hint', type: 'toggle', default: false },
		{ key: 'showDead', label: 'warn players when they hit a dead end', type: 'toggle', default: true },
		{ key: 'explore', label: 'explorer mode — watch the solution space shrink as you pin pieces', type: 'toggle', default: false },
	],

	async createPuzzle(options) {
		const data = await puzzles();
		const tier = options.difficulty || 'medium';
		const bank = data.banks[tier];
		const cells = bank[Math.floor(Math.random() * bank.length)].split(' ').map(nameToIndex);
		const count = countSolutions(cells, 25000);
		const bits = [];
		if (options.showCount) bits.push(`${count.toLocaleString()} solutions`);
		if (options.explore) bits.push('explorer mode');
		if (!options.showDead) bits.push('no dead-end warnings — good luck');
		const tierName = data.tiers.find(t => t.key === tier)?.label || tier;
		return {
			cells, tier, count,
			showCount: !!options.showCount,
			showDead: !!options.showDead,
			explore: !!options.explore,
			summary: `Genius Square — ${tierName}${bits.length ? ` (${bits.join(', ')})` : ''}`,
		};
	},

	mount(root, ctx) {
		injectStyles();
		const { cells: blockerCells, showDead, explore } = ctx.payload;
		const blockers = blockerCells;
		const placed = new Map();
		let selected = null, orientIdx = 0, hoverCell = -1, armedCell = -1;
		let done = false, lastStuck = false, autoCompleting = false;
		let exploreSols = [], exploreIdx = 0, exploreTimer = 0;

		root.innerHTML = `<div class="gs-wrap">
			<div class="gs-board" aria-label="game board"></div>
			<div class="gs-tray" aria-label="piece tray"></div>
			<div class="gs-buttons">
				<button class="gs-rotate">⟳ rotate</button>
				<button class="gs-clear">clear board</button>
			</div>
		</div>`;
		const boardEl = root.querySelector('.gs-board');
		const trayEl = root.querySelector('.gs-tray');

		const cellEls = [];
		for (let i = 0; i < 36; i++) {
			const el = document.createElement('div');
			el.className = 'cell';
			el.addEventListener('pointerdown', ev => onCellPointer(i, ev), { passive: true });
			el.addEventListener('mouseenter', () => { hoverCell = i; renderGhost(); });
			el.addEventListener('mouseleave', () => { if (armedCell < 0) { hoverCell = -1; renderGhost(); } });
			boardEl.appendChild(el);
			cellEls.push(el);
		}

		const pieceAt = cell => {
			for (const [key, cs] of placed) if (cs.includes(cell)) return key;
			return null;
		};

		// Anchor the piece around the touched cell (not its top-left corner)
		// and clamp inside the board, so a tap lands the piece under your
		// finger and edge taps still produce an in-board preview.
		function ghostCells() {
			if (selected === null || hoverCell < 0 || placed.has(selected)) return null;
			const orients = PIECES[PIECE_INDEX[selected]].orients;
			const orient = orients[orientIdx % orients.length];
			const maxR = Math.max(...orient.map(o => o[0])), maxC = Math.max(...orient.map(o => o[1]));
			let r = Math.floor(hoverCell / 6) - (maxR >> 1), c = hoverCell % 6 - (maxC >> 1);
			r = Math.max(0, Math.min(5 - maxR, r));
			c = Math.max(0, Math.min(5 - maxC, c));
			return orient.map(([dr, dc]) => cellIndex(r + dr, c + dc));
		}
		const ghostValid = cs =>
			cs && cs.every(i => i >= 0 && !blockers.includes(i) && !pieceAt(i));

		function renderGhost() {
			cellEls.forEach(el => el.classList.remove('ghost-ok', 'ghost-bad'));
			const cs = ghostCells();
			if (!cs) return;
			const valid = ghostValid(cs);
			for (const i of cs) if (i >= 0) cellEls[i].classList.add(valid ? 'ghost-ok' : 'ghost-bad');
		}

		function renderBoard() {
			for (let i = 0; i < 36; i++) {
				const el = cellEls[i];
				el.classList.toggle('blocker', blockers.includes(i));
				const key = pieceAt(i);
				el.style.background = key ? PIECES[PIECE_INDEX[key]].color : '';
			}
			renderExploreOverlay();
			renderTray();
		}

		// Fixed 4x4 footprint: rotating never resizes a tile or reflows the tray.
		function renderTray() {
			trayEl.innerHTML = '';
			for (const piece of PIECES) {
				const orients = piece.orients;
				const orient = orients[piece.key === selected ? orientIdx % orients.length : 0];
				const maxR = Math.max(...orient.map(o => o[0])), maxC = Math.max(...orient.map(o => o[1]));
				const offR = Math.floor((4 - (maxR + 1)) / 2), offC = Math.floor((4 - (maxC + 1)) / 2);
				const el = document.createElement('div');
				el.className = 'gs-piece' + (piece.key === selected ? ' selected' : '') + (placed.has(piece.key) ? ' placed' : '');
				for (let r = 0; r < 4; r++)
					for (let c = 0; c < 4; c++) {
						const d = document.createElement('div');
						d.className = 'pc';
						d.style.background = orient.some(([dr, dc]) => dr + offR === r && dc + offC === c) ? piece.color : 'transparent';
						el.appendChild(d);
					}
				el.addEventListener('click', () => {
					if (placed.has(piece.key)) return;
					if (selected === piece.key) orientIdx++;	// tap again = rotate
					else { selected = piece.key; orientIdx = 0; }
					armedCell = -1;
					renderTray(); renderGhost();
				});
				trayEl.appendChild(el);
			}
		}

		function rotate() { orientIdx++; renderTray(); renderGhost(); }
		root.querySelector('.gs-rotate').addEventListener('click', rotate);
		const onKey = e => {
			if (e.key === 'r' || e.key === 'R' || e.key === 'f' || e.key === 'F') rotate();
		};
		document.addEventListener('keydown', onKey);

		function onCellPointer(i, ev) {
			if (done) return;
			const onPiece = pieceAt(i);
			const haveSelection = selected !== null && !placed.has(selected);
			if (!haveSelection) {
				if (onPiece) pickUp(onPiece);
				return;
			}
			hoverCell = i;
			if (ev.pointerType === 'touch') {
				// Two-tap on touch: first tap previews, second tap on the same
				// cell places. A second tap on an occupied cell picks THAT up.
				if (armedCell === i) {
					if (ghostValid(ghostCells())) placeSelected();
					else if (onPiece) pickUp(onPiece);
					return;
				}
				armedCell = i;
				renderGhost();
				return;
			}
			if (ghostValid(ghostCells())) placeSelected();
			else if (onPiece) pickUp(onPiece);
		}

		function placeSelected() {
			placed.set(selected, ghostCells());
			selected = null; armedCell = -1;
			afterChange();
		}

		function pickUp(key) {
			const cs = placed.get(key);
			placed.delete(key);
			selected = key;
			orientIdx = orientIndexFor(key, cs);
			armedCell = -1;
			afterChange();
		}

		function orientIndexFor(key, cs) {
			const r0 = Math.min(...cs.map(c => Math.floor(c / 6)));
			const c0 = Math.min(...cs.map(c => c % 6));
			const got = new Set(cs.map(c => (Math.floor(c / 6) - r0) * 6 + (c % 6 - c0)));
			const orients = PIECES[PIECE_INDEX[key]].orients;
			for (let k = 0; k < orients.length; k++) {
				const minR = Math.min(...orients[k].map(o => o[0]));
				const minC = Math.min(...orients[k].map(o => o[1]));
				if (orients[k].every(([dr, dc]) => got.has((dr - minR) * 6 + (dc - minC)))) return k;
			}
			return 0;
		}

		root.querySelector('.gs-clear').addEventListener('click', () => {
			if (done) return;
			placed.clear();
			afterChange();
		});

		// ----- solution-space explorer -----
		function renderExploreOverlay() {
			if (!explore || done || !exploreSols.length) return;
			const sol = exploreSols[exploreIdx % exploreSols.length];
			for (const [key, cs] of Object.entries(sol)) {
				if (placed.has(key)) continue;
				for (const i of cs)
					if (!blockers.includes(i) && !pieceAt(i))
						cellEls[i].style.background = PIECES[PIECE_INDEX[key]].color + '55';
			}
		}

		function updateExplore() {
			if (!explore || done) return;
			exploreSols = enumerateSolutions(blockers, Object.fromEntries(placed), EXPLORE_CAP);
			exploreIdx = 0;
			const n = exploreSols.length;
			ctx.setStatus(`exploring ${n}${n >= EXPLORE_CAP ? '+' : ''} solution${n === 1 ? '' : 's'}`, n ? 'ok' : 'bad');
			if (n === 1 && placed.size > 0 && !autoCompleting) autoComplete(exploreSols[0]);
		}

		function autoComplete(sol) {
			autoCompleting = true;
			const rest = Object.entries(sol).filter(([key]) => !placed.has(key));
			const step = () => {
				if (done) { autoCompleting = false; return; }
				const next = rest.shift();
				if (!next) { autoCompleting = false; return; }
				placed.set(next[0], next[1]);
				selected = null; armedCell = -1;
				afterChange();
				setTimeout(step, 280);
			};
			step();
		}

		function afterChange() {
			updateExplore();
			renderBoard(); renderGhost();
			const filled = [...placed.values()].flat().length;	// piece cells of 29
			ctx.progress({ type: 'gs', placements: Object.fromEntries(placed), pct: filled / 29 });
			const covered = filled + blockers.length === 36;
			if (covered && !done) {
				done = true;
				clearInterval(exploreTimer);
				ctx.setStatus('★ solved!', 'won');
				ctx.finish();
				return;
			}
			if (!done && !explore) {
				// Always compute solvability and tell the room when we're
				// stuck — opponents enjoy that. Whether WE get warned is the
				// master's call (showDead): the warning is a big hint.
				const solvable = !!solve(blockers, Object.fromEntries(placed));
				if (showDead) ctx.setStatus(solvable ? '● solvable' : '● dead end', solvable ? 'ok' : 'bad');
				if (!solvable !== lastStuck) {
					lastStuck = !solvable;
					ctx.sendStuck(!solvable);
				}
			}
		}

		updateExplore();
		renderBoard();
		ctx.progress({ type: 'gs', placements: {}, pct: 0 });	// announce presence
		if (!explore && showDead) ctx.setStatus('● solvable', 'ok');
		if (explore)
			exploreTimer = setInterval(() => {
				if (done || exploreSols.length < 2) return;
				exploreIdx++;
				renderBoard(); renderGhost();
			}, 700);

		return {
			destroy() {
				done = true;
				clearInterval(exploreTimer);
				document.removeEventListener('keydown', onKey);
			},
		};
	},

	renderMini(el, progress, payload) {
		el.innerHTML = '';
		const mini = document.createElement('div');
		mini.className = 'mini-board';
		const byCell = {};
		for (const [key, cs] of Object.entries(progress?.placements || {}))
			for (const c of cs) byCell[c] = PIECES[PIECE_INDEX[key]].color;
		for (let i = 0; i < 36; i++) {
			const d = document.createElement('div');
			d.className = 'mc';
			if (payload?.cells?.includes(i)) d.style.background = '#999';
			else if (byCell[i]) d.style.background = byCell[i];
			mini.appendChild(d);
		}
		el.appendChild(mini);
	},
};
