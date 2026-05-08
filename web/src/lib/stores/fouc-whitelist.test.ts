import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { validFonts, validThemes } from './preferences';

// Resolve path to app.html relative to this test file.
// This file lives at web/src/lib/stores/fouc-whitelist.test.ts.
// app.html lives at web/src/app.html — three directory levels up from here.
const appHtmlPath = resolve(
	new URL(import.meta.url).pathname,
	'../../../app.html'
);

/**
 * Extract an array literal from the inline FOUC script in app.html.
 * Finds the line matching `var <varName> = [...]` and returns the
 * string values parsed from the bracket-enclosed content.
 */
function extractInlineArray(html: string, varName: string): string[] {
	// Match the variable assignment line, e.g.:
	// var validThemes = ['default','dark',...];
	const pattern = new RegExp(`var\\s+${varName}\\s*=\\s*\\[([^\\]]+)\\]`);
	const match = html.match(pattern);
	if (!match) {
		throw new Error(
			`Could not find "var ${varName} = [...]" in app.html inline script. ` +
				'Did you rename the variable or move it out of the expected format?'
		);
	}
	const inner = match[1];
	// Extract all single-quoted string values.
	const valuePattern = /'([^']+)'/g;
	const values: string[] = [];
	let valueMatch: RegExpExecArray | null;
	while ((valueMatch = valuePattern.exec(inner)) !== null) {
		values.push(valueMatch[1]);
	}
	return values;
}

/**
 * Extract an object literal from the inline FOUC script in app.html.
 * Finds the block matching `var <varName> = { ... };` and returns the
 * key-value pairs parsed from the brace-enclosed content.
 */
function extractInlineObjectMap(html: string, varName: string): Record<string, string> {
	const pattern = new RegExp('var\\s+' + varName + '\\s*=\\s*\\{(.+?)\\};', 's');
	const match = html.match(pattern);
	if (!match) {
		throw new Error(
			`Could not find "var ${varName} = { ... };" in app.html inline script. ` +
				'Did you rename the variable or move it out of the expected format?'
		);
	}
	const inner = match[1];
	const pairPattern = /'([^']+)'\s*:\s*'([^']+)'/g;
	const result: Record<string, string> = {};
	let pairMatch: RegExpExecArray | null;
	while ((pairMatch = pairPattern.exec(inner)) !== null) {
		result[pairMatch[1]] = pairMatch[2];
	}
	return result;
}

describe('FOUC whitelist sync', () => {
	const html = readFileSync(appHtmlPath, 'utf-8');

	it('inline script theme whitelist matches validThemes from preferences.ts', () => {
		const inlineThemes = extractInlineArray(html, 'validThemes');
		expect(inlineThemes).toEqual(validThemes);
	});

	it('inline script font whitelist matches validFonts from preferences.ts', () => {
		const inlineFonts = extractInlineArray(html, 'validFonts');
		expect(inlineFonts).toEqual(validFonts);
	});

	it('font path map covers all web-font slugs', () => {
		const fontPaths = extractInlineObjectMap(html, 'fontPaths');
		const systemFonts = ['georgia', 'sf-pro', 'system'];
		const expectedWebFonts = validFonts.filter((f) => !systemFonts.includes(f));
		expect(Object.keys(fontPaths).sort()).toEqual(expectedWebFonts.sort());
	});

	it('system-font slugs are absent from fontPaths map', () => {
		const fontPaths = extractInlineObjectMap(html, 'fontPaths');
		expect(fontPaths['georgia']).toBeUndefined();
		expect(fontPaths['sf-pro']).toBeUndefined();
		expect(fontPaths['system']).toBeUndefined();
	});

	it('every font path follows /fonts/<slug>/font.css structure', () => {
		const fontPaths = extractInlineObjectMap(html, 'fontPaths');
		for (const [key, value] of Object.entries(fontPaths)) {
			expect(value, `font path for "${key}" must follow /fonts/<slug>/font.css`).toBe(
				`/fonts/${key}/font.css`
			);
		}
	});

	it('every font.css file exists and contains font-display: swap', () => {
		// web/static is 4 levels up from this test file:
		// web/src/lib/stores/fouc-whitelist.test.ts -> ../../../../static
		const staticDir = resolve(new URL(import.meta.url).pathname, '../../../../static');
		const fontPaths = extractInlineObjectMap(html, 'fontPaths');
		for (const [slug, fontPath] of Object.entries(fontPaths)) {
			// Strip the leading '/' to get a relative path suitable for joining
			const fullPath = resolve(staticDir, fontPath.replace(/^\//, ''));
			const content = readFileSync(fullPath, 'utf-8');

			// Assert at least one @font-face block exists
			expect(content, `font.css for "${slug}" must contain at least one @font-face block`).toMatch(
				/@font-face/
			);

			// Assert every @font-face block contains font-display: swap
			const fontFaceBlocks = content.match(/@font-face\s*\{[^}]*\}/g) ?? [];
			expect(
				fontFaceBlocks.length,
				`font.css for "${slug}" must have at least one @font-face block`
			).toBeGreaterThan(0);
			for (const block of fontFaceBlocks) {
				expect(
					block,
					`every @font-face in font.css for "${slug}" must contain font-display: swap`
				).toContain('font-display: swap');
			}
		}
	});
});
