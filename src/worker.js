// Puzzle Party — Cloudflare Worker entry.
// Serves the static app (assets binding), a small API, party share pages
// with per-party Open Graph tags, and routes WebSockets to room DOs.
export { Room } from './room.js';
export { Directory } from './directory.js';

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ';	// no I/L/O/0/1 lookalikes

function getCookie(request, name) {
	const m = (request.headers.get('Cookie') || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
	return m ? decodeURIComponent(m[1]) : null;
}

function identityFrom(request) {
	// Cloudflare Access (IdP) injects the verified user on protected paths
	// (we protect /login); elsewhere we carry it in our own cookie, set by
	// the /login handler after Access has verified the user.
	return request.headers.get('Cf-Access-Authenticated-User-Email')
		|| getCookie(request, 'gs-email') || null;
}

export default {
	async fetch(request, env) {
		const url = new URL(request.url);

		if (url.pathname === '/api/me')
			return Response.json({ email: identityFrom(request) });

		// /login sits behind a Cloudflare Access app (Google etc.). By the
		// time the request reaches us the user is verified — stash the email
		// in a cookie for the unprotected rest of the site and bounce back.
		if (url.pathname === '/login') {
			const email = request.headers.get('Cf-Access-Authenticated-User-Email');
			const next = url.searchParams.get('next') || '/';
			const headers = new Headers({ Location: next.startsWith('/') ? next : '/' });
			if (email)
				headers.append('Set-Cookie',
					`gs-email=${encodeURIComponent(email)}; Path=/; Max-Age=2592000; Secure; SameSite=Lax`);
			return new Response(null, { status: 302, headers });
		}

		if (url.pathname === '/logout') {
			const headers = new Headers();
			headers.append('Set-Cookie', 'gs-email=; Path=/; Max-Age=0; Secure; SameSite=Lax');
			headers.set('Location', getCookie(request, 'CF_Authorization')
				? '/cdn-cgi/access/logout' : '/');
			return new Response(null, { status: 302, headers });
		}

		if (url.pathname === '/api/rooms' && request.method === 'POST') {
			let code = '';
			const rand = crypto.getRandomValues(new Uint8Array(4));
			for (const b of rand) code += ROOM_CODE_ALPHABET[b % ROOM_CODE_ALPHABET.length];
			return Response.json({ code });
		}

		// Public party directory for the landing page.
		if (url.pathname === '/api/parties')
			return env.DIRECTORY.get(env.DIRECTORY.idFromName('main'))
				.fetch('https://directory/list');

		const wsMatch = url.pathname.match(/^\/ws\/([A-Z]{4})$/);
		if (wsMatch) {
			const id = env.ROOM.idFromName(wsMatch[1]);
			const headers = new Headers(request.headers);
			const email = identityFrom(request);
			if (email) headers.set('X-Player-Email', email);
			headers.set('X-Room-Code', wsMatch[1]);	// DOs don't know their own name
			return env.ROOM.get(id).fetch(new Request(request, { headers }));
		}

		// Party share links: serve the app shell with party-specific OG tags
		// so pasted links unfurl nicely in chat apps.
		const roomMatch = url.pathname.match(/^\/r\/([A-Za-z]{4})$/);
		if (roomMatch) {
			const code = roomMatch[1].toUpperCase();
			const shell = await env.ASSETS.fetch(new Request(new URL('/', url)));
			let html = await shell.text();
			html = html
				.replaceAll('Puzzle Party — race your friends',
					`Join my Puzzle Party ${code}!`)
				.replace('content="Genius Square, Sudoku and Boggle',
					`content="Tap to join party ${code} and race.`);
			return new Response(html, {
				headers: { 'content-type': 'text/html; charset=utf-8' },
			});
		}

		return env.ASSETS.fetch(request);
	},
};
