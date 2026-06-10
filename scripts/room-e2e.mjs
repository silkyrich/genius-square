// End-to-end room test against a running dev server (npm run dev, port 8787):
//   node scripts/room-e2e.mjs
// Covers: master assignment, propose flags (showDead/explore), stuck
// broadcast + reset, chat, finish order, podium scoring.
import WebSocket from 'ws';
import { solve, nameToIndex } from '../public/solver.js';

let pass = 0, fail = 0;
const ok = (cond, label) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${label}`); cond ? pass++ : fail++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function client(name) {
	const ws = new WebSocket(`ws://localhost:8787/ws/TS${Math.random().toString(36).slice(2, 4).toUpperCase()}?name=${name}`);
	const c = { ws, name, state: null };
	ws.on('message', d => { const m = JSON.parse(d); if (m.t === 'state') c.state = m; });
	c.send = m => ws.send(JSON.stringify(m));
	return new Promise(res => ws.on('open', () => res(c)));
}

// one shared room for both clients
const code = 'TQ' + Math.random().toString(36).slice(2, 4).toUpperCase().replace(/[^A-Z]/g, 'A');
const join = name => new Promise(res => {
	const ws = new WebSocket(`ws://localhost:8787/ws/${code.slice(0, 4).padEnd(4, 'Q')}?name=${name}`);
	const c = { ws, name, state: null, send: m => ws.send(JSON.stringify(m)) };
	ws.on('message', d => { const m = JSON.parse(d); if (m.t === 'state') c.state = m; });
	ws.on('open', () => res(c));
});

const alice = await join('alice');
await sleep(400);
const bob = await join('bob');
await sleep(500);

ok(alice.state.game.master === 'alice', 'first joiner is master');

const cells = 'A4 B3 B5 C1 C2 C4 C6'.split(' ').map(nameToIndex);
alice.send({ t: 'propose', puzzle: { cells, tier: 'brutal', count: 1, showCount: false, showDead: false, explore: true } });
await sleep(400);
ok(bob.state.game.phase === 'proposed', 'proposal broadcast');
ok(bob.state.game.proposal.showDead === false, 'showDead=false stored');
ok(bob.state.game.proposal.explore === true, 'explore stored');

bob.send({ t: 'agree' });
await sleep(400);
ok(alice.state.game.phase === 'playing', 'all agreed -> playing');

bob.send({ t: 'stuck', stuck: true });
await sleep(400);
ok(alice.state.players.find(p => p.name === 'bob')?.stuck === true, 'stuck flag visible to others');

alice.send({ t: 'chat', text: 'good luck!' });
await sleep(400);
ok(bob.state.game.chat?.at(-1)?.text === 'good luck!', 'chat broadcast');

const sol = solve(cells);
for (const [k, cs] of Object.entries(sol)) alice.send({ t: 'place', piece: k, cells: cs });
alice.send({ t: 'finish', ms: 4200 });
bob.send({ t: 'finish', ms: 9000 });
await sleep(500);
ok(bob.state.game.phase === 'lobby', 'all finished -> lobby');
ok(bob.state.game.lastResult.winner === 'alice', 'winner alice');
ok(alice.state.players.every(p => !p.stuck), 'stuck reset after round');

alice.ws.close(); bob.ws.close();
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
