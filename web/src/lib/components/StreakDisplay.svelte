<script lang="ts">
	import { fly } from 'svelte/transition';
	import { streakDigitsPaths, streakDisplay, streakWordUrl } from '$lib/stores/streak';
	import { uiPreferences } from '$lib/stores/preferences';

	$: settings = $uiPreferences.streakSettings;
	$: theme = settings.theme;
	$: display = $streakDisplay;
	$: digitsPath = $streakDigitsPaths[theme] ?? 'digits';

	// Split count into individual digit characters for rendering.
	// Only used when count > 0 (normal combo state).
	$: digits = String(Math.min(display.count, 9999)).split('');
</script>

{#if display.visible && settings.enabled}
	<div
		class="streak-root"
		class:day-complete={display.isDayComplete}
		class:combo-dropped={display.isComboDropped}
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
				<div class="judgment-layer">
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
							src={`/streak/${theme}/${digitsPath}/${digit}.png`}
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
		top: 64px;
		/* Span the full content pane using sidebar-offset from +layout.svelte.
		   Flexbox centers children — no translate/-50% hack, so centering works
		   even before streak images finish loading (no width dependency). */
		left: var(--sidebar-offset, 0px);
		right: 0;
		z-index: 200;
		pointer-events: none;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
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

	/* Combo dropped: red glow + larger missed image (same size as day-complete) */
	.streak-root.combo-dropped {
		animation: combo-dropped-glow 0.7s ease-out forwards;
	}

	.streak-root.combo-dropped .judgment-img {
		height: clamp(80px, 14vw, 180px);
	}

	@keyframes combo-dropped-glow {
		0%   { filter: drop-shadow(0 0 0px rgba(220, 38, 38, 0)); }
		40%  { filter: drop-shadow(0 0 22px rgba(220, 38, 38, 0.8)) drop-shadow(0 0 8px rgba(255, 100, 100, 0.6)); }
		100% { filter: drop-shadow(0 0 14px rgba(220, 38, 38, 0.45)) drop-shadow(0 0 4px rgba(220, 38, 38, 0.25)); }
	}

	/* Day-complete: warm golden glow + larger judgment image */
	.streak-root.day-complete {
		animation: day-complete-glow 0.7s ease-out forwards;
	}

	.streak-root.day-complete .judgment-img {
		height: clamp(80px, 14vw, 180px);
	}

	@keyframes day-complete-glow {
		0%   { filter: drop-shadow(0 0 0px rgba(251, 191, 36, 0)); }
		40%  { filter: drop-shadow(0 0 22px rgba(251, 191, 36, 0.8)) drop-shadow(0 0 8px rgba(255, 255, 200, 0.6)); }
		100% { filter: drop-shadow(0 0 14px rgba(251, 191, 36, 0.45)) drop-shadow(0 0 4px rgba(251, 191, 36, 0.25)); }
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
		.streak-root.combo-dropped .judgment-img,
		.streak-root.day-complete .judgment-img {
			height: clamp(80px, 14vw, 180px);
		}
	}
</style>
