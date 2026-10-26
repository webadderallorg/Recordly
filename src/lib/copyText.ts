/** Copies plain text through Electron when available, with a browser fallback. */
export function copyText(text: string): Promise<void> {
	if (
		typeof window !== "undefined" &&
		typeof window.electronAPI?.writeClipboardText === "function"
	) {
		return window.electronAPI.writeClipboardText(text);
	}

	return navigator.clipboard.writeText(text);
}
