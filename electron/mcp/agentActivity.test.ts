import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: () => os.tmpdir() } }));

import {
	pauseCursorCapture,
	resetCursorCaptureClock,
	resumeCursorCapture,
} from "../ipc/cursor/telemetry";
import { MAX_CHANGE_TIMES } from "../ipc/ffmpeg/changeTimes";
import { setCursorCaptureStartTimeMs, setIsCursorCaptureActive } from "../ipc/state";
import {
	beginScene,
	beginSpan,
	getAgentActivityMs,
	markCameraTarget,
	normalizeAgentActivityLog,
	persistAgentActivity,
	readAgentActivity,
	resetAgentActivity,
	setPlannedSceneTitles,
	snapshotAgentActivity,
} from "./agentActivity";

const START = 1_000_000;
const at = (ms: number) => vi.setSystemTime(START + ms);

function startRecording() {
	at(0);
	setIsCursorCaptureActive(true);
	setCursorCaptureStartTimeMs(START);
	resetCursorCaptureClock();
	resetAgentActivity();
}

function stopRecording(ms: number) {
	at(ms);
	const log = snapshotAgentActivity(getAgentActivityMs() ?? ms);
	setIsCursorCaptureActive(false);
	return log;
}

beforeEach(() => {
	vi.useFakeTimers();
	at(0);
	setIsCursorCaptureActive(false);
	resetCursorCaptureClock();
	resetAgentActivity();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("clock gating", () => {
	it("logs nothing before start or during a countdown, and nothing after stop", () => {
		at(500);
		expect(getAgentActivityMs()).toBeNull();
		beginSpan("motion", "click")();
		const endScene = beginScene("Before");

		startRecording();
		endScene(true);
		at(100);
		const end = beginSpan("motion", "move");
		at(400);
		end();
		const log = stopRecording(1_000);

		at(1_200);
		expect(getAgentActivityMs()).toBeNull();
		beginSpan("hold", "wait")();
		expect(snapshotAgentActivity(5_000)).toEqual(log);
		expect(log).toEqual({
			version: 1,
			scenes: [],
			spans: [{ kind: "motion", action: "move", startMs: 100, endMs: 400 }],
		});
	});

	it("drops spans inside a pause, ends a running span at the pause, and starts a straddling one at the resume", () => {
		startRecording();
		at(100);
		const running = beginSpan("hold", "wait");
		at(300);
		pauseCursorCapture(START + 300);
		expect(getAgentActivityMs()).toBe(300);
		at(800);
		running();
		const duringPause = beginSpan("motion", "click");
		at(1_500);
		const straddling = beginSpan("motion", "drag");
		at(2_000);
		resumeCursorCapture(START + 2_000);
		duringPause();
		at(2_100);
		const afterResume = beginSpan("motion", "type");
		at(2_300);
		straddling();
		at(2_600);
		afterResume();
		expect(stopRecording(3_000).spans).toEqual([
			{ kind: "hold", action: "wait", startMs: 100, endMs: 300 },
			{ kind: "motion", action: "drag", startMs: 300, endMs: 600 },
			{ kind: "motion", action: "type", startMs: 400, endMs: 900 },
		]);
	});
});

describe("scenes and spans", () => {
	it("keeps scenes and spans in order with titles, targets and failure", () => {
		startRecording();
		at(100);
		const first = beginScene("Open settings");
		const raise = beginSpan("wait", "raise");
		at(350);
		raise();
		const click = beginSpan("motion", "click", { cx: 0.25, cy: 0.5 });
		at(950);
		click();
		first(false);
		at(4_000);
		const second = beginScene();
		const type = beginSpan("motion", "type");
		at(4_500);
		type();
		second(true);
		expect(stopRecording(6_000)).toEqual({
			version: 1,
			scenes: [
				{ startMs: 100, endMs: 950, failed: false, title: "Open settings" },
				{ startMs: 4_000, endMs: 4_500, failed: true },
			],
			spans: [
				{ kind: "wait", action: "raise", startMs: 100, endMs: 350 },
				{
					kind: "motion",
					action: "click",
					startMs: 350,
					endMs: 950,
					target: { cx: 0.25, cy: 0.5 },
				},
				{ kind: "motion", action: "type", startMs: 4_000, endMs: 4_500 },
			],
		});
	});

	it("closes open entries at stop, drops empty ones, and ignores late ends", () => {
		startRecording();
		at(200);
		const scene = beginScene("Mid-stop");
		beginSpan("motion", "move")();
		const open = beginSpan("motion", "drag");
		const log = stopRecording(700);
		at(900);
		open();
		scene(true);
		expect(log).toEqual({
			version: 1,
			scenes: [{ startMs: 200, endMs: 700, failed: false, title: "Mid-stop" }],
			spans: [{ kind: "motion", action: "drag", startMs: 200, endMs: 700 }],
		});
	});

	it("clamps to the stop time and forgets everything on reset", () => {
		startRecording();
		at(100);
		const end = beginSpan("hold", "wait");
		at(900);
		end();
		expect(snapshotAgentActivity(500).spans).toEqual([
			{ kind: "hold", action: "wait", startMs: 100, endMs: 500 },
		]);
		startRecording();
		expect(snapshotAgentActivity(500)).toEqual({ version: 1, scenes: [], spans: [] });
	});
});

describe("persistence", () => {
	let dir: string;
	beforeEach(async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-activity-"));
	});
	afterEach(async () => {
		await fs.rm(dir, { recursive: true, force: true });
	});

	it("writes the sidecar once, reads it back, and skips an empty log", async () => {
		const video = path.join(dir, "demo.mp4");
		startRecording();
		at(100);
		const scene = beginScene("Demo");
		const span = beginSpan("motion", "scroll", { cx: 0.1, cy: 0.9 });
		at(600);
		span();
		scene(false);
		const log = stopRecording(1_000);
		await persistAgentActivity(video);
		expect(await readAgentActivity(video)).toEqual(log);

		const empty = path.join(dir, "empty.mp4");
		await persistAgentActivity(empty);
		await expect(fs.access(`${empty}.agent.json`)).rejects.toThrow();
		expect(await readAgentActivity(empty)).toBeNull();
	});

	it("stores the screen change times alongside the log", async () => {
		const video = path.join(dir, "changes.mp4");
		startRecording();
		at(100);
		const span = beginSpan("motion", "click", { cx: 0.5, cy: 0.5 });
		at(600);
		span();
		stopRecording(1_000);
		await persistAgentActivity(video, async () => [0, 120, 480]);
		expect(await readAgentActivity(video)).toMatchObject({ changeTimesMs: [0, 120, 480] });
	});

	it("never asks for change times for a recording without agent activity", async () => {
		const video = path.join(dir, "plain.mp4");
		const extract = vi.fn(async () => [0, 120]);
		await persistAgentActivity(video, extract);
		expect(extract).not.toHaveBeenCalled();
		expect(await readAgentActivity(video)).toBeNull();
	});

	it("still saves the log when the change times cannot be extracted", async () => {
		const video = path.join(dir, "noprobe.mp4");
		startRecording();
		at(100);
		const span = beginSpan("motion", "click");
		at(600);
		span();
		const log = stopRecording(1_000);
		await persistAgentActivity(video, async () => {
			throw new Error("ffprobe is missing");
		});
		expect(await readAgentActivity(video)).toEqual(log);

		const emptyList = path.join(dir, "emptylist.mp4");
		startRecording();
		at(100);
		const other = beginSpan("motion", "click");
		at(600);
		other();
		stopRecording(1_000);
		await persistAgentActivity(emptyList, async () => []);
		expect(await readAgentActivity(emptyList)).not.toHaveProperty("changeTimesMs");
	});

	it("tolerates a byte order mark and rejects broken JSON", async () => {
		const video = path.join(dir, "bom.mp4");
		await fs.writeFile(
			`${video}.agent.json`,
			`﻿${JSON.stringify({ version: 1, scenes: [], spans: [] })}`,
		);
		expect(await readAgentActivity(video)).toEqual({ version: 1, scenes: [], spans: [] });
		await fs.writeFile(`${video}.agent.json`, "{");
		await expect(readAgentActivity(video)).rejects.toThrow();
	});

	it("normalizes change times: sorted, deduped, non-negative and capped", () => {
		expect(
			normalizeAgentActivityLog({
				version: 1,
				scenes: [],
				spans: [],
				changeTimesMs: [
					900,
					"400",
					400.4,
					400.6,
					Number.NaN,
					-20,
					Number.POSITIVE_INFINITY,
				],
			}),
		).toEqual({ version: 1, changeTimesMs: [0, 400, 401, 900], scenes: [], spans: [] });

		for (const changeTimesMs of [undefined, null, [], "0,1", {}, [Number.NaN, "x"]]) {
			expect(
				normalizeAgentActivityLog({ version: 1, scenes: [], spans: [], changeTimesMs }),
			).not.toHaveProperty("changeTimesMs");
		}

		const overLong = normalizeAgentActivityLog({
			version: 1,
			scenes: [],
			spans: [],
			changeTimesMs: Array.from({ length: MAX_CHANGE_TIMES + 500 }, (_, index) => index),
		});
		expect(overLong?.changeTimesMs).toHaveLength(MAX_CHANGE_TIMES);
	});

	it("normalizes malformed logs defensively", () => {
		expect(normalizeAgentActivityLog(null)).toBeNull();
		expect(normalizeAgentActivityLog({ version: 2, scenes: [], spans: [] })).toBeNull();
		expect(normalizeAgentActivityLog({ version: 1 })).toEqual({
			version: 1,
			scenes: [],
			spans: [],
		});
		expect(
			normalizeAgentActivityLog({
				version: 1,
				scenes: [
					{ startMs: 5_000, endMs: 6_000, failed: "yes", title: 7 },
					{ startMs: -10, endMs: 400, failed: true, title: "Intro" },
					{ startMs: 10, endMs: 5 },
					null,
				],
				spans: [
					null,
					{ kind: "think", action: "move", startMs: 0, endMs: 10 },
					{ kind: "motion", action: "teleport", startMs: 0, endMs: 10 },
					{ kind: "motion", action: "move", startMs: "0", endMs: 10 },
					{ kind: "hold", action: "wait", startMs: 20, endMs: 20 },
					{
						kind: "motion",
						action: "click",
						startMs: 300,
						endMs: 900,
						target: { cx: 1.5, cy: -0.2, width: 0.1, height: Number.NaN },
					},
					{
						kind: "motion",
						action: "drag",
						startMs: 100,
						endMs: 200,
						target: { cx: "left", cy: 0.5 },
					},
				],
			}),
		).toEqual({
			version: 1,
			scenes: [
				{ startMs: 0, endMs: 400, failed: true, title: "Intro" },
				{ startMs: 5_000, endMs: 6_000, failed: false },
			],
			spans: [
				{ kind: "motion", action: "drag", startMs: 100, endMs: 200 },
				{
					kind: "motion",
					action: "click",
					startMs: 300,
					endMs: 900,
					target: { cx: 1, cy: 0, width: 0.1 },
				},
			],
		});
	});
});

describe("camera targets", () => {
	const rect = { x: 0.1, y: 0.2, width: 0.5, height: 0.4 };

	it("records a marker with its time and label, and leaves logs without markers unchanged", () => {
		startRecording();
		at(300);
		expect(markCameraTarget(rect, "Notes")).toBe(true);
		at(900);
		expect(markCameraTarget(rect)).toBe(true);
		const log = stopRecording(2_000);
		expect(log.cameraTargets).toEqual([
			{ atMs: 300, ...rect, label: "Notes" },
			{ atMs: 900, ...rect },
		]);
		startRecording();
		expect("cameraTargets" in snapshotAgentActivity(500)).toBe(false);
	});

	it("keeps only the part of a rectangle that is on screen", () => {
		startRecording();
		at(100);
		expect(markCameraTarget({ x: 0.6, y: 0.1, width: 0.8, height: 0.2 })).toBe(true);
		expect(snapshotAgentActivity(200).cameraTargets).toEqual([
			{ atMs: 100, x: 0.6, y: 0.1, width: 0.4, height: 0.2 },
		]);
	});

	it("refuses unusable rectangles and a stopped clock, and drops markers at or after the stop", () => {
		expect(markCameraTarget(rect)).toBe(false);
		startRecording();
		at(100);
		expect(markCameraTarget({ ...rect, width: 0 })).toBe(false);
		expect(markCameraTarget({ ...rect, height: Number.NaN })).toBe(false);
		expect(markCameraTarget({ ...rect, x: Number.POSITIVE_INFINITY })).toBe(false);
		expect(markCameraTarget({ x: -1, y: 2, width: 3, height: 3 })).toBe(false);
		expect(markCameraTarget({ x: -0.25, y: 0.5, width: 0.75, height: 2 })).toBe(true);
		at(800);
		markCameraTarget(rect);
		const log = snapshotAgentActivity(800);
		expect(log.cameraTargets).toEqual([{ atMs: 100, x: 0, y: 0.5, width: 0.5, height: 0.5 }]);
	});

	it("persists a marker-only log and reads it back normalized", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-activity-"));
		try {
			const video = path.join(dir, "cam.mp4");
			startRecording();
			at(200);
			markCameraTarget(rect, "Browser");
			const log = stopRecording(1_000);
			await persistAgentActivity(video);
			expect(await readAgentActivity(video)).toEqual(log);
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
		expect(
			normalizeAgentActivityLog({
				version: 1,
				cameraTargets: [
					{ atMs: 900, x: 0, y: 0, width: 1, height: 1 },
					{ atMs: -5, x: 2, y: 0, width: 0.5, height: 0.5, label: 4 },
					{ atMs: 1, x: 0, y: 0, width: 0, height: 0.5 },
					{ atMs: "1", x: 0, y: 0, width: 0.5, height: 0.5 },
					null,
				],
			})?.cameraTargets,
		).toEqual([
			{ atMs: 0, x: 1, y: 0, width: 0.5, height: 0.5 },
			{ atMs: 900, x: 0, y: 0, width: 1, height: 1 },
		]);
	});

	it("round-trips scene titles through the sidecar, including a failed scene", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-activity-"));
		try {
			const video = path.join(dir, "titled.mp4");
			startRecording();
			at(100);
			const ok = beginScene("Open payroll");
			at(500);
			ok(false);
			const bad = beginScene("Run it");
			at(900);
			bad(true);
			stopRecording(1_000);
			await persistAgentActivity(video);
			expect((await readAgentActivity(video))?.scenes).toEqual([
				{ startMs: 100, endMs: 500, failed: false, title: "Open payroll" },
				{ startMs: 500, endMs: 900, failed: true, title: "Run it" },
			]);
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});

	it("keeps planned titles through the capture-start reset, aligned by scene order", () => {
		setPlannedSceneTitles(["One", "  ", "Three", "x".repeat(250)]);
		startRecording();
		const titles = ["", "", "", "", ""].map((_, i) => {
			at(i * 100 + 10);
			const end = beginScene(i === 4 ? "Explicit" : undefined);
			at(i * 100 + 50);
			end(false);
			return i;
		});
		expect(titles).toHaveLength(5);
		const log = stopRecording(1_000);
		expect(log.scenes.map((s) => s.title)).toEqual([
			"One",
			undefined,
			"Three",
			"x".repeat(200),
			"Explicit",
		]);
		setPlannedSceneTitles(undefined);
		startRecording();
		at(10);
		const end = beginScene();
		at(20);
		end(false);
		expect(stopRecording(30).scenes.map((s) => s.title)).toEqual([undefined]);
	});

	it("drops scene titles that are empty, blank, not text or too long", () => {
		const scene = (title: unknown) => ({ startMs: 0, endMs: 10, failed: false, title });
		const titles = [
			normalizeAgentActivityLog({
				version: 1,
				scenes: [scene(""), scene("   "), scene(null), scene({}), scene("x".repeat(201))],
			})?.scenes.map((s) => s.title),
			normalizeAgentActivityLog({ version: 1, scenes: [scene("x".repeat(200))] })?.scenes.map(
				(s) => s.title,
			),
		];
		expect(titles[0]).toEqual([undefined, undefined, undefined, undefined, undefined]);
		expect(titles[1]).toEqual(["x".repeat(200)]);
		expect(
			normalizeAgentActivityLog({ version: 1, scenes: [{ startMs: 0, endMs: 5 }] })?.scenes,
		).toEqual([{ startMs: 0, endMs: 5, failed: false }]);
		expect(normalizeAgentActivityLog({ version: 1, scenes: [] })?.scenes).toEqual([]);
	});

	it("rejects a half-written sidecar instead of returning a partial log", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-activity-"));
		try {
			const video = path.join(dir, "cut.mp4");
			await fs.writeFile(
				`${video}.agent.json`,
				'{"version":1,"scenes":[{"startMs":0,',
				"utf-8",
			);
			await expect(readAgentActivity(video)).rejects.toThrow();
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});
});
