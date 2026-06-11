// One Durable Object per party — the whole game loop lives here, and it is
// game-agnostic: the proposal carries an opaque per-game payload that only
// the clients interpret (Genius Square, Sudoku, Boggle, ...).
//
// Roles: the first player to join is the party master. The master proposes
// a round (game + options); other players agree; when everyone has agreed
// (or the master force-starts) the round begins. Two scoring modes:
//   race   — finish order earns podium points (first to solve wins)
//   points — everyone plays until the clock runs out, podium by score
// Party scores roll up across rounds and across games.
//
// Phases: lobby -> proposed -> playing -> lobby ...
//
// "Device lock": one live connection per player identity — connecting from
// a second device kicks the first (explicit message + close; close frames
// alone don't reliably reach the old client).

const PODIUM = [3, 2, 1];

export class Room {
	constructor(state, env) {
		this.state = state;
		this.env = env;
	}

	async game() {
		const g = await this.state.storage.get('game');
		if (g) {
			g.chat ||= [];
			g.theme ||= 'classic';
			g.isPublic ??= false;
			return g;
		}
		return {
			phase: 'lobby',
			round: 0,
			master: null,
			puzzle: null,		// { game, summary, scoreMode, durationMs, payload }
			proposal: null,		// same shape, while phase == 'proposed'
			agreed: [],
			finishOrder: [],	// race: [{name, ms}] in arrival order; points: [{name, points}]
			scores: {},		// name -> party points, across games
			lastResult: null,	// { round, game, winner, order: [{name, ms?, points?, awarded}] }
			chat: [],		// [{ name, text, ts }], capped
			theme: 'classic',
			isPublic: false,
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
		const code = request.headers.get('X-Room-Code');
		if (code && !(await this.state.storage.get('code')))
			await this.state.storage.put('code', code);
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
			progress: null,		// opaque per-game blob, relayed to other players
			stuck: false,
			finishedMs: null,
			finishedPts: null,
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
		await this.heartbeatDirectory(g, players.length);
	}

	// Keep the public directory fresh (or remove ourselves when private/empty).
	async heartbeatDirectory(g, playerCount) {
		const code = await this.state.storage.get('code');
		if (!code || !this.env?.DIRECTORY) return;
		try {
			await this.env.DIRECTORY.get(this.env.DIRECTORY.idFromName('main'))
				.fetch('https://directory/update', {
					method: 'POST',
					body: JSON.stringify({
						code,
						public: g.isPublic,
						host: g.master,
						players: playerCount,
						game: g.phase === 'playing' ? g.puzzle?.game : (g.proposal?.game || 'lobby'),
						theme: g.theme,
						phase: g.phase,
					}),
				});
		} catch {}
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
			a.progress = null; a.stuck = false; a.finishedMs = null; a.finishedPts = null;
			ws.serializeAttachment(a);
		}
		await this.putGame(g);
	}

	async endRound(g) {
		g.phase = 'lobby';
		const points = g.puzzle?.scoreMode === 'points';
		const order = points
			? [...g.finishOrder].sort((a, b) => (b.points || 0) - (a.points || 0))
			: g.finishOrder;
		const awarded = order.map((f, i) => {
			const pts = points && !(f.points > 0) ? 0 : (PODIUM[i] ?? 0);	// no podium for a zero score
			g.scores[f.name] = (g.scores[f.name] || 0) + pts;
			return { ...f, awarded: pts };
		});
		g.lastResult = {
			round: g.round,
			game: g.puzzle?.game,
			winner: awarded[0]?.awarded ? awarded[0].name : null,
			order: awarded,
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
		// ----- per-player progress (opaque to the server) -----
		case 'progress': {
			const s = JSON.stringify(msg.data ?? null);
			if (s.length > 4096) break;
			att.progress = msg.data;
			ws.serializeAttachment(att);
			break;
		}
		case 'stuck':	// client-computed dead-end flag, shown to OTHER players
			att.stuck = !!msg.stuck;
			ws.serializeAttachment(att);
			break;
		case 'chat': {
			const text = String(msg.text || '').trim().slice(0, 300);
			if (!text) return;
			g.chat.push({ name: att.name, text, ts: Date.now() });
			if (g.chat.length > 50) g.chat = g.chat.slice(-50);
			await this.putGame(g);
			break;
		}

		// ----- party settings (master) -----
		case 'theme':
			if (!isMaster) break;
			g.theme = String(msg.key || 'classic').slice(0, 24);
			await this.putGame(g);
			break;
		case 'visibility':
			if (!isMaster) break;
			g.isPublic = !!msg.public;
			await this.putGame(g);
			break;

		// ----- game flow -----
		case 'propose': {
			if (!isMaster || g.phase === 'playing') break;
			const p = msg.puzzle;
			if (!p || typeof p.game !== 'string') break;
			if (JSON.stringify(p.payload ?? null).length > 32768) break;
			g.proposal = {
				game: p.game.slice(0, 24),
				summary: String(p.summary || '').slice(0, 120),
				scoreMode: p.scoreMode === 'points' ? 'points' : 'race',
				durationMs: Number(p.durationMs) || 0,
				payload: p.payload ?? null,
			};
			g.phase = 'proposed';
			g.agreed = [att.name];
			// Solo party: no one to agree with — go.
			if (this.connectedNames().length === 1) await this.startRound(g);
			else await this.putGame(g);
			break;
		}
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
		case 'finish': {
			if (g.phase !== 'playing') break;
			if (g.finishOrder.some(f => f.name === att.name)) break;
			if (g.puzzle?.scoreMode === 'points') {
				const points = Number(msg.points) || 0;
				att.finishedPts = points;
				ws.serializeAttachment(att);
				g.finishOrder.push({ name: att.name, points });
			} else {
				if (!Number.isFinite(msg.ms)) break;
				att.finishedMs = msg.ms;
				ws.serializeAttachment(att);
				g.finishOrder.push({ name: att.name, ms: msg.ms });
			}
			if (this.connectedNames().every(n => g.finishOrder.some(f => f.name === n)))
				await this.endRound(g);
			else
				await this.putGame(g);
			break;
		}
		case 'endRound':	// master ends a stuck round
			if (isMaster && g.phase === 'playing') await this.endRound(g);
			break;
		case 'clearRound':	// the party "clear" button (master)
			if (!isMaster) break;
			g.phase = 'lobby';
			g.proposal = null;
			g.agreed = [];
			g.finishOrder = [];
			for (const sock of this.state.getWebSockets()) {
				const a = sock.deserializeAttachment();
				a.progress = null; a.stuck = false; a.finishedMs = null; a.finishedPts = null;
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
