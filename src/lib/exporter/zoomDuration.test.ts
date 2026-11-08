import { describe, expect, it } from "vitest";
import { CURSOR_MOTION_PRESETS } from "@/components/video-editor/cursorMotionPresets";
import type { ZoomRegion } from "@/components/video-editor/types";
import { computeCameraTransform } from "@/components/video-editor/videoPlayback/cameraTransform";
import { createCursorFollowCameraState } from "@/components/video-editor/videoPlayback/cursorFollowCamera";
import { computePaddedLayout } from "@/components/video-editor/videoPlayback/layoutUtils";
import { createSpringState } from "@/components/video-editor/videoPlayback/motionSmoothing";
import { resolveSceneZoomTarget } from "@/components/video-editor/videoPlayback/sceneMotion";
import {
	getZoomTransitionDurationMs,
	sampleZoomTransition,
} from "@/components/video-editor/videoPlayback/zoomTransition";
import { updateAnimationState as updateLegacyAnimationState } from "./legacyFrameLayout";
import { FrameMotion } from "./modernFrameMotion";
import { createAnimationState } from "./modernFrameUtils";
import type { VideoExporterConfig } from "./modernVideoExporterConfig";
import { getNativeStaticLayoutZoomTelemetry } from "./nativeStaticLayoutOverlays";

type Transform = { scale: number; x: number; y: number };

const stageSize = { width: 1000, height: 600 };
const sourceCrop = { x: 0, y: 0, width: 1, height: 1 };
const baseMask = { x: 0, y: 0, ...stageSize, sourceCrop };
const layoutCache = {
	stageSize,
	videoSize: stageSize,
	baseScale: 1,
	baseOffset: { x: 0, y: 0 },
	maskRect: baseMask,
};
const layout = computePaddedLayout({
	...stageSize,
	padding: 0,
	cropRegion: sourceCrop,
	videoWidth: stageSize.width,
	videoHeight: stageSize.height,
});
const region: ZoomRegion = {
	id: "duration",
	startMs: 1000,
	endMs: 4000,
	depth: 3,
	focus: { cx: 0.6, cy: 0.4 },
	mode: "manual",
};

function createConfig(frameRate: number): VideoExporterConfig {
	return {
		...stageSize,
		frameRate,
		bitrate: 1_000_000,
		videoUrl: "file:///zoom-duration-test.mp4",
		wallpaper: "#000000",
		zoomRegions: [{ ...region, focus: { ...region.focus } }],
		zoomInDurationMs: 200,
		zoomOutDurationMs: 300,
		zoomSmoothness: 0.5,
		zoomClassicMode: false,
		showShadow: false,
		shadowIntensity: 0,
		backgroundBlur: 0,
		cropRegion: sourceCrop,
	};
}

function createSequentialRenderers(config: VideoExporterConfig) {
	const renderConfig = {
		...config,
		videoWidth: stageSize.width,
		videoHeight: stageSize.height,
	};
	// These motion evaluators need geometry and camera presence, not a GPU scene.
	const modern = new FrameMotion({
		scene: { cameraContainer: {} },
		geometry: { layoutCache },
		config: renderConfig,
	} as unknown as ConstructorParameters<typeof FrameMotion>[0]);
	const legacy = {
		cameraContainer: {},
		layoutCache,
		config: renderConfig,
		cursorFollowCamera: createCursorFollowCameraState(),
		animationState: createAnimationState(),
		lastContentTimeMs: null as number | null,
		springScale: createSpringState(1),
		springX: createSpringState(0),
		springY: createSpringState(0),
	};
	const previewCamera = createCursorFollowCameraState();
	const previewSpringScale = createSpringState(1);
	const previewSpringX = createSpringState(0);
	const previewSpringY = createSpringState(0);
	let previousPreviewTimeMs: number | null = null;

	return {
		preview(timeMs: number): Transform {
			const target = resolveSceneZoomTarget({
				...config,
				timeMs,
				cursorFollowCamera: previewCamera,
			});
			const deltaMs =
				previousPreviewTimeMs === null
					? 1000 / config.frameRate
					: timeMs - previousPreviewTimeMs;
			previousPreviewTimeMs = timeMs;
			return computeCameraTransform({
				target,
				stageSize,
				baseMask,
				springScale: previewSpringScale,
				springX: previewSpringX,
				springY: previewSpringY,
				deltaMs,
				zoomSmoothness: config.zoomSmoothness,
			});
		},
		modern(timeMs: number): Transform {
			modern.updateAnimationState(timeMs);
			const { appliedScale: scale, x, y } = modern.animationState;
			return { scale, x, y };
		},
		legacy(timeMs: number): Transform {
			updateLegacyAnimationState(
				legacy as unknown as Parameters<typeof updateLegacyAnimationState>[0],
				timeMs,
			);
			const { appliedScale: scale, x, y } = legacy.animationState;
			return { scale, x, y };
		},
	};
}

function expectedStrength(timeMs: number) {
	if (timeMs <= 1000 || timeMs >= 4000) return 0;
	const entry = getZoomTransitionDurationMs(200);
	const exit = getZoomTransitionDurationMs(300);
	if (timeMs < 1000 + entry) return sampleZoomTransition((timeMs - 1000) / entry, 200);
	if (timeMs <= 4000 - exit) return 1;
	return 1 - sampleZoomTransition((timeMs - (4000 - exit)) / exit, 300);
}

function expectEnvelope(transform: Transform, timeMs: number, renderer: string) {
	const strength = expectedStrength(timeMs);
	const message = `${renderer} at ${timeMs} ms`;
	expect(transform.scale, message).toBeCloseTo(1 + 0.8 * strength, 10);
	expect(transform.x, message).toBeCloseTo(-580 * strength, 8);
	expect(transform.y, message).toBeCloseTo(-132 * strength, 8);
	if (timeMs <= 1000 || timeMs >= 4000) {
		expect(transform, message).toEqual({ scale: 1, x: 0, y: 0 });
	}
}

describe("zoom duration across rendering paths", () => {
	it.each([
		false,
		true,
	])("matches weighted Cinematic motion in every renderer (connected: %s)", (connected) => {
		const config = createConfig(60);
		config.zoomInDurationMs = CURSOR_MOTION_PRESETS.smooth.zoomInDurationMs;
		config.zoomOutDurationMs = CURSOR_MOTION_PRESETS.smooth.zoomOutDurationMs;
		config.connectZooms = connected;
		config.zoomRegions = connected
			? [
					{ ...region, startMs: 0, endMs: 3000 },
					{
						...region,
						id: "next",
						startMs: 3500,
						endMs: 6000,
						depth: 4,
						focus: { cx: 0.35, cy: 0.55 },
					},
				]
			: [{ ...region, endMs: 6000 }];
		const renderers = createSequentialRenderers(config);
		const native = getNativeStaticLayoutZoomTelemetry(config, layout, 380)!;
		expect(native).not.toBeNull();
		for (const sample of native) {
			for (const [name, frame] of Object.entries(renderers)) {
				const pose = frame(sample.timeMs);
				for (const key of ["scale", "x", "y"] as const)
					expect(pose[key], `${name} ${key} at ${sample.timeMs}`).toBeCloseTo(
						sample[key],
						8,
					);
				if (sample.timeMs >= 6000) expect(pose).toEqual({ scale: 1, x: 0, y: 0 });
			}
		}
	});

	it.each([
		24, 30, 60,
	])("presents the short second 1.8x block and completes its exit at %i fps", (frameRate) => {
		const config = createConfig(frameRate);
		config.connectZooms = true;
		config.zoomOutDurationMs = 200 / 0.7;
		config.zoomRegions = [
			{ ...region, id: "first", startMs: 789, endMs: 7189 },
			{ ...region, id: "second", startMs: 7884, endMs: 8884 },
		];
		const renderers = createSequentialRenderers(config);
		const native = getNativeStaticLayoutZoomTelemetry(
			config,
			layout,
			Math.ceil(9.1 * frameRate),
		)!;
		let arrivalScale = 0;
		let tailFrames = 0;
		for (const sample of native) {
			const poses = {
				native: sample,
				...Object.fromEntries(
					Object.entries(renderers).map(([name, frame]) => [name, frame(sample.timeMs)]),
				),
			};
			for (const [name, pose] of Object.entries(poses)) {
				expect(pose.scale, name).toBeCloseTo(sample.scale, 8);
				if (sample.timeMs >= 7884 && sample.timeMs < 7934)
					arrivalScale = Math.max(arrivalScale, pose.scale);
				if (sample.timeMs > 8884 && sample.timeMs < 8988) {
					expect(pose.scale, name).toBeGreaterThan(1);
					tailFrames += 1;
				}
				if (sample.timeMs >= 9000) expect(pose.scale, name).toBe(1);
			}
		}
		expect(arrivalScale).toBeGreaterThan(1.79);
		expect(tailFrames).toBeGreaterThan(0);
	});

	it.each([
		24, 30, 60,
	])("seeds every renderer at the correct cursor on the first faint zoom frame at %i fps", (frameRate) => {
		const config = createConfig(frameRate);
		config.zoomRegions[0] = {
			...config.zoomRegions[0],
			startMs: 999,
			mode: "auto",
			focus: { cx: 0.5, cy: 0.5 },
		};
		config.cursorTelemetry = [{ timeMs: 0, cx: 0.9, cy: 0.1 }];
		const renderers = createSequentialRenderers(config);
		const native = getNativeStaticLayoutZoomTelemetry(config, layout, frameRate + 1)!;
		let firstPositive = false;
		for (const sample of native) {
			const poses = {
				native: sample,
				...Object.fromEntries(
					Object.entries(renderers).map(([name, frame]) => [name, frame(sample.timeMs)]),
				),
			};
			if (sample.timeMs < 999) continue;
			firstPositive = true;
			for (const [name, pose] of Object.entries(poses)) {
				const progress = (pose.scale - 1) / 0.8;
				expect(progress, name).toBeGreaterThan(0);
				expect(progress, name).toBeLessThan(0.01);
				expect(pose.x / progress, name).toBeCloseTo(-800, 5);
				expect(pose.y / progress, name).toBeCloseTo(0, 5);
			}
		}
		expect(firstPositive).toBe(true);
	});

	it("starts pans in the gap and carries settling motion through the incoming block", () => {
		const config = createConfig(60);
		config.connectZooms = true;
		config.zoomRegions = [
			region,
			{ ...region, id: "next", startMs: 5000, endMs: 8000, focus: { cx: 0.35, cy: 0.6 } },
		];
		const renderers = createSequentialRenderers(config);
		const native = getNativeStaticLayoutZoomTelemetry(config, layout, 511)!;
		const history: Record<string, Array<Transform & { timeMs: number }>> = {};
		for (const sample of native) {
			const { timeMs, scale, x, y } = sample;
			const transforms = {
				native: { scale, x, y },
				...Object.fromEntries(
					Object.entries(renderers).map(([name, frame]) => [name, frame(timeMs)]),
				),
			};
			for (const [name, transform] of Object.entries(transforms)) {
				const message = `${name} at ${timeMs}`;
				expect(transform.scale, message).toBeCloseTo(scale, 9);
				expect(transform.x, message).toBeCloseTo(x, 9);
				expect(transform.y, message).toBeCloseTo(y, 9);
				history[name] ??= [];
				history[name].push({ ...transform, timeMs });
				if (timeMs >= 2200 && timeMs <= 4000 + 1e-6) {
					expect(transform.scale, message).toBe(1.8);
					expect(transform.x, message).toBeCloseTo(-580, 7);
					expect(transform.y, message).toBeCloseTo(-132, 7);
				}
			}
		}
		for (const [name, frames] of Object.entries(history)) {
			const at = (timeMs: number) => frames.find((f) => Math.abs(f.timeMs - timeMs) < 1)!;
			expect(at(4500).x, name).toBeGreaterThan(-580);
			expect(at(4500).x, name).toBeLessThan(-130);
			// The target reaches the block first; the camera still has momentum.
			const boundary = at(5000);
			expect(boundary.x, name).toBeLessThan(-130.5);
			expect(at(5050).x, name).toBeGreaterThan(boundary.x);
			expect(at(5200).x, name).toBeGreaterThan(at(5050).x);
			expect(at(6000).x, name).toBeCloseTo(-130, 7);
			expect(at(6000).y, name).toBeCloseTo(-348, 7);
			const boundaryIndex = frames.indexOf(boundary);
			const beforeStep = boundary.x - frames[boundaryIndex - 1].x;
			const afterStep = frames[boundaryIndex + 1].x - boundary.x;
			expect(beforeStep, name).toBeGreaterThan(0);
			expect(afterStep, name).toBeGreaterThan(0);
			expect(afterStep / beforeStep, name).toBeGreaterThan(0.65);
			expect(afterStep / beforeStep, name).toBeLessThan(1.15);
		}
	});

	it.each([
		false,
		true,
	])("keeps rendering paths continuous and covered during a depth change (reverse=%s)", (reverse) => {
		const config = createConfig(60);
		config.connectZooms = true;
		config.connectedZoomDurationMs = 1000;
		config.zoomRegions = [
			{
				...region,
				id: "deep",
				startMs: 0,
				endMs: 3000,
				depth: 6,
				focus: { cx: 0.9, cy: 0.5 },
			},
			{
				...region,
				id: "wide",
				startMs: 3500,
				endMs: 6000,
				depth: 2,
				focus: { cx: 2 / 3, cy: 0.5 },
			},
		];
		if (reverse) {
			const first = config.zoomRegions[0];
			const second = config.zoomRegions[1];
			[first.depth, second.depth] = [second.depth, first.depth];
			[first.focus, second.focus] = [second.focus, first.focus];
		}
		const renderers = createSequentialRenderers(config);
		const native = getNativeStaticLayoutZoomTelemetry(config, layout, 361)!;
		for (const sample of native) {
			const { timeMs, scale, x, y } = sample;
			const transforms = {
				native: { scale, x, y },
				...Object.fromEntries(
					Object.entries(renderers).map(([name, sampleFrame]) => [
						name,
						sampleFrame(timeMs),
					]),
				),
			};
			for (const [name, transform] of Object.entries(transforms)) {
				const message = `${name} at ${timeMs} ms`;
				expect(transform.scale, message).toBeCloseTo(scale, 9);
				expect(transform.x, message).toBeCloseTo(x, 9);
				expect(transform.y, message).toBeCloseTo(y, 9);
				expect(transform.x, message).toBeLessThanOrEqual(1e-8);
				expect(transform.y, message).toBeLessThanOrEqual(1e-8);
				expect(
					transform.x + stageSize.width * transform.scale,
					message,
				).toBeGreaterThanOrEqual(stageSize.width - 1e-8);
				expect(
					transform.y + stageSize.height * transform.scale,
					message,
				).toBeGreaterThanOrEqual(stageSize.height - 1e-8);
			}
		}
	});

	it.each([24, 30, 60])("uses the same exact envelope at %i fps", (frameRate) => {
		const config = createConfig(frameRate);
		const renderers = createSequentialRenderers(config);
		const totalFrames = Math.floor(frameRate * 4.5) + 1;
		const native = getNativeStaticLayoutZoomTelemetry(config, layout, totalFrames)!;
		expect(native).toHaveLength(totalFrames);

		for (const sample of native) {
			const { timeMs, scale, x, y } = sample;
			expectEnvelope({ scale, x, y }, timeMs, "native");
			for (const [renderer, sampleFrame] of Object.entries(renderers)) {
				expectEnvelope(sampleFrame(timeMs), timeMs, renderer);
			}
		}
	});

	it.each([24, 30, 60])("honors boundaries between decoded frames at %i fps", (frameRate) => {
		const renderers = createSequentialRenderers(createConfig(frameRate));
		const times = new Set([
			0,
			999,
			1000,
			1100,
			1000 + getZoomTransitionDurationMs(200),
			4000 - getZoomTransitionDurationMs(300),
			3700,
			3850,
			3999,
			4000,
			4500,
		]);
		for (let frame = 0; frame <= frameRate * 4.5; frame += 1) {
			times.add((frame * 1000) / frameRate);
		}
		for (const timeMs of [...times].sort((left, right) => left - right)) {
			for (const [renderer, sampleFrame] of Object.entries(renderers)) {
				expectEnvelope(sampleFrame(timeMs), timeMs, renderer);
			}
		}
	});

	it.each([24, 30, 60])("stops a pending camera pan at the block end at %i fps", (frameRate) => {
		const config = createConfig(frameRate);
		config.zoomRegions[0].mode = "auto";
		config.zoomRegions[0].focus = { cx: 0.3, cy: 0.5 };
		config.cursorTelemetry = [
			{ timeMs: 0, cx: 0.3, cy: 0.5 },
			{ timeMs: 2400, cx: 0.3, cy: 0.5 },
			{ timeMs: 2600, cx: 0.7, cy: 0.5 },
			{ timeMs: 4500, cx: 0.7, cy: 0.5 },
		];
		const renderers = createSequentialRenderers(config);
		const native = getNativeStaticLayoutZoomTelemetry(config, layout, frameRate * 4.5 + 1)!;
		const latest = new Map<string, Transform>();
		const pendingPan = new Set<string>();
		for (const sample of native) {
			const { timeMs, scale, x, y } = sample;
			const transforms = {
				native: { scale, x, y },
				...Object.fromEntries(
					Object.entries(renderers).map(([name, sampleFrame]) => [
						name,
						sampleFrame(timeMs),
					]),
				),
			};
			for (const [name, transform] of Object.entries(transforms)) {
				if (Math.abs(timeMs - 2500) < 1e-6) {
					// All three frame rates sample this moment during the fast cursor move.
					// The automatic target has reached at least cx=0.5 (x=-400), while
					// the visible pan has started but still trails that target.
					expect(transform.scale, name).toBe(1.8);
					expect(transform.x, name).toBeLessThan(-40);
					expect(transform.x, name).toBeGreaterThan(-399);
					pendingPan.add(name);
				}
				if (timeMs >= 4000) {
					expect(transform, `${name} at ${timeMs} ms`).toEqual({ scale: 1, x: 0, y: 0 });
				} else if (timeMs > 3600) {
					latest.set(name, transform);
				}
			}
		}
		expect(pendingPan.size).toBe(4);
		for (const transform of latest.values()) {
			expect(transform.scale).toBeGreaterThan(1);
			expect(transform.x).toBeLessThan(0);
		}
	});
});
