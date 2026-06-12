import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The React shell builds into public/ alongside the runtime-loaded game
// modules (public/games/*, /solver.js, /vendor/*) which stay OUTSIDE the
// bundle — they're plain ES modules fetched by absolute path.
export default defineConfig({
	root: 'ui',
	plugins: [react()],
	build: {
		outDir: '../public',
		emptyOutDir: false,
	},
	server: {
		proxy: Object.fromEntries(
			['/api', '/ws', '/games', '/data', '/vendor', '/fonts'].map(p =>
				[p, { target: 'http://localhost:8787', ws: p === '/ws' }])
			.concat([['/solver.js', { target: 'http://localhost:8787' }]])),
	},
});
