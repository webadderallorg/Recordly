import fs from "node:fs/promises";
import { afterEach, expect, it, vi } from "vitest";
import { publishCompletedFile } from "./publishCompletedFile";

afterEach(() => vi.restoreAllMocks());
it("copies a completed file when Windows redirects rename across volumes", async () => {
	vi.spyOn(fs, "rename").mockRejectedValue(
		Object.assign(new Error("redirected"), { code: "EXDEV" }),
	);
	const copy = vi.spyOn(fs, "copyFile").mockResolvedValue();
	const unlink = vi.spyOn(fs, "unlink").mockResolvedValue();
	await publishCompletedFile("staged.wav", "final.wav");
	expect(copy).toHaveBeenCalledWith("staged.wav", "final.wav");
	expect(unlink).toHaveBeenCalledWith("staged.wav");
	expect(copy.mock.invocationCallOrder[0]).toBeLessThan(unlink.mock.invocationCallOrder[0]);
});
it("does not remove staged audio when the fallback copy fails", async () => {
	vi.spyOn(fs, "rename").mockRejectedValue(
		Object.assign(new Error("redirected"), { code: "EXDEV" }),
	);
	vi.spyOn(fs, "copyFile").mockRejectedValue(new Error("disk full"));
	const unlink = vi.spyOn(fs, "unlink").mockResolvedValue();
	await expect(publishCompletedFile("staged.wav", "final.wav")).rejects.toThrow("disk full");
	expect(unlink).not.toHaveBeenCalled();
});
it("propagates other rename failures without overwriting the destination", async () => {
	vi.spyOn(fs, "rename").mockRejectedValue(
		Object.assign(new Error("access denied"), { code: "EACCES" }),
	);
	const copy = vi.spyOn(fs, "copyFile").mockResolvedValue();
	await expect(publishCompletedFile("staged.wav", "final.wav")).rejects.toThrow("access denied");
	expect(copy).not.toHaveBeenCalled();
});
