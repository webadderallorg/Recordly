import { afterEach, expect, it, vi } from "vitest";
import { copyTextToClipboard } from "./clipboard";

afterEach(() => vi.unstubAllGlobals());
it("uses the desktop bridge even when the renderer clipboard is denied", async () => {
	const native = vi.fn(async () => ({ success: true }));
	const browser = vi.fn().mockRejectedValue(new Error("Not focused"));
	vi.stubGlobal("window", { electronAPI: { writeClipboardText: native } });
	vi.stubGlobal("navigator", { clipboard: { writeText: browser } });
	await copyTextToClipboard("https://recordly.test/v/123");
	expect(native).toHaveBeenCalledWith("https://recordly.test/v/123");
	expect(browser).not.toHaveBeenCalled();
});
it.each([
	"absent",
	"failed",
	"rejected",
])("uses browser copying when the desktop bridge is %s", async (mode) => {
	const native =
		mode === "absent"
			? undefined
			: mode === "failed"
				? vi.fn(async () => ({ success: false }))
				: vi.fn().mockRejectedValue(new Error("Bridge unavailable"));
	const browser = vi.fn(async () => undefined);
	vi.stubGlobal("window", { electronAPI: { writeClipboardText: native } });
	vi.stubGlobal("navigator", { clipboard: { writeText: browser } });
	await copyTextToClipboard("text");
	expect(browser).toHaveBeenCalledWith("text");
});
it("rejects rather than reporting a copy when no clipboard path succeeds", async () => {
	vi.stubGlobal("window", {});
	vi.stubGlobal("navigator", {
		clipboard: { writeText: vi.fn().mockRejectedValue(new Error("Denied")) },
	});
	await expect(copyTextToClipboard("text")).rejects.toThrow("Clipboard write failed");
});
