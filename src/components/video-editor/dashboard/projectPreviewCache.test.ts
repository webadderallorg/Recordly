import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectPreviewData } from "@/types/projectPreview";
import { getCachedProjectPreview } from "./projectPreviewCache";

type PreviewResult = Awaited<ReturnType<Window["electronAPI"]["getProjectPreview"]>>;
const success = (videoUrl = "http://media.test/source.mp4"): PreviewResult => ({
	success: true,
	value: { videoUrl, webcamUrl: null, project: {} } as ProjectPreviewData,
});
const read = vi.fn<Window["electronAPI"]["getProjectPreview"]>();

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(100_000);
	read.mockReset().mockResolvedValue(success());
	vi.stubGlobal("window", { electronAPI: { getProjectPreview: read } });
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("project preview metadata cache", () => {
	it("shares concurrent reads and reuses the resolved preview on remount", async () => {
		let finish!: (result: PreviewResult) => void;
		read.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		const first = getCachedProjectPreview("/projects/one.recordly", 1);
		expect(getCachedProjectPreview("/projects/one.recordly", 1)).toBe(first);
		await Promise.resolve();
		expect(read).toHaveBeenCalledOnce();
		const result = success();
		finish(result);
		await expect(first).resolves.toBe(result);
		await expect(getCachedProjectPreview("/projects/one.recordly", 1)).resolves.toBe(result);
		expect(read).toHaveBeenCalledOnce();
	});

	it("keeps changed revisions separate even if an old read finishes last", async () => {
		let finishOld!: (result: PreviewResult) => void;
		read.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finishOld = resolve;
				}),
		);
		const old = getCachedProjectPreview("/projects/one.recordly", 1);
		await Promise.resolve();
		const latest = success("http://media.test/relinked.mp4");
		read.mockResolvedValueOnce(latest);
		await expect(getCachedProjectPreview("/projects/one.recordly", 2)).resolves.toBe(latest);
		finishOld(success());
		await old;
		await expect(getCachedProjectPreview("/projects/one.recordly", 2)).resolves.toBe(latest);
		expect(read).toHaveBeenCalledTimes(2);
		await getCachedProjectPreview("/projects/two.recordly", 2);
		expect(read).toHaveBeenCalledTimes(3);
	});

	it("retries both reported failures and rejected reads instead of caching them", async () => {
		read.mockResolvedValueOnce({ success: false, error: "Source is offline" });
		await expect(getCachedProjectPreview("/offline.recordly", 1)).resolves.toHaveProperty(
			"success",
			false,
		);
		read.mockRejectedValueOnce(new Error("IPC unavailable"));
		await expect(getCachedProjectPreview("/offline.recordly", 1)).rejects.toThrow(
			"IPC unavailable",
		);
		await expect(getCachedProjectPreview("/offline.recordly", 1)).resolves.toHaveProperty(
			"success",
			true,
		);
		expect(read).toHaveBeenCalledTimes(3);
	});

	it("expires a successful snapshot so unchanged project revisions can resolve moved sources", async () => {
		await getCachedProjectPreview("/one.recordly", 1);
		vi.setSystemTime(129_999);
		await getCachedProjectPreview("/one.recordly", 1);
		expect(read).toHaveBeenCalledOnce();
		vi.setSystemTime(130_000);
		const relinked = success("http://media.test/new-location.mp4");
		read.mockResolvedValueOnce(relinked);
		await expect(getCachedProjectPreview("/one.recordly", 1)).resolves.toBe(relinked);
		expect(read).toHaveBeenCalledTimes(2);
	});

	it("bounds retained previews and keeps recently used entries", async () => {
		for (let index = 0; index < 100; index++)
			await getCachedProjectPreview(`/project-${index}.recordly`, 1);
		await getCachedProjectPreview("/project-0.recordly", 1);
		await getCachedProjectPreview("/project-100.recordly", 1);
		await getCachedProjectPreview("/project-0.recordly", 1);
		expect(read).toHaveBeenCalledTimes(101);
		await getCachedProjectPreview("/project-1.recordly", 1);
		expect(read).toHaveBeenCalledTimes(102);
	});

	it("does not restore an evicted pending request when it completes", async () => {
		let finish!: (result: PreviewResult) => void;
		read.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		const first = getCachedProjectPreview("/slow.recordly", 1);
		await Promise.resolve();
		for (let index = 0; index < 100; index++)
			await getCachedProjectPreview(`/project-${index}.recordly`, 1);
		finish(success());
		await first;
		await getCachedProjectPreview("/slow.recordly", 1);
		expect(read).toHaveBeenCalledTimes(102);
	});

	it("does not reuse capability URLs across bridge sessions", async () => {
		await getCachedProjectPreview("/one.recordly", 1);
		const newRead = vi.fn().mockResolvedValue(success("http://media.test/new-session.mp4"));
		vi.stubGlobal("window", { electronAPI: { getProjectPreview: newRead } });
		await expect(getCachedProjectPreview("/one.recordly", 1)).resolves.toHaveProperty(
			"value.videoUrl",
			"http://media.test/new-session.mp4",
		);
		expect(newRead).toHaveBeenCalledOnce();
	});
});
