import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectLibraryEntry } from "../ProjectBrowserDialog";
import {
	duplicateCandidates,
	hasNoTimelineEdits,
	matchesCleanupDate,
	projectDuplicateKey,
	scanCleanup,
	sourceIsReferenced,
} from "./libraryCleanup";

const entry = (path: string, updatedAt = 1, isCurrent = false): ProjectLibraryEntry => ({
	path,
	updatedAt,
	createdAt: updatedAt,
	isCurrent,
	name: path,
	thumbnailPath: null,
	isInProjectsDirectory: true,
});
const project = { version: 1, videoPath: "/clips/a.mp4", editor: {} };
afterEach(() => vi.unstubAllGlobals());

describe("cleanup dates", () => {
	it("uses strict age cutoffs and the chosen timestamp", () => {
		const now = 100 * 86400000;
		const filter = { period: "older30" as const, basis: "edited" as const, from: "", to: "" };
		expect(matchesCleanupDate(entry("a", now - 30 * 86400000), filter, now)).toBe(false);
		expect(matchesCleanupDate(entry("a", now - 31 * 86400000), filter, now)).toBe(true);
		expect(
			matchesCleanupDate(
				{ ...entry("a", now), createdAt: 1 },
				{ ...filter, basis: "created" },
				now,
			),
		).toBe(true);
		expect(
			matchesCleanupDate(
				{ ...entry("a"), createdAt: undefined },
				{ ...filter, basis: "created" },
				now,
			),
		).toBe(false);
	});
	it("includes the entire local last day and excludes reversed or invalid ranges", () => {
		const filter = {
			period: "custom" as const,
			basis: "edited" as const,
			from: "2026-10-04",
			to: "2026-10-04",
		};
		expect(
			matchesCleanupDate(entry("a", new Date("2026-10-04T23:59:59.999").getTime()), filter),
		).toBe(true);
		expect(
			matchesCleanupDate(entry("a", new Date("2026-10-05T00:00:00").getTime()), filter),
		).toBe(false);
		expect(matchesCleanupDate(entry("a"), { ...filter, from: "2026-10-06" })).toBe(false);
		expect(matchesCleanupDate(entry("a"), { ...filter, from: "invalid" })).toBe(false);
	});
});

it("keeps current/newest copies and every protected source, independently of visible filters", () => {
	const entries = [entry("old"), entry("new", 3), entry("current", 2, true)];
	expect([...duplicateCandidates([["old", "new", "current"]], entries).candidates]).toEqual([
		"new",
		"old",
	]);
	const protectedPaths = new Set(["old", "new"]);
	expect([
		...duplicateCandidates([["old", "new", "current"]], entries, protectedPaths).candidates,
	]).toEqual([]);
});

it("only matches identical saved edits and sources, ignoring project identity and object key order", () => {
	expect(projectDuplicateKey(project)).toBe(
		projectDuplicateKey({ ...project, projectId: "another" }),
	);
	expect(projectDuplicateKey(project)).not.toBe(
		projectDuplicateKey({ ...project, videoPath: "/other.mp4" }),
	);
	expect(projectDuplicateKey(project)).not.toBe(
		projectDuplicateKey({ ...project, editor: { padding: 12 } as never }),
	);
});

it("requires full-length, unmodified timelines and known duration", () => {
	expect(hasNoTimelineEdits(project, 1000)).toBe(true);
	expect(hasNoTimelineEdits(project, NaN)).toBe(false);
	const clip = { id: "clip", startMs: 0, endMs: 1000, speed: 1 };
	expect(hasNoTimelineEdits({ ...project, editor: { clipRegions: [clip] } }, 1000)).toBe(true);
	for (const change of [{ endMs: 900 }, { sourceStartMs: 100 }, { speed: 2 }, { muted: true }])
		expect(
			hasNoTimelineEdits(
				{ ...project, editor: { clipRegions: [{ ...clip, ...change }] } },
				1000,
			),
		).toBe(false);
	expect(
		hasNoTimelineEdits({ ...project, editor: { annotationRegions: [{}] as never } }, 1000),
	).toBe(false);
	for (const setting of [
		{ volume: 0, normalize: false },
		{ volume: 1, normalize: true },
	]) {
		expect(
			hasNoTimelineEdits(
				{ ...project, editor: { defaultSourceAudioTrackSettings: { mic: setting } } },
				1000,
			),
		).toBe(false);
		expect(
			hasNoTimelineEdits(
				{
					...project,
					editor: { sourceAudioTrackSettingsByClip: { clip: { mic: setting } } },
				},
				1000,
			),
		).toBe(false);
	}
	expect(
		hasNoTimelineEdits(
			{
				...project,
				editor: {
					defaultSourceAudioTrackSettings: { mic: { volume: 1, normalize: false } },
				},
			},
			1000,
		),
	).toBe(true);
});

it("protects linked source, mic, system audio and webcam files without matching neighbouring captures", () => {
	const refs = new Set(["/clips/capture.mp4"]);
	for (const source of [
		"/clips/capture.mp4",
		"/clips/capture.mic.wav",
		"/clips/capture.system.m4a",
		"/clips/capture-webcam.webm",
		"/clips/capture.webcam.mp4",
	])
		expect(sourceIsReferenced(source, refs)).toBe(true);
	expect(sourceIsReferenced("/clips/capture-other.mic.wav", refs)).toBe(false);
	expect(
		sourceIsReferenced("C:\\clips\\Capture.mp4", new Set(["file:///C:/clips/capture.mp4"])),
	).toBe(true);
	expect(
		sourceIsReferenced("C:\\clips\\Capture.mic.wav", new Set(["C:/clips/./capture.mp4"])),
	).toBe(true);
	expect(
		sourceIsReferenced("\\\\server\\share\\a.mp4", new Set(["file://server/share/a.mp4"])),
	).toBe(true);
	expect(sourceIsReferenced("/clips/a.mp4", new Set(["/clips/other/../a.mp4"]))).toBe(true);
});

it("disables source suggestions if any project cannot be inspected", async () => {
	const hash = vi.fn();
	vi.stubGlobal("window", {
		electronAPI: {
			getProjectPreview: async () => ({ success: false }),
			findDuplicateRecordingSources: hash,
		},
	});
	const result = await scanCleanup(
		"duplicates",
		[entry("raw")],
		[entry("project")],
		true,
		() => false,
	);
	expect(result.incomplete).toBe(true);
	expect(result.candidates.size).toBe(0);
	expect(hash).not.toHaveBeenCalled();
});

it("finds unused sources after reading every known project's references", async () => {
	vi.stubGlobal("window", {
		electronAPI: { getProjectPreview: async () => ({ success: true, value: { project } }) },
	});
	const result = await scanCleanup(
		"unused",
		[entry("/clips/a.mp4"), entry("/clips/a.mic.wav"), entry("/clips/unused.mp4")],
		[entry("project")],
		true,
		() => false,
	);
	expect([...result.candidates]).toEqual(["/clips/unused.mp4"]);
});

it("protects canonical dependencies through folder aliases and blocks incomplete resolution", async () => {
	const getProjectPreview = vi.fn(async () => ({
		success: true,
		value: { project, sourcePaths: ["/actual/a.mp4"], sourcePathsComplete: true },
	}));
	vi.stubGlobal("window", { electronAPI: { getProjectPreview } });
	const entries = [entry("/actual/a.mp4"), entry("/actual/a.mic.wav")];
	expect(
		(await scanCleanup("unused", entries, [entry("project")], true, () => false)).candidates
			.size,
	).toBe(0);
	getProjectPreview.mockResolvedValue({
		success: true,
		value: { project, sourcePaths: [], sourcePathsComplete: false },
	});
	const result = await scanCleanup("unused", entries, [entry("project")], true, () => false);
	expect(result.incomplete).toBe(true);
	expect(result.candidates.size).toBe(0);
});
