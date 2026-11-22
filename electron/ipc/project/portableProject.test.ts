import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

	it("resolves and relinks companion audio tracks and audio regions", async () => {
		const videoFile = path.join(tempDir, "clip.mp4");
		const audioFile1 = path.join(tempDir, "clip.mic.wav");
		const audioFile2 = path.join(tempDir, "bg-music.mp3");
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
						audioPath: "/old/machine/bg-music.mp3",
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
