import { expect, it, vi } from "vitest";
import { applyAutomaticZooms } from "./useAutoApplyZooms";

type Input = Parameters<typeof applyAutomaticZooms>[0];
function input(patch: Partial<Input> = {}): Input {
	return {
		enabled: true,
		sourcePath: "recording.mp4",
		ready: true,
		isSavedProject: false,
		totalMs: 6000,
		clipRegions: [{ id: "clip", startMs: 0, endMs: 6000, sourceStartMs: 0, speed: 1 }],
		zoomRegions: [],
		cursorTelemetrySourcePath: "recording.mp4",
		recordingZoomMarkers: [],
		cursorTelemetry: [
			{ timeMs: 0, cx: 0.5, cy: 0.5, interactionType: "move" },
			{ timeMs: 3000, cx: 0.5, cy: 0.5, interactionType: "click" },
			{ timeMs: 3080, cx: 0.5, cy: 0.5, interactionType: "mouseup" },
			{ timeMs: 6000, cx: 0.5, cy: 0.5, interactionType: "move" },
		],
		onZoomSuggested: vi.fn(),
		...patch,
	};
}

it("automatically applies zooms on every new recording, without a three-recording limit", () => {
	for (const take of [1, 2, 3, 4]) {
		const sourcePath = `recording-${take}.mp4`;
		const params = input({ sourcePath, cursorTelemetrySourcePath: sourcePath });
		expect(applyAutomaticZooms(params)).toBe(true);
		expect(params.onZoomSuggested).toHaveBeenCalledOnce();
	}
});

it("waits for ready media and matching cursor data before applying", () => {
	for (const patch of [
		{ ready: false },
		{ totalMs: 0 },
		{ cursorTelemetry: [] },
		{ clipRegions: [] },
		{ cursorTelemetrySourcePath: "previous.mp4" },
	]) {
		const params = input(patch);
		expect(applyAutomaticZooms(params)).toBe(false);
		expect(params.onZoomSuggested).not.toHaveBeenCalled();
	}
});

it("keeps automatic zooms off when disabled and preserves reopened projects and existing zoom edits", () => {
	for (const patch of [
		{ enabled: false },
		{ isSavedProject: true },
		{ zoomRegions: [{ id: "manual" } as never] },
	]) {
		const params = input(patch);
		expect(applyAutomaticZooms(params)).toBe(true);
		expect(params.onZoomSuggested).not.toHaveBeenCalled();
	}
});

it("uses manual markers from the current take even when automatic zooms are disabled", () => {
	const params = input({
		enabled: false,
		recordingZoomMarkers: [
			{ timeMs: 1000, cx: 0.45, cy: 0.55 },
			{ timeMs: 1600, cx: 0.6, cy: 0.5 },
			{ timeMs: 5750, cx: 0.55, cy: 0.45 },
			{ timeMs: 6500, cx: 0.5, cy: 0.5 },
		],
	});
	expect(applyAutomaticZooms({ ...params, cursorTelemetrySourcePath: "other.mp4" })).toBe(false);
	expect(params.onZoomSuggested).not.toHaveBeenCalled();
	expect(applyAutomaticZooms(params)).toBe(true);
	expect(vi.mocked(params.onZoomSuggested).mock.calls).toEqual([
		[{ start: 1000, end: 1600 }, { cx: 0.45, cy: 0.55 }, "manual"],
		[{ start: 1600, end: 2600 }, { cx: 0.6, cy: 0.5 }, "manual"],
		[{ start: 5750, end: 6000 }, { cx: 0.55, cy: 0.45 }, "manual"],
	]);
});

it("preserves imported sequences and clip edits made while cursor data was loading", () => {
	const original = input().clipRegions[0];
	for (const clipRegions of [
		[
			original,
			{ ...original, id: "imported", startMs: 6000, endMs: 7000, sourceStartMs: 6000 },
		],
		[{ ...original, sourceStartMs: 1000 }],
		[{ ...original, startMs: 500 }],
		[{ ...original, endMs: 5000 }],
		[{ ...original, speed: 2 }],
	]) {
		const params = input({ clipRegions });
		expect(applyAutomaticZooms(params)).toBe(true);
		expect(params.onZoomSuggested).not.toHaveBeenCalled();
	}
});
