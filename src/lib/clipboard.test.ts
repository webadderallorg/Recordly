import { afterEach, describe, expect, it, vi } from "vitest";
import { copyTextToClipboard } from "./clipboard";

describe("copyTextToClipboard", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("prefers electronAPI.writeClipboardText when available", async () => {
		const writeClipboardText = vi.fn().mockResolvedValue({ success: true });
		vi.stubGlobal("window", {
			electronAPI: { writeClipboardText },
		});

		const result = await copyTextToClipboard("error message");
		expect(result).toBe(true);
		expect(writeClipboardText).toHaveBeenCalledWith("error message");
	});

	it("falls back to navigator.clipboard.writeText if electronAPI fails", async () => {
		const writeClipboardText = vi.fn().mockRejectedValue(new Error("IPC failed"));
		const navWriteText = vi.fn().mockResolvedValue(undefined);
		vi.stubGlobal("window", {
			electronAPI: { writeClipboardText },
		});
		vi.stubGlobal("navigator", {
			clipboard: { writeText: navWriteText },
		});

		const result = await copyTextToClipboard("fallback text");
		expect(result).toBe(true);
		expect(navWriteText).toHaveBeenCalledWith("fallback text");
	});

	it("falls back to execCommand if navigator.clipboard fails", async () => {
		const execCommand = vi.fn().mockReturnValue(true);
		vi.stubGlobal("navigator", {
			clipboard: { writeText: vi.fn().mockRejectedValue(new Error("Denied")) },
		});
		vi.stubGlobal("document", {
			createElement: vi.fn(() => ({
				value: "",
				style: {},
				setAttribute: vi.fn(),
				select: vi.fn(),
			})),
			body: {
				appendChild: vi.fn(),
				removeChild: vi.fn(),
			},
			execCommand,
		});

		const result = await copyTextToClipboard("execCommand text");
		expect(result).toBe(true);
		expect(execCommand).toHaveBeenCalledWith("copy");
	});

	it("returns false if all copy mechanisms fail", async () => {
		vi.stubGlobal("navigator", {
			clipboard: { writeText: vi.fn().mockRejectedValue(new Error("Denied")) },
		});
		vi.stubGlobal("document", {
			createElement: vi.fn(() => ({
				value: "",
				style: {},
				setAttribute: vi.fn(),
				select: vi.fn(),
			})),
			body: {
				appendChild: vi.fn(),
				removeChild: vi.fn(),
			},
			execCommand: vi.fn().mockReturnValue(false),
		});

		const result = await copyTextToClipboard("failed copy");
		expect(result).toBe(false);
	});

	it("removes the textarea even if execCommand throws an error", async () => {
		const removeChild = vi.fn();
		vi.stubGlobal("navigator", {
			clipboard: { writeText: vi.fn().mockRejectedValue(new Error("Denied")) },
		});
		vi.stubGlobal("document", {
			createElement: vi.fn(() => ({
				value: "",
				style: {},
				setAttribute: vi.fn(),
				select: vi.fn(),
			})),
			body: {
				appendChild: vi.fn(),
				removeChild,
			},
			execCommand: vi.fn(() => {
				throw new Error("execCommand crashed");
			}),
		});

		const result = await copyTextToClipboard("error copy");
		expect(result).toBe(false);
		expect(removeChild).toHaveBeenCalledTimes(1);
	});
});
