// Singleton Durable Object: in-app feedback inbox.
// Stores each report (text + context + JPEG screenshot) and serves the
// screenshot back over HTTP so a Linear issue can embed it by URL.
// Screenshots are base64 and may exceed the 128KiB per-value storage
// limit, so they're chunked.

const CHUNK = 100_000;

export class Feedback {
	constructor(state) {
		this.state = state;
	}

	async fetch(request) {
		const url = new URL(request.url);

		if (request.method === 'POST' && url.pathname === '/submit') {
			const b = await request.json();
			const text = String(b.text || '').trim().slice(0, 2000);
			if (!text) return new Response('no text', { status: 400 });
			const id = crypto.randomUUID().slice(0, 12);
			const entry = {
				id,
				ts: Date.now(),
				text,
				meta: {
					url: String(b.meta?.url || '').slice(0, 200),
					party: String(b.meta?.party || '').slice(0, 8),
					game: String(b.meta?.game || '').slice(0, 24),
					phase: String(b.meta?.phase || '').slice(0, 16),
					player: String(b.meta?.player || '').slice(0, 40),
					ua: String(b.meta?.ua || '').slice(0, 200),
				},
				hasImage: false,
				filed: null,	// Linear issue identifier once filed
			};
			const img = String(b.image || '');
			if (img.startsWith('data:image/jpeg;base64,') && img.length < 800_000) {
				const data = img.slice('data:image/jpeg;base64,'.length);
				const chunks = Math.ceil(data.length / CHUNK);
				for (let i = 0; i < chunks; i++)
					await this.state.storage.put(`img:${id}:${i}`, data.slice(i * CHUNK, (i + 1) * CHUNK));
				await this.state.storage.put(`imgn:${id}`, chunks);
				entry.hasImage = true;
			}
			await this.state.storage.put(`fb:${id}`, entry);
			return Response.json(entry);
		}

		const imgMatch = url.pathname.match(/^\/img\/([a-z0-9-]{12})$/);
		if (imgMatch) {
			const id = imgMatch[1];
			const chunks = await this.state.storage.get(`imgn:${id}`);
			if (!chunks) return new Response('not found', { status: 404 });
			let data = '';
			for (let i = 0; i < chunks; i++)
				data += await this.state.storage.get(`img:${id}:${i}`) || '';
			const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
			return new Response(bytes, {
				headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=31536000' },
			});
		}

		if (url.pathname === '/list') {
			const all = await this.state.storage.list({ prefix: 'fb:' });
			const out = [...all.values()].sort((a, b) => b.ts - a.ts);
			return Response.json(out.slice(0, 100));
		}

		if (request.method === 'POST' && url.pathname === '/mark-filed') {
			const { id, issue } = await request.json();
			const e = await this.state.storage.get(`fb:${id}`);
			if (e) { e.filed = String(issue || '').slice(0, 20); await this.state.storage.put(`fb:${id}`, e); }
			return new Response('ok');
		}

		return new Response('not found', { status: 404 });
	}
}
