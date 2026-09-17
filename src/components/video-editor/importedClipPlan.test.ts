import { describe, expect, it } from "vitest";
import { buildImportedClipPlan } from "./importedClipPlan";

describe("buildImportedClipPlan", () => {
	it("appends imported media after existing timeline edits without changing them", () => {
		const existing = [
			{ id: "clip-1", startMs: 0, endMs: 3000, sourceStartMs: 1000, speed: 1 },
			{ id: "clip-2", startMs: 5000, endMs: 7000, sourceStartMs: 6000, speed: 1 },
		];
		const plan = buildImportedClipPlan({
			clips: existing,
			sourceDurationMs: 12_000,
			importedDurationMs: 2500,
			nextClipId: 3,
		});

		expect(existing).toHaveLength(2);
		expect(plan).toEqual({
			timelineStartMs: 7000,
			clip: {
				id: "clip-3",
				startMs: 7000,
				endMs: 9500,
				sourceStartMs: 12_000,
				speed: 1,
				showSourceAudio: true,
			},
		});
	});

	it("places the import at zero when all original clips were deleted", () => {
		expect(
			buildImportedClipPlan({
				clips: [],
				sourceDurationMs: 10_000,
				importedDurationMs: 1000,
				nextClipId: 1,
			}),
		).toMatchObject({
			timelineStartMs: 0,
			clip: { startMs: 0, endMs: 1000, sourceStartMs: 10_000 },
		});
	});

	it("rejects invalid timing instead of corrupting the timeline", () => {
		expect(() =>
			buildImportedClipPlan({
				clips: [],
				sourceDurationMs: 10_000,
				importedDurationMs: 0,
				nextClipId: 1,
			}),
		).toThrow("Imported clip timing is invalid");
	});
});
