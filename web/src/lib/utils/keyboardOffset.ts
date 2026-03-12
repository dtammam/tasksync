/**
 * installKeyboardOffsetTracker — sets `--mobile-keyboard-offset` on `el`
 * from `visualViewport` + focus events. Returns a cleanup function.
 *
 * Called once from `+layout.svelte` on mount; layout is the single owner
 * of `--mobile-keyboard-offset` per docs/FRONTEND.md.
 */
export function installKeyboardOffsetTracker(el: HTMLElement): () => void {
	if (typeof window === 'undefined' || typeof document === 'undefined') return () => undefined;
	const viewport = window.visualViewport;
	if (!viewport) {
		el.style.setProperty('--mobile-keyboard-offset', '0px');
		return () => {
			el.style.removeProperty('--mobile-keyboard-offset');
		};
	}

	const isEditableInput = (target: EventTarget | null): boolean => {
		if (!(target instanceof HTMLElement)) return false;
		if (target.isContentEditable) return true;
		if (target instanceof HTMLTextAreaElement) {
			return !target.readOnly && !target.disabled;
		}
		if (target instanceof HTMLInputElement) {
			const nonTextInputTypes = new Set([
				'button',
				'checkbox',
				'color',
				'file',
				'hidden',
				'image',
				'radio',
				'range',
				'reset',
				'submit'
			]);
			return !target.readOnly && !target.disabled && !nonTextInputTypes.has((target.type || 'text').toLowerCase());
		}
		return false;
	};

	let focusTimers: ReturnType<typeof setTimeout>[] = [];
	const clearFocusTimers = () => {
		for (const timer of focusTimers) {
			clearTimeout(timer);
		}
		focusTimers = [];
	};

	const updateOffset = () => {
		const isMobileViewport = window.matchMedia('(max-width: 900px)').matches;
		const editableFocused = isEditableInput(document.activeElement);
		if (!isMobileViewport || !editableFocused) {
			el.style.setProperty('--mobile-keyboard-offset', '0px');
			return;
		}

		const layoutHeight = Math.max(window.innerHeight, document.documentElement.clientHeight);
		const keyboardHeight = Math.max(0, Math.round(layoutHeight - viewport.height - viewport.offsetTop));
		el.style.setProperty('--mobile-keyboard-offset', `${keyboardHeight}px`);
	};

	const scheduleFocusRefresh = () => {
		clearFocusTimers();
		updateOffset();
		for (const delay of [40, 120, 220]) {
			focusTimers.push(setTimeout(updateOffset, delay));
		}
	};

	const handleFocusIn = (event: FocusEvent) => {
		if (!isEditableInput(event.target)) return;
		scheduleFocusRefresh();
	};

	const handleFocusOut = () => {
		clearFocusTimers();
		setTimeout(updateOffset, 60);
	};

	window.addEventListener('resize', updateOffset);
	viewport.addEventListener('resize', updateOffset);
	viewport.addEventListener('scroll', updateOffset);
	document.addEventListener('focusin', handleFocusIn);
	document.addEventListener('focusout', handleFocusOut);
	updateOffset();

	return () => {
		clearFocusTimers();
		window.removeEventListener('resize', updateOffset);
		viewport.removeEventListener('resize', updateOffset);
		viewport.removeEventListener('scroll', updateOffset);
		document.removeEventListener('focusin', handleFocusIn);
		document.removeEventListener('focusout', handleFocusOut);
		el.style.removeProperty('--mobile-keyboard-offset');
	};
}
