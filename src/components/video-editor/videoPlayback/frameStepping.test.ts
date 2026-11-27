import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { ALL_FORMATS, BufferSource, EncodedPacketSink, Input } from "mediabunny";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_SHORTCUTS } from "@/lib/shortcuts";
import { useEditorGlobalInteractions } from "../hooks/useEditorGlobalInteractions";
import { useEditorPlaybackControls } from "../hooks/useEditorPlaybackControls";
import type { ClipRegion } from "../types";
import {
	loadVideoFrameTimeline,
	normalizePresentationTimestamps,
	resolveAdjacentFrameTimelineTime,
} from "./frameStepping";

vi.mock("react", () => ({
	useCallback: (callback: unknown) => callback,
	useEffect: (effect: () => void) => effect(),
	useRef: (current: unknown) => ({ current }),
}));

class MockElement {
	isContentEditable = false;
	closest() {
		return null;
	}
}
class MockInput extends MockElement {}
class MockTextarea extends MockElement {}
class MockSelect extends MockElement {}

const require = createRequire(import.meta.url);
const ffmpegPath = require("ffmpeg-static") as string;

interface DecodedVideoFrame {
	ptsSeconds: number;
	rgb: [number, number, number];
}

function runFfmpeg(args: string[], encoding: "utf8" | null = "utf8") {
	const result = spawnSync(ffmpegPath, args, {
		encoding: encoding ?? undefined,
		maxBuffer: 16 * 1024 * 1024,
	});
	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		const stderrText = Buffer.isBuffer(result.stderr)
			? result.stderr.toString("utf8")
			: (result.stderr ?? "");
		throw new Error(`ffmpeg failed (${result.status}): ${stderrText}`);
	}
	return result;
}

function decodeVideoFramesWithFfmpeg(
	filePath: string,
	width = 32,
	height = 32,
): DecodedVideoFrame[] {
	const result = runFfmpeg(
		[
			"-v",
			"info",
			"-i",
			filePath,
			"-fps_mode",
			"passthrough",
			"-vf",
			"showinfo",
			"-pix_fmt",
			"rgb24",
			"-f",
			"rawvideo",
			"-",
		],
		null,
	);
	const stderr = (result.stderr as Buffer).toString("utf8");
	const stdout = result.stdout as Buffer;
	const tbMatch = stderr.match(/config in time_base:\s*(\d+)\/(\d+)/);
	const timeBaseSeconds = tbMatch ? Number(tbMatch[1]) / Number(tbMatch[2]) : 1;
	const ptsMatches = [...stderr.matchAll(/\bn:\s*\d+\s+pts:\s*(-?\d+)/g)];
	const frameBytes = width * height * 3;
	expect(stdout.length).toBe(ptsMatches.length * frameBytes);

	return ptsMatches.map((match, index) => {
		const offset = index * frameBytes;
		return {
			ptsSeconds: Number(match[1]) * timeBaseSeconds,
			rgb: [stdout[offset], stdout[offset + 1], stdout[offset + 2]],
		};
	});
}

function displayedFrameAtTime(
	frames: readonly DecodedVideoFrame[],
	timeSeconds: number,
): DecodedVideoFrame {
	let active = frames[0];
	for (const frame of frames) {
		if (frame.ptsSeconds <= timeSeconds + 1e-5) {
			active = frame;
		} else {
			break;
		}
	}
	return active;
}

function setupKeyboardSteppingHarness({
	initialTimeSeconds,
	durationSeconds,
	presentationTimestamps,
	frameRate = null,
	clipRegions = [],
}: {
	initialTimeSeconds: number;
	durationSeconds: number;
	presentationTimestamps: ArrayLike<number> | null;
	frameRate?: number | null;
	clipRegions?: readonly ClipRegion[];
}) {
	vi.stubGlobal("HTMLInputElement", MockInput);
	vi.stubGlobal("HTMLTextAreaElement", MockTextarea);
	vi.stubGlobal("HTMLSelectElement", MockSelect);

	const handlers = new Map<string, (event: KeyboardEvent) => void>();
	vi.stubGlobal("window", {
		addEventListener: (name: string, handler: (event: KeyboardEvent) => void) =>
			handlers.set(name, handler),
		removeEventListener: vi.fn(),
	});

	let seekedTime = initialTimeSeconds;
	const playback = {
		video: {},
		isPlaying: false,
		pause: vi.fn(() => {
			playback.isPlaying = false;
		}),
		play: vi.fn().mockResolvedValue(undefined),
		seekTimeline: vi.fn((time: number) => {
			seekedTime = time;
		}),
	};

	const controls = useEditorPlaybackControls({
		videoPlaybackRef: { current: playback } as unknown as Parameters<
			typeof useEditorPlaybackControls
		>[0]["videoPlaybackRef"],
		timelineRef: { current: { keyframes: [] } } as unknown as Parameters<
			typeof useEditorPlaybackControls
		>[0]["timelineRef"],
		playSourceAudioPreview: vi.fn(),
		clipRegions,
		zoomRegions: [],
		timelinePlayheadTime: initialTimeSeconds,
		timelineDuration: durationSeconds,
		sourceFrameTimestamps: presentationTimestamps,
		sourceFrameRate: frameRate,
	});

	useEditorGlobalInteractions({
		timeline: {},
		videoPlaybackRef: { current: playback },
		shortcuts: DEFAULT_SHORTCUTS,
		isMac: true,
		handleUndo: vi.fn(),
		handleRedo: vi.fn(),
		startPlayback: controls.startPlayback,
		stepFrameBackward: controls.stepFrameBackward,
		stepFrameForward: controls.stepFrameForward,
		stepTimeSeconds: controls.stepTimeSeconds,
		handlePreviewSkip: controls.handlePreviewSkip,
	} as unknown as Parameters<typeof useEditorGlobalInteractions>[0]);

	const pressKey = (key: string) => {
		const event = {
			key,
			code: key,
			target: new MockElement(),
			metaKey: false,
			ctrlKey: false,
			shiftKey: false,
			altKey: false,
			repeat: false,
			preventDefault: vi.fn(),
			stopImmediatePropagation: vi.fn(),
		};
		handlers.get("keydown")!(event as unknown as KeyboardEvent);
		return seekedTime;
	};

	return {
		pressKey,
		playback,
		getCurrentTime: () => seekedTime,
	};
}

describe("frameStepping with real decoded presentation timestamps", () => {
	let tempDir = "";
	let sparseWgcMp4Path = "";
	let normal30FpsMp4Path = "";

	const sparseWgcTimestamps = [0, 0.05, 0.225, 1.236117, 1.252783, 2.0];
	const sparseWgcColors = ["#ff0000", "#00ff00", "#0000ff", "#ffff00", "#00ffff", "#ff00ff"];

	const normal30FpsColors = [
		"#ff0000",
		"#00ff00",
		"#0000ff",
		"#ffff00",
		"#00ffff",
		"#ff00ff",
		"#ffffff",
		"#ff8000",
		"#8000ff",
		"#0080ff",
		"#80ff00",
		"#ff0080",
	];

	beforeAll(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-frame-stepping-"));
		sparseWgcMp4Path = path.join(tempDir, "sparse-wgc.mp4");
		normal30FpsMp4Path = path.join(tempDir, "normal-30fps.mp4");

		const wgcInputs = sparseWgcColors.map(
			(color, index) => `color=c=${color}:s=32x32:r=1000:d=0.05,trim=end_frame=1[c${index}]`,
		);
		const wgcSetPts = sparseWgcTimestamps.reduceRight(
			(fallback, timestamp, index) =>
				index === sparseWgcTimestamps.length - 1
					? String(timestamp)
					: `if(eq(N,${index}),${timestamp.toFixed(6)},${fallback})`,
			"0",
		);
		runFfmpeg([
			"-v",
			"error",
			"-y",
			"-filter_complex",
			`${wgcInputs.join(";")};${sparseWgcColors.map((_, i) => `[c${i}]`).join("")}concat=n=${sparseWgcColors.length}:v=1:a=0,settb=expr=1/1000000,setpts='round((${wgcSetPts})/TB)'[v]`,
			"-map",
			"[v]",
			"-c:v",
			"libx264",
			"-g",
			"1",
			"-pix_fmt",
			"yuv420p",
			"-fps_mode",
			"passthrough",
			"-enc_time_base",
			"1/1000000",
			"-video_track_timescale",
			"1000000",
			"-movflags",
			"+faststart",
			sparseWgcMp4Path,
		]);

		const normalInputs = normal30FpsColors.map(
			(color, index) => `color=c=${color}:s=32x32:r=30:d=0.05,trim=end_frame=1[c${index}]`,
		);
		runFfmpeg([
			"-v",
			"error",
			"-y",
			"-filter_complex",
			`${normalInputs.join(";")};${normal30FpsColors.map((_, i) => `[c${i}]`).join("")}concat=n=${normal30FpsColors.length}:v=1:a=0,setpts=N/30/TB[v]`,
			"-map",
			"[v]",
			"-c:v",
			"libx264",
			"-profile:v",
			"high",
			"-bf",
			"2",
			"-x264-params",
			"scenecut=0:b-adapt=0:bframes=2",
			"-g",
			"12",
			"-pix_fmt",
			"yuv420p",
			"-video_track_timescale",
			"30000",
			"-movflags",
			"+faststart",
			normal30FpsMp4Path,
		]);
	}, 30_000);

	afterAll(async () => {
		if (tempDir) {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("steps one keypress per decoded frame on a sparse WGC clip (including 0.225000s -> 1.236117s)", async () => {
		const decodedFrames = decodeVideoFramesWithFfmpeg(sparseWgcMp4Path);
		expect(decodedFrames).toHaveLength(sparseWgcTimestamps.length);
		for (const [index, expectedPts] of sparseWgcTimestamps.entries()) {
			expect(decodedFrames[index].ptsSeconds).toBeCloseTo(expectedPts, 6);
		}

		// Confirm the bug described on PR #1023: +16.7ms from 0.225s stays on the same picture.
		expect(displayedFrameAtTime(decodedFrames, 0.225 + 1 / 60).rgb).toEqual(
			displayedFrameAtTime(decodedFrames, 0.225).rgb,
		);

		const mp4Bytes = new Uint8Array(await fs.readFile(sparseWgcMp4Path));
		const timeline = await loadVideoFrameTimeline(mp4Bytes);
		expect(timeline.presentationTimestamps).toHaveLength(decodedFrames.length);
		for (let i = 0; i < decodedFrames.length; i++) {
			expect(timeline.presentationTimestamps[i]).toBeCloseTo(decodedFrames[i].ptsSeconds, 6);
		}

		// Single ArrowRight from 0.225000s must jump to 1.236117s (new picture), and ArrowLeft back.
		const singleJumpHarness = setupKeyboardSteppingHarness({
			initialTimeSeconds: 0.225,
			durationSeconds: 2.5,
			presentationTimestamps: timeline.presentationTimestamps,
			frameRate: timeline.frameRate,
		});
		const afterRight = singleJumpHarness.pressKey("ArrowRight");
		expect(afterRight).toBeCloseTo(1.236117, 6);
		expect(displayedFrameAtTime(decodedFrames, afterRight).rgb).not.toEqual(
			displayedFrameAtTime(decodedFrames, 0.225).rgb,
		);
		expect(singleJumpHarness.pressKey("ArrowLeft")).toBeCloseTo(0.225, 6);

		// Walk every frame forward (ArrowRight / .) and backward (ArrowLeft / ,) across the sparse WGC clip.
		const fullWalkHarness = setupKeyboardSteppingHarness({
			initialTimeSeconds: 0,
			durationSeconds: 2.5,
			presentationTimestamps: timeline.presentationTimestamps,
			frameRate: timeline.frameRate,
		});
		const visitedForward: number[] = [0];
		for (let i = 1; i < decodedFrames.length; i++) {
			const nextTime = fullWalkHarness.pressKey(i % 2 === 1 ? "ArrowRight" : ".");
			visitedForward.push(nextTime);
			expect(displayedFrameAtTime(decodedFrames, nextTime).rgb).not.toEqual(
				displayedFrameAtTime(decodedFrames, visitedForward[i - 1]).rgb,
			);
		}
		expect(visitedForward).toHaveLength(decodedFrames.length);
		for (let i = 0; i < decodedFrames.length; i++) {
			expect(visitedForward[i]).toBeCloseTo(decodedFrames[i].ptsSeconds, 6);
		}
		// Pressing forward on the final frame holds the final frame instead of drifting into hold time.
		expect(fullWalkHarness.pressKey("ArrowRight")).toBeCloseTo(2.0, 6);

		const visitedBackward: number[] = [];
		for (let i = decodedFrames.length - 2; i >= 0; i--) {
			const prevTime = fullWalkHarness.pressKey(i % 2 === 0 ? "ArrowLeft" : ",");
			visitedBackward.push(prevTime);
			expect(prevTime).toBeCloseTo(decodedFrames[i].ptsSeconds, 6);
		}
		expect(visitedBackward).toHaveLength(decodedFrames.length - 1);
		expect(fullWalkHarness.pressKey("ArrowLeft")).toBe(0);
	});

	it("steps one keypress per decoded presentation timestamp on a 30 fps B-frame clip", async () => {
		const decodedFrames = decodeVideoFramesWithFfmpeg(normal30FpsMp4Path);
		expect(decodedFrames).toHaveLength(normal30FpsColors.length);
		for (let i = 0; i < decodedFrames.length; i++) {
			expect(decodedFrames[i].ptsSeconds).toBeCloseTo(i / 30, 6);
		}

		// Verify the encoded container packets actually have out-of-order B-frame decode timestamps.
		const mp4Bytes = new Uint8Array(await fs.readFile(normal30FpsMp4Path));
		const inspectInput = new Input({
			source: new BufferSource(mp4Bytes),
			formats: ALL_FORMATS,
		});
		const track = await inspectInput.getPrimaryVideoTrack();
		expect(track).not.toBeNull();
		const decodeOrderPts: number[] = [];
		const sink = new EncodedPacketSink(track!);
		for await (const packet of sink.packets(undefined, undefined, { metadataOnly: true })) {
			decodeOrderPts.push(packet.timestamp);
		}
		inspectInput.dispose();
		expect(
			decodeOrderPts.some((ts, index) => index > 0 && ts < decodeOrderPts[index - 1]),
		).toBe(true);

		const timeline = await loadVideoFrameTimeline(mp4Bytes);
		expect(timeline.presentationTimestamps).toHaveLength(decodedFrames.length);
		expect(timeline.frameRate).toBeCloseTo(30, 2);
		for (let i = 0; i < decodedFrames.length; i++) {
			expect(timeline.presentationTimestamps[i]).toBeCloseTo(decodedFrames[i].ptsSeconds, 6);
		}

		const harness = setupKeyboardSteppingHarness({
			initialTimeSeconds: 0,
			durationSeconds: decodedFrames.length / 30,
			presentationTimestamps: timeline.presentationTimestamps,
			frameRate: timeline.frameRate,
		});

		let previousRgb = displayedFrameAtTime(decodedFrames, 0).rgb;
		for (let i = 1; i < decodedFrames.length; i++) {
			const nextTime = harness.pressKey(i % 2 === 1 ? "ArrowRight" : ".");
			expect(nextTime).toBeCloseTo(decodedFrames[i].ptsSeconds, 6);
			const nextRgb = displayedFrameAtTime(decodedFrames, nextTime).rgb;
			expect(nextRgb).not.toEqual(previousRgb);
			previousRgb = nextRgb;
		}

		for (let i = decodedFrames.length - 2; i >= 0; i--) {
			const prevTime = harness.pressKey(i % 2 === 0 ? "ArrowLeft" : ",");
			expect(prevTime).toBeCloseTo(decodedFrames[i].ptsSeconds, 6);
			const prevRgb = displayedFrameAtTime(decodedFrames, prevTime).rgb;
			expect(prevRgb).not.toEqual(previousRgb);
			previousRgb = prevRgb;
		}
	});

	it("falls back to an independently estimated frame rate when indexing exceeds maxIndexedPackets", async () => {
		const decodedFrames = decodeVideoFramesWithFfmpeg(normal30FpsMp4Path);
		const mp4Bytes = new Uint8Array(await fs.readFile(normal30FpsMp4Path));

		const truncatedTimeline = await loadVideoFrameTimeline(mp4Bytes, { maxIndexedPackets: 5 });
		expect(truncatedTimeline.presentationTimestamps).toHaveLength(0);
		expect(truncatedTimeline.frameRate).not.toBeNull();
		expect(truncatedTimeline.frameRate!).toBeCloseTo(30, 1);

		const completeTimeline = await loadVideoFrameTimeline(mp4Bytes, {
			maxIndexedPackets: decodedFrames.length,
		});
		expect(completeTimeline.presentationTimestamps).toHaveLength(decodedFrames.length);
	});
});

describe("normalizePresentationTimestamps & resolveAdjacentFrameTimelineTime", () => {
	it("sorts out-of-order timestamps and deduplicates sub-microsecond entries", () => {
		const normalized = normalizePresentationTimestamps([
			0.1,
			0.0333333,
			0.0333334,
			-0.01,
			Number.NaN,
			0,
			0.066667,
		]);
		expect(Array.from(normalized)).toEqual([0, 0.0333333, 0.066667, 0.1]);
	});

	it("steps to the adjacent visible frame from mid-hold positions", () => {
		const pts = [0, 0.05, 0.225, 1.236117, 1.252783, 2.0];
		expect(
			resolveAdjacentFrameTimelineTime({
				currentTimeSeconds: 0.6,
				direction: "forward",
				timelineDurationSeconds: 2.5,
				sourceFrameTimestampsSeconds: pts,
			}),
		).toBeCloseTo(1.236117, 6);

		// At t=0.6s frame 0.225s is displayed; backward must jump to the previous picture (0.05s).
		expect(
			resolveAdjacentFrameTimelineTime({
				currentTimeSeconds: 0.6,
				direction: "backward",
				timelineDurationSeconds: 2.5,
				sourceFrameTimestampsSeconds: pts,
			}),
		).toBeCloseTo(0.05, 6);
	});

	it("projects presentation timestamps through trimmed, sped-up, and split clips with gaps", () => {
		const pts = [0, 0.2, 0.5, 0.8, 1.2, 1.6, 2.2];
		const clips: ClipRegion[] = [
			// Plays source [0.5s .. 1.5s) at 2x speed on timeline [0.0s .. 0.5s)
			{ id: "clip-1", startMs: 0, endMs: 500, sourceStartMs: 500, speed: 2 },
			// Gap [0.5s .. 1.0s), then plays source [1.5s .. 2.5s) at 1x on timeline [1.0s .. 2.0s)
			{ id: "clip-2", startMs: 1000, endMs: 2000, sourceStartMs: 1500, speed: 1 },
		];

		// Inside clip-1 at t=0 (source 0.5s) -> next frame source 0.8s => timeline (0.8 - 0.5)/2 = 0.15s
		const step1 = resolveAdjacentFrameTimelineTime({
			currentTimeSeconds: 0,
			direction: "forward",
			timelineDurationSeconds: 2.0,
			clipRegions: clips,
			sourceFrameTimestampsSeconds: pts,
		});
		expect(step1).toBeCloseTo(0.15, 6);

		// Next inside clip-1: source 1.2s => timeline (1.2 - 0.5)/2 = 0.35s
		const step2 = resolveAdjacentFrameTimelineTime({
			currentTimeSeconds: step1,
			direction: "forward",
			timelineDurationSeconds: 2.0,
			clipRegions: clips,
			sourceFrameTimestampsSeconds: pts,
		});
		expect(step2).toBeCloseTo(0.35, 6);

		// Next skips remaining hold + gap directly to start of clip-2 (1.0s)
		const step3 = resolveAdjacentFrameTimelineTime({
			currentTimeSeconds: step2,
			direction: "forward",
			timelineDurationSeconds: 2.0,
			clipRegions: clips,
			sourceFrameTimestampsSeconds: pts,
		});
		expect(step3).toBeCloseTo(1.0, 6);

		// Inside clip-2 at 1.0s (source 1.5s, displays frame 1.2s) -> next frame source 1.6s => timeline 1.1s
		const step4 = resolveAdjacentFrameTimelineTime({
			currentTimeSeconds: step3,
			direction: "forward",
			timelineDurationSeconds: 2.0,
			clipRegions: clips,
			sourceFrameTimestampsSeconds: pts,
		});
		expect(step4).toBeCloseTo(1.1, 6);

		// Stepping backward from start of clip-2 (1.0s) lands on last frame of clip-1 (0.35s)
		const backToClip1 = resolveAdjacentFrameTimelineTime({
			currentTimeSeconds: 1.0,
			direction: "backward",
			timelineDurationSeconds: 2.0,
			clipRegions: clips,
			sourceFrameTimestampsSeconds: pts,
		});
		expect(backToClip1).toBeCloseTo(0.35, 6);
	});

	it("excludes a frame at the clip's exclusive source end when stepping backward across adjacent clips", () => {
		const pts = [0, 0.5, 1, 1.5];
		const clips: ClipRegion[] = [
			{ id: "clip-1", startMs: 0, endMs: 1000, sourceStartMs: 0, speed: 1 },
			{ id: "clip-2", startMs: 1000, endMs: 2000, sourceStartMs: 1000, speed: 1 },
		];

		const stepBack1 = resolveAdjacentFrameTimelineTime({
			currentTimeSeconds: 1,
			direction: "backward",
			timelineDurationSeconds: 2,
			clipRegions: clips,
			sourceFrameTimestampsSeconds: pts,
		});
		expect(stepBack1).toBeCloseTo(0.5, 6);

		const stepBack2 = resolveAdjacentFrameTimelineTime({
			currentTimeSeconds: stepBack1,
			direction: "backward",
			timelineDurationSeconds: 2,
			clipRegions: clips,
			sourceFrameTimestampsSeconds: pts,
		});
		expect(stepBack2).toBeCloseTo(0, 6);
	});

	it("applies clip-boundary navigation and skips gaps in fallback frame-rate stepping", () => {
		const clips: ClipRegion[] = [
			{ id: "clip-1", startMs: 0, endMs: 1000, sourceStartMs: 0, speed: 1 },
			{ id: "clip-2", startMs: 3000, endMs: 4000, sourceStartMs: 3000, speed: 1 },
		];

		// Inside active clip: preserve 1/30s delta
		expect(
			resolveAdjacentFrameTimelineTime({
				currentTimeSeconds: 0.5,
				direction: "forward",
				timelineDurationSeconds: 4,
				clipRegions: clips,
				sourceFrameTimestampsSeconds: null,
				fallbackFps: 30,
			}),
		).toBeCloseTo(0.5 + 1 / 30, 6);

		// Crossing end of clip-1 skips gap directly to start of clip-2 (3.0s)
		expect(
			resolveAdjacentFrameTimelineTime({
				currentTimeSeconds: 0.99,
				direction: "forward",
				timelineDurationSeconds: 4,
				clipRegions: clips,
				sourceFrameTimestampsSeconds: null,
				fallbackFps: 30,
			}),
		).toBeCloseTo(3, 6);

		// Stepping forward from inside a gap jumps to start of clip-2 (3.0s)
		expect(
			resolveAdjacentFrameTimelineTime({
				currentTimeSeconds: 2,
				direction: "forward",
				timelineDurationSeconds: 4,
				clipRegions: clips,
				sourceFrameTimestampsSeconds: null,
				fallbackFps: 30,
			}),
		).toBeCloseTo(3, 6);

		// Stepping backward from start of clip-2 (3.0s) skips gap to last frame of clip-1
		expect(
			resolveAdjacentFrameTimelineTime({
				currentTimeSeconds: 3,
				direction: "backward",
				timelineDurationSeconds: 4,
				clipRegions: clips,
				sourceFrameTimestampsSeconds: null,
				fallbackFps: 30,
			}),
		).toBeCloseTo(1 - 1 / 30, 6);

		// Stepping backward near start of clip-2 clamps to clip-2 start instead of entering gap
		expect(
			resolveAdjacentFrameTimelineTime({
				currentTimeSeconds: 3.01,
				direction: "backward",
				timelineDurationSeconds: 4,
				clipRegions: clips,
				sourceFrameTimestampsSeconds: null,
				fallbackFps: 30,
			}),
		).toBeCloseTo(3, 6);

		// Stepping backward from inside a gap jumps to last frame of clip-1
		expect(
			resolveAdjacentFrameTimelineTime({
				currentTimeSeconds: 2,
				direction: "backward",
				timelineDurationSeconds: 4,
				clipRegions: clips,
				sourceFrameTimestampsSeconds: null,
				fallbackFps: 30,
			}),
		).toBeCloseTo(1 - 1 / 30, 6);
	});
});
