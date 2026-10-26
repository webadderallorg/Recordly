import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./copyText";

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("copyText", () => {
	it("uses the Electron clipboard API when available", async () => {
		const writeClipboardText = vi.fn().mockResolvedValue(undefined);
		const writeText = vi.fn().mockResolvedValue(undefined);
		vi.stubGlobal("window", { electronAPI: { writeClipboardText } });
		vi.stubGlobal("navigator", { clipboard: { writeText } });

		await copyText("share link");

		expect(writeClipboardText).toHaveBeenCalledWith("share link");
		expect(writeText).not.toHaveBeenCalled();
	});

	it("falls back to the browser clipboard API", async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		vi.stubGlobal("window", {});
		vi.stubGlobal("navigator", { clipboard: { writeText } });

		await copyText("share link");

		expect(writeText).toHaveBeenCalledWith("share link");
	});

	it("propagates clipboard failures", async () => {
		const error = new Error("clipboard unavailable");
		const writeClipboardText = vi.fn().mockRejectedValue(error);
		vi.stubGlobal("window", { electronAPI: { writeClipboardText } });

		await expect(copyText("share link")).rejects.toBe(error);
	});
});
