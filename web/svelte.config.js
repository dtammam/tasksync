import adapter from '@sveltejs/adapter-auto';
import path from 'node:path';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter(),
		alias: {
			$shared: path.resolve('../shared')
		}
	}
};

export default config;
