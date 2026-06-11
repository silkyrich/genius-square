// Puzzle Party — Cloudflare Worker entry.
// Serves the static app (assets binding), a small API, party share pages
// with per-party Open Graph tags, and routes WebSockets to room DOs.
export { Room } from './room.js';
export { Directory } from './directory.js';
export { Feedback } from './feedback.js';

const LINEAR_TEAM = '55b5b491-1fec-45d3-8381-4b32a9a2e7a3';		// Automated-learning
const LINEAR_PROJECT = '17c2fc91-3006-4057-b03c-09c7be5645ee';	// Genius Square Web

// File a stored feedback entry as a Linear issue (when a key is configured).
async function fileToLinear(env, entry, origin) {
	if (!env.LINEAR_API_KEY) return null;
	const img = entry.hasImage ? `\n\n![screenshot](${origin}/api/feedback/img/${entry.id})` : '';
	const m = entry.meta;
	const description = `${entry.text}\n\n---\n` +
		`**From:** ${m.player || 'guest'}\n**URL:** ${m.url}\n**Party:** ${m.party || '—'} ` +
		`(${m.phase || '—'}${m.game ? ', playing ' + m.game : ''})\n**UA:** ${m.ua}${img}`;
	const res = await fetch('https://api.linear.app/graphql', {
		method: 'POST',
		headers: { 'content-type': 'application/json', authorization: env.LINEAR_API_KEY },
		body: JSON.stringify({
			query: `mutation($input: IssueCreateInput!) {
				issueCreate(input: $input) { success issue { identifier } } }`,
			variables: { input: {
				teamId: LINEAR_TEAM, projectId: LINEAR_PROJECT,
				title: 'In-app feedback: ' + entry.text.slice(0, 60),
				description, priority: 3,
			} },
		}),
	});
	const d = await res.json().catch(() => null);
	return d?.data?.issueCreate?.issue?.identifier || null;
}

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

		// In-app feedback: store in the Feedback DO, then file to Linear
		// directly when LINEAR_API_KEY is configured.
		const fbStub = () => env.FEEDBACK.get(env.FEEDBACK.idFromName('main'));
		if (url.pathname === '/api/feedback' && request.method === 'POST') {
			const stored = await fbStub().fetch('https://feedback/submit',
				{ method: 'POST', body: await request.text() });
			if (!stored.ok) return stored;
			const entry = await stored.json();
			let issue = null;
			try { issue = await fileToLinear(env, entry, url.origin); } catch {}
			if (issue)
				await fbStub().fetch('https://feedback/mark-filed',
					{ method: 'POST', body: JSON.stringify({ id: entry.id, issue }) });
			return Response.json({ ok: true, id: entry.id, issue });
		}
		if (url.pathname === '/api/feedback/mark' && request.method === 'POST')
			return fbStub().fetch('https://feedback/mark-filed', { method: 'POST', body: await request.text() });
		const fbImg = url.pathname.match(/^\/api\/feedback\/img\/([a-z0-9-]{12})$/);
		if (fbImg) return fbStub().fetch(`https://feedback/img/${fbImg[1]}`);
		if (url.pathname === '/api/feedback/list')
			return fbStub().fetch('https://feedback/list');

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
				.replace('content="A growing shelf of puzzle games',
					`content="Tap to join party ${code} and race.`);
			return new Response(html, {
				headers: { 'content-type': 'text/html; charset=utf-8' },
			});
		}

		return env.ASSETS.fetch(request);
	},
};
