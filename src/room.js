// One Durable Object per room — the whole game loop lives here.
//
// Roles: the first player to join is the puzzle master. The master proposes
// a puzzle (difficulty tier + optional solution-count hint); other players
// agree; when everyone has agreed (or the master force-starts) the round
// begins. Players race; finish order earns points (3/2/1); scores roll up
// across rounds. The master can clear a round or reset scores.
//
// Phases: lobby -> proposed -> playing -> lobby ...
//
// "Device lock": one live connection per player identity — connecting from
// a second device kicks the first (explicit message + close; close frames
// alone don't reliably reach the old client).

const PODIUM = [3, 2, 1];

export class Room {
	constructor(state) {
		this.state = state;
	}

	async game() {
		return (await this.state.storage.get('game')) || {
			phase: 'lobby',
			round: 0,
			master: null,
			puzzle: null,		// { cells, tier, count, showCount }
			proposal: null,		// same shape, while phase == 'proposed'
			agreed: [],
			finishOrder: [],	// [{ name, ms }]
			scores: {},		// name -> points
			lastResult: null,	// { round, winner, order: [{name, ms, points}] }
		};
	}
	async putGame(g) { await this.state.storage.put('game', g); }

	players() {
		return this.state.getWebSockets().map(ws => ws.deserializeAttachment());
	}
	connectedNames() {
		return [...new Set(this.players().map(p => p.name))];
	}

	async fetch(request) {
		if (request.headers.get('Upgrade') !== 'websocket')
			return new Response('expected websocket', { status: 426 });

		const url = new URL(request.url);
		const name = request.headers.get('X-Player-Email')
			|| url.searchParams.get('name')
			|| 'anonymous';

		for (const ws of this.state.getWebSockets())
			if (ws.deserializeAttachment()?.name === name) {
				try { ws.send(JSON.stringify({ t: 'kicked', reason: 'signed in from another device' })); } catch {}
				ws.close(4000, 'signed in from another device');
			}

		const pair = new WebSocketPair();
		this.state.acceptWebSocket(pair[1]);
		pair[1].serializeAttachment({
			id: crypto.randomUUID().slice(0, 8),
			name,
			placements: {},
			finishedMs: null,
		});

		const g = await this.game();
		if (!g.master || !this.connectedNames().includes(g.master)) {
			g.master = name;
			await this.putGame(g);
		}
		if (!(name in g.scores)) {
			g.scores[name] = 0;
			await this.putGame(g);
		}
		queueMicrotask(() => this.broadcast());

		return new Response(null, { status: 101, webSocket: pair[0] });
	}

	async broadcast() {
		const g = await this.game();
		const players = this.players();
		for (const ws of this.state.getWebSockets()) {
			const att = ws.deserializeAttachment();
			try {
				ws.send(JSON.stringify({ t: 'state', you: att.id, game: g, players }));
			} catch {}
		}
	}

	async startRound(g) {
		g.round++;
		g.phase = 'playing';
		g.puzzle = g.proposal;
		g.proposal = null;
		g.agreed = [];
		g.finishOrder = [];
		for (const ws of this.state.getWebSockets()) {
			const a = ws.deserializeAttachment();
			a.placements = {}; a.finishedMs = null;
			ws.serializeAttachment(a);
		}
		await this.putGame(g);
	}

	async endRound(g) {
		g.phase = 'lobby';
		g.lastResult = {
			round: g.round,
			winner: g.finishOrder[0]?.name ?? null,
			order: g.finishOrder.map((f, i) =>
				({ ...f, points: PODIUM[i] ?? 0 })),
		};
		await this.putGame(g);
	}

	async webSocketMessage(ws, data) {
		let msg;
		try { msg = JSON.parse(data); } catch { return; }
		const att = ws.deserializeAttachment();
		const g = await this.game();
		const isMaster = att.name === g.master;

		switch (msg.t) {
		// ----- board sync (any phase; placements are per-player) -----
		case 'place':
			if (typeof msg.piece === 'string' && Array.isArray(msg.cells))
				att.placements[msg.piece] = msg.cells.filter(c => Number.isInteger(c) && c >= 0 && c < 36);
			ws.serializeAttachment(att);
			break;
		case 'remove':
			delete att.placements[msg.piece];
			att.finishedMs = null;
			ws.serializeAttachment(att);
			break;
		case 'clear':
			att.placements = {};
			att.finishedMs = null;
			ws.serializeAttachment(att);
			break;

		// ----- game flow -----
		case 'propose':
			if (!isMaster || g.phase === 'playing') break;
			if (!Array.isArray(msg.puzzle?.cells) || msg.puzzle.cells.length !== 7) break;
			g.proposal = {
				cells: msg.puzzle.cells,
				tier: String(msg.puzzle.tier || ''),
				count: Number(msg.puzzle.count) || 0,
				showCount: !!msg.puzzle.showCount,
			};
			g.phase = 'proposed';
			g.agreed = [att.name];
			// Solo room: no one to agree with — go.
			if (this.connectedNames().length === 1) await this.startRound(g);
			else await this.putGame(g);
			break;
		case 'agree':
			if (g.phase !== 'proposed') break;
			if (!g.agreed.includes(att.name)) g.agreed.push(att.name);
			if (this.connectedNames().every(n => g.agreed.includes(n)))
				await this.startRound(g);
			else
				await this.putGame(g);
			break;
		case 'start':	// master force-start
			if (isMaster && g.phase === 'proposed') await this.startRound(g);
			break;
		case 'finish':
			if (g.phase !== 'playing' || !Number.isFinite(msg.ms)) break;
			if (g.finishOrder.some(f => f.name === att.name)) break;
			att.finishedMs = msg.ms;
			ws.serializeAttachment(att);
			g.finishOrder.push({ name: att.name, ms: msg.ms });
			g.scores[att.name] = (g.scores[att.name] || 0) + (PODIUM[g.finishOrder.length - 1] ?? 0);
			if (this.connectedNames().every(n => g.finishOrder.some(f => f.name === n)))
				await this.endRound(g);
			else
				await this.putGame(g);
			break;
		case 'endRound':	// master ends a stuck round
			if (isMaster && g.phase === 'playing') await this.endRound(g);
			break;
		case 'clearRound':	// the room "clear" button (master)
			if (!isMaster) break;
			g.phase = 'lobby';
			g.proposal = null;
			g.agreed = [];
			g.finishOrder = [];
			for (const sock of this.state.getWebSockets()) {
				const a = sock.deserializeAttachment();
				a.placements = {}; a.finishedMs = null;
				sock.serializeAttachment(a);
			}
			await this.putGame(g);
			break;
		case 'resetScores':
			if (!isMaster) break;
			g.scores = Object.fromEntries(Object.keys(g.scores).map(n => [n, 0]));
			g.lastResult = null;
			g.round = 0;
			await this.putGame(g);
			break;
		default:
			return;
		}
		await this.broadcast();
	}

	async webSocketClose(ws) {
		// Reassign master if they left; round continues for the rest.
		// The closing socket can still appear in getWebSockets() here.
		const g = await this.game();
		const names = [...new Set(this.state.getWebSockets()
			.filter(s => s !== ws)
			.map(s => s.deserializeAttachment().name))];
		if (g.master && !names.includes(g.master)) {
			g.master = names[0] ?? null;
			await this.putGame(g);
		}
		await this.broadcast();
	}

	async webSocketError() {
		await this.broadcast();
	}
}
