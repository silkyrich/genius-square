// Singleton Durable Object: the public party directory.
// Rooms that opt in (master toggles "discoverable") heartbeat their state
// here on every broadcast; the landing page lists fresh entries so anyone
// can tap in without a code.

const FRESH_MS = 90_000;

export class Directory {
	constructor(state) {
		this.state = state;
	}

	async fetch(request) {
		const url = new URL(request.url);

		if (request.method === 'POST' && url.pathname === '/update') {
			const e = await request.json();
			if (!/^[A-Z]{4}$/.test(e.code || '')) return new Response('bad code', { status: 400 });
			if (!e.public || !e.players) await this.state.storage.delete(e.code);
			else await this.state.storage.put(e.code, {
				code: e.code,
				name: String(e.name || '').slice(0, 40),
				host: String(e.host || '').slice(0, 24),
				players: Number(e.players) || 0,
				game: String(e.game || '').slice(0, 24),
				phase: String(e.phase || '').slice(0, 16),
				ts: Date.now(),
			});
			return new Response('ok');
		}

		if (url.pathname === '/list') {
			const all = await this.state.storage.list();
			const now = Date.now();
			const out = [];
			for (const [code, e] of all) {
				if (now - e.ts > FRESH_MS) { await this.state.storage.delete(code); continue; }
				out.push(e);
			}
			out.sort((a, b) => b.players - a.players || b.ts - a.ts);
			return Response.json(out.slice(0, 30));
		}

		return new Response('not found', { status: 404 });
	}
}
