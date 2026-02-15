export type SoundTheme =
	| 'chime_soft'
	| 'click_pop'
	| 'sparkle_short'
	| 'wood_tick'
	| 'bell_crisp'
	| 'marimba_blip'
	| 'pulse_soft'
	| 'custom_file';

export interface SoundSettings {
	enabled: boolean;
	volume: number; // 0..100
	theme: SoundTheme;
	customSoundFileId?: string;
	customSoundDataUrl?: string;
	customSoundFileName?: string;
	customSoundFilesJson?: string;
	profileAttachmentsJson?: string;
}

export type UiTheme =
	| 'default'
	| 'dark'
	| 'light'
	| 'demo-theme'
	| 'shades-of-coffee'
	| 'miami-beach'
	| 'simple-dark'
	| 'matrix'
	| 'black-gold'
	| 'okabe-ito'
	| 'theme-from-1970'
	| 'shades-of-gray-light'
	| 'catppuccin-latte'
	| 'catppuccin-frappe'
	| 'catppuccin-macchiato'
	| 'catppuccin-mocha'
	| 'you-need-a-dark-mode'
	| 'butterfly';
export type ListSortMode = 'created' | 'alpha' | 'due_date';
export type ListSortDirection = 'asc' | 'desc';

export interface ListSortPreference {
	mode: ListSortMode;
	direction: ListSortDirection;
}

export interface SidebarPanelState {
	lists: boolean;
	members: boolean;
	sound: boolean;
	backups: boolean;
	account: boolean;
}

export interface UiPreferences {
	theme: UiTheme;
	sidebarPanels: SidebarPanelState;
	listSort: ListSortPreference;
}

export interface UiPreferencesWire {
	theme: UiTheme;
	sidebarPanelsJson?: string;
	listSortJson?: string;
}
