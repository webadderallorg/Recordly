/**
 * Cross-platform clipboard helper.
 * Tries Electron native clipboard IPC first, then navigator.clipboard, and finally document.execCommand fallback.
 *
 * @param text - The text string to copy to the clipboard.
 * @returns Promise resolving to true if copying succeeded, false otherwise.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
	if (typeof window !== "undefined" && window.electronAPI?.writeClipboardText) {
		try {
			const result = await window.electronAPI.writeClipboardText(text);
			if (result?.success) {
				return true;
			}
		} catch {
			// Fall through to browser clipboard
		}
	}

	if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
		try {
			await navigator.clipboard.writeText(text);
			return true;
		} catch {
			// Fall through to execCommand
		}
	}

	if (typeof document !== "undefined") {
		const textarea = document.createElement("textarea");
		textarea.value = text;
		textarea.style.position = "fixed";
		textarea.style.left = "-9999px";
		textarea.style.top = "-9999px";
		textarea.setAttribute("readonly", "");
		document.body.appendChild(textarea);
		try {
			textarea.select();
			const successful = document.execCommand("copy");
			if (successful) return true;
		} catch {
			// Failed all copy attempts
		} finally {
			document.body.removeChild(textarea);
		}
	}

	return false;
}
