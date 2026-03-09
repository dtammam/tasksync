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

export type UiFont =
	| 'sora'
	| 'sono'
	| 'inter'
	| 'inter-tight'
	| 'jetbrains-mono'
	| 'atkinson-hyperlegible'
	| 'atkinson-hyperlegible-next'
	| 'ibm-plex-sans'
	| 'ibm-plex-mono'
	| 'ibm-plex-serif'
	| 'roboto'
	| 'roboto-slab'
	| 'roboto-mono'
	| 'dm-mono'
	| 'comfortaa'
	| 'poppins'
	| 'victor-mono'
	| 'pt-sans'
	| 'pt-serif'
	| 'pt-mono'
	| 'georgia'
	| 'sf-pro'
	| 'system';

export type UiTheme =
	| 'default'
	| 'dark'
	| 'light'
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
	font: UiFont;
	completionQuotes: string[];
	sidebarPanels: SidebarPanelState;
	listSort: ListSortPreference;
	streakSettings: StreakSettings;
}

export type StreakTheme = 'ddr' | 'thps';

export type StreakResetMode = 'daily' | 'endless';

export interface StreakSettings {
	enabled: boolean;
	theme: StreakTheme;
	resetMode: StreakResetMode;
}

export interface StreakState {
	count: number;
	countedTaskIds: string[];
	lastResetDate: string | null; // ISO date string (YYYY-MM-DD)
}

export interface UiPreferencesWire {
	theme: UiTheme;
	font?: string;
	completionQuotesJson?: string;
	sidebarPanelsJson?: string;
	listSortJson?: string;
	streakSettingsJson?: string;
	streakStateJson?: string;
}
