import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Output is served by the worker as static assets (see wrangler.jsonc "assets"): / is the landing page, /cpanel the admin panel,
// /privacy and /terms the legal pages (the worker serves x.html for /x).
export default defineConfig({
	plugins: [react()],
	build: {
		outDir: 'dist',
		emptyOutDir: true,
		rollupOptions: {
			input: {
				main: resolve(__dirname, 'index.html'),
				cpanel: resolve(__dirname, 'cpanel.html'),
				privacy: resolve(__dirname, 'privacy.html'),
				terms: resolve(__dirname, 'terms.html'),
			},
		},
	},
	// `bun run dev` here + `bun run dev` in worker/: the cpanel calls the worker API through these.
	server: {
		proxy: { '/admin': 'http://localhost:9999' },
	},
});
