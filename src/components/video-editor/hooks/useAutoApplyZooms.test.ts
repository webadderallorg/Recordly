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
