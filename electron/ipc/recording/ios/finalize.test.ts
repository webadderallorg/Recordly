import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import type { NativeCaptureResult } from "../../../../src/shared/iosCapture";
import { allocateIOSSessionStorage, readIOSJournal } from "./storage";
import {
	buildAudioAlignment,
	finalizeIOSRecording,
	nativeTimeDifferenceMs,
	buildIOSFFmpegArguments,
} from "./finalize";
vi.mock("electron", () => ({ app: { getPath: () => "/private/tmp", isPackaged: false } }));
export const id = "3d594650-3436-4a5a-b6a7-5ff45ecf73d0";
export const format = {
	codedWidth: 1920,
	codedHeight: 1080,
	displayWidth: 1080,
	displayHeight: 1920,
	codec: "h264",
	colorPrimaries: null,
	transferFunction: null,
	ycbcrMatrix: null,
	fullRange: null,
	transform: [0, 1, -1, 0, 1080, 0] as const,
	observedFrameRate: 30,
	fingerprint: "format1",
};
export const result: NativeCaptureResult = {
	sessionId: id,
	stopReason: "user-stop",
	mode: "passthrough",
	format,
	video: {
		relativeName: "source-video.mov",
		mediaKind: "video",
		firstHostTime: { value: "9007199254740993000", timescale: 1000 },
		duration: { value: "5000", timescale: 1000 },
		sampleCount: 10,
		mediaFormat: { codec: "h264", width: 1920, height: 1080 },
	},
	timingFile: "native-timing.json",
};
const roots: string[] = [];
async function fixture() {
	const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "ios-finalize-")));
	roots.push(root);
	const storage = await allocateIOSSessionStorage(root, id);
	await fs.writeFile(path.join(storage.directory, "source-video.mov"), "video-fixture");
	return storage;
}
afterEach(async () => {
	await Promise.all(roots.splice(0).map((p) => fs.rm(p, { recursive: true, force: true })));
});
it("aligns signed offsets and subtracts rational clocks before conversion", () => {
	expect(buildAudioAlignment(250)).toEqual({ trimStartMs: 0, delayMs: 250 });
	expect(buildAudioAlignment(-120)).toEqual({ trimStartMs: 120, delayMs: 0 });
	expect(
		nativeTimeDifferenceMs(
			{ value: "9007199254740993250", timescale: 1000 },
			result.video.firstHostTime,
		),
	).toBe(250);
});
it("commits inspected video without copying it and retry retains the source", async () => {
	const storage = await fixture();
	const inspectMedia = vi.fn(async () => ({
		decodable: true,
		duration: result.video.duration,
		video: format,
	}));
	const runFFmpeg = vi.fn();
	const committed = await finalizeIOSRecording(
		{ storage, nativeResult: result },
		{ inspectMedia, runFFmpeg },
	);
	expect(committed.videoPath).toBe(path.join(storage.directory, "source-video.mov"));
	expect(runFFmpeg).not.toHaveBeenCalled();
	expect((await readIOSJournal(storage)).state).toBe("committed");
	expect(
		await finalizeIOSRecording({ storage, nativeResult: result }, { inspectMedia, runFFmpeg }),
	).toEqual(committed);
});
it("does not commit nondecodable, wrong geometry or zero duration files", async () => {
	const storage = await fixture();
	for (const inspection of [
		{ decodable: false, duration: result.video.duration, video: format },
		{ decodable: true, duration: { value: "0", timescale: 1000 }, video: format },
		{
			decodable: true,
			duration: result.video.duration,
			video: { ...format, displayWidth: 99 },
		},
	]) {
		await expect(
			finalizeIOSRecording(
				{ storage, nativeResult: result },
				{ inspectMedia: async () => inspection },
			),
		).rejects.toThrow();
	}
	expect((await readIOSJournal(storage)).state).not.toBe("committed");
});
it("constructs video copy and one unity soundtrack with silence to video duration, never shortest", () => {
	const args = buildIOSFFmpegArguments({
		videoPath: "/video.mov",
		outputPath: "/pending.mov",
		durationMs: 5000,
		audio: [{ path: "/mic.mov", offsetMs: 250, channels: 1 }],
	});
	expect(args).toContain("copy");
	expect(args).not.toContain("-shortest");
	expect(args.join(" ")).toContain("volume=1");
	expect(args.join(" ")).toContain("adelay=250");
	expect(args).toContain("128k");
	const two = buildIOSFFmpegArguments({
		videoPath: "/v",
		outputPath: "/o",
		durationMs: 5000,
		audio: [
			{ path: "/a", offsetMs: 0, channels: 2 },
			{ path: "/b", offsetMs: -120, channels: 1 },
		],
	});
	expect(two.join(" ")).toContain("normalize=0");
	expect(two.join(" ")).toContain("volume=0.5");
});

async function audioFixture() {
	const storage = await fixture();
	await fs.writeFile(path.join(storage.directory, "microphone.mov"), "audio-fixture");
	const microphone: NativeCaptureResult["microphone"] = {
		relativeName: "microphone.mov",
		mediaKind: "microphone",
		firstHostTime: { value: "9007199254740993250", timescale: 1000 },
		duration: { value: "4750", timescale: 1000 },
		sampleCount: 200,
		mediaFormat: { codec: "aac", sampleRate: 48000, channels: 1 },
	};
	const timing = {
		version: 1 as const,
		timeline: "host-mapped" as const,
		gapsRepresentedInMedia: true as const,
		streams: [
			{
				mediaKind: "microphone" as const,
				firstHostTime: microphone.firstHostTime,
				duration: microphone.duration,
				rate: { numerator: "10001", denominator: "10000" },
				clockAnchor: {
					hostTime: microphone.firstHostTime,
					mediaTime: { value: "0", timescale: 1 },
				},
				gaps: [
					{
						start: { value: "1000", timescale: 1000 },
						duration: { value: "250", timescale: 1000 },
					},
				],
			},
		],
	};
	await fs.writeFile(path.join(storage.directory, "native-timing.json"), JSON.stringify(timing));
	const nativeResult = { ...result, microphone, timing };
	const inspectMedia = async (p: string) =>
		p.endsWith("microphone.mov")
			? {
					decodable: true,
					duration: microphone.duration,
					audio: { codec: "aac", sampleRate: 48000, channels: 1 },
				}
			: {
					decodable: true,
					duration: result.video.duration,
					video: format,
					...(p.endsWith("recording.mov") || p.endsWith("recording.pending.mov")
						? { audio: { codec: "aac", sampleRate: 48000, channels: 1 } }
						: {}),
				};
	const runFFmpeg = vi.fn(async (args: readonly string[]) => {
		await fs.writeFile(args.at(-1)!, "assembled");
	});
	return { storage, nativeResult, inspectMedia, runFFmpeg };
}
it("retries after rename without assembling again and preserves all original sidecars", async () => {
	const f = await audioFixture();
	let fail = true;
	const persistManifest = vi.fn(async () => {
		if (fail) throw new Error("manifest failure");
	});
	await expect(finalizeIOSRecording(f, { ...f, persistManifest })).rejects.toThrow(
		"manifest failure",
	);
	expect((await readIOSJournal(f.storage)).state).toBe("renamed");
	fail = false;
	await finalizeIOSRecording(f, { ...f, persistManifest });
	expect(f.runFFmpeg).toHaveBeenCalledTimes(1);
	expect(await fs.readFile(path.join(f.storage.directory, "source-video.mov"), "utf8")).toBe(
		"video-fixture",
	);
	expect(await fs.readFile(path.join(f.storage.directory, "microphone.mov"), "utf8")).toBe(
		"audio-fixture",
	);
	const filter = f.runFFmpeg.mock.calls[0][0].join(" ");
	expect(filter).not.toContain("atempo");
	expect(filter.match(/adelay=/g)).toHaveLength(1);
});
it("preserves recoverable journal on mux failure and rejects symlink outputs", async () => {
	const f = await audioFixture();
	await expect(
		finalizeIOSRecording(f, {
			...f,
			runFFmpeg: async () => {
				throw new Error("mux failed");
			},
		}),
	).rejects.toThrow("mux failed");
	expect((await readIOSJournal(f.storage)).nativeResult).toEqual(f.nativeResult);
	await fs.symlink(
		path.join(f.storage.directory, "source-video.mov"),
		path.join(f.storage.directory, "recording.mov"),
	);
	await expect(finalizeIOSRecording(f, f)).rejects.toThrow("UNSAFE_ARTIFACT");
});
it("preflights duplicate-video capacity before audio assembly", async () => {
	const f = await audioFixture();
	await expect(finalizeIOSRecording(f, { ...f, availableBytes: async () => 10 })).rejects.toThrow(
		"DISK_SPACE_LOW",
	);
	expect(f.runFFmpeg).not.toHaveBeenCalled();
});
it("can finish a validated renamed movie when optional native audio or timing is missing", async () => {
	const f = await audioFixture();
	await expect(
		finalizeIOSRecording(f, {
			...f,
			persistManifest: async () => {
				throw new Error("crash");
			},
		}),
	).rejects.toThrow();
	await fs.rm(path.join(f.storage.directory, "microphone.mov"));
	await fs.rm(path.join(f.storage.directory, "native-timing.json"));
	const committed = await finalizeIOSRecording(f, f);
	expect(committed.captureMetadata.narrationRecorded).toBe(true);
	expect(f.runFFmpeg).toHaveBeenCalledTimes(1);
});
it.skipIf(
	!existsSync(
		path.resolve(
			"node_modules/ffmpeg-static",
			process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
		),
	),
)(
	"runs bundled FFmpeg video-copy assembly and preserves delayed mono audio and full video duration",
	async () => {
		const { execFileSync } = await import("node:child_process");
		const { runIOSFFmpeg } = await import("./finalize");
		const binary = path.resolve(
			"node_modules/ffmpeg-static",
			process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
		);
		const storage = await fixture();
		const videoPath = path.join(storage.directory, "fixture.mov");
		const audioPath = path.join(storage.directory, "fixture-audio.mov");
		const outputPath = path.join(storage.directory, "fixture-output.mov");
		execFileSync(binary, [
			"-hide_banner",
			"-loglevel",
			"error",
			"-f",
			"lavfi",
			"-i",
			"color=c=red:s=64x96:r=10:d=2",
			"-an",
			"-c:v",
			"libx264",
			videoPath,
		]);
		execFileSync(binary, [
			"-hide_banner",
			"-loglevel",
			"error",
			"-f",
			"lavfi",
			"-i",
			"sine=frequency=440:sample_rate=48000:duration=0.5",
			"-c:a",
			"pcm_s16le",
			audioPath,
		]);
		await runIOSFFmpeg(
			buildIOSFFmpegArguments({
				videoPath,
				outputPath,
				durationMs: 2000,
				audio: [{ path: audioPath, offsetMs: 250, channels: 1 }],
			}),
		);
		const samples = execFileSync(binary, [
			"-hide_banner",
			"-loglevel",
			"error",
			"-i",
			outputPath,
			"-map",
			"0:a:0",
			"-f",
			"s16le",
			"-ac",
			"1",
			"-ar",
			"48000",
			"pipe:1",
		]);
		function energy(start: number, end: number) {
			let sum = 0;
			for (let i = Math.round(start * 48000); i < Math.round(end * 48000); i++)
				sum += Math.abs(samples.readInt16LE(i * 2));
			return sum / ((end - start) * 48000);
		}
		expect(samples.length / 2 / 48000).toBeGreaterThanOrEqual(1.99);
		expect(energy(0, 0.2)).toBeLessThan(1);
		expect(energy(0.3, 0.6)).toBeGreaterThan(100);
		expect(energy(1, 1.8)).toBeLessThan(1);
		const sourcePackets = execFileSync(
			binary,
			[
				"-hide_banner",
				"-loglevel",
				"error",
				"-i",
				videoPath,
				"-map",
				"0:v:0",
				"-c:v",
				"copy",
				"-f",
				"hash",
				"-hash",
				"sha256",
				"pipe:1",
			],
			{ encoding: "utf8" },
		);
		const finalPackets = execFileSync(
			binary,
			[
				"-hide_banner",
				"-loglevel",
				"error",
				"-i",
				outputPath,
				"-map",
				"0:v:0",
				"-c:v",
				"copy",
				"-f",
				"hash",
				"-hash",
				"sha256",
				"pipe:1",
			],
			{ encoding: "utf8" },
		);
		expect(finalPackets).toBe(sourcePackets);
	},
	20000,
);
it("uses advancing progress rather than a total deadline and kills a stalled process", async () => {
	const { runIOSFFmpeg } = await import("./finalize");
	await runIOSFFmpeg(
		[
			"-e",
			"let n=0;const timer=setInterval(()=>{process.stdout.write(`out_time_us=${++n}\n`);if(n===30){clearInterval(timer);}},30)",
		],
		{ binary: process.execPath, stallTimeoutMs: 500 },
	);
	await expect(
		runIOSFFmpeg(["-e", 'setInterval(()=>process.stdout.write("out_time_us=1\\n"),10)'], {
			binary: process.execPath,
			stallTimeoutMs: 500,
		}),
	).rejects.toThrow("FFMPEG_STALLED");
}, 5000);
it.skipIf(process.platform === "win32")(
	"aborts finalization, escalates an ignored SIGTERM, preserves partial output and removes its listener",
	async () => {
		const { runIOSFFmpeg } = await import("./finalize");
		const storage = await fixture();
		const partial = path.join(storage.directory, "recording.pending.mov");
		const ready = path.join(storage.directory, "abort-ready.json");
		const terminated = path.join(storage.directory, "terminated.txt");
		const controller = new AbortController();
		const removeListener = vi.spyOn(controller.signal, "removeEventListener");
		const script = `const fs=require('node:fs');process.on('SIGTERM',()=>fs.writeFileSync(${JSON.stringify(terminated)},'term'));fs.writeFileSync(${JSON.stringify(partial)},'partial media');fs.writeFileSync(${JSON.stringify(ready)},JSON.stringify({pid:process.pid}));let n=0;setInterval(()=>{process.stdout.write('out_time_us='+ ++n+'\\n');process.stderr.write('drained diagnostics\\n');},20);setTimeout(()=>process.exit(0),6500);`;
		const running = runIOSFFmpeg(["-e", script], {
			binary: process.execPath,
			signal: controller.signal,
		});
		const rejection = expect(running).rejects.toThrow("FFMPEG_ABORTED");
		await vi.waitFor(() => expect(existsSync(ready)).toBe(true));
		const { pid } = JSON.parse(await fs.readFile(ready, "utf8"));
		controller.abort();
		await rejection;
		expect(await fs.readFile(terminated, "utf8")).toBe("term");
		expect(await fs.readFile(partial, "utf8")).toBe("partial media");
		expect(() => process.kill(pid, 0)).toThrow();
		expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
	},
	10000,
);
it("rejects an already-aborted signal before resolving or spawning an executable", async () => {
	const { runIOSFFmpeg } = await import("./finalize");
	const controller = new AbortController();
	controller.abort();
	await expect(
		runIOSFFmpeg([], { binary: "/nonexistent-ffmpeg", signal: controller.signal }),
	).rejects.toThrow("FFMPEG_ABORTED");
});
