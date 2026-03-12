<script lang="ts">
	import { soundSettings, soundThemes } from '$lib/stores/settings';
	import { playCompletion } from '$lib/sound/sound';
	import type { SoundSettings } from '$shared/types/settings';

	let soundBusy = false;
	let soundError = '';
	let soundMessage = '';

	const readAsDataUrl = (file: File): Promise<string> =>
		new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(String(reader.result ?? ''));
			reader.onerror = () => reject(new Error('Could not read sound file.'));
			reader.readAsDataURL(file);
		});

	const uploadCustomSound = async (event: Event & { currentTarget: HTMLInputElement }) => {
		const input = event.currentTarget;
		const files = Array.from(input?.files ?? []);
		if (!files.length) return;
		if (files.length > 8) {
			soundError = 'Please upload up to 8 sounds at a time.';
			soundMessage = '';
			input.value = '';
			return;
		}
		for (const file of files) {
			if (!/\.(mp3|wav)$/i.test(file.name)) {
				soundError = 'Please upload MP3 or WAV files only.';
				soundMessage = '';
				input.value = '';
				return;
			}
			if (file.size > 2 * 1024 * 1024) {
				soundError = 'Sound file is too large (max 2MB each).';
				soundMessage = '';
				input.value = '';
				return;
			}
		}
		soundBusy = true;
		soundError = '';
		soundMessage = '';
		try {
			const payload = await Promise.all(
				files.map(async (file) => ({
					dataUrl: await readAsDataUrl(file),
					fileName: file.name,
				}))
			);
			soundSettings.setCustomSounds(payload);
			soundMessage =
				payload.length === 1
					? `Custom sound loaded: ${payload[0].fileName}`
					: `${payload.length} custom sounds loaded. Playback will randomize.`;
		} catch (err) {
			soundError = err instanceof Error ? err.message : String(err);
		} finally {
			soundBusy = false;
			input.value = '';
		}
	};

	const clearCustomSound = () => {
		soundSettings.clearCustomSound();
		soundError = '';
		soundMessage = 'Custom sound removed.';
	};

	const customSoundNames = (settings: SoundSettings): string[] => {
		const raw = settings?.customSoundFilesJson;
		if (typeof raw === 'string' && raw.trim()) {
			try {
				const parsed = JSON.parse(raw);
				if (Array.isArray(parsed)) {
					return parsed
						.map((entry) =>
							entry && typeof entry === 'object' ? String(entry.name ?? '').trim() : ''
						)
						.filter((name) => !!name)
						.slice(0, 8);
				}
			} catch {
				// Fall back to legacy single-file naming below.
			}
		}
		return settings?.customSoundFileName ? [settings.customSoundFileName] : [];
	};

	const previewSound = async () => {
		await playCompletion(soundSettings.get());
	};

	$: loadedCustomSoundNames = customSoundNames($soundSettings);
	$: hasCustomSounds =
		loadedCustomSoundNames.length > 0 ||
		!!$soundSettings.customSoundDataUrl ||
		!!$soundSettings.customSoundFilesJson;
</script>

<div class="card sound">
	<label class="toggle" for="sound-enabled">
		<input
			id="sound-enabled"
			data-testid="sound-enabled"
			type="checkbox"
			checked={$soundSettings.enabled}
			on:change={(e) => soundSettings.setEnabled((e.currentTarget as HTMLInputElement).checked)}
		/>
		Completion sound
	</label>
	<label>
		Theme
		<select
			data-testid="sound-theme"
			value={$soundSettings.theme}
			on:change={(e) => soundSettings.setTheme((e.currentTarget as HTMLSelectElement).value as import('$shared/types/settings').SoundTheme)}
		>
			{#each soundThemes as theme}
				<option value={theme}>{theme.replace('_', ' ')}</option>
			{/each}
		</select>
	</label>
	<label>
		Volume
		<div class="volume">
			<input
				data-testid="sound-volume"
				type="range"
				min="0"
				max="100"
				step="1"
				value={$soundSettings.volume}
				style={`--range-pct:${$soundSettings.volume}%`}
				on:input={(e) => soundSettings.setVolume(Number((e.currentTarget as HTMLInputElement).value))}
			/>
			<span>{$soundSettings.volume}%</span>
		</div>
	</label>
	<label>
		Custom sounds (mp3/wav)
		<input
			type="file"
			accept=".mp3,.wav,audio/mpeg,audio/wav"
			multiple
			on:change={uploadCustomSound}
			disabled={soundBusy}
		/>
	</label>
	<div class="sound-actions">
		<button type="button" class="ghost tiny" on:click={previewSound}>
			Test sound
		</button>
		<button
			type="button"
			class="ghost tiny"
			on:click={clearCustomSound}
			disabled={!hasCustomSounds}
		>
			Clear custom
		</button>
	</div>
	{#if loadedCustomSoundNames.length}
		<div class="loaded-sounds">
			<p class="muted-note">Loaded:</p>
			<ul class="sound-file-list">
				{#each loadedCustomSoundNames as name}
					<li>{name}</li>
				{/each}
			</ul>
		</div>
	{/if}
	{#if soundMessage}
		<p class="ok">{soundMessage}</p>
	{/if}
	{#if soundError}
		<p class="error">{soundError}</p>
	{/if}
</div>

<style>
	.card {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 13px;
		color: var(--app-muted);
	}

	label select,
	label input[type='range'] {
		background: linear-gradient(
			180deg,
			var(--surface-1),
			color-mix(in oklab, var(--surface-1) 88%, black 12%)
		);
		border: 1px solid var(--border-1);
		color: var(--app-text);
		border-radius: 10px;
		padding: 8px 10px;
		font-size: 14px;
		box-shadow: var(--ring-shadow);
	}

	.toggle {
		flex-direction: row;
		align-items: center;
		gap: 10px;
		color: var(--app-text);
		font-size: 14px;
	}

	.volume {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.volume input[type='range'] {
		flex: 1;
		accent-color: var(--surface-accent);
	}

	.sound-actions {
		display: flex;
		gap: 8px;
	}

	.ghost.tiny {
		background: color-mix(in oklab, var(--surface-1) 92%, white 8%);
		border: 1px solid var(--border-1);
		color: var(--app-text);
		border-radius: 8px;
		padding: 6px 12px;
		font-size: 12px;
		cursor: pointer;
		box-shadow: var(--ring-shadow);
	}

	.ghost.tiny:hover {
		filter: brightness(1.1);
	}

	.ghost.tiny:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.loaded-sounds {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.sound-file-list {
		margin: 0;
		padding: 0 0 0 16px;
		font-size: 12px;
		color: var(--app-text);
	}

	.muted-note {
		margin: 0;
		font-size: 12px;
		color: var(--app-muted);
	}

	.ok {
		margin: 0;
		color: #86efac;
		font-size: 12px;
	}

	.error {
		margin: 0;
		color: #fda4af;
		font-size: 12px;
	}
</style>
