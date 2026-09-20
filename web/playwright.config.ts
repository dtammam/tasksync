import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: './tests/e2e',
	fullyParallel: true,
	timeout: 45_000,
	workers: process.env.CI ? 2 : 3,
	expect: {
		timeout: 10_000
	},
	use: {
		baseURL: 'http://localhost:4173',
		trace: 'retain-on-failure',
		// Keep e2e deterministic and avoid browser-level service worker interference across tests.
		serviceWorkers: 'block'
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] }
		},
		{
			name: 'firefox',
			use: { ...devices['Desktop Firefox'] }
		},
		{
			name: 'webkit',
			use: { ...devices['Desktop Safari'] }
		}
	],
	webServer: {
		// Serve a PRODUCTION build (not the dev server) so the service worker has a
		// real precache manifest and offline reloads are deterministic — the dev
		// server precaches nothing, which made the offline tests flake (tech-debt
		// #050 signature a). This is the same bundle production ships.
		command: 'npm run build && npm run preview -- --host --port 4173',
		url: 'http://localhost:4173',
		reuseExistingServer: !process.env.CI,
		// Allow time for the build step before the preview server answers.
		timeout: 120_000,
		stdout: 'ignore',
		stderr: 'pipe'
	}
});
