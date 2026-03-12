/**
 * Clipboard utilities extracted from `+layout.svelte`.
 * No DOM coupling beyond what the function signature declares.
 */

/**
 * fallbackCopyText — DOM-based copy for browsers without Clipboard API.
 * Returns true if the copy command succeeded.
 */
export function fallbackCopyText(text: string): boolean {
	if (typeof document === 'undefined') return false;
	const el = document.createElement('textarea');
	el.value = text;
	el.setAttribute('readonly', 'true');
	el.style.position = 'fixed';
	el.style.opacity = '0';
	el.style.pointerEvents = 'none';
	document.body.appendChild(el);
	el.focus();
	el.select();
	let copied = false;
	try {
		copied = document.execCommand('copy');
	} catch {
		copied = false;
	}
	document.body.removeChild(el);
	return copied;
}

/**
 * copyToClipboard — writes `text` to the clipboard using the modern API
 * with a fallback to `fallbackCopyText`. Returns true on success.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
	try {
		if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(text);
			return true;
		}
		return fallbackCopyText(text);
	} catch {
		return false;
	}
}
