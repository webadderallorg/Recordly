import { describe, expect, it } from "vitest";
import { createProjectData, type EditorProjectData } from "../projectPersistence";
import {
	createPristineRecordingGate,
	SETTLE_GIVE_UP_MS,
	SETTLE_STABLE_MS,
} from "./pristineRecordingGate";

const snap = (zooms = 0, extra: Record<string, unknown> = {}): EditorProjectData =>
	createProjectData("/r/take.mp4", {
		zoomRegions: Array.from({ length: zooms }, (_, i) => ({ id: `z${i}` })),
		...extra,
	} as never);

function clock() {
	let t = 1_000;
	return {
		now: () => t,
		advance: (ms: number) => {
			t += ms;
		},
	};
}

describe("pristine recording gate", () => {
	it("a fresh take is pristine and stays pristine through the settle window", () => {
		const c = clock();
		const gate = createPristineRecordingGate(c.now);
		gate.observe(snap(), true);
		c.advance(5000);
		gate.observe(snap(), true);
		expect(gate.isPristine(snap())).toBe(true);
	});

	it("changes the app makes while its pipeline is busy are part of the baseline", () => {
		const c = clock();
		const gate = createPristineRecordingGate(c.now);
		gate.observe(snap(), true);
		gate.observe(snap(3), true);
		c.advance(SETTLE_STABLE_MS);
		gate.observe(snap(3), false);
		expect(gate.isPristine(snap(3))).toBe(true);
	});

	it("an edit after the baseline is settled is not pristine, and undoing it makes it pristine again", () => {
		const c = clock();
		const gate = createPristineRecordingGate(c.now);
		gate.observe(snap(2), false);
		c.advance(SETTLE_STABLE_MS);
		gate.observe(snap(2), false);
		expect(gate.isPristine(snap(2, { padding: 10 }))).toBe(false);
		expect(gate.isPristine(snap(2))).toBe(true);
	});

	it("does not settle while the pipeline is busy or the snapshot is still moving", () => {
		const c = clock();
		const gate = createPristineRecordingGate(c.now);
		gate.observe(snap(), true);
		c.advance(SETTLE_STABLE_MS * 2);
		gate.observe(snap(), true);
		gate.observe(snap(1), false);
		c.advance(SETTLE_STABLE_MS - 1);
		gate.observe(snap(1), false);
		expect(gate.isPristine(snap(1, { padding: 10 }))).toBe(true);
	});

	it("gives up and treats the session as edited when it never settles, so work is saved", () => {
		const c = clock();
		const gate = createPristineRecordingGate(c.now);
		gate.observe(snap(), true);
		c.advance(SETTLE_GIVE_UP_MS);
		gate.observe(snap(), true);
		expect(gate.isPristine(snap(1))).toBe(false);
	});

	it("never settles on a missing snapshot", () => {
		const c = clock();
		const gate = createPristineRecordingGate(c.now);
		gate.observe(null, false);
		c.advance(SETTLE_STABLE_MS * 5);
		gate.observe(null, false);
		expect(gate.isPristine(snap(1))).toBe(true);
	});
});
