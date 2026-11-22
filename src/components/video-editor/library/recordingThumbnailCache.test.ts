import { afterEach, expect, it, vi } from "vitest";
import {
	loadRecordingThumbnail,
	peekRecordingThumbnail,
	recordingThumbnailKey,
} from "./recordingThumbnailCache";

afterEach(() => vi.unstubAllGlobals());
it("reuses loaded recordings across remounts and shares pending requests", async () => {
	let finish!: (value: { success: true; value: string }) => void;
	const getRecordingThumbnail = vi.fn(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	vi.stubGlobal("window", { electronAPI: { getRecordingThumbnail } });
	const first = loadRecordingThumbnail("same", "/recording.mp4");
	expect(loadRecordingThumbnail("same", "/recording.mp4")).toBe(first);
	finish({ success: true, value: "data:image/jpeg;base64,still" });
	await first;
	expect(peekRecordingThumbnail("same")).toContain("still");
	await loadRecordingThumbnail("same", "/recording.mp4");
	expect(getRecordingThumbnail).toHaveBeenCalledOnce();
});
it("does not cache failures and retries later", async () => {
	const getRecordingThumbnail = vi
		.fn()
		.mockResolvedValueOnce({ success: false, error: "offline" })
		.mockResolvedValueOnce({ success: true, value: "recovered" });
	vi.stubGlobal("window", { electronAPI: { getRecordingThumbnail } });
	await expect(loadRecordingThumbnail("retry", "/retry.mp4")).rejects.toThrow("offline");
	await expect(loadRecordingThumbnail("retry", "/retry.mp4")).resolves.toBe("recovered");
});
it("invalidates when recording metadata changes and bounds retained previews", async () => {
	const entry = { path: "/file.mp4", createdAt: 1, bytes: 10, name: "File", url: "" };
	expect(recordingThumbnailKey(entry)).not.toBe(recordingThumbnailKey({ ...entry, bytes: 20 }));
	expect(recordingThumbnailKey(entry)).not.toBe(
		recordingThumbnailKey({ ...entry, createdAt: 2 }),
	);
	vi.stubGlobal("window", {
		electronAPI: { getRecordingThumbnail: async () => ({ success: true, value: "image" }) },
	});
	for (let i = 0; i < 201; i++) await loadRecordingThumbnail(`bounded:${i}`, entry.path);
	expect(peekRecordingThumbnail("bounded:0")).toBeUndefined();
	expect(peekRecordingThumbnail("bounded:200")).toBe("image");
});
