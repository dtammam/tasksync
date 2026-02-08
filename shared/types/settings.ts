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
	profileAttachmentsJson?: string;
}

export type UiTheme = 'default' | 'dark' | 'light';

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
}

export interface UiPreferencesWire {
	theme: UiTheme;
	sidebarPanelsJson?: string;
}
