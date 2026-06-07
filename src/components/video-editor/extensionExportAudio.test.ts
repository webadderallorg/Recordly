import { describe, expect, it, vi } from "vitest";
import type { ExtensionExportAudioCue } from "@/lib/extensions/extensionHost";
import {
	collectExtensionAudioRegionsForExport,
	extensionAudioCuesToRegions,
	isExportableCursorInteraction,
} from "./extensionExportAudio";
import type { CursorTelemetryPoint } from "./types";

describe("extension export audio", () => {
	it("captures extension sounds for cursor interactions that preview treats as clicks", () => {
		const cues: ExtensionExportAudioCue[] = [];
		let activeTimeMs = 0;
		const host = {
			beginExportAudioCapture: vi.fn(),
			setExportAudioCaptureTime: vi.fn((timeMs: number) => {
				activeTimeMs = timeMs;
			}),
			emitEvent: vi.fn((event: { type: string }) => {
				if (event.type === "cursor:click") {
					cues.push({
						id: `cue-${cues.length}`,
						extensionId: "com.test.clicks",
						timeMs: activeTimeMs,
						audioPath: `file:///sounds/click-${cues.length}.mp3`,
						volume: 0.8,
					});
				}
			}),
			finishExportAudioCapture: vi.fn(() => cues),
			cancelExportAudioCapture: vi.fn(),
		};
		const telemetry: CursorTelemetryPoint[] = [
			{ timeMs: 100, cx: 0.1, cy: 0.2, interactionType: "move" },
			{ timeMs: 250, cx: 0.3, cy: 0.4, interactionType: "click" },
			{ timeMs: 400, cx: 0.5, cy: 0.6, interactionType: "mouseup" },
			{ timeMs: 550, cx: 0.7, cy: 0.8 },
		];

		const regions = collectExtensionAudioRegionsForExport(host, telemetry, 300);

		expect(host.beginExportAudioCapture).toHaveBeenCalledTimes(1);
		expect(host.setExportAudioCaptureTime).toHaveBeenNthCalledWith(1, 250);
		expect(host.setExportAudioCaptureTime).toHaveBeenNthCalledWith(2, 400);
		expect(host.emitEvent).toHaveBeenCalledTimes(2);
		expect(host.emitEvent).toHaveBeenNthCalledWith(1, {
			type: "cursor:click",
			timeMs: 250,
			data: { cx: 0.3, cy: 0.4, interactionType: "click" },
		});
		expect(host.cancelExportAudioCapture).not.toHaveBeenCalled();
		expect(regions).toEqual([
			{
				id: "extension-audio-cue-0",
				startMs: 250,
				endMs: 550,
				audioPath: "file:///sounds/click-0.mp3",
				volume: 0.8,
				normalize: false,
			},
			{
				id: "extension-audio-cue-1",
				startMs: 400,
				endMs: 700,
				audioPath: "file:///sounds/click-1.mp3",
				volume: 0.8,
				normalize: false,
			},
		]);
	});

	it("cancels capture if event collection fails", () => {
		const error = new Error("event failed");
		const host = {
			beginExportAudioCapture: vi.fn(),
			setExportAudioCaptureTime: vi.fn(),
			emitEvent: vi.fn(() => {
				throw error;
			}),
			finishExportAudioCapture: vi.fn(),
			cancelExportAudioCapture: vi.fn(),
		};

		expect(() =>
			collectExtensionAudioRegionsForExport(host, [
				{ timeMs: 100, cx: 0.5, cy: 0.5, interactionType: "click" },
			]),
		).toThrow(error);
		expect(host.cancelExportAudioCapture).toHaveBeenCalledTimes(1);
		expect(host.finishExportAudioCapture).not.toHaveBeenCalled();
	});

	it("guards cursor interaction and cue duration boundaries", () => {
		expect(isExportableCursorInteraction({ timeMs: 0, cx: 0, cy: 0 })).toBe(false);
		expect(
			isExportableCursorInteraction({
				timeMs: 0,
				cx: 0,
				cy: 0,
				interactionType: "move",
			}),
		).toBe(false);
		expect(
			isExportableCursorInteraction({
				timeMs: 0,
				cx: 0,
				cy: 0,
				interactionType: "right-click",
			}),
		).toBe(true);

		expect(
			extensionAudioCuesToRegions(
				[
					{
						id: "cue",
						extensionId: "com.test.clicks",
						timeMs: 10,
						audioPath: "file:///sounds/click.mp3",
						volume: 0.5,
					},
				],
				0,
			)[0],
		).toMatchObject({ startMs: 10, endMs: 11 });
	});
});
