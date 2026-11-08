import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { applyFirstRecordingAutoZooms } from "./useFirstRecordingAutoZooms";

type Input = Parameters<typeof applyFirstRecordingAutoZooms>[0];
const claim = vi.fn();
beforeEach(() => {
	const handled = new Set<string>();
	claim.mockReset().mockImplementation(async (path: string) => {
		if (!["one.mp4", "two.mp4", "three.mp4"].includes(path) || handled.has(path)) return false;
		handled.add(path);
		return true;
	});
	vi.stubGlobal("window", { electronAPI: { claimFirstRecordingAutoZooms: claim } });
});
afterEach(() => vi.unstubAllGlobals());
function input(sourcePath = "one.mp4", overrides: Partial<Input> = {}): Input {
	return {
		sourcePath,
		ready: true,
		isSavedProject: false,
		totalMs: 6000,
		clipRegions: [{ id: "clip", startMs: 0, endMs: 6000, sourceStartMs: 0, speed: 1 }],
		zoomRegions: [],
		cursorTelemetrySourcePath: sourcePath,
		cursorTelemetry: [
			{ timeMs: 0, cx: 0.5, cy: 0.5, interactionType: "move" },
			{ timeMs: 3000, cx: 0.5, cy: 0.5, interactionType: "click" },
			{ timeMs: 3080, cx: 0.5, cy: 0.5, interactionType: "mouseup" },
			{ timeMs: 6000, cx: 0.5, cy: 0.5, interactionType: "move" },
		],
		onZoomSuggested: vi.fn(),
		...overrides,
	};
}

it("applies automatically for the first three recordings and leaves the fourth manual", async () => {
	for (const source of ["one.mp4", "two.mp4", "three.mp4", "four.mp4"]) {
		const params = input(source);
		await applyFirstRecordingAutoZooms(params);
		expect(params.onZoomSuggested).toHaveBeenCalledTimes(source === "four.mp4" ? 0 : 1);
	}
});

it("waits for ready media and matching telemetry without consuming the trial", async () => {
	for (const patch of [
		{ cursorTelemetry: [] },
		{ ready: false },
		{ totalMs: 0 },
		{ cursorTelemetrySourcePath: "previous.mp4" },
	]) {
		const params = input("one.mp4", patch);
		expect(await applyFirstRecordingAutoZooms(params)).toBe(false);
		expect(params.onZoomSuggested).not.toHaveBeenCalled();
	}
	expect(claim).not.toHaveBeenCalled();
	const ready = input();
	await applyFirstRecordingAutoZooms(ready);
	expect(ready.onZoomSuggested).toHaveBeenCalledOnce();
});

it("does not reapply after undo or a renderer restart", async () => {
	const first = input();
	await applyFirstRecordingAutoZooms(first);
	const reopened = input();
	await applyFirstRecordingAutoZooms(reopened);
	expect(first.onZoomSuggested).toHaveBeenCalledOnce();
	expect(reopened.onZoomSuggested).not.toHaveBeenCalled();
});

it("leaves imported videos, saved projects and existing zoom edits intact", async () => {
	for (const params of [
		input("import.mp4"),
		input("one.mp4", { isSavedProject: true }),
		input("two.mp4", { zoomRegions: [{ id: "manual" } as never] }),
	]) {
		await applyFirstRecordingAutoZooms(params);
		expect(params.onZoomSuggested).not.toHaveBeenCalled();
	}
});

it("does not apply if a claim fails or the source changes while IPC is pending", async () => {
	claim.mockResolvedValueOnce(false);
	const failed = input();
	await applyFirstRecordingAutoZooms(failed);
	expect(failed.onZoomSuggested).not.toHaveBeenCalled();
	const replaced = input();
	await applyFirstRecordingAutoZooms(replaced, () => false);
	expect(replaced.onZoomSuggested).not.toHaveBeenCalled();
});
