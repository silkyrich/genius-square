// Genius Square — Cloudflare Worker entry.
// Serves the static game (assets binding), a small API, and routes
// WebSocket connections to per-room Durable Objects.
export { Room } from './room.js';

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ';	// no I/L/O/0/1 lookalikes

function identityFrom(request) {
	// Cloudflare Access (IdP) injects the verified user when configured.
	return request.headers.get('Cf-Access-Authenticated-User-Email') || null;
}

export default {
	async fetch(request, env) {
		const url = new URL(request.url);

		if (url.pathname === '/api/me')
			return Response.json({ email: identityFrom(request) });

		if (url.pathname === '/api/rooms' && request.method === 'POST') {
			let code = '';
			const rand = crypto.getRandomValues(new Uint8Array(4));
			for (const b of rand) code += ROOM_CODE_ALPHABET[b % ROOM_CODE_ALPHABET.length];
			return Response.json({ code });
		}

		const wsMatch = url.pathname.match(/^\/ws\/([A-Z]{4})$/);
		if (wsMatch) {
			const id = env.ROOM.idFromName(wsMatch[1]);
			// Pass the verified identity to the room; it beats the ?name= hint.
			const headers = new Headers(request.headers);
			const email = identityFrom(request);
			if (email) headers.set('X-Player-Email', email);
			return env.ROOM.get(id).fetch(new Request(request, { headers }));
		}

		return env.ASSETS.fetch(request);
	},
};
