import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const plist = readFileSync(resolve(process.cwd(), 'ios/App/App/Info.plist'), 'utf8');

/** Returns the <string> values of the <array> following the given top-level key. */
function orientations(key: string): string[] {
	const re = new RegExp(`<key>${key}</key>\\s*<array>([\\s\\S]*?)</array>`);
	const m = re.exec(plist);
	if (!m) throw new Error(`Info.plist is missing ${key}`);
	return [...m[1].matchAll(/<string>([^<]*)<\/string>/g)].map((x) => x[1]);
}

describe('iOS Info.plist orientations', () => {
	it('is well-formed XML plist', () => {
		expect(plist).toMatch(/<plist[^>]*>[\s\S]*<\/plist>\s*$/);
		expect(plist.match(/<dict>/g)?.length).toBe(plist.match(/<\/dict>/g)?.length);
		expect(plist.match(/<array>/g)?.length).toBe(plist.match(/<\/array>/g)?.length);
	});

	it('locks the iPhone app to portrait only', () => {
		expect(orientations('UISupportedInterfaceOrientations')).toEqual([
			'UIInterfaceOrientationPortrait'
		]);
	});

	it('leaves iPad with all four orientations (Split View / Slide Over)', () => {
		expect(orientations('UISupportedInterfaceOrientations~ipad').sort()).toEqual(
			[
				'UIInterfaceOrientationLandscapeLeft',
				'UIInterfaceOrientationLandscapeRight',
				'UIInterfaceOrientationPortrait',
				'UIInterfaceOrientationPortraitUpsideDown'
			].sort()
		);
	});
});
