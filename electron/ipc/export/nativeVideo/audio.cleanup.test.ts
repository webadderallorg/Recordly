import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ directory: "", mux: vi.fn() }));
vi.mock("electron", () => ({ app: { getPath: () => state.directory } }));
vi.mock("../../ffmpeg/binary", () => ({
	getFfmpegBinaryPath: () => "synthetic-ffmpeg",
	getFfprobeBinaryPath: () => "synthetic-ffprobe",
}));
vi.mock("../../growingShareUpload", () => ({ replaceShareExportSource: vi.fn() }));
vi.mock("./process", () => ({ runFfmpegAudioMux: state.mux }));
vi.mock("./constants", () => ({
	getNowMs: () => 0,
	formatFfmpegSeconds: (ms: number) => (ms / 1000).toFixed(3),
	MISSING_NATIVE_STATIC_BACKGROUND_COLOR: "#ffffff",
}));

vi.mock("./gpuAttempt", () => ({
	tryNativeStaticGpuExport: async () => ({ didRenderVideo: false, didMuxAudioInline: false }),
}));
vi.mock("./sourceProxy", () => ({
	prepareNativeStaticLayoutSourceInput: async (
		_ffmpeg: string,
		options: { inputPath: string },
	) => ({ inputPath: options.inputPath, elapsedMs: 0 }),
}));
vi.mock("./probe", () => ({ validateNativeVideoOutputFile: vi.fn() }));
vi.mock("./staticFfmpeg", () => ({
	renderNativeStaticFfmpeg: async (options: { videoOnlyPath: string }) => {
		await fs.writeFile(options.videoOnlyPath, "rendered temporary video");
	},
}));

import { muxExportedVideoAudioBuffer, muxNativeVideoExportAudio } from "./audio";
import { exportNativeStaticLayoutVideo } from "./staticLayout";

beforeEach(async () => {
	state.directory = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-mux-cleanup-"));
	state.mux.mockReset();
});
afterEach(async () => {
	await fs.rm(state.directory, { recursive: true, force: true });
});
for (const reason of ["mux failed", "mux timed out"]) {
	it(`removes the partial final output and buffer intermediate when ${reason}`, async () => {
		const original = new Error(reason);
		state.mux.mockImplementation(async (_ffmpeg, args: string[]) => {
			await fs.writeFile(args.at(-1)!, "partial");
			throw original;
		});
		await expect(
			muxExportedVideoAudioBuffer(new ArrayBuffer(16), {
				audioMode: "copy-source",
				audioSourcePath: "/selected-source.mp4",
			}),
		).rejects.toBe(original);
		expect(await fs.readdir(state.directory)).toEqual([]);
	});
}
it("retains successful mux output while deleting its buffer intermediate", async () => {
	state.mux.mockImplementation(async (_ffmpeg, args: string[]) => {
		await fs.writeFile(args.at(-1)!, "complete");
	});
	const result = await muxExportedVideoAudioBuffer(new ArrayBuffer(16), {
		audioMode: "copy-source",
		audioSourcePath: "/selected-source.mp4",
	});
	expect(await fs.readdir(state.directory)).toEqual([path.basename(result.outputPath)]);
	expect(await fs.readFile(result.outputPath, "utf8")).toBe("complete");
});
it("cleans edited audio and partial output while retaining the caller-owned source on failure", async () => {
	const video = path.join(state.directory, "take.mp4");
	await fs.writeFile(video, "source");
	state.mux.mockImplementation(async (_ffmpeg, args: string[]) => {
		await fs.writeFile(args.at(-1)!, "partial");
		throw new Error("failed");
	});
	await expect(
		muxNativeVideoExportAudio(video, {
			audioMode: "edited-track",
			editedAudioData: new ArrayBuffer(16),
			editedAudioMimeType: "audio/wav",
		}),
	).rejects.toThrow("failed");
	expect(await fs.readdir(state.directory)).toEqual(["take.mp4"]);
	expect(await fs.readFile(video, "utf8")).toBe("source");
});

for (const collision of ["audio-input", "unrelated-file", "symlink", "hardlink"] as const) {
	it.skipIf(process.platform === "win32" && collision === "symlink")(
		`refuses an existing ${collision} at the derived output without overwriting or deleting it`,
		async () => {
			const video = path.join(state.directory, "take.mp4");
			const output = path.join(state.directory, "take-final.mp4");
			const audio =
				collision === "audio-input"
					? output
					: path.join(state.directory, "selected-audio.wav");
			await fs.writeFile(video, "original video");
			await fs.writeFile(audio, "original audio");
			if (collision === "unrelated-file") await fs.writeFile(output, "unrelated recording");
			else if (collision === "symlink") await fs.symlink(audio, output);
			else if (collision === "hardlink") await fs.link(audio, output);
			await expect(
				muxNativeVideoExportAudio(video, {
					audioMode: "copy-source",
					audioSourcePath: audio,
				}),
			).rejects.toMatchObject({ code: "EEXIST" });
			expect(state.mux).not.toHaveBeenCalled();
			expect(await fs.readFile(video, "utf8")).toBe("original video");
			expect(await fs.readFile(audio, "utf8")).toBe("original audio");
			expect(await fs.readFile(output, "utf8")).toBe(
				collision === "unrelated-file" ? "unrelated recording" : "original audio",
			);
			if (collision === "symlink")
				expect((await fs.lstat(output)).isSymbolicLink()).toBe(true);
		},
	);
}
it("removes its edited-audio temporary after output reservation fails, preserving pre-existing output", async () => {
	const video = path.join(state.directory, "take.mp4");
	const output = path.join(state.directory, "take-final.mp4");
	await fs.writeFile(video, "source");
	await fs.writeFile(output, "existing recording");
	await expect(
		muxNativeVideoExportAudio(video, {
			audioMode: "edited-track",
			editedAudioData: new ArrayBuffer(16),
			editedAudioMimeType: "audio/wav",
		}),
	).rejects.toMatchObject({ code: "EEXIST" });
	expect(state.mux).not.toHaveBeenCalled();
	expect((await fs.readdir(state.directory)).sort()).toEqual(["take-final.mp4", "take.mp4"]);
	expect(await fs.readFile(output, "utf8")).toBe("existing recording");
});

it("preserves pre-existing media through the static export caller's failure cleanup", async () => {
	const audio = path.join(state.directory, "test-session-final.mp4");
	await fs.writeFile(audio, "selected existing media");
	await expect(
		exportNativeStaticLayoutVideo("synthetic-ffmpeg", {
			sessionId: "test-session",
			inputPath: "/screen.mp4",
			width: 64,
			height: 64,
			frameRate: 30,
			bitrate: 1000000,
			encodingMode: "balanced",
			durationSec: 1,
			contentWidth: 64,
			contentHeight: 64,
			offsetX: 0,
			offsetY: 0,
			backgroundColor: "#000000",
			audioOptions: { audioMode: "copy-source", audioSourcePath: audio },
		}),
	).rejects.toMatchObject({ code: "EEXIST" });
	expect(state.mux).not.toHaveBeenCalled();
	expect(await fs.readFile(audio, "utf8")).toBe("selected existing media");
	expect(await fs.readdir(state.directory)).toEqual(["test-session-final.mp4"]);
});
