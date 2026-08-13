import { describe, expect, it } from "vitest";

import {
	getAudioResourceCacheScope,
	getAudioResourceVersionKey,
	getVersionedAudioResourceUrl,
	isAudioResourceLoadCurrent,
} from "./audioResourceVersion";

describe("getAudioResourceVersionKey", () => {
	it("changes identity when a finalized companion replaces a partial file at the same path", () => {
		const audioPath = "C:\\Recordly\\recording.mic.wav";

		expect(getAudioResourceVersionKey(audioPath, 0)).not.toBe(
			getAudioResourceVersionKey(audioPath, 1),
		);
	});

	it("is stable for rerenders within the same finalization version", () => {
		const audioPath = "C:\\Recordly\\recording.mic.wav";

		expect(getAudioResourceVersionKey(audioPath, 3)).toBe(
			getAudioResourceVersionKey(audioPath, 3),
		);
	});

	it("keeps an in-flight load valid across rerenders and rejects an older version", () => {
		const audioPath = "C:\\Recordly\\recording.mic.wav";
		const versionOne = getAudioResourceVersionKey(audioPath, 1);
		const versionTwo = getAudioResourceVersionKey(audioPath, 2);
		const resources = new Map([[audioPath, versionOne]]);

		expect(isAudioResourceLoadCurrent(resources, audioPath, versionOne)).toBe(true);
		resources.set(audioPath, versionTwo);
		expect(isAudioResourceLoadCurrent(resources, audioPath, versionOne)).toBe(false);
	});

	it("cache-busts only the trusted loopback media URL after finalization", () => {
		const localUrl =
			"http://127.0.0.1:43123/video?path=C%3A%5CRecordly%5Crecording.mic.wav";
		const versionedUrl = new URL(getVersionedAudioResourceUrl(localUrl, 2));

		expect(versionedUrl.searchParams.get("path")).toBe(
			"C:\\Recordly\\recording.mic.wav",
		);
		expect(versionedUrl.searchParams.get("recordlyAudioVersion")).toBe("2");
		expect(getVersionedAudioResourceUrl("https://cdn.example/audio.wav?sig=abc", 2)).toBe(
			"https://cdn.example/audio.wav?sig=abc",
		);
	});

	it("uses one cache scope for every version of a loopback resource", () => {
		const baseUrl =
			"http://127.0.0.1:43123/video?path=C%3A%5CRecordly%5Crecording.mic.wav";
		const versionedUrl = `${baseUrl}&recordlyAudioVersion=4`;

		expect(getAudioResourceCacheScope(versionedUrl)).toBe(baseUrl);
		expect(
			getAudioResourceCacheScope(
				"https://cdn.example/audio.wav?recordlyAudioVersion=4&sig=abc",
			),
		).toBe("https://cdn.example/audio.wav?recordlyAudioVersion=4&sig=abc");
	});
});
