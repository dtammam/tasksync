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
 *
 * Handles values containing escaped single quotes (\'). The returned
 * values have escape sequences unescaped so callers receive clean strings.
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
	// Match key-value pairs where values may contain escaped single quotes (\').
	// Pattern: 'key': 'value-possibly-containing-\'-escapes'
	const pairPattern = /'((?:[^'\\]|\\.)*)'\s*:\s*'((?:[^'\\]|\\.)*)'/g;
	const result: Record<string, string> = {};
	let pairMatch: RegExpExecArray | null;
	while ((pairMatch = pairPattern.exec(inner)) !== null) {
		const key = pairMatch[1];
		// Unescape \' -> ' so callers receive clean string content.
		const value = pairMatch[2].replace(/\\'/g, "'");
		result[key] = value;
	}
	return result;
}

/**
 * Build the expected inlined CSS for a given font slug by reading the
 * on-disk font.css file and applying the same transforms the generation
 * script uses:
 *   1. Strip CSS block comments.
 *   2. Rewrite relative url('./file') to absolute url('/fonts/<slug>/file').
 *   3. Collapse whitespace to a single space.
 */
function buildExpectedFontFaceCSS(slug: string, staticDir: string): string {
	const cssPath = resolve(staticDir, 'fonts', slug, 'font.css');
	let css = readFileSync(cssPath, 'utf-8');

	// Strip CSS block comments.
	css = css.replace(/\/\*[\s\S]*?\*\//g, '');

	// Rewrite relative URL references to absolute.
	css = css.replace(/url\(['"]?\.\/([\w.-]+)['"]?\)/g, `url('/fonts/${slug}/$1')`);

	// Collapse whitespace: trim each line, then collapse all remaining
	// whitespace sequences into a single space, and trim the whole result.
	css = css
		.split('\n')
		.map((line) => line.trim())
		.join(' ')
		.replace(/\s+/g, ' ')
		.trim();

	return css;
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

	it('fontFaceCSS map covers all web-font slugs', () => {
		const fontFaceCSS = extractInlineObjectMap(html, 'fontFaceCSS');
		const systemFonts = ['georgia', 'sf-pro', 'system'];
		const expectedWebFonts = validFonts.filter((f) => !systemFonts.includes(f));
		expect(Object.keys(fontFaceCSS).sort()).toEqual(expectedWebFonts.sort());
	});

	it('system-font slugs are absent from fontFaceCSS map', () => {
		const fontFaceCSS = extractInlineObjectMap(html, 'fontFaceCSS');
		expect(fontFaceCSS['georgia']).toBeUndefined();
		expect(fontFaceCSS['sf-pro']).toBeUndefined();
		expect(fontFaceCSS['system']).toBeUndefined();
	});

	it('every fontFaceCSS value contains @font-face blocks with font-display: block and absolute woff2 URLs', () => {
		const fontFaceCSS = extractInlineObjectMap(html, 'fontFaceCSS');
		for (const [slug, css] of Object.entries(fontFaceCSS)) {
			// Must contain at least one @font-face block.
			expect(css, `fontFaceCSS["${slug}"] must contain at least one @font-face block`).toContain(
				'@font-face'
			);

			// Must use font-display: block (not swap).
			expect(css, `fontFaceCSS["${slug}"] must use font-display: block`).toContain(
				'font-display: block'
			);

			// Must not contain font-display: swap.
			expect(css, `fontFaceCSS["${slug}"] must not contain font-display: swap`).not.toContain(
				'font-display: swap'
			);

			// Must contain absolute woff2 URLs referencing /fonts/<slug>/.
			expect(
				css,
				`fontFaceCSS["${slug}"] must contain absolute URL /fonts/${slug}/`
			).toContain(`/fonts/${slug}/`);

			// Must not contain relative ./ URLs.
			expect(css, `fontFaceCSS["${slug}"] must not contain relative ./ URLs`).not.toContain(
				"url('./"
			);
		}
	});

	it('every on-disk font.css file contains font-display: block', () => {
		// web/static is 4 levels up from this test file:
		// web/src/lib/stores/fouc-whitelist.test.ts -> ../../../../static
		const staticDir = resolve(new URL(import.meta.url).pathname, '../../../../static');
		const systemFonts = ['georgia', 'sf-pro', 'system'];
		const webFontSlugs = validFonts.filter((f) => !systemFonts.includes(f));

		for (const slug of webFontSlugs) {
			const fullPath = resolve(staticDir, 'fonts', slug, 'font.css');
			const content = readFileSync(fullPath, 'utf-8');

			// Assert at least one @font-face block exists.
			expect(
				content,
				`font.css for "${slug}" must contain at least one @font-face block`
			).toMatch(/@font-face/);

			// Assert every @font-face block contains font-display: block.
			const fontFaceBlocks = content.match(/@font-face\s*\{[^}]*\}/g) ?? [];
			expect(
				fontFaceBlocks.length,
				`font.css for "${slug}" must have at least one @font-face block`
			).toBeGreaterThan(0);
			for (const block of fontFaceBlocks) {
				expect(
					block,
					`every @font-face in font.css for "${slug}" must contain font-display: block`
				).toContain('font-display: block');
			}
		}
	});

	it('fontFaceCSS map in app.html matches source font.css files (no drift)', () => {
		// web/static is 4 levels up from this test file.
		const staticDir = resolve(new URL(import.meta.url).pathname, '../../../../static');
		const fontFaceCSS = extractInlineObjectMap(html, 'fontFaceCSS');

		for (const [slug, inlinedCSS] of Object.entries(fontFaceCSS)) {
			const expected = buildExpectedFontFaceCSS(slug, staticDir);
			expect(
				inlinedCSS,
				`fontFaceCSS["${slug}"] in app.html must match the processed content of fonts/${slug}/font.css`
			).toBe(expected);
		}
	});
});
