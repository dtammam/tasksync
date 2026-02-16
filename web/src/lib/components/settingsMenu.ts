export type SettingsSectionId = 'account' | 'sound' | 'lists' | 'members' | 'backups';

export interface SettingsSection {
	id: SettingsSectionId;
	label: string;
	description: string;
	adminOnly: boolean;
}

const baseSections: SettingsSection[] = [
	{
		id: 'account',
		label: 'Account',
		description: 'Theme, sign-in, and profile controls',
		adminOnly: false,
	},
	{
		id: 'sound',
		label: 'Sound',
		description: 'Completion sound, uploads, and volume',
		adminOnly: false,
	},
	{
		id: 'lists',
		label: 'Lists',
		description: 'Create, rename, reorder, and delete lists',
		adminOnly: true,
	},
	{
		id: 'members',
		label: 'Members',
		description: 'Manage teammates and list grants',
		adminOnly: true,
	},
	{
		id: 'backups',
		label: 'Backups',
		description: 'Export or restore your space backup',
		adminOnly: true,
	},
];

export const getSettingsSections = (adminMode: boolean): SettingsSection[] =>
	baseSections.filter((section) => !section.adminOnly || adminMode);

export const pickSettingsSection = (
	requested: SettingsSectionId | null | undefined,
	adminMode: boolean,
	fallback: SettingsSectionId = 'account'
): SettingsSectionId => {
	const sections = getSettingsSections(adminMode);
	const first = sections[0]?.id ?? fallback;
	if (!requested) return first;
	return sections.some((section) => section.id === requested) ? requested : first;
};
