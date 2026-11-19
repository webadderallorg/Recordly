import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectLibraryEntry } from "../ProjectBrowserDialog";
import {
	compareLibraryEntries,
	libraryMediaKey,
	readLibraryMediaInfo,
	type LibraryMediaInfo,
	type LibrarySort,
	type LibrarySortDirection,
	defaultLibrarySortDirection,
} from "./librarySort";

const entry = (name: string, updatedAt: number): ProjectLibraryEntry => ({
	path: `/projects/${name}.recordly`,
	name,
	updatedAt,
	thumbnailPath: null,
	isCurrent: false,
	isInProjectsDirectory: true,
});
const entries = [entry("short", 3), entry("long", 2), entry("offline", 4), entry("silent", 1)];
const metadata = new Map<string, LibraryMediaInfo>([
	[libraryMediaKey(entries[0]), { duration: 5, hasAudio: true }],
	[libraryMediaKey(entries[1]), { duration: 90, hasAudio: true }],
	[libraryMediaKey(entries[3]), { duration: 20, hasAudio: false }],
]);
const sorted = (sort: LibrarySort, direction?: LibrarySortDirection) =>
	[...entries]
		.sort((a, b) => compareLibraryEntries(a, b, sort, "en", metadata, direction))
		.map((item) => item.name);
afterEach(() => vi.unstubAllGlobals());

describe("library sorting", () => {
	it("sorts duration in both directions with missing values last", () => {
		expect(sorted("duration", "desc")).toEqual(["long", "silent", "short", "offline"]);
		expect(sorted("duration", "asc")).toEqual(["short", "silent", "long", "offline"]);
	});
	it("places audio first, silent next and unknown last with recent ties", () => {
		expect(sorted("audio")).toEqual(["short", "long", "silent", "offline"]);
	});
	it("reverses name, date and audio order without promoting unknown metadata", () => {
		expect(sorted("name", "desc")).toEqual(["silent", "short", "offline", "long"]);
		expect(sorted("recent", "asc")).toEqual(["silent", "long", "short", "offline"]);
		expect(sorted("audio", "asc")).toEqual(["silent", "short", "long", "offline"]);
		const created = entries.map((item, index) => ({
			...item,
			createdAt: [1000, 3000, 2000, 4000][index],
		}));
		expect(
			[...created]
				.sort((a, b) => compareLibraryEntries(a, b, "created", "en", metadata, "asc"))
				.map((item) => item.name),
		).toEqual(["short", "offline", "long", "silent"]);
		expect(
			[...created]
				.sort((a, b) => compareLibraryEntries(a, b, "created", "en", metadata, "desc"))
				.map((item) => item.name),
		).toEqual(["silent", "long", "offline", "short"]);
	});
	it("defaults to A–Z for name and descending for dates, duration and audio", () => {
		expect(defaultLibrarySortDirection("name")).toBe("asc");
		for (const criterion of ["recent", "created", "duration", "audio"] as const)
			expect(defaultLibrarySortDirection(criterion)).toBe("desc");
	});

	it("keeps existing name/date sorts and ignores stale metadata after a revision", () => {
		expect(sorted("recent")).toEqual(["offline", "short", "long", "silent"]);
		expect(sorted("name")).toEqual(["long", "offline", "short", "silent"]);
		const updated = { ...entries[0], updatedAt: 100 };
		expect(
			compareLibraryEntries(updated, entries[1], "duration", "en", metadata, "asc"),
		).toBeGreaterThan(0);
	});
});

function install({
	clips = [],
	addedAudio = [],
	probeAudio = false,
	companionPaths = [],
	probeFails = false,
}: {
	clips?: Array<{ id: string; startMs: number; endMs: number; speed: number }>;
	addedAudio?: Array<{
		id: string;
		audioPath: string;
		startMs: number;
		endMs: number;
		volume: number;
	}>;
	probeAudio?: boolean;
	companionPaths?: string[];
	probeFails?: boolean;
} = {}) {
	const api = {
		getProjectPreview: vi.fn(async () => ({
			success: true,
			value: {
				project: {
					version: 1,
					videoPath: "/recordings/source.mp4",
					editor: { clipRegions: clips, audioRegions: addedAudio },
				},
			},
		})),
		probeNativeVideoMetadata: vi.fn(async () =>
			probeFails
				? { success: false }
				: { success: true, metadata: { duration: 100, hasAudio: probeAudio } },
		),
		getVideoAudioFallbackPaths: vi.fn(async () => ({ success: true, paths: companionPaths })),
	};
	vi.stubGlobal("window", { electronAPI: api });
	return api;
}

describe("library media metadata", () => {
	it("uses edited timeline length rather than full source length", async () => {
		install({ clips: [{ id: "trimmed", startMs: 0, endMs: 2500, speed: 2 }] });
		expect(await readLibraryMediaInfo(entries[0])).toEqual({ duration: 2.5, hasAudio: false });
	});
	it("finds embedded, companion and added audio without guessing video filenames", async () => {
		for (const setup of [
			{ probeAudio: true },
			{ companionPaths: ["/recordings/source.mic.wav"] },
			{
				addedAudio: [
					{ id: "music", audioPath: "/music.wav", startMs: 0, endMs: 5000, volume: 1 },
				],
			},
		]) {
			install(setup);
			expect((await readLibraryMediaInfo(entries[0])).hasAudio).toBe(true);
		}
	});
	it("keeps unknown probe failures separate from silent recordings", async () => {
		install({ probeFails: true });
		expect(await readLibraryMediaInfo(entries[0])).toEqual({
			duration: undefined,
			hasAudio: undefined,
		});
	});
	it("keeps audio presence unknown if companion inspection fails for a silent source", async () => {
		const api = install();
		api.getVideoAudioFallbackPaths.mockRejectedValueOnce(new Error("offline companion files"));
		expect((await readLibraryMediaInfo(entries[0])).hasAudio).toBeUndefined();
	});
	it("identifies raw audio without probing it as video or decoding its duration for audio sorting", async () => {
		const api = install();
		const rawSource = {
			path: "/recordings/take.mp3",
			name: "renamed voice",
			bytes: 123,
			createdAt: 5,
			url: "http://media/take.mp3",
		};
		expect(await readLibraryMediaInfo({ ...entries[0], rawSource }, true)).toEqual({
			hasAudio: true,
			duration: undefined,
		});
		expect(api.probeNativeVideoMetadata).not.toHaveBeenCalled();
		expect(api.getProjectPreview).not.toHaveBeenCalled();
	});
});
