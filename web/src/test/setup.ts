import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';

// JSDOM does not implement window.matchMedia. Provide a minimal stub so that
// components using matchMedia (e.g. prefers-reduced-motion checks) work in tests.
Object.defineProperty(window, 'matchMedia', {
	writable: true,
	value: (query: string): MediaQueryList =>
		({
			matches: false,
			media: query,
			onchange: null,
			addListener: () => undefined,
			removeListener: () => undefined,
			addEventListener: () => undefined,
			removeEventListener: () => undefined,
			dispatchEvent: () => false
		}) as MediaQueryList
});

// JSDOM does not implement the Web Animations API. Provide a minimal stub so
// that Svelte transitions (which call element.animate()) do not throw in tests.
if (!Element.prototype.animate) {
	Element.prototype.animate = () =>
		({
			cancel: () => undefined,
			finish: () => undefined,
			pause: () => undefined,
			play: () => undefined,
			reverse: () => undefined,
			onfinish: null,
			oncancel: null,
			finished: Promise.resolve({} as Animation),
			ready: Promise.resolve({} as Animation),
			currentTime: 0,
			playState: 'finished' as AnimationPlayState,
			effect: null,
			timeline: null,
			id: '',
			pending: false,
			playbackRate: 1,
			startTime: null,
			replaceState: 'active' as AnimationReplaceState,
			commitStyles: () => undefined,
			persist: () => undefined,
			addEventListener: () => undefined,
			removeEventListener: () => undefined,
			dispatchEvent: () => false
		}) as unknown as Animation;
}
