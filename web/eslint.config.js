import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';

const ignores = [
	'build',
	'coverage',
	'coverage/**',
	'.svelte-kit',
	'dist',
	'node_modules',
	'playwright-report',
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
	}
];
