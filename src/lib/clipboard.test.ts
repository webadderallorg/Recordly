import { afterEach, describe, expect, it, vi } from "vitest";
import { copyToClipboard } from "./clipboard";

describe("copyToClipboard", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.clearAllMocks();
	});

	it("returns false for empty text", async () => {
		const result = await copyToClipboard("");
		expect(result).toBe(false);
	});

	it("uses electronAPI.writeClipboardText when available and successful", async () => {
		const writeClipboardText = vi.fn().mockResolvedValue({ success: true });
		vi.stubGlobal("window", { electronAPI: { writeClipboardText } });

		const result = await copyToClipboard("test error");
		expect(result).toBe(true);
		expect(writeClipboardText).toHaveBeenCalledWith("test error");
	});

	it("falls back to navigator.clipboard when electronAPI fails", async () => {
		const writeClipboardText = vi.fn().mockRejectedValue(new Error("IPC failed"));
		const writeText = vi.fn().mockResolvedValue(undefined);
		vi.stubGlobal("window", { electronAPI: { writeClipboardText } });
		vi.stubGlobal("navigator", { clipboard: { writeText } });

		const result = await copyToClipboard("test error");
		expect(result).toBe(true);
		expect(writeText).toHaveBeenCalledWith("test error");
	});

	it("falls back to document.execCommand when navigator.clipboard fails", async () => {
		const writeText = vi
			.fn()
			.mockRejectedValue(new Error("NotAllowedError: Document is not focused"));
		const execCommand = vi.fn().mockReturnValue(true);
		vi.stubGlobal("window", {});
		vi.stubGlobal("navigator", { clipboard: { writeText } });
		vi.stubGlobal("document", {
			createElement: () => ({
				value: "",
				style: {},
				setAttribute: vi.fn(),
				focus: vi.fn(),
				select: vi.fn(),
			}),
			body: {
				appendChild: vi.fn(),
				removeChild: vi.fn(),
			},
			execCommand,
		});

		const result = await copyToClipboard("test error");
		expect(result).toBe(true);
		expect(execCommand).toHaveBeenCalledWith("copy");
	});
});
