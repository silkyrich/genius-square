// Tests for the Trio hunt module's pure helpers.
// Lives next to the module because test/ is not writable in this session.
// Run: node public/games/trio.test.mjs
import { deckFromSeed, isTrio, findTrio } from '../public/games/trio.js';

let failed = 0;
const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) failed++; };
const card = (count, shape, fill, color) => ({ count, shape, fill, color });

// deckFromSeed: 81 unique cards, every feature combination exactly once.
const d1 = deckFromSeed(12345);
const keys = new Set(d1.map(c => `${c.count},${c.shape},${c.fill},${c.color}`));
check(d1.length === 81, 'deck has 81 cards');
check(keys.size === 81, 'all 81 cards are unique');
check(d1.every(c => [c.count, c.shape, c.fill, c.color].every(v => v >= 0 && v <= 2)),
	'all feature indices are 0-2');
check(new Set(d1.map(c => c.id)).size === 81, 'all 81 ids are unique');

// Deterministic shuffle: same seed -> same order, different seed -> different.
const ids = d => d.map(c => c.id).join();
check(ids(d1) === ids(deckFromSeed(12345)), 'same seed -> same deck order');
check(ids(d1) !== ids(deckFromSeed(54321)), 'different seed -> different deck order');

// isTrio: each feature must be all-same or all-different across the trio.
check(isTrio(card(0,0,0,0), card(0,1,1,1), card(0,2,2,2)),
	'trio with an all-same feature (count) is valid');
check(isTrio(card(0,0,0,0), card(1,1,1,1), card(2,2,2,2)),
	'all-different trio is valid');
check(!isTrio(card(0,0,0,0), card(0,1,1,1), card(1,2,2,2)),
	'exactly two sharing a feature (count) is invalid');
check(!isTrio(card(0,0,0,0), card(1,1,1,1), card(2,2,0,2)),
	'exactly two sharing a feature (fill) is invalid');

// findTrio: locates a planted trio among decoys.
const planted = [
	card(0,0,0,1), card(1,0,2,0), card(0,1,0,0),	// decoys
	card(0,0,0,0), card(1,1,1,1), card(2,2,2,2),	// the trio
];
const hit = findTrio(planted);
check(Array.isArray(hit) && isTrio(...hit.map(i => planted[i])), 'findTrio finds a planted trio');

// Trio-free set: 4 cards where every triple has a two-and-one feature.
// A=(0,0,0,0) B=(0,0,0,1) C=(0,0,1,0) D=(0,1,0,0):
//   ABC fails fill, ABD fails shape, ACD fails fill, BCD fails color.
const capset = [card(0,0,0,0), card(0,0,0,1), card(0,0,1,0), card(0,1,0,0)];
let anyTrio = false;	// exhaustive verification of the construction
for (let i = 0; i < 4; i++)
	for (let j = i + 1; j < 4; j++)
		for (let k = j + 1; k < 4; k++)
			if (isTrio(capset[i], capset[j], capset[k])) anyTrio = true;
check(!anyTrio, 'cap set verified trio-free by exhaustion');
check(findTrio(capset) === null, 'findTrio returns null for a trio-free set');

process.exit(failed ? 1 : 0);
