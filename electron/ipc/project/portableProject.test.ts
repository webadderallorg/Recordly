import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../utils", () => ({
	normalizeVideoSourcePath: (value: string) => {
		if (typeof value !== "string") return null;
		if (value.startsWith("file://")) {
			try {
				return fileURLToPath(value);
			} catch {
				return value;
			}
		}
		return value;
	},
}));

import {
	applyRelinkedProjectMedia,
	collectRelinkedProjectMedia,
	resolveProjectMediaSources,
} from "./projectMedia";

describe("portable project media resolution (#1104)", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = path.join(
			os.tmpdir(),
			`recordly-portable-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		await fs.mkdir(tempDir, { recursive: true });
		tempDir = await fs.realpath(tempDir);
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
	});

	it("resolves video with a cross-platform POSIX path when the file is nearby", async () => {
		const videoFile = path.join(tempDir, "clip.mp4");
		await fs.writeFile(videoFile, "video data");
		const projectPath = path.join(tempDir, "project.recordly");
		const project = {
			videoPath: "/Users/alice/Movies/clip.mp4",
		};
		const result = await resolveProjectMediaSources(project, projectPath);
		expect(result).toEqual(
			expect.objectContaining({
				success: true,
				videoPath: videoFile,
			}),
		);
	});

	it("resolves video with a cross-platform Windows path when the file is nearby", async () => {
		const videoFile = path.join(tempDir, "clip.mp4");
		await fs.writeFile(videoFile, "video data");
		const projectPath = path.join(tempDir, "project.recordly");
		const project = {
			videoPath: "C:\\Users\\Bob\\Videos\\clip.mp4",
		};
		const result = await resolveProjectMediaSources(project, projectPath);
		expect(result).toEqual(
			expect.objectContaining({
				success: true,
				videoPath: videoFile,
			}),
		);
	});

	it("resolves media located in a recordings subfolder", async () => {
		const recordingsDir = path.join(tempDir, "recordings");
		await fs.mkdir(recordingsDir);
		const videoFile = path.join(recordingsDir, "clip.mp4");
		await fs.writeFile(videoFile, "video data");
		const projectPath = path.join(tempDir, "project.recordly");
		const project = {
			videoPath: "C:\\Original\\Machine\\Path\\clip.mp4",
		};
		const result = await resolveProjectMediaSources(project, projectPath);
		expect(result).toEqual(
			expect.objectContaining({
				success: true,
				videoPath: videoFile,
			}),
		);
	});

	it("resolves media located in a media subfolder", async () => {
		const mediaDir = path.join(tempDir, "media");
		await fs.mkdir(mediaDir);
		const videoFile = path.join(mediaDir, "clip.mp4");
		await fs.writeFile(videoFile, "video data");
		const projectPath = path.join(tempDir, "project.recordly");
		const project = {
			videoPath: "/original/clip.mp4",
		};
		const result = await resolveProjectMediaSources(project, projectPath);
		expect(result).toEqual(
			expect.objectContaining({
				success: true,
				videoPath: videoFile,
			}),
		);
	});

	it("resolves relative video paths against project directory", async () => {
		const videoFile = path.join(tempDir, "clip.mp4");
		await fs.writeFile(videoFile, "video data");
		const projectPath = path.join(tempDir, "project.recordly");
		const project = {
			videoPath: "./clip.mp4",
		};
		const result = await resolveProjectMediaSources(project, projectPath);
		expect(result).toEqual(
			expect.objectContaining({
				success: true,
				videoPath: videoFile,
			}),
		);
	});

	it("opens a nested media path saved with Windows separators", async () => {
		const archiveDir = path.join(tempDir, "assets", "takes");
		await fs.mkdir(archiveDir, { recursive: true });
		const videoPath = path.join(archiveDir, "clip.mp4");
		await fs.writeFile(videoPath, "video");
		const result = await resolveProjectMediaSources(
			{ videoPath: "assets\\takes\\clip.mp4" },
			path.join(tempDir, "project.recordly"),
		);
		expect(result).toMatchObject({ success: true, videoPath });
	});

	it("does not treat a directory as a relative video file", async () => {
		await fs.mkdir(path.join(tempDir, "clip.mp4"));
		const result = await resolveProjectMediaSources(
			{ videoPath: "./clip.mp4" },
			path.join(tempDir, "project.recordly"),
		);
		expect(result).toMatchObject({ success: false });
	});

	it.each([
		"flac",
		"aac",
	])("relinks companion audio tracks and %s audio regions", async (extension) => {
		const videoFile = path.join(tempDir, "clip.mp4");
		const audioFile1 = path.join(tempDir, "clip.mic.wav");
		const audioFile2 = path.join(tempDir, `bg-music.${extension}`);
		await fs.writeFile(videoFile, "video");
		await fs.writeFile(audioFile1, "mic audio");
		await fs.writeFile(audioFile2, "bg music");

		const projectPath = path.join(tempDir, "project.recordly");
		const project = {
			videoPath: "/old/machine/clip.mp4",
			editor: {
				audioTracks: [{ sourcePath: "C:\\old\\path\\clip.mic.wav" }],
				audioRegions: [
					{
						id: "r1",
						audioPath: `/old/machine/bg-music.${extension}`,
						startMs: 0,
						endMs: 5000,
					},
				],
			},
		};

		const media = await resolveProjectMediaSources(project, projectPath);
		expect(media.success).toBe(true);
		if (!media.success) return;

		const relinked = applyRelinkedProjectMedia(project, media);
		expect(project.videoPath).toBe(videoFile);
		expect(project.editor.audioTracks[0].sourcePath).toBe(audioFile1);
		expect(project.editor.audioRegions[0].audioPath).toBe(audioFile2);
		expect(relinked.has(videoFile)).toBe(true);
		expect(relinked.has(audioFile1)).toBe(true);
		expect(relinked.has(audioFile2)).toBe(true);
	});

	it("resolves URL-encoded file paths", async () => {
		const videoFile = path.join(tempDir, "my space video.mp4");
		await fs.writeFile(videoFile, "video data");
		const projectPath = path.join(tempDir, "project.recordly");
		const project = {
			videoPath: "file:///C:/Users/Bob/my%20space%20video.mp4",
		};
		const result = await resolveProjectMediaSources(project, projectPath);
		expect(result).toEqual(
			expect.objectContaining({
				success: true,
				videoPath: videoFile,
			}),
		);
	});

	it("keeps literal percent sequences in a moved media filename", async () => {
		const videoPath = path.join(tempDir, "démo%20take.mp4");
		await fs.writeFile(videoPath, "video");
		const result = await resolveProjectMediaSources(
			{ videoPath: "file:///C:/Original/Recordings/d%C3%A9mo%2520take.mp4" },
			path.join(tempDir, "project.recordly"),
		);
		expect(result).toMatchObject({ success: true, videoPath });
	});

	it("keeps a working audio file URL without marking it as a new location", async () => {
		const videoPath = path.join(tempDir, "clip.mp4");
		const audioPath = path.join(tempDir, "music.wav");
		await fs.writeFile(videoPath, "video");
		await fs.writeFile(audioPath, "audio");
		const audioUrl = pathToFileURL(audioPath).href;
		const project = {
			videoPath,
			editor: {
				audioTracks: [{ sourcePath: audioUrl }],
				audioRegions: [{ audioPath: audioUrl }],
			},
		};
		const media = await resolveProjectMediaSources(
			project,
			path.join(tempDir, "demo.recordly"),
		);
		expect(media).toMatchObject({ success: true, relinkedAudio: [] });
	});

	it("collects all relinked sources including audio", async () => {
		const videoFile = path.join(tempDir, "clip.mp4");
		const audioFile = path.join(tempDir, "clip.mic.wav");
		await fs.writeFile(videoFile, "video");
		await fs.writeFile(audioFile, "audio");

		const projectPath = path.join(tempDir, "project.recordly");
		const project = {
			videoPath: "/old/clip.mp4",
			editor: {
				audioTracks: [{ sourcePath: "/old/clip.mic.wav" }],
			},
		};

		const { sources, complete } = await collectRelinkedProjectMedia(project, projectPath);
		expect(complete).toBe(true);
		expect(sources).toContain(videoFile);
		expect(sources).toContain(audioFile);
	});
});
