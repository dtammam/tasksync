<script lang="ts">
	// @ts-nocheck
	import { fly, fade } from 'svelte/transition';
	import { streakDisplay, streakWordUrl } from '$lib/stores/streak';
	import { uiPreferences } from '$lib/stores/preferences';

	$: settings = $uiPreferences.streakSettings;
	$: theme = settings.theme;
	$: display = $streakDisplay;

	// Split count into individual digit characters for rendering.
	// Only used when count > 0 (normal combo state).
	$: digits = String(Math.min(display.count, 9999)).split('');
</script>

{#if display.visible && settings.enabled}
	<div
		class="streak-root"
		class:breaking={display.breaking}
		aria-live="polite"
		aria-atomic="true"
		aria-label={display.count > 0 ? `Streak: ${display.count}` : 'Combo dropped'}
		in:fly={{ y: -12, duration: 180, opacity: 0 }}
		out:fly={{ y: -8, duration: 300, opacity: 0 }}
	>
		<!-- Judgment / missed image: shown whenever judgmentSrc is set.
		     During break (count=0): this is the missed image (if any).
		     During normal combo: this is the judgment image. -->
		{#if display.judgmentSrc}
			{#key display.judgmentSrc}
				<div class="judgment-layer" in:fade={{ duration: 150 }}>
					<img
						src={display.judgmentSrc}
						alt=""
						class="judgment-img"
						draggable="false"
					/>
				</div>
			{/key}
		{/if}

		<!-- Digits and combo word only shown during an active combo (count > 0).
		     Hidden during the break state so the missed image stands alone. -->
		{#if display.count > 0}
			{#key display.pulse}
				<div
					class="digits-layer"
					in:fly={{ y: -6, duration: 120, opacity: 0 }}
				>
					{#each digits as digit}
						<img
							src={`/streak/${theme}/digits/${digit}.png`}
							alt={digit}
							class="digit-img"
							draggable="false"
						/>
					{/each}
				</div>
			{/key}

			{#if $streakWordUrl}
				<div class="word-layer">
					<img
						src={$streakWordUrl}
						alt="streak"
						class="word-img"
						draggable="false"
					/>
				</div>
			{/if}
		{/if}
	</div>
{/if}

<style>
	.streak-root {
		position: fixed;
		/* Position at top of content area, centered in the content pane (sidebar-aware) */
		top: 64px;
		left: calc(var(--sidebar-offset, 0px) + (100vw - var(--sidebar-offset, 0px)) / 2);
		transform: translateX(-50%);
		z-index: 200;
		pointer-events: none;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		/* Prevent layout interference */
		width: max-content;
		max-width: calc(100vw - var(--sidebar-offset, 0px) - 32px);
	}

	.judgment-layer {
		display: flex;
		justify-content: center;
	}

	.judgment-img {
		height: clamp(24px, 4vw, 48px);
		width: auto;
		object-fit: contain;
	}

	.digits-layer {
		display: flex;
		flex-direction: row;
		align-items: flex-end;
		gap: 2px;
		justify-content: center;
	}

	.digit-img {
		height: clamp(48px, 8vw, 96px);
		width: auto;
		object-fit: contain;
		/* Slight drop shadow for legibility over any background */
		filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.45));
	}

	.word-layer {
		display: flex;
		justify-content: center;
	}

	.word-img {
		height: clamp(20px, 3vw, 36px);
		width: auto;
		object-fit: contain;
		filter: drop-shadow(0 1px 4px rgba(0, 0, 0, 0.4));
	}

	/* Break animation: brief red desaturate flash on the missed image */
	.streak-root.breaking .judgment-img {
		filter: drop-shadow(0 2px 6px rgba(255, 60, 60, 0.8)) saturate(0.2);
		transition: filter 150ms ease-out;
	}

	/* Mobile: tighten up spacing */
	@media (max-width: 600px) {
		.streak-root {
			top: 54px;
			gap: 1px;
		}
		.digit-img {
			height: clamp(36px, 10vw, 64px);
		}
		.word-img {
			height: clamp(16px, 4vw, 28px);
		}
		.judgment-img {
			height: clamp(18px, 5vw, 36px);
		}
	}
</style>
