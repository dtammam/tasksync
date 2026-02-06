import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';

const parseAllowedHosts = (raw: string | undefined): true | string[] | undefined => {
	if (!raw) return undefined;
	const normalized = raw.trim();
	if (!normalized) return undefined;
	if (normalized === '*' || normalized.toLowerCase() === 'all') return true;
	const hosts = normalized
		.split(',')
		.map((host) => host.trim())
		.filter(Boolean);
	return hosts.length ? hosts : undefined;
};

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, '.', '');
	const allowedHosts = parseAllowedHosts(env.VITE_ALLOWED_HOSTS);

	return {
		plugins: [sveltekit()],
		server: {
			...(allowedHosts ? { allowedHosts } : {}),
			fs: {
				allow: ['..']
			}
		},
		preview: {
			...(allowedHosts ? { allowedHosts } : {})
		},
		test: {
			include: ['src/**/*.{test,spec}.{js,ts}'],
			environment: 'jsdom',
			setupFiles: ['src/test/setup.ts'],
			coverage: {
				provider: 'v8'
			}
		}
	};
});
