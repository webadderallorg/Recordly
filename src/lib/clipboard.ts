/** Desktop writes use Electron so clipboard access does not depend on renderer focus. */
export async function copyTextToClipboard(text: string): Promise<void> {
	if (typeof window !== "undefined" && window.electronAPI?.writeClipboardText) {
		try {
			const result = await window.electronAPI.writeClipboardText(text);
			if (result.success) return;
		} catch {
			// Older or unavailable desktop bridges can still use the browser fallback.
		}
	}
	try {
		if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(text);
			return;
		}
	} catch {
		// Some embedded browsers deny the asynchronous Clipboard API.
	}
	if (typeof document !== "undefined" && typeof document.execCommand === "function") {
		const active = document.activeElement;
		const selection = document.getSelection();
		const ranges = selection
			? Array.from({ length: selection.rangeCount }, (_, index) =>
					selection.getRangeAt(index),
				)
			: [];
		const input = document.createElement("textarea");
		input.value = text;
		input.setAttribute("readonly", "");
		input.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
		document.body.append(input);
		try {
			input.select();
			if (document.execCommand("copy")) return;
		} finally {
			input.remove();
			if (active instanceof HTMLElement) active.focus({ preventScroll: true });
			if (selection) {
				selection.removeAllRanges();
				for (const range of ranges) selection.addRange(range);
			}
		}
	}
	throw new Error("Clipboard write failed");
}
