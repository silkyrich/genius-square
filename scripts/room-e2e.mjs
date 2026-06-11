// End-to-end party test against a running dev server (npm run dev, port 8787):
//   node scripts/room-e2e.mjs
// Covers: master assignment, game-agnostic proposals, race + points scoring,
// generic progress relay, stuck broadcast + reset, chat, theme/visibility,
// directory listing.
import WebSocket from 'ws';

let pass = 0, fail = 0;
const ok = (cond, label) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${label}`); cond ? pass++ : fail++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const code = 'Q' + Array.from({ length: 3 }, () =>
	'ABCDEFGHJKMNPQRSTUVWXYZ'[Math.floor(Math.random() * 23)]).join('');
const join = name => new Promise(res => {
	const ws = new WebSocket(`ws://localhost:8787/ws/${code}?name=${name}`);
	const c = { ws, name, state: null, send: m => ws.send(JSON.stringify(m)) };
	ws.on('message', d => { const m = JSON.parse(d); if (m.t === 'state') c.state = m; });
	ws.on('open', () => res(c));
});

const alice = await join('alice');
await sleep(400);
const bob = await join('bob');
await sleep(500);

ok(alice.state.game.master === 'alice', 'first joiner is master');

// theme + discoverability
alice.send({ t: 'theme', key: 'tigertea' });
alice.send({ t: 'visibility', public: true });
await sleep(400);
ok(bob.state.game.theme === 'tigertea', 'theme broadcast');
ok(bob.state.game.isPublic === true, 'visibility broadcast');
const parties = await (await fetch('http://localhost:8787/api/parties')).json();
ok(parties.some(p => p.code === code && p.theme === 'tigertea'), 'party listed in directory');

// ---- round 1: race game (genius square style payload is opaque) ----
alice.send({ t: 'propose', puzzle: {
	game: 'gs', summary: 'Genius Square — Medium', scoreMode: 'race', durationMs: 0,
	payload: { cells: [1, 2, 3, 4, 5, 6, 7] },
} });
await sleep(400);
ok(bob.state.game.phase === 'proposed', 'proposal broadcast');
ok(bob.state.game.proposal.game === 'gs', 'proposal carries game key');
bob.send({ t: 'agree' });
await sleep(400);
ok(alice.state.game.phase === 'playing', 'all agreed -> playing');

bob.send({ t: 'progress', data: { type: 'gs', placements: { square: [10, 11, 16, 17] } } });
bob.send({ t: 'stuck', stuck: true });
await sleep(400);
const bobP = alice.state.players.find(p => p.name === 'bob');
ok(bobP?.progress?.placements?.square?.length === 4, 'progress relayed');
ok(bobP?.stuck === true, 'stuck flag visible to others');

alice.send({ t: 'chat', text: 'good luck!' });
await sleep(300);
ok(bob.state.game.chat?.at(-1)?.text === 'good luck!', 'chat broadcast');

alice.send({ t: 'finish', ms: 4200 });
bob.send({ t: 'finish', ms: 9000 });
await sleep(500);
ok(bob.state.game.phase === 'lobby', 'race: all finished -> lobby');
ok(bob.state.game.lastResult.winner === 'alice', 'race: fastest wins');
ok(bob.state.game.scores.alice === 3 && bob.state.game.scores.bob === 2, 'race: podium points');
// final boards stay visible in the lobby; reset happens at next round start

// ---- round 2: points game (boggle style) ----
alice.send({ t: 'propose', puzzle: {
	game: 'boggle', summary: 'Boggle — 90 seconds', scoreMode: 'points', durationMs: 90000,
	payload: { seed: 42, grid: [] },
} });
await sleep(300);
bob.send({ t: 'agree' });
await sleep(400);
ok(alice.state.game.phase === 'playing' && alice.state.game.puzzle.scoreMode === 'points', 'points round started');
ok(alice.state.players.every(p => !p.stuck && !p.progress), 'progress/stuck reset at round start');
alice.send({ t: 'finish', points: 7 });
bob.send({ t: 'finish', points: 19 });
await sleep(500);
ok(bob.state.game.phase === 'lobby', 'points: all finished -> lobby');
ok(bob.state.game.lastResult.winner === 'bob', 'points: highest score wins');
ok(bob.state.game.scores.bob === 2 + 3 && bob.state.game.scores.alice === 3 + 2, 'points: podium added to party scores');
ok(bob.state.game.lastResult.order[0].points === 19, 'result order carries points');

alice.ws.close(); bob.ws.close();
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
