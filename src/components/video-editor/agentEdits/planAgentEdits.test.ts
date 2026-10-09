import { describe, expect, it } from "vitest";
import {
	type AgentActivityAction,
	type AgentActivityCameraTarget,
	type AgentActivityLog,
	type AgentActivitySpanKind,
	type AgentActivityTarget,
	type AgentEditPlan,
	HOLD_READ_KEEP_MAX_MS,
	MIN_SHOT_MS,
	planAgentEdits,
	QUIET_RADIUS_MS,
	RAMP_MAX_GAP_MS,
	RAMP_MAX_SPEED,
	RAMP_MIN_SPEED,
	ZOOM_KEEP_TAIL_MS,
} from "./planAgentEdits";

type Step = [AgentActivitySpanKind, AgentActivityAction, number, AgentActivityTarget?];
interface SceneSpec {
	startMs: number;
	steps: Step[];
	failed?: boolean;
	title?: string;
}

const WIDE = 16 / 9;
const button = (cx: number, cy: number): AgentActivityTarget => ({
	cx,
	cy,
	width: 0.08,
	height: 0.04,
});

function buildLog(scenes: SceneSpec[]): AgentActivityLog {
	const log: AgentActivityLog = { version: 1, scenes: [], spans: [] };
	for (const scene of scenes) {
		let cursor = scene.startMs;
		for (const [kind, action, durationMs, target] of scene.steps) {
			log.spans.push({ kind, action, startMs: cursor, endMs: cursor + durationMs, target });
			cursor += durationMs;
		}
		log.scenes.push({
			startMs: scene.startMs,
			endMs: cursor,
			failed: scene.failed ?? false,
			title: scene.title,
		});
	}
	return log;
}

function clickScene(startMs: number, target: AgentActivityTarget = button(0.5, 0.5)): SceneSpec {
	return {
		startMs,
		steps: [
			["motion", "click", 700, target],
			["hold", "wait", 2300],
		],
	};
}

const speedOf = (range: AgentEditPlan["keepRanges"][number]) => range.speed ?? 1;
const shotsOf = (plan: AgentEditPlan) => plan.keepRanges.filter((range) => speedOf(range) === 1);
const rampsOf = (plan: AgentEditPlan) => plan.keepRanges.filter((range) => speedOf(range) !== 1);

function keptWithin(plan: AgentEditPlan, startMs: number, endMs: number) {
	return plan.keepRanges.reduce(
		(sum, range) =>
			sum + Math.max(0, Math.min(endMs, range.endMs) - Math.max(startMs, range.startMs)),
		0,
	);
}

function screenMsOf(plan: AgentEditPlan) {
	return plan.keepRanges.reduce(
		(sum, range) => sum + (range.endMs - range.startMs) / speedOf(range),
		0,
	);
}

function cutsOf(plan: AgentEditPlan) {
	return plan.keepRanges.slice(1).flatMap((range, index) => {
		const previous = plan.keepRanges[index];
		return range.startMs > previous.endMs
			? [{ startMs: previous.endMs, endMs: range.startMs }]
			: [];
	});
}

function expectWellFormed(plan: AgentEditPlan, durationMs: number) {
	plan.keepRanges.forEach((range, index) => {
		expect(range.startMs).toBeGreaterThanOrEqual(0);
		expect(range.endMs).toBeLessThanOrEqual(durationMs);
		expect(range.endMs).toBeGreaterThan(range.startMs);
		expect(speedOf(range)).toBeGreaterThan(0);
		if (index > 0) {
			expect(range.startMs).toBeGreaterThanOrEqual(plan.keepRanges[index - 1].endMs);
		}
	});
	for (const shot of shotsOf(plan)) {
		if (shot.endMs < durationMs) {
			expect(shot.endMs - shot.startMs).toBeGreaterThanOrEqual(MIN_SHOT_MS);
		}
	}
	plan.zooms.forEach((zoom, index) => {
		expect(zoom.endMs - zoom.startMs).toBeGreaterThanOrEqual(100);
		expect(
			shotsOf(plan).filter(
				(range) => range.startMs <= zoom.startMs && zoom.endMs <= range.endMs,
			),
		).toHaveLength(1);
		expect(
			rampsOf(plan).filter(
				(range) => range.startMs < zoom.endMs && zoom.startMs < range.endMs,
			),
		).toHaveLength(0);
		if (index > 0) expect(zoom.startMs).toBeGreaterThanOrEqual(plan.zooms[index - 1].endMs);
		expect(zoom.focus.cx).toBeGreaterThanOrEqual(0);
		expect(zoom.focus.cx).toBeLessThanOrEqual(1);
		expect(zoom.focus.cy).toBeGreaterThanOrEqual(0);
		expect(zoom.focus.cy).toBeLessThanOrEqual(1);
	});
	for (const caption of plan.captions) {
		expect(
			plan.keepRanges.some(
				(range) => range.startMs <= caption.startMs && caption.endMs <= range.endMs,
			),
		).toBe(true);
	}
}

function plan(
	log: AgentActivityLog,
	durationMs: number,
	aspect = WIDE,
	changeTimesMs?: number[],
): AgentEditPlan {
	const result = planAgentEdits(log, durationMs, aspect, changeTimesMs);
	if (!result) throw new Error("expected a plan");
	expectWellFormed(result, durationMs);
	return result;
}

describe("planAgentEdits on a realistic agent demo", () => {
	const field: AgentActivityTarget = { cx: 0.4, cy: 0.5, width: 0.25, height: 0.05 };
	const log = buildLog([
		{
			startMs: 5000,
			title: "Open onboarding",
			steps: [
				["wait", "raise", 250],
				["motion", "click", 700, button(0.2, 0.1)],
				["hold", "wait", 4000],
				["motion", "click", 650, button(0.5, 0.3)],
				["hold", "wait", 3000],
			],
		},
		{
			startMs: 17600,
			steps: [
				["wait", "raise", 250],
				["motion", "click", 800, field],
				["motion", "type", 1800],
				["motion", "key", 200],
				["wait", "wait", 2500],
				["hold", "wait", 2500],
			],
		},
		{
			startMs: 30650,
			steps: [
				["wait", "raise", 250],
				["motion", "scroll", 900],
				["hold", "wait", 2500],
				["motion", "click", 700, button(0.7, 0.6)],
				["hold", "wait", 3500],
			],
		},
		{
			startMs: 43000,
			steps: [
				["wait", "raise", 250],
				["motion", "click", 750, button(0.3, 0.7)],
				["hold", "wait", 3000],
				["motion", "click", 700, button(0.32, 0.72)],
				["hold", "wait", 3000],
			],
		},
		{
			startMs: 56700,
			steps: [
				["wait", "raise", 250],
				["motion", "click", 700, button(0.8, 0.2)],
				["wait", "wait", 3000],
				["hold", "wait", 2500],
				["motion", "move", 600],
				["hold", "wait", 1000],
			],
		},
		{
			startMs: 68750,
			steps: [
				["wait", "raise", 250],
				["motion", "click", 700, button(0.6, 0.5)],
				["hold", "wait", 3500],
				["motion", "click", 650, button(0.9, 0.9)],
				["hold", "wait", 2500],
			],
		},
	]);
	const durationMs = 76500;
	const result = plan(log, durationMs);
	const clicks = log.spans.filter((span) => span.action === "click");

	it("shortens the demo by at least 20 s of thinking and loading", () => {
		expect(log.scenes[log.scenes.length - 1].endMs).toBeLessThanOrEqual(durationMs);
		expect(durationMs - screenMsOf(result)).toBeGreaterThanOrEqual(20000);
	});

	it("keeps every click inside one kept range", () => {
		for (const click of clicks) {
			expect(
				result.keepRanges.some(
					(range) => range.startMs <= click.startMs && click.endMs <= range.endMs,
				),
			).toBe(true);
		}
	});

	it("zooms on every click, each zoom inside one shot", () => {
		for (const click of clicks) {
			expect(
				result.zooms.some(
					(zoom) => zoom.startMs <= click.startMs && click.startMs < zoom.endMs,
				),
			).toBe(true);
		}
	});

	it("never ends a zoom on a cut", () => {
		const edges = new Set(result.keepRanges.flatMap((range) => [range.startMs, range.endMs]));
		for (const zoom of result.zooms) {
			expect(edges.has(zoom.endMs)).toBe(false);
		}
	});

	it("speeds up every gap it does not cut", () => {
		for (const cut of cutsOf(result)) {
			expect(cut.endMs - cut.startMs).toBeGreaterThan(RAMP_MAX_GAP_MS);
		}
		for (const ramp of rampsOf(result)) {
			expect(ramp.speed).toBeGreaterThanOrEqual(2);
			expect(ramp.speed).toBeLessThanOrEqual(RAMP_MAX_SPEED);
		}
	});

	it("captions only the titled scene", () => {
		expect(result.captions).toEqual([{ startMs: 4550, endMs: 6450, text: "Open onboarding" }]);
	});
});

describe("planAgentEdits", () => {
	it("returns null when there is nothing to plan", () => {
		expect(planAgentEdits(null, 10000, WIDE)).toBeNull();
		expect(planAgentEdits(undefined, 10000, WIDE)).toBeNull();
		expect(planAgentEdits({ version: 1, scenes: [], spans: [] }, 10000, WIDE)).toBeNull();
		const log = buildLog([clickScene(1000)]);
		expect(
			planAgentEdits({ ...log, version: 2 } as unknown as AgentActivityLog, 1e4, WIDE),
		).toBeNull();
		expect(
			planAgentEdits({ version: 1 } as unknown as AgentActivityLog, 10000, WIDE),
		).toBeNull();
		expect(planAgentEdits(log, 0, WIDE)).toBeNull();
		expect(planAgentEdits(log, Number.NaN, WIDE)).toBeNull();
	});

	it("returns null when the recording is already as short as the cut", () => {
		const log = buildLog([{ startMs: 200, steps: [["hold", "wait", 600]] }]);
		expect(planAgentEdits(log, 900, 0.8)).toBeNull();
	});

	it("plans a single scene: lead-in cut, split hold, ramped middle, click zoomed", () => {
		const result = plan(buildLog([clickScene(1000, button(0.25, 0.75))]), 10000);
		expect(result.keepRanges).toEqual([
			{ startMs: 300, endMs: 2200 },
			{ startMs: 2200, endMs: 2550, speed: 2 },
			{ startMs: 2550, endMs: 3350, speed: 4 },
			{ startMs: 3350, endMs: 3700, speed: 2 },
			{ startMs: 3700, endMs: 5200 },
		]);
		expect(result.zooms).toEqual([
			{ startMs: 1000, endMs: 1950, depth: 2, focus: { cx: 0.25, cy: 0.75 } },
		]);
		expect(result.captions).toEqual([]);
	});

	it("keeps 0.7 s of run-up so a cut clears the previous step's settle", () => {
		expect(plan(buildLog([clickScene(4000)]), 12000).keepRanges[0].startMs).toBe(3300);
	});

	it("splits a hold instead of keeping it whole", () => {
		const log = buildLog([
			{
				startMs: 1000,
				steps: [
					["motion", "click", 700, button(0.5, 0.5)],
					["hold", "wait", 10000],
					["motion", "click", 700, button(0.5, 0.5)],
				],
			},
		]);
		const result = plan(log, 20000);
		expect(result.keepRanges).toEqual([
			{ startMs: 300, endMs: 2200 },
			{ startMs: 11000, endMs: 13600 },
		]);
		expect(keptWithin(result, 1700, 11700)).toBe(1200);
	});

	it("gives a hold after a settle reading time, capped at four seconds", () => {
		const log = buildLog([
			{
				startMs: 1000,
				steps: [
					["motion", "click", 700, button(0.5, 0.5)],
					["wait", "wait", 2000],
					["hold", "wait", 9000],
					["motion", "click", 700, button(0.5, 0.5)],
					["hold", "wait", 1500],
				],
			},
		]);
		const result = plan(log, 30000);
		expect(keptWithin(result, 3700, 12000)).toBe(HOLD_READ_KEEP_MAX_MS - 300);
		expect(keptWithin(result, 7400, 12000)).toBe(0);
	});

	it("shortens a long wait to 1.5 s", () => {
		const log = buildLog([
			{
				startMs: 1000,
				steps: [
					["motion", "click", 700, button(0.2, 0.2)],
					["wait", "wait", 10000],
					["motion", "click", 700, button(0.8, 0.8)],
					["hold", "wait", 2000],
				],
			},
		]);
		const result = plan(log, 20000);
		expect(result.keepRanges[0]).toEqual({ startMs: 300, endMs: 2900 });
		expect(keptWithin(result, 2900, 11000)).toBe(0);
	});

	it("speeds a short gap up instead of cutting it", () => {
		const result = plan(buildLog([clickScene(1000), clickScene(5000)]), 12000);
		expect(cutsOf(result)).toEqual([]);
		expect(rampsOf(result)).toHaveLength(6);
		const sourceMs = result.keepRanges.reduce(
			(sum, range) => sum + range.endMs - range.startMs,
			0,
		);
		expect(screenMsOf(result)).toBeLessThan(sourceMs);
	});

	it("eases into and out of a ramp with a slower clip at each end", () => {
		const ramps = rampsOf(plan(buildLog([clickScene(1000)]), 10000));
		expect(ramps.map(speedOf)).toEqual([2, 4, 2]);
		expect(ramps[0].endMs - ramps[0].startMs).toBe(ramps[2].endMs - ramps[2].startMs);
	});

	it("cuts a gap longer than three seconds rather than speeding it up", () => {
		const log = buildLog([
			{
				startMs: 1000,
				steps: [
					["motion", "click", 700, button(0.5, 0.5)],
					["wait", "wait", 8000],
					["motion", "click", 700, button(0.5, 0.5)],
					["hold", "wait", 1200],
				],
			},
		]);
		const result = plan(log, 20000);
		expect(cutsOf(result)).toHaveLength(1);
		expect(rampsOf(result)).toEqual([]);
	});

	it("keeps every ramp between four and eight times speed", () => {
		for (const holdMs of [1600, 2200, 2800, 3200]) {
			const log = buildLog([
				{
					startMs: 1000,
					steps: [
						["motion", "click", 700, button(0.5, 0.5)],
						["hold", "wait", holdMs],
						["motion", "click", 700, button(0.5, 0.5)],
						["hold", "wait", 1200],
					],
				},
			]);
			const ramps = rampsOf(plan(log, 20000));
			if (ramps.length === 0) continue;
			const fastest = Math.max(...ramps.map(speedOf));
			expect(fastest).toBeGreaterThanOrEqual(RAMP_MIN_SPEED);
			expect(fastest).toBeLessThanOrEqual(RAMP_MAX_SPEED);
		}
	});

	it("snaps both sides of a cut to a moment with no screen change", () => {
		const log = buildLog([
			{
				startMs: 1000,
				steps: [
					["motion", "click", 700, button(0.5, 0.5)],
					["wait", "wait", 8000],
					["motion", "click", 700, button(0.5, 0.5)],
					["hold", "wait", 1200],
				],
			},
		]);
		const changeTimesMs = [0, 250, 2150, 2400, 9500, 9700, 9900, 10400, 12000];
		const result = plan(log, 20000, WIDE, changeTimesMs);
		expect(cutsOf(result)).toHaveLength(1);
		for (const cut of cutsOf(result)) {
			for (const edge of [cut.startMs, cut.endMs]) {
				expect(
					Math.min(...changeTimesMs.map((timeMs) => Math.abs(timeMs - edge))),
				).toBeGreaterThanOrEqual(QUIET_RADIUS_MS);
			}
		}
	});

	it("leaves a boundary alone when no quiet moment is within reach", () => {
		const log = buildLog([
			{
				startMs: 1000,
				steps: [
					["motion", "click", 700, button(0.5, 0.5)],
					["wait", "wait", 8000],
					["motion", "click", 700, button(0.5, 0.5)],
					["hold", "wait", 1200],
				],
			},
		]);
		const busy = Array.from({ length: 400 }, (_, index) => index * 50);
		expect(plan(log, 20000, WIDE, busy).keepRanges[0].startMs).toBe(300);
	});

	it("cuts a gap nothing happens in rather than speeding up a still frame", () => {
		const log = buildLog([
			{
				startMs: 1000,
				steps: [
					["motion", "click", 700, button(0.5, 0.5)],
					["hold", "wait", 3000],
				],
			},
		]);
		const quietGap = plan(log, 10000, WIDE, [0, 1000, 1500, 2100, 4600, 5000]);
		expect(rampsOf(quietGap)).toEqual([]);
		expect(cutsOf(quietGap)).toHaveLength(1);

		const busyGap = plan(log, 10000, WIDE, [0, 1000, 1500, 2100, 3000, 4600, 5000]);
		expect(rampsOf(busyGap).length).toBeGreaterThan(0);
		expect(cutsOf(busyGap)).toEqual([]);
	});

	it("survives overlapping, unsorted, out-of-range and corrupt spans", () => {
		const log: AgentActivityLog = {
			version: 1,
			scenes: [{ startMs: Number.NaN, endMs: 5, failed: true }],
			spans: [
				{ kind: "hold", action: "wait", startMs: 5000, endMs: 6000 },
				{ kind: "motion", action: "click", startMs: 1000, endMs: 1500 },
				{ kind: "motion", action: "move", startMs: -2000, endMs: 200 },
				{ kind: "hold", action: "wait", startMs: 4000, endMs: 5500 },
				{ kind: "motion", action: "click", startMs: Number.NaN, endMs: 3000 },
				{ kind: "motion", action: "move", startMs: 8000, endMs: 7000 },
				{ kind: "hold", action: "wait", startMs: 20000, endMs: 21000 },
				{ kind: "think", action: "wait", startMs: 8000, endMs: 9000 } as unknown as never,
			],
		};
		expect(shotsOf(plan(log, 10000))).toEqual([
			{ startMs: 0, endMs: 1900 },
			{ startMs: 4000, endMs: 7200 },
		]);
	});

	it("cuts a failed scene so the retake replaces it", () => {
		const log = buildLog([
			clickScene(1000),
			{ ...clickScene(8000, button(0.1, 0.1)), failed: true, title: "Broken" },
			{ ...clickScene(13000), title: "Retake" },
		]);
		const result = plan(log, 20000);
		expect(keptWithin(result, 7300, 12300)).toBe(0);
		expect(result.zooms.every((zoom) => zoom.endMs <= 4600 || zoom.startMs >= 12300)).toBe(
			true,
		);
		expect(result.captions.map((caption) => caption.text)).toEqual(["Retake"]);
	});

	it("never speeds a failed take up instead of cutting it", () => {
		const log = buildLog([
			clickScene(1000),
			{ startMs: 5000, steps: [["motion", "click", 300, button(0.1, 0.1)]], failed: true },
			clickScene(7000),
		]);
		const result = plan(log, 20000);
		expect(keptWithin(result, 5000, 6300)).toBe(0);
		for (const ramp of rampsOf(result)) {
			expect(ramp.startMs >= 6300 || ramp.endMs <= 5000).toBe(true);
		}
	});

	it("cuts a failed last scene to the end and never keeps nothing", () => {
		const log = buildLog([clickScene(1000), { ...clickScene(4500), failed: true }]);
		expect(plan(log, 15000).keepRanges.at(-1)?.endMs).toBe(4500);
		const allFailed = buildLog([{ ...clickScene(1000), failed: true }]);
		expect(planAgentEdits(allFailed, 15000, WIDE)).toBeNull();
	});

	it("leaves no sliver between back-to-back failed scenes", () => {
		const log = buildLog([
			clickScene(1000),
			{ startMs: 4500, steps: [["motion", "click", 200, button(0.5, 0.5)]], failed: true },
			{ startMs: 5100, steps: [["motion", "click", 200, button(0.5, 0.5)]], failed: true },
		]);
		expect(plan(log, 15000).keepRanges.at(-1)?.endMs).toBe(4500);
	});

	it("never snaps a retake back across the failed scene before it", () => {
		const log = buildLog([
			clickScene(1000),
			{ startMs: 5000, steps: [["motion", "click", 300, button(0.1, 0.1)]], failed: true },
			{ ...clickScene(9000), title: "Retake" },
		]);
		const result = plan(log, 20000, WIDE, [8600]);
		expect(keptWithin(result, 5000, 8300)).toBe(0);
		expect(shotsOf(result).find((shot) => shot.endMs > 8300)?.startMs).toBe(8300);
	});

	it("never leaves a shot under 0.9 s", () => {
		const log = buildLog([
			{ startMs: 1000, steps: [["motion", "key", 50]] },
			{ startMs: 9000, steps: [["motion", "key", 50]] },
		]);
		for (const shot of shotsOf(plan(log, 20000))) {
			expect(shot.endMs - shot.startMs).toBeGreaterThanOrEqual(MIN_SHOT_MS);
		}
	});

	it("adds no zooms to tall sources", () => {
		const result = plan(buildLog([clickScene(3000)]), 10000, 0.8);
		expect(result.zooms).toEqual([]);
		expect(shotsOf(result)).toEqual([
			{ startMs: 2300, endMs: 4200 },
			{ startMs: 5700, endMs: 7200 },
		]);
	});

	it("picks 1.5x for a small target, 1.25x for a medium one and nothing for a big one", () => {
		const zoomFor = (target: AgentActivityTarget) =>
			plan(buildLog([clickScene(3000, target)]), 10000).zooms;
		expect(zoomFor({ cx: 0.5, cy: 0.5, width: 0.5 })).toEqual([]);
		expect(zoomFor({ cx: 0.5, cy: 0.5, width: 0.2 })[0].depth).toBe(1);
		expect(zoomFor({ cx: 0.5, cy: 0.5, width: 0.05 })[0].depth).toBe(2);
		expect(zoomFor({ cx: 1.4, cy: -0.2 })[0]).toMatchObject({
			depth: 2,
			focus: { cx: 1, cy: 0 },
		});
	});

	it("ends every zoom before its shot ends", () => {
		const result = plan(buildLog([clickScene(1000), clickScene(6000)]), 14000);
		expect(result.zooms.length).toBeGreaterThan(0);
		for (const zoom of result.zooms) {
			const shot = shotsOf(result).find(
				(range) => range.startMs <= zoom.startMs && zoom.startMs < range.endMs,
			);
			expect(shot).toBeDefined();
			expect(zoom.endMs).toBeLessThanOrEqual((shot?.endMs ?? 0) - ZOOM_KEEP_TAIL_MS);
		}
	});

	it("no zoom for scroll, key or move-only motion", () => {
		const log = buildLog([
			{
				startMs: 3000,
				steps: [
					["motion", "scroll", 900, button(0.5, 0.5)],
					["motion", "key", 200, button(0.5, 0.5)],
					["motion", "move", 600, button(0.5, 0.5)],
					["hold", "wait", 2000],
				],
			},
		]);
		expect(plan(log, 10000).zooms).toEqual([]);
	});

	it("lets typing right after a click inherit its focus", () => {
		const field = { cx: 0.3, cy: 0.4, width: 0.2 };
		const log = buildLog([
			{
				startMs: 1000,
				steps: [
					["motion", "click", 700, field],
					["hold", "wait", 500],
					["motion", "type", 2000],
					["hold", "wait", 2000],
				],
			},
		]);
		expect(plan(log, 12000).zooms).toEqual([
			{ startMs: 1000, endMs: 4450, depth: 1, focus: { cx: 0.3, cy: 0.4 } },
		]);
	});

	it("does not overlap zooms with different focus", () => {
		const log = buildLog([
			{
				startMs: 1000,
				steps: [
					["motion", "click", 800, button(0.1, 0.1)],
					["motion", "click", 500, button(0.9, 0.9)],
					["hold", "wait", 2000],
				],
			},
		]);
		expect(plan(log, 10000).zooms).toEqual([
			{ startMs: 1000, endMs: 1800, depth: 2, focus: { cx: 0.1, cy: 0.1 } },
			{ startMs: 1800, endMs: 2550, depth: 2, focus: { cx: 0.9, cy: 0.9 } },
		]);
	});

	it("captions only titled, successful scenes, clamped to their keep range", () => {
		const log = buildLog([
			{
				startMs: 1000,
				title: "  Open settings  ",
				steps: [
					["motion", "click", 700, button(0.5, 0.5)],
					["hold", "wait", 1000],
				],
			},
			clickScene(8000),
			{ ...clickScene(15000), title: "   " },
			{ ...clickScene(22000), title: "Oops", failed: true },
			{ ...clickScene(29000), title: "x".repeat(100) },
		]);
		expect(plan(log, 40000).captions).toEqual([
			{ startMs: 300, endMs: 2700, text: "Open settings" },
			{ startMs: 28300, endMs: 30200, text: "x".repeat(80) },
		]);
	});

	it("clamps to a duration shorter than the log", () => {
		const log = buildLog([
			clickScene(1000),
			{
				startMs: 8000,
				steps: [
					["motion", "click", 700, button(0.5, 0.5)],
					["hold", "wait", 11300],
					["hold", "wait", 1000],
				],
			},
		]);
		expect(plan(log, 10000).keepRanges.at(-1)?.endMs).toBe(10000);
	});

	it("ignores a change log that is empty, unsorted or corrupt", () => {
		const log = buildLog([clickScene(1000), clickScene(6000)]);
		const baseline = plan(log, 14000);
		expect(plan(log, 14000, WIDE, []).keepRanges).toEqual(baseline.keepRanges);
		expect(plan(log, 14000, WIDE, [Number.NaN, Number.POSITIVE_INFINITY]).keepRanges).toEqual(
			baseline.keepRanges,
		);
		const unsorted = plan(log, 14000, WIDE, [9000, 1000, 4000, 2000]);
		const sorted = plan(log, 14000, WIDE, [1000, 2000, 4000, 9000]);
		expect(unsorted.keepRanges).toEqual(sorted.keepRanges);
	});
});

describe("camera targets", () => {
	const wide = { cx: 0.5, cy: 0.5, width: 0.9 };
	const rect = (
		atMs: number,
		width: number,
		x = 0.1,
		y = 0.1,
		height = width,
	): AgentActivityCameraTarget => ({
		atMs,
		x,
		y,
		width,
		height,
	});
	const scenes = () => [clickScene(1000, wide), clickScene(6000, wide)];
	const withCamera = (cameraTargets?: AgentActivityCameraTarget[], list = scenes()) => ({
		...buildLog(list),
		cameraTargets,
	});
	const zoomsFor = (cameraTargets?: AgentActivityCameraTarget[], durationMs = 14000) =>
		plan(withCamera(cameraTargets), durationMs).zooms;

	it("changes nothing without markers", () => {
		const base = plan(buildLog(scenes()), 14000);
		expect(zoomsFor(undefined)).toEqual(base.zooms);
		expect(zoomsFor([])).toEqual(base.zooms);
		expect(base.zooms).toEqual([]);
	});

	it("picks the deepest depth that never crops the framed window", () => {
		const depthFor = (width: number) => zoomsFor([rect(0, width, 0, 0)])[0]?.depth;
		expect(depthFor(0.9)).toBeUndefined();
		expect(depthFor(0.8)).toBe(1);
		expect(depthFor(0.66)).toBe(2);
		expect(depthFor(0.55)).toBe(3);
		expect(depthFor(0.45)).toBe(4);
		expect(depthFor(0.28)).toBe(5);
		expect(depthFor(0.2)).toBe(6);
	});

	it("is limited by the taller side of the rectangle", () => {
		expect(zoomsFor([rect(0, 0.3, 0, 0, 0.7)])[0].depth).toBe(1);
	});

	it("glides between two apps and focuses each window centre", () => {
		const zooms = zoomsFor([rect(0, 0.5, 0, 0), rect(5000, 0.5, 0.5, 0.5)]);
		const before = zooms.filter((zoom) => zoom.startMs < 5000);
		const after = zooms.filter((zoom) => zoom.startMs >= 5000);
		expect(before.length).toBeGreaterThan(0);
		expect(after.length).toBeGreaterThan(0);
		expect(before.every((zoom) => zoom.depth === 3 && zoom.focus.cx === 0.25)).toBe(true);
		expect(after.every((zoom) => zoom.depth === 3 && zoom.focus.cx === 0.75)).toBe(true);
		expect(before.every((zoom) => zoom.endMs <= 5000)).toBe(true);
	});

	it("merges consecutive markers that frame the same rectangle", () => {
		const zooms = zoomsFor([rect(0, 0.5, 0, 0), rect(5000, 0.5, 0.01, 0.01)]);
		expect(zooms.filter((zoom) => zoom.startMs < 5000 && zoom.endMs > 5000)).toHaveLength(1);
		expect(zooms.every((zoom) => zoom.focus.cx < 0.3)).toBe(true);
	});

	it("ends a region at a marker that frames the whole display", () => {
		const zooms = zoomsFor([rect(0, 0.5, 0, 0), rect(5000, 1, 0, 0)]);
		expect(zooms.length).toBeGreaterThan(0);
		expect(zooms.every((zoom) => zoom.endMs <= 5000)).toBe(true);
	});

	it("handles one marker, a marker at 0, and a later marker replacing an equal-time one", () => {
		expect(zoomsFor([rect(0, 0.5, 0, 0)]).length).toBeGreaterThan(0);
		const zooms = zoomsFor([rect(5000, 0.9), rect(5000, 0.5, 0.5, 0.5)]);
		expect(zooms.length).toBeGreaterThan(0);
		expect(zooms.every((zoom) => zoom.focus.cx === 0.75 && zoom.startMs >= 5000)).toBe(true);
	});

	it("sorts markers that arrive out of order", () => {
		const forward = zoomsFor([rect(0, 0.5, 0, 0), rect(5000, 0.5, 0.5, 0.5)]);
		expect(zoomsFor([rect(5000, 0.5, 0.5, 0.5), rect(0, 0.5, 0, 0)])).toEqual(forward);
	});

	it("ignores unusable rectangles and markers after the end", () => {
		expect(
			zoomsFor([
				rect(0, 0, 0, 0),
				rect(0, Number.NaN),
				{ atMs: 0, x: 0, y: 0, width: 0.5, height: 0 },
				{ atMs: Number.NaN, x: 0, y: 0, width: 0.5, height: 0.5 },
				rect(14000, 0.5),
				rect(99999, 0.5),
			]),
		).toEqual([]);
		expect(zoomsFor([rect(0, 3, 0, 0)])).toEqual([]);
	});

	it("never survives into a cut or a failed scene", () => {
		const list = [clickScene(1000, wide), { ...clickScene(6000, wide), failed: true }];
		const result = plan(withCamera([rect(0, 0.5, 0, 0)], list), 14000);
		expect(result.zooms.length).toBeGreaterThan(0);
		for (const zoom of result.zooms) {
			expect(
				shotsOf(result).some(
					(shot) => shot.startMs <= zoom.startMs && zoom.endMs <= shot.endMs,
				),
			).toBe(true);
			expect(zoom.endMs).toBeLessThanOrEqual(6000);
		}
	});

	it("drops a marker that lies wholly in a cut", () => {
		const [first, second] = shotsOf(plan(buildLog(scenes()), 14000));
		const zooms = zoomsFor([rect(first.endMs + 1, 0.5, 0, 0), rect(second.startMs - 1, 1)]);
		expect(zooms).toEqual([]);
	});

	it("lets a click zoom win and resumes the camera region after it", () => {
		const list = [clickScene(1000, wide), clickScene(6000, button(0.5, 0.5))];
		const result = plan(withCamera([rect(0, 0.5, 0, 0)], list), 14000);
		const click = result.zooms.find((zoom) => zoom.depth === 2 && zoom.focus.cx === 0.5);
		expect(click).toBeDefined();
		for (let index = 1; index < result.zooms.length; index += 1) {
			expect(result.zooms[index].startMs).toBeGreaterThanOrEqual(
				result.zooms[index - 1].endMs,
			);
		}
		const camera = result.zooms.filter((zoom) => zoom.depth === 3);
		expect(camera.some((zoom) => zoom.endMs <= (click?.startMs ?? 0))).toBe(true);
	});

	it("adds nothing to tall sources", () => {
		expect(plan(withCamera([rect(0, 0.5, 0, 0)]), 14000, 0.8).zooms).toEqual([]);
	});
});
