import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildResolvedAudioPlan } from "../../../src/lib/exporter/audioRoutingEngine";

describe("macOS companion audio loading pipeline", () => {
	let tempRoot: string;
	let recordingsPath: string;

	beforeEach(async () => {
		tempRoot = await fs.realpath(
			await fs.mkdtemp(path.join(os.tmpdir(), "recordly-mac-audio-pipeline-")),
		);
		recordingsPath = path.join(tempRoot, "UserData", "recordings");
		await fs.mkdir(recordingsPath, { recursive: true });
		vi.resetModules();
		vi.doMock("electron", () => ({
			app: {
				isPackaged: false,
				getAppPath: () => path.join(tempRoot, "App"),
				getPath: (name: string) =>
					path.join(tempRoot, name === "userData" ? "UserData" : name),
				setPath: () => undefined,
			},
		}));
		// Only the native probe is simulated; discovery, approval and routing use
		// the real implementations and actual files on disk.
		vi.doMock("node:child_process", () => ({
			execFile: (
				_file: string,
				_args: string[],
				_options: unknown,
				callback: (error: Error | null, stdout: string, stderr: string) => void,
			) => {
				const error = Object.assign(new Error("probe found embedded audio"), {
					stderr: "Stream #0:1: Audio: aac",
				});
				callback(error, "", error.stderr);
			},
		}));
		vi.doMock("../ffmpeg/binary", () => ({
			getFfmpegBinaryPath: () => "ffmpeg",
			getFfprobeBinaryPath: () => "ffprobe",
		}));
	});

	afterEach(async () => {
		vi.resetModules();
		vi.doUnmock("electron");
		vi.doUnmock("node:child_process");
		vi.doUnmock("../ffmpeg/binary");
		await fs.rm(tempRoot, { recursive: true, force: true });
	});

	it.each([
		"m4a",
		"webm",
	])("keeps both %s sidecars loadable and routes the mic into preview and export", async (extension) => {
		const videoPath = path.join(recordingsPath, "recording.mp4");
		const systemPath = path.join(recordingsPath, `recording.system.${extension}`);
		const micPath = path.join(recordingsPath, `recording.mic.${extension}`);
		await Promise.all([
			fs.writeFile(videoPath, "video with system-only embedded audio"),
			fs.writeFile(systemPath, "system"),
			fs.writeFile(micPath, "microphone"),
			fs.writeFile(`${micPath}.json`, JSON.stringify({ startDelayMs: 125 })),
		]);

		const { getCompanionAudioFallbackInfo } = await import("./diagnostics");
		const { resolveApprovedLocalMediaPath } = await import("../project/manager");
		const { isAllowedMediaPath } = await import("../../mediaServer");
		const { getMediaContentType } = await import("../../mediaTypes");

		const info = await getCompanionAudioFallbackInfo(videoPath);
		expect(info.paths).toEqual([systemPath, micPath]);
		expect(info.startDelayMsByPath).toEqual({ [micPath]: 125 });

		for (const audioPath of info.paths) {
			const realPath = await fs.realpath(audioPath);
			await expect(resolveApprovedLocalMediaPath(audioPath)).resolves.toBe(realPath);
			expect(isAllowedMediaPath(realPath)).toBe(true);
			expect(getMediaContentType(realPath)).toBe(
				extension === "m4a" ? "audio/mp4" : "video/webm",
			);
		}

		const plan = buildResolvedAudioPlan({
			videoResource: videoPath,
			sourceAudioFallbackPaths: info.paths,
		});
		expect(plan.playbackPaths).toEqual([systemPath, micPath]);
		expect(plan.pathsByTrack).toEqual({ system: systemPath, mic: micPath });
		expect(plan.muteEmbeddedPreview).toBe(true);
		expect(plan.includeEmbeddedInExport).toBe(false);
		expect(plan.tracks.map((track) => track.kind)).toEqual(["system", "mic"]);
	});

	it("requires explicit approval for an external m4a sidecar", async () => {
		const externalPath = path.join(tempRoot, "Downloads", "recording.mic.m4a");
		await fs.mkdir(path.dirname(externalPath), { recursive: true });
		await fs.writeFile(externalPath, "microphone");
		const realPath = await fs.realpath(externalPath);
		const { resolveApprovedLocalMediaPath, rememberApprovedLocalReadPath } = await import(
			"../project/manager"
		);
		const { isAllowedMediaPath } = await import("../../mediaServer");

		await expect(resolveApprovedLocalMediaPath(externalPath)).resolves.toBeNull();
		expect(isAllowedMediaPath(realPath)).toBe(false);
		await rememberApprovedLocalReadPath(externalPath);
		await expect(resolveApprovedLocalMediaPath(externalPath)).resolves.toBe(realPath);
		expect(isAllowedMediaPath(realPath)).toBe(true);
	});
});
