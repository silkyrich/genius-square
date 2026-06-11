// Tests for the Boggle module's pure helpers + the bundled word list.
// Run: node test/boggle.test.js
import { readFileSync } from 'node:fs';
import { DICE, gridFromSeed, canForm, scoreWord } from '../public/games/boggle.js';

let failed = 0;
const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) failed++; };

// gridFromSeed: deterministic, 16 faces, all faces come from the dice.
const g1 = gridFromSeed(12345), g2 = gridFromSeed(12345), g3 = gridFromSeed(54321);
check(g1.join() === g2.join(), 'same seed -> same grid');
check(g1.join() !== g3.join(), 'different seed -> different grid');
const faces = new Set(DICE.flat());
check(DICE.length === 16 && DICE.every(d => d.length === 6), '16 dice with 6 faces each');
check(g1.length === 16 && g1.every(f => faces.has(f)), 'grid has 16 faces, all from the dice');

// canForm on a handcrafted grid (rows of 4, index = row * 4 + col):
//   c a t b
//   x x x x
//   d o x x
//   x x g x
const grid = ['c','a','t','b', 'x','x','x','x', 'd','o','x','x', 'x','x','g','x'];
check(canForm(grid, 'cat'), 'forms word along a horizontal path');
check(canForm(grid, 'dog'), 'forms word using diagonal steps');
check(!canForm(grid, 'cac'), 'rejects word needing cell reuse');
check(!canForm(grid, 'cab'), 'rejects non-adjacent step (c -> a -> b)');
check(!canForm(grid, 'zzz'), 'rejects letters not on the grid');

// 'qu' face counts as the two letters "qu".
const qgrid = ['qu','i','z','x', 'x','x','x','x', 'x','x','x','x', 'x','x','x','x'];
check(canForm(qgrid, 'quiz'), 'qu face forms "quiz"');
check(!canForm(qgrid, 'qiz'), 'qu face cannot stand for a lone q');

// Classic scoring by word length.
const scores = ['cat','cats','crane','crates','craters','crateful'].map(scoreWord);
check(scores.join() === '1,1,2,3,5,11', `scores 3..8 letters -> ${scores.join('/')}`);
check(scoreWord('hippopotamus') === 11, '8+ letters -> 11');

// Bundled dictionary: big enough, sane contents.
const words = readFileSync(new URL('../public/data/words-en.txt', import.meta.url), 'utf8')
	.split('\n').filter(Boolean);
check(words.length > 100000, `word list has ${words.length} words (> 100000)`);
check(words.every(w => /^[a-z]{3,16}$/.test(w)), 'all words match ^[a-z]{3,16}$');
const set = new Set(words);
check(set.has('tea'), "contains 'tea'");
check(!set.has('zzzzzz'), "does not contain 'zzzzzz'");

process.exit(failed ? 1 : 0);
