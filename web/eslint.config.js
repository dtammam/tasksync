import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import svelteParser from 'svelte-eslint-parser';
import tsParser from '@typescript-eslint/parser';

const ignores = [
	'build',
	'coverage',
	'coverage/**',
	'.svelte-kit',
	'dist',
	'node_modules',
	'playwright-report',
	'src/service-worker.ts',
	'static/runtime-config.js',
	'eslint.config.js',
	'playwright.config.ts',
	'svelte.config.js',
	'vite.config.ts'
];

export default [
	{
		ignores
	},
	js.configs.recommended,
	...ts.configs.recommended,
	...ts.configs.stylistic,
	...svelte.configs['flat/recommended'],
	{
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.es2021
			},
			parserOptions: {
				project: ['./tsconfig.json'],
				extraFileExtensions: ['.svelte']
			}
		},
		rules: {
			'no-console': ['warn', { allow: ['warn', 'error'] }],
			'svelte/no-at-html-tags': 'error'
		}
	},
	{
		files: ['**/*.svelte'],
		languageOptions: {
			parser: svelteParser,
			parserOptions: {
				parser: tsParser,
				project: ['./tsconfig.json'],
				extraFileExtensions: ['.svelte']
			}
		}
	},
	// Layer boundary rules — see docs/FRONTEND.md "No spaghetti" import rules.
	// UI layers (components/, routes/) must not reach into data/ directly.
	// data/ must not import from UI layers.
	{
		files: ['src/lib/components/**', 'src/routes/**'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							group: ['$lib/data/*', '$lib/data'],
							message:
								'UI layers must not import from data/ directly. Go through stores/ or service/ instead. See docs/FRONTEND.md.'
						}
					]
				}
			]
		}
	},
	{
		files: ['src/lib/data/**'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							group: ['$lib/components/*', '$lib/components'],
							message: 'data/ must not import from components/. See docs/FRONTEND.md.'
						},
						{
							group: ['**/routes/**'],
							message: 'data/ must not import from routes/. See docs/FRONTEND.md.'
						}
					]
				}
			]
		}
	}
];
