// adapter-static is required for Capacitor iOS — the native app serves
// pre-rendered static files from the WKWebView bundle.
import adapter from '@sveltejs/adapter-static';
import path from 'node:path';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter({ fallback: 'index.html' }),
		prerender: {
			handleUnseenRoutes: 'ignore'
		},
		alias: {
			$shared: path.resolve('../shared')
		}
	}
};

export default config;
