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
