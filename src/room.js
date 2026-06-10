// One Durable Object instance per room. Uses the WebSocket hibernation API:
// player state is serialized into each socket's attachment and the shared
// puzzle lives in DO storage, so a room survives eviction between moves.
//
// "Device lock": one live connection per player identity — connecting from
// a second device closes the first socket.

export class Room {
	constructor(state) {
		this.state = state;
	}

	async fetch(request) {
		if (request.headers.get('Upgrade') !== 'websocket')
			return new Response('expected websocket', { status: 426 });

		const url = new URL(request.url);
		const name = request.headers.get('X-Player-Email')
			|| url.searchParams.get('name')
			|| 'anonymous';

		// Device lock: drop any existing socket for this identity. The
		// explicit message matters — close frames don't always reach the
		// old client, but a message followed by a client-side close does.
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

		// Send initial state once the socket is live.
		const puzzle = (await this.state.storage.get('puzzle')) || [];
		queueMicrotask(() => this.broadcastState(puzzle));

		return new Response(null, { status: 101, webSocket: pair[0] });
	}

	players() {
		return this.state.getWebSockets().map(ws => ws.deserializeAttachment());
	}

	async broadcastState(puzzle) {
		if (puzzle === undefined)
			puzzle = (await this.state.storage.get('puzzle')) || [];
		const players = this.players();
		for (const ws of this.state.getWebSockets()) {
			const you = ws.deserializeAttachment().id;
			try {
				ws.send(JSON.stringify({ t: 'state', you, puzzle, players }));
			} catch {}
		}
	}

	async webSocketMessage(ws, data) {
		let msg;
		try { msg = JSON.parse(data); } catch { return; }
		const att = ws.deserializeAttachment();

		switch (msg.t) {
		case 'place':
			if (typeof msg.piece === 'string' && Array.isArray(msg.cells))
				att.placements[msg.piece] = msg.cells.filter(c => Number.isInteger(c) && c >= 0 && c < 36);
			break;
		case 'remove':
			delete att.placements[msg.piece];
			att.finishedMs = null;
			break;
		case 'board':
			att.placements = msg.placements && typeof msg.placements === 'object' ? msg.placements : {};
			break;
		case 'clear':
			att.placements = {};
			att.finishedMs = null;
			break;
		case 'finish':
			if (Number.isFinite(msg.ms)) att.finishedMs = msg.ms;
			break;
		case 'puzzle':
			if (Array.isArray(msg.blockers) && msg.blockers.length === 7) {
				await this.state.storage.put('puzzle', msg.blockers);
				// New round: wipe everyone's board.
				for (const sock of this.state.getWebSockets()) {
					const a = sock.deserializeAttachment();
					a.placements = {}; a.finishedMs = null;
					sock.serializeAttachment(a);
				}
				await this.broadcastState(msg.blockers);
				return;
			}
			return;
		default:
			return;
		}
		ws.serializeAttachment(att);
		await this.broadcastState();
	}

	async webSocketClose() {
		await this.broadcastState();
	}

	async webSocketError() {
		await this.broadcastState();
	}
}
