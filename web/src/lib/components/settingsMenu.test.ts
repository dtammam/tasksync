import { describe, expect, it } from 'vitest';
import { getSettingsSections, pickSettingsSection } from './settingsMenu';

describe('settings menu helpers', () => {
	it('returns account and sound for non-admin users', () => {
		expect(getSettingsSections(false).map((section) => section.id)).toEqual(['account', 'sound']);
	});

	it('returns all sections for admins', () => {
		expect(getSettingsSections(true).map((section) => section.id)).toEqual([
			'account',
			'sound',
			'lists',
			'members',
			'backups',
		]);
	});

	it('falls back to first visible section when requested section is hidden', () => {
		expect(pickSettingsSection('backups', false)).toBe('account');
	});

	it('keeps requested section when visible', () => {
		expect(pickSettingsSection('members', true)).toBe('members');
	});
});
