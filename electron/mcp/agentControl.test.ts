import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const clock = vi.hoisted(() => ({ ms: 0 }));
vi.mock("electron", () => ({ app: {}, shell: {} }));
vi.mock("../ipc/cursor/bounds", () => ({}));
vi.mock("../ipc/cursor/telemetry", () => ({
	clamp: (value: number, min: number, max: number) => Math.min(max, Math.max(min, value)),
	getCursorCaptureElapsedMs: () => clock.ms,
	isCursorCapturePaused: () => false,
}));
vi.mock("../ipc/state", () => ({ isCursorCaptureActive: true }));
vi.mock("../ipc/utils", () => ({
	parseWindowId: (id?: string) => {
		const match = id?.match(/^window:(\d+)/);
		return match ? Number(match[1]) : null;
	},
}));
vi.mock("./agentInput", () => ({ agentInput: {} }));
vi.mock("./screenshot", () => ({ captureWindow: vi.fn(), waitForStillWindow: vi.fn() }));

import { resetAgentActivity, snapshotAgentActivity } from "./agentActivity";
import {
	type AgentControlDeps,
	type AgentStep,
	createAgentControl,
	TAKEOVER_MESSAGE,
} from "./agentControl";
import { createAgentPlatform, X11_REQUIRED } from "./agentPlatform";
import type { AgentCommand, AgentElement } from "./agentProtocol";

const FRAME = { x: 100, y: 50, width: 800, height: 600 };
const CHROME = {
	pid: 42,
	windowId: 7,
	title: "Docs",
	appName: "Google Chrome",
	bundleId: "com.google.Chrome",
	...FRAME,
};

type Handler = (command: AgentCommand) => unknown;

const tick = (command: AgentCommand) => {
	clock.ms += "ms" in command ? command.ms : 10;
	return {};
};

const element = (
	label: string,
	x: number,
	y: number,
	extra: Partial<AgentElement> = {},
): AgentElement => ({
	role: "AXButton",
	label,
	x: FRAME.x + x,
	y: FRAME.y + y,
	width: 80,
	height: 30,
	...extra,
});

function findOn(screen: AgentElement[] | (() => AgentElement[])) {
	return (command: AgentCommand) => {
		if (command.cmd !== "find") return {};
		const text = command.text?.trim().toLowerCase() ?? "";
		const elements = (typeof screen === "function" ? screen() : screen).filter(
			(each) =>
				(!text || each.label.toLowerCase().includes(text)) &&
				(!command.role || each.role === command.role) &&
				(command.offscreen || each.visible !== false),
		);
		return { elements: elements.slice(0, command.limit), truncated: false };
	};
}

async function flush() {
	for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
}

function setup(overrides: Partial<AgentControlDeps> = {}, handlers: Record<string, Handler> = {}) {
	let pointer = { x: FRAME.x, y: FRAME.y };
	const all: Record<string, Handler> = {
		preflight: () => ({ postEvents: true, accessibility: true }),
		frontmost_window: () => ({ window: CHROME }),
		move: tick,
		raise: () => ({ raised: true }),
		cursor: () => pointer,
		...handlers,
	};
	const commands: AgentCommand[] = [];
	const events = new EventEmitter();
	const request = vi.fn(async (command: AgentCommand) => {
		commands.push(command);
		const result = await (all[command.cmd]?.(command) ?? {});
		if (command.cmd === "move" || command.cmd === "click" || command.cmd === "scroll") {
			pointer = { x: command.x, y: command.y };
		}
		if (command.cmd === "drag") pointer = { x: command.toX, y: command.toY };
		return result;
	});
	const remote = {
		getStatus: vi.fn(() => ({ state: "idle" })),
		listSources: vi.fn(async () => [
			{ id: "screen:1", name: "Screen 1", type: "screen" },
			{ id: "window:9:0", name: "Google Chrome — Example", type: "window" },
		]),
		selectSource: vi.fn(async ({ id }: { id?: string }) => ({ id, type: "window" })),
	};
	const deps = {
		input: { request, events } as unknown as AgentControlDeps["input"],
		platform: createAgentPlatform({ platform: "darwin", ownPid: 1, ownWindowIds: () => [] }),
		getSelectedSource: () => ({ id: "window:7:0", name: "Docs", pid: 42 }),
		findWindow: vi.fn(async () => ({ pid: 42, frame: FRAME })),
		capture: vi.fn(async () => ({
			data: "aGk=",
			mimeType: "image/jpeg" as const,
			width: 800,
			height: 600,
			scale: 1,
			originX: 0,
			originY: 0,
		})),
		openExternal: vi.fn(async () => undefined),
		getBrowserName: () => "Google Chrome.app",
		getDisplays: () => [{ x: 0, y: 0, width: 3000, height: 2000 }],
		sleep: async (ms: number) => {
			clock.ms += ms;
		},
		now: () => clock.ms,
		waitForStill: vi.fn(async () => ({ settled: true, elapsedMs: 0 })),
		...overrides,
	};
	const agent = createAgentControl(remote as never, deps);
	const names = () => commands.map((command) => command.cmd);
	const count = (cmd: string) => names().filter((name) => name === cmd).length;
	return { agent, deps, remote, events, commands, names, count };
}

describe("perform", () => {
	it("raises the window, then runs window-relative steps as global points between arm and disarm", async () => {
		const { agent, commands } = setup();
		await expect(
			agent.perform([
				{ action: "move", x: 10, y: 20 },
				{ action: "click", x: 5, y: 5, count: 2 },
				{ action: "wait", ms: 100 },
				{ action: "scroll", x: 1, y: 2, deltaY: 300 },
				{ action: "type", text: "hi" },
				{ action: "key", key: "enter" },
			]),
		).resolves.toEqual({ performed: 6, durationMs: 1_750 });
		expect(commands).toEqual([
			{ cmd: "preflight" },
			{ cmd: "frontmost_window" },
			{ cmd: "arm" },
			{ cmd: "cursor" },
			{ cmd: "move", x: 110, y: 70, ms: 450 },
			{ cmd: "cursor" },
			{ cmd: "click", x: 105, y: 55, ms: 450, button: "left", count: 2, modifiers: [] },
			{ cmd: "scroll", x: 101, y: 52, ms: 600, dx: 0, dy: 300, modifiers: [] },
			{ cmd: "frontmost_window" },
			{ cmd: "type", text: "hi", cps: 25 },
			{ cmd: "frontmost_window" },
			{ cmd: "key", key: "enter", modifiers: [], repeat: 1 },
			{ cmd: "disarm" },
		]);
	});

	it("refuses a point outside the window before raising or posting anything", async () => {
		const { agent, names } = setup();
		await expect(
			agent.perform([
				{ action: "move", x: 10, y: 10 },
				{ action: "click", x: 800, y: 10 },
			]),
		).rejects.toThrow(/outside the selected window/);
		expect(names()).toEqual(["preflight"]);
	});

	it("re-checks fresh bounds on every pointer step", async () => {
		const findWindow = vi
			.fn()
			.mockResolvedValueOnce({ pid: 42, frame: FRAME })
			.mockResolvedValueOnce({ pid: 42, frame: FRAME })
			.mockResolvedValue({ pid: 42, frame: { ...FRAME, width: 100 } });
		const { agent, names, count } = setup({ findWindow });
		await expect(
			agent.perform([
				{ action: "move", x: 10, y: 10 },
				{ action: "move", x: 500, y: 10 },
			]),
		).rejects.toThrow(/outside the selected window/);
		expect(count("move")).toBe(1);
		expect(names().at(-1)).toBe("disarm");
	});

	it.each([
		["type", { action: "type" as const, text: "secret" }],
		["key", { action: "key" as const, key: "enter" }],
	])("refuses %s while another app is frontmost", async (cmd, step) => {
		const { agent, count } = setup(
			{},
			{
				frontmost_window: vi
					.fn()
					.mockReturnValueOnce({ window: CHROME })
					.mockReturnValue({ window: { ...CHROME, pid: 99 } }),
			},
		);
		await expect(agent.perform([step])).rejects.toThrow(/another app is in front/);
		expect(count(cmd)).toBe(0);
		expect(count("arm")).toBe(1);
		expect(count("disarm")).toBe(1);
	});

	it("stops at once when the user takes over mid-sequence, and disarms", async () => {
		const { agent, events, count } = setup({
			sleep: (ms) => (ms === 5000 ? new Promise(() => undefined) : Promise.resolve()),
		});
		const running = agent.perform([
			{ action: "click", x: 10, y: 10 },
			{ action: "wait", ms: 5000 },
			{ action: "click", x: 20, y: 20 },
		]);
		await flush();
		expect(count("click")).toBe(1);
		events.emit("user-input", { event: "user-input", kind: "move", escape: false });
		events.emit("user-input", { event: "user-input", kind: "key", escape: false });
		await expect(running).rejects.toThrow(
			`${TAKEOVER_MESSAGE} Recordly noticed that the mouse moved.`,
		);
		expect(count("click")).toBe(1);
		expect(count("disarm")).toBe(1);
		expect(events.listenerCount("user-input")).toBe(0);
	});

	it("posts nothing when the user takes over while a step is still looking up the window", async () => {
		let release!: (value: unknown) => void;
		const findWindow = vi
			.fn()
			.mockResolvedValueOnce({ pid: 42, frame: FRAME })
			.mockReturnValueOnce(
				new Promise((resolve) => {
					release = resolve;
				}),
			);
		const { agent, events, count } = setup({ findWindow });
		const running = agent.perform([{ action: "click", x: 10, y: 10 }]);
		await flush();
		expect(findWindow).toHaveBeenCalledTimes(2);
		events.emit("user-input", { event: "user-input", kind: "move", escape: false });
		await expect(running).rejects.toThrow(TAKEOVER_MESSAGE);
		release({ pid: 42, frame: FRAME });
		await flush();
		expect(count("click")).toBe(0);
		expect(count("disarm")).toBe(1);
	});

	it("lets the pointer through the control pill while acting, and restores it after", async () => {
		const hud: boolean[] = [];
		const { agent } = setup({ setHudPassthrough: (active: boolean) => hud.push(active) });
		await agent.perform([{ action: "click", x: 10, y: 10 }]);
		expect(hud).toEqual([true, false]);
		hud.length = 0;
		const failing = setup(
			{ setHudPassthrough: (active: boolean) => hud.push(active) },
			{
				click: () => {
					throw new Error("boom");
				},
			},
		);
		await expect(failing.agent.perform([{ action: "click", x: 10, y: 10 }])).rejects.toThrow();
		expect(hud).toEqual([true, false]);
	});

	it("runs one action at a time", async () => {
		const { agent, events } = setup({
			sleep: (ms) => (ms === 5000 ? new Promise(() => undefined) : Promise.resolve()),
		});
		const first = agent.perform([{ action: "wait", ms: 5000 }]);
		await flush();
		await expect(agent.perform([{ action: "wait", ms: 1 }])).rejects.toThrow(
			"Another action is still running.",
		);
		await expect(agent.openUrl("https://example.com")).rejects.toThrow(
			"Another action is still running.",
		);
		events.emit("user-input", { event: "user-input", kind: "key", escape: true });
		await expect(first).rejects.toThrow("Recordly noticed that Esc was pressed.");
		await expect(agent.perform([{ action: "wait", ms: 1 }])).resolves.toEqual({
			performed: 1,
			durationMs: 0,
		});
	});

	it("fails before arming when the window did not come to the front", async () => {
		const { agent, count } = setup(
			{},
			{ frontmost_window: () => ({ window: { ...CHROME, pid: 99 } }) },
		);
		await expect(agent.perform([{ action: "wait", ms: 1 }])).rejects.toThrow(
			"Recordly couldn't bring the window to the front.",
		);
		expect(count("arm")).toBe(0);
	});

	it("refuses points that land off every display, and Recordly's own windows", async () => {
		const offDisplay = setup({ getDisplays: () => [{ x: 0, y: 0, width: 500, height: 500 }] });
		await expect(
			offDisplay.agent.perform([{ action: "click", x: 450, y: 10 }]),
		).rejects.toThrow(/off screen/);
		expect(offDisplay.count("raise")).toBe(0);

		const own = setup({ findWindow: async () => ({ pid: 1, frame: FRAME }) });
		await expect(own.agent.perform([{ action: "wait", ms: 1 }])).rejects.toThrow(
			/its own windows/,
		);
		expect(own.count("raise")).toBe(0);
	});

	it("maps a helper user-input error to the takeover message", async () => {
		const { agent, count } = setup(
			{},
			{
				click: () => {
					throw new Error("user-input");
				},
			},
		);
		await expect(agent.perform([{ action: "click", x: 1, y: 1 }])).rejects.toThrow(
			TAKEOVER_MESSAGE,
		);
		expect(count("arm")).toBe(count("disarm"));
	});

	it("keeps arm and disarm balanced when a step or arm itself fails", async () => {
		const failing = setup(
			{},
			{
				move: () => {
					throw new Error("boom");
				},
			},
		);
		await expect(failing.agent.perform([{ action: "move", x: 1, y: 1 }])).rejects.toThrow(
			"boom",
		);
		expect([failing.count("arm"), failing.count("disarm")]).toEqual([1, 1]);

		const noTap = setup(
			{},
			{
				arm: () => {
					throw new Error("tap failed");
				},
			},
		);
		await expect(noTap.agent.perform([{ action: "wait", ms: 1 }])).rejects.toThrow(
			"tap failed",
		);
		expect([noTap.count("arm"), noTap.count("disarm")]).toEqual([1, 0]);
	});

	it("turns the HUD passthrough back off and drops the listener when arming fails", async () => {
		const setHudPassthrough = vi.fn();
		const noTap = setup(
			{ setHudPassthrough },
			{
				arm: () => {
					throw new Error("tap failed");
				},
			},
		);
		await expect(noTap.agent.perform([{ action: "wait", ms: 1 }])).rejects.toThrow(
			"tap failed",
		);
		expect(setHudPassthrough.mock.calls.flat()).toEqual([true, false]);
		expect(noTap.events.listenerCount("user-input")).toBe(0);
	});

	it.each([
		["too many steps", Array.from({ length: 201 }, () => ({ action: "wait" as const, ms: 1 }))],
		["no steps", []],
		["a wait over 30 s", [{ action: "wait" as const, ms: 30_001 }]],
		[
			"more than 10 minutes",
			Array.from({ length: 21 }, () => ({ action: "wait" as const, ms: 30_000 })),
		],
	])("refuses %s before touching the helper", async (_, steps) => {
		const { agent, commands } = setup();
		await expect(agent.perform(steps)).rejects.toThrow();
		expect(commands).toHaveLength(0);
	});
});

describe("bringing the window to the front", () => {
	it.each([
		["another app", { ...CHROME, pid: 99 }],
		["another window of the same app", { ...CHROME, windowId: 8 }],
	])("raises and settles when %s is in front", async (_, window) => {
		const sleep = vi.fn(async () => undefined);
		const { agent, names } = setup(
			{ sleep },
			{
				frontmost_window: vi
					.fn()
					.mockReturnValueOnce({ window })
					.mockReturnValue({ window: CHROME }),
			},
		);
		await agent.perform([{ action: "move", x: 1, y: 1 }]);
		expect(names()).toEqual([
			"preflight",
			"frontmost_window",
			"raise",
			"frontmost_window",
			"arm",
			"cursor",
			"move",
			"disarm",
		]);
		expect(sleep).toHaveBeenCalledWith(250);
	});

	it("skips the raise and its settle when the window is already in front", async () => {
		const sleep = vi.fn(async () => undefined);
		const { agent, count } = setup({ sleep });
		await agent.perform([{ action: "move", x: 1, y: 1 }]);
		expect(count("raise")).toBe(0);
		expect(count("frontmost_window")).toBe(1);
		expect(sleep).not.toHaveBeenCalled();
	});
});

describe("activity log", () => {
	const timed = (
		handlers: Record<string, Handler> = {},
		overrides: Partial<AgentControlDeps> = {},
	) =>
		setup(
			{
				sleep: async (ms) => {
					clock.ms += ms;
				},
				...overrides,
			},
			{
				move: tick,
				click: tick,
				drag: tick,
				scroll: tick,
				type: tick,
				key: tick,
				...handlers,
			},
		);

	beforeEach(() => {
		clock.ms = 1_000;
		resetAgentActivity();
	});

	it("logs one titled scene per perform with measured motion and hold spans", async () => {
		const { agent } = timed(
			{},
			{
				waitForStill: async () => {
					clock.ms += 200;
					return { settled: true, elapsedMs: 200 };
				},
			},
		);
		await agent.perform(
			[
				{ action: "move", x: 80, y: 60, durationMs: 500 },
				{ action: "click", x: 400, y: 300, durationMs: 600 },
				{ action: "drag", fromX: 0, fromY: 0, toX: 200, toY: 150, durationMs: 900 },
				{ action: "wait", ms: 1_000 },
				{ action: "scroll", x: 80, y: 60, deltaY: 100 },
				{ action: "type", text: "hi" },
				{ action: "key", key: "enter" },
			],
			{ title: "Tour" },
		);
		clock.ms = 9_000;
		await agent.perform([{ action: "wait", ms: 100 }]);
		expect(snapshotAgentActivity(clock.ms)).toEqual({
			version: 1,
			scenes: [
				{ startMs: 1_000, endMs: 7_420, failed: false, title: "Tour" },
				{ startMs: 9_000, endMs: 9_100, failed: false },
			],
			spans: [
				{
					kind: "motion",
					action: "move",
					startMs: 1_000,
					endMs: 1_500,
					target: { cx: 0.1, cy: 0.1 },
				},
				{
					kind: "motion",
					action: "click",
					startMs: 1_500,
					endMs: 2_100,
					target: { cx: 0.5, cy: 0.5 },
				},
				{ kind: "wait", action: "wait", startMs: 2_100, endMs: 2_300 },
				{ kind: "hold", action: "wait", startMs: 2_300, endMs: 3_500 },
				{
					kind: "motion",
					action: "drag",
					startMs: 3_500,
					endMs: 4_400,
					target: { cx: 0.25, cy: 0.25 },
				},
				{ kind: "hold", action: "wait", startMs: 4_400, endMs: 5_400 },
				{
					kind: "motion",
					action: "scroll",
					startMs: 5_400,
					endMs: 6_000,
					target: { cx: 0.1, cy: 0.1 },
				},
				{ kind: "motion", action: "type", startMs: 6_000, endMs: 6_010 },
				{ kind: "motion", action: "key", startMs: 6_010, endMs: 6_020 },
				{ kind: "wait", action: "wait", startMs: 6_020, endMs: 6_220 },
				{ kind: "hold", action: "wait", startMs: 6_220, endMs: 7_420 },
				{ kind: "hold", action: "wait", startMs: 9_000, endMs: 9_100 },
			],
		});
	});

	it("logs the raise and its settle as a wait", async () => {
		const { agent } = timed({
			frontmost_window: vi
				.fn()
				.mockReturnValueOnce({ window: { ...CHROME, pid: 99 } })
				.mockReturnValue({ window: CHROME }),
		});
		await agent.perform([{ action: "move", x: 1, y: 1, durationMs: 400 }]);
		expect(snapshotAgentActivity(clock.ms).spans.slice(0, 2)).toEqual([
			{ kind: "wait", action: "raise", startMs: 1_000, endMs: 1_250 },
			{
				kind: "motion",
				action: "move",
				startMs: 1_250,
				endMs: 1_650,
				target: { cx: 1 / 800, cy: 1 / 600 },
			},
		]);
	});

	it("marks the scene failed on a takeover, ending the running span at once", async () => {
		const { agent, events } = timed(
			{},
			{
				sleep: (ms) => (ms === 5_000 ? new Promise(() => undefined) : Promise.resolve()),
			},
		);
		const running = agent.perform([{ action: "wait", ms: 5_000 }], { title: "Interrupted" });
		await flush();
		clock.ms = 2_500;
		events.emit("user-input", { event: "user-input", kind: "move", escape: false });
		await expect(running).rejects.toThrow(TAKEOVER_MESSAGE);
		expect(snapshotAgentActivity(9_000)).toEqual({
			version: 1,
			scenes: [{ startMs: 1_000, endMs: 2_500, failed: true, title: "Interrupted" }],
			spans: [{ kind: "hold", action: "wait", startMs: 1_000, endMs: 2_500 }],
		});
	});

	it("cuts a scene whose step or check fails for any reason, and logs nothing for refused calls", async () => {
		const { agent } = timed({
			click: (command) => {
				tick(command);
				throw new Error("boom");
			},
		});
		await expect(
			agent.perform([{ action: "click", x: 1, y: 1, durationMs: 600 }]),
		).rejects.toThrow("Step 1 (click): boom");
		await expect(agent.perform([{ action: "wait", ms: 30_001 }])).rejects.toThrow();
		clock.ms = 3_000;
		const offWindow = timed(
			{},
			{
				findWindow: async () => {
					clock.ms += 5;
					return null;
				},
			},
		);
		await expect(offWindow.agent.perform([{ action: "wait", ms: 1 }])).rejects.toThrow();
		const log = snapshotAgentActivity(5_000);
		expect(log.scenes).toEqual([
			{ startMs: 1_000, endMs: 1_600, failed: true },
			{ startMs: 3_000, endMs: 3_005, failed: true },
		]);
		expect(log.spans).toEqual([
			{
				kind: "motion",
				action: "click",
				startMs: 1_000,
				endMs: 1_600,
				target: { cx: 1 / 800, cy: 1 / 600 },
			},
		]);
	});
});

describe("keyboard and mouse details", () => {
	const keyOf = async (step: AgentStep) => {
		const { agent, commands } = setup();
		await agent.perform([step]);
		return commands.find((command) => command.cmd === "key");
	};

	it("normalises modifier aliases case-insensitively and drops duplicates", async () => {
		await expect(
			keyOf({
				action: "key",
				key: "z",
				modifiers: ["Command", "OPTION", " control ", "Shift", "function", "cmd", "meta"],
			}),
		).resolves.toEqual({
			cmd: "key",
			key: "z",
			modifiers: ["cmd", "alt", "ctrl", "shift", "fn"],
			repeat: 1,
		});
	});

	it("refuses an unknown modifier before touching the helper, listing the valid names", async () => {
		const { agent, commands } = setup();
		const outcome = agent.perform([{ action: "click", x: 1, y: 1, modifiers: ["hyper"] }]);
		await expect(outcome).rejects.toThrow(
			/Unknown modifier "hyper"\. Use one of: cmd, command/,
		);
		await expect(
			agent.perform([{ action: "key", key: "a", modifiers: ["constructor"] }]),
		).rejects.toThrow(/Unknown modifier/);
		expect(commands).toHaveLength(0);
	});

	it.each([
		["Return", "enter"],
		["ESC", "escape"],
		["ArrowUp", "up"],
		["Page_Down", "pagedown"],
		["page up", "pageup"],
		["F12", "f12"],
		["F20", "f20"],
		["Forward-Delete", "delete"],
		["Backspace", "backspace"],
		["keypad-enter", "keypadenter"],
		["Backtick", "grave"],
		["\n", "enter"],
		["\r\n", "enter"],
		["\t", "tab"],
		["?", "?"],
		["A", "A"],
		["a", "a"],
		[" ", " "],
		["-", "-"],
		["é", "é"],
		["e\u0301", "e\u0301"],
		["€", "€"],
		["👍🏽", "👍🏽"],
	])("sends key %j as %j", async (key, sent) => {
		await expect(keyOf({ action: "key", key })).resolves.toMatchObject({ key: sent });
	});

	it.each([
		["a word", "hello", /Unknown key "hello".*type_text/],
		["a shortcut string", "cmd+c", /Pass modifiers separately/],
		["an empty key", "", /Unknown key ""/],
		["a control character", "\u0007", /Unknown key/],
		["two characters", "ab", /Unknown key "ab"/],
	])("refuses %s before touching the helper", async (_, key, message) => {
		const { agent, commands } = setup();
		await expect(agent.perform([{ action: "key", key }])).rejects.toThrow(message);
		expect(commands).toHaveLength(0);
	});

	it("passes key repeat through and refuses repeats outside 1 to 100", async () => {
		await expect(keyOf({ action: "key", key: "down", repeat: 100 })).resolves.toMatchObject({
			repeat: 100,
		});
		for (const repeat of [0, 101, 2.5]) {
			const { agent, commands } = setup();
			await expect(agent.perform([{ action: "key", key: "down", repeat }])).rejects.toThrow(
				/repeat must be a whole number from 1 to 100/,
			);
			expect(commands).toHaveLength(0);
		}
	});

	it("sends triple clicks with modifiers and refuses other counts", async () => {
		const { agent, commands } = setup();
		await agent.perform([
			{ action: "click", x: 5, y: 5, count: 3, modifiers: ["Shift"], button: "right" },
		]);
		expect(commands.find((command) => command.cmd === "click")).toEqual({
			cmd: "click",
			x: 105,
			y: 55,
			ms: 450,
			button: "right",
			count: 3,
			modifiers: ["shift"],
		});
		const bad = setup();
		await expect(
			bad.agent.perform([{ action: "click", x: 5, y: 5, count: 4 as 3 }]),
		).rejects.toThrow(/count must be 1, 2 or 3/);
		expect(bad.commands).toHaveLength(0);
	});

	it("drags between two window points as global points", async () => {
		const { agent, commands } = setup();
		await agent.perform([
			{ action: "drag", fromX: 10, fromY: 20, toX: 300, toY: 400, modifiers: ["alt"] },
			{
				action: "drag",
				fromX: 1,
				fromY: 1,
				toX: 2,
				toY: 2,
				durationMs: 50,
				button: "middle",
			},
		]);
		expect(commands.filter((command) => command.cmd === "drag")).toEqual([
			{
				cmd: "drag",
				fromX: 110,
				fromY: 70,
				toX: 400,
				toY: 450,
				ms: 565,
				button: "left",
				modifiers: ["alt"],
			},
			{
				cmd: "drag",
				fromX: 101,
				fromY: 51,
				toX: 102,
				toY: 52,
				ms: 50,
				button: "middle",
				modifiers: [],
			},
		]);
	});

	it.each([
		["the start outside the window", { fromX: -1, fromY: 10, toX: 10, toY: 10 }, /outside/],
		["the end outside the window", { fromX: 10, fromY: 10, toX: 10, toY: 600 }, /outside/],
		["the end off every display", { fromX: 10, fromY: 10, toX: 700, toY: 10 }, /off screen/],
	])("refuses a drag with %s before raising", async (_, points, message) => {
		const { agent, names } = setup({
			getDisplays: () => [{ x: 0, y: 0, width: 600, height: 2000 }],
		});
		await expect(agent.perform([{ action: "drag", ...points }])).rejects.toThrow(message);
		expect(names()).toEqual(["preflight"]);
	});

	it("re-checks both drag endpoints against fresh bounds", async () => {
		const findWindow = vi
			.fn()
			.mockResolvedValueOnce({ pid: 42, frame: FRAME })
			.mockResolvedValue({ pid: 42, frame: { ...FRAME, height: 100 } });
		const { agent, count, names } = setup({ findWindow });
		await expect(
			agent.perform([{ action: "drag", fromX: 10, fromY: 10, toX: 10, toY: 300 }]),
		).rejects.toThrow(/outside the selected window/);
		expect(count("drag")).toBe(0);
		expect(names().at(-1)).toBe("disarm");
	});

	it("stops a drag at once when the user takes over, and disarms so the helper releases", async () => {
		const { agent, events, count, names } = setup(
			{},
			{ drag: () => new Promise(() => undefined) },
		);
		const running = agent.perform([{ action: "drag", fromX: 1, fromY: 1, toX: 50, toY: 50 }]);
		await flush();
		expect(count("drag")).toBe(1);
		events.emit("user-input", { event: "user-input", kind: "move", escape: false });
		await expect(running).rejects.toThrow(TAKEOVER_MESSAGE);
		expect(names().at(-1)).toBe("disarm");
	});

	it("checks the window is in front for modifier clicks, drags and scrolls, but not plain ones", async () => {
		const plain = setup();
		await plain.agent.perform([
			{ action: "click", x: 1, y: 1 },
			{ action: "drag", fromX: 1, fromY: 1, toX: 2, toY: 2, modifiers: [] },
			{ action: "scroll", x: 1, y: 1, deltaY: 10 },
		]);
		expect(plain.count("frontmost_window")).toBe(1);

		for (const step of [
			{ action: "click" as const, x: 1, y: 1, modifiers: ["cmd"] },
			{ action: "drag" as const, fromX: 1, fromY: 1, toX: 2, toY: 2, modifiers: ["alt"] },
			{ action: "scroll" as const, x: 1, y: 1, deltaY: 10, modifiers: ["shift"] },
		]) {
			const behind = setup(
				{},
				{
					frontmost_window: vi
						.fn()
						.mockReturnValueOnce({ window: CHROME })
						.mockReturnValue({ window: { ...CHROME, pid: 99 } }),
				},
			);
			await expect(behind.agent.perform([step])).rejects.toThrow(/another app is in front/);
			expect(behind.count(step.action)).toBe(0);
			expect(behind.count("disarm")).toBe(1);
		}
	});

	it("passes tabs and newlines in typed text to the helper unchanged", async () => {
		const { agent, commands } = setup();
		await agent.perform([{ action: "type", text: "a\tb\r\nc\nd" }]);
		expect(commands.find((command) => command.cmd === "type")).toEqual({
			cmd: "type",
			text: "a\tb\r\nc\nd",
			cps: 25,
		});
	});

	it("budgets drags and key repeats against the 10 minute limit", async () => {
		const { agent, commands } = setup();
		await expect(
			agent.perform(
				Array.from({ length: 21 }, () => ({
					action: "drag" as const,
					fromX: 1,
					fromY: 1,
					toX: 2,
					toY: 2,
					durationMs: 30_000,
				})),
			),
		).rejects.toThrow(/10 minutes/);
		expect(commands).toHaveLength(0);
	});
});

describe("preflight and target checks", () => {
	it("refuses on Wayland and explains missing input permission", async () => {
		const wayland = createAgentPlatform({
			platform: "linux",
			env: { WAYLAND_DISPLAY: "wayland-0" },
			ozonePlatform: () => "",
		});
		await expect(setup({ platform: wayland }).agent.preflightInput()).rejects.toThrow(
			X11_REQUIRED,
		);
		const denied = setup({}, { preflight: () => ({ postEvents: false, accessibility: true }) });
		await expect(denied.agent.perform([{ action: "wait", ms: 1 }])).rejects.toThrow(
			/npm run dev/,
		);
		expect(denied.count("arm")).toBe(0);
	});

	it("needs a selected window that is on this desktop", async () => {
		const none = setup({ getSelectedSource: () => null });
		await expect(none.agent.findElements({})).rejects.toThrow(/Select a window first/);
		const screen = setup({ getSelectedSource: () => ({ id: "screen:1", name: "Screen" }) });
		await expect(screen.agent.findElements({})).rejects.toThrow(
			/Choose the window for the mouse and keyboard first/,
		);
		const gone = setup({ findWindow: async () => null });
		await expect(gone.agent.screenshot()).rejects.toThrow(/another desktop/);
	});
});

describe("findElements and screenshot", () => {
	it("passes the window to the helper and returns window-relative frames", async () => {
		const { agent, commands } = setup(
			{},
			{
				find: () => ({
					elements: [
						{ role: "AXButton", label: "Save", x: 150, y: 80, width: 40, height: 20 },
					],
					truncated: false,
				}),
			},
		);
		await expect(agent.findElements({ text: "save" })).resolves.toEqual({
			elements: [{ role: "AXButton", label: "Save", x: 50, y: 30, width: 40, height: 20 }],
			truncated: false,
		});
		expect(commands).toEqual([
			{
				cmd: "find",
				pid: 42,
				windowId: 7,
				frame: FRAME,
				text: "save",
				role: undefined,
				limit: 30,
			},
		]);
	});

	it("raises the window before capturing its frame", async () => {
		const { agent, deps, names } = setup();
		await expect(agent.screenshot()).resolves.toMatchObject({ width: 800, scale: 1 });
		expect(names()).toEqual(["raise"]);
		expect(deps.capture).toHaveBeenCalledWith(FRAME, undefined);
		const region = { x: 10, y: 20, width: 300, height: 200 };
		await agent.screenshot(region);
		expect(deps.capture).toHaveBeenLastCalledWith(FRAME, region);
	});
});

describe("openUrl", () => {
	it("refuses non-http URLs and refuses while recording", async () => {
		const { agent, deps, remote } = setup();
		await expect(agent.openUrl("file:///etc/passwd")).rejects.toThrow(/http and https/);
		await expect(agent.openUrl("not a url")).rejects.toThrow(/full http/);
		remote.getStatus.mockReturnValue({ state: "recording" });
		await expect(agent.openUrl("https://example.com")).rejects.toThrow(/while recording/);
		expect(deps.openExternal).not.toHaveBeenCalled();
	});

	it("waits for a stable browser window in front and selects it by its listed id", async () => {
		const frontmost = [
			{ ...CHROME, pid: 5, windowId: 3, appName: "Terminal" },
			{ ...CHROME, pid: 1, windowId: 4, appName: "Recordly" },
			{ ...CHROME, windowId: 9 },
			{ ...CHROME, windowId: 9 },
		];
		const { agent, deps, remote } = setup(
			{},
			{ frontmost_window: () => ({ window: frontmost.shift() ?? null }) },
		);
		await expect(agent.openUrl("https://example.com")).resolves.toEqual({
			url: "https://example.com/",
			source: { id: "window:9:0", type: "window" },
		});
		expect(deps.openExternal).toHaveBeenCalledWith("https://example.com/");
		expect(remote.selectSource).toHaveBeenCalledWith({ id: "window:9:0" });
	});

	it("accepts only known browsers when the default browser is unknown", async () => {
		const terminal = {
			...CHROME,
			windowId: 3,
			appName: "Terminal",
			bundleId: "com.apple.Terminal",
		};
		const frontmost = [
			terminal,
			terminal,
			{ ...CHROME, windowId: 9 },
			{ ...CHROME, windowId: 9 },
		];
		const { agent, remote } = setup(
			{ getBrowserName: () => "" },
			{ frontmost_window: () => ({ window: frontmost.shift() ?? null }) },
		);
		await agent.openUrl("https://example.com");
		expect(remote.selectSource).toHaveBeenCalledWith({ id: "window:9:0" });
	});

	it("gives up after about 5 s without a browser window", async () => {
		const { agent, remote } = setup({}, { frontmost_window: () => ({ window: null }) });
		await expect(agent.openUrl("https://example.com")).rejects.toThrow(/could not find/);
		expect(remote.selectSource).not.toHaveBeenCalled();
	});
});

describe("targets", () => {
	beforeEach(() => {
		clock.ms = 1_000;
		resetAgentActivity();
	});

	const spansOf = () =>
		snapshotAgentActivity(clock.ms).spans.map(({ kind, action }) => `${kind}:${action}`);

	it("clicks the centre of the one visible match and logs its size", async () => {
		const { agent, commands } = setup(
			{},
			{ find: findOn([element("Save", 300, 200)]), click: tick },
		);
		await agent.perform([
			{ action: "click", target: { text: "save" }, durationMs: 500 },
			{ action: "wait", ms: 10 },
		]);
		const query = {
			cmd: "find",
			pid: 42,
			windowId: 7,
			frame: FRAME,
			text: "save",
			role: undefined,
			limit: 200,
		};
		expect(commands.filter((command) => command.cmd === "find")).toEqual([
			query,
			{ ...query, offscreen: true },
			query,
			query,
		]);
		expect(commands.find((command) => command.cmd === "move")).toMatchObject({
			x: 440,
			y: 265,
			ms: 500,
		});
		expect(commands.find((command) => command.cmd === "click")).toMatchObject({
			x: 440,
			y: 265,
			ms: 0,
		});
		expect(snapshotAgentActivity(clock.ms).spans[1]).toEqual({
			kind: "motion",
			action: "click",
			startMs: 1_100,
			endMs: 1_600,
			target: { cx: 340 / 800, cy: 215 / 600, width: 0.1, height: 0.05 },
		});
	});

	it("refuses several equally good matches, listing them in reading order, and picks one by index", async () => {
		const screen = [
			element("Save", 300, 400),
			element("Save", 300, 100),
			element("Save", 100, 104),
		];
		const ambiguous = setup({}, { find: findOn(screen) });
		await expect(
			ambiguous.agent.perform([{ action: "click", target: { text: "Save" } }]),
		).rejects.toThrow(
			'Step 1 (click): 3 elements match "Save" equally well. Add an index (0-based, best match ' +
				"first, then top to bottom): " +
				'0: "Save" (AXButton) at (140, 119), 1: "Save" (AXButton) at (340, 115), ' +
				'2: "Save" (AXButton) at (340, 415).',
		);
		expect(ambiguous.count("click")).toBe(0);

		const picked = setup({}, { find: findOn(screen) });
		await picked.agent.perform([
			{ action: "click", target: { text: "Save", index: 1 } },
			{ action: "click", target: { text: "Save", index: 2 } },
		]);
		expect(
			picked.commands.flatMap((command) =>
				command.cmd === "click" ? [[command.x, command.y]] : [],
			),
		).toEqual([
			[440, 165],
			[440, 465],
		]);
	});

	it("prefers the one exact label among several matches", async () => {
		const { agent, commands } = setup(
			{},
			{ find: findOn([element("Save as…", 100, 100), element("Save", 300, 100)]) },
		);
		await agent.perform([{ action: "click", target: { text: "save" } }]);
		expect(commands.find((command) => command.cmd === "click")).toMatchObject({
			x: 440,
			y: 165,
		});
	});

	it("waits for a missing target, logging the wait, then clicks it", async () => {
		let finds = 0;
		const { agent, count } = setup(
			{},
			{
				find: findOn(() => {
					finds += 1;
					return finds > 6 ? [element("Save", 300, 200)] : [];
				}),
				click: tick,
			},
		);
		await agent.perform([{ action: "click", target: { text: "Save" }, durationMs: 100 }]);
		expect(count("click")).toBe(1);
		expect(snapshotAgentActivity(clock.ms).spans.slice(0, 3)).toMatchObject([
			{ kind: "wait", action: "wait", startMs: 1_000, endMs: 1_750 },
			{ kind: "wait", action: "wait", startMs: 1_750, endMs: 1_850 },
			{ kind: "motion", action: "click", startMs: 1_850, endMs: 1_950 },
		]);
	});

	it("ends the target wait at once when the user takes over while a find is running", async () => {
		let finds = 0;
		const { agent, events, count } = setup(
			{},
			{
				find: () => {
					finds += 1;
					return finds > 2
						? new Promise(() => undefined)
						: { elements: [], truncated: false };
				},
			},
		);
		const running = agent.perform([{ action: "click", target: { text: "Save" } }]);
		await flush();
		expect(finds).toBe(3);
		events.emit("user-input", { event: "user-input", kind: "move", escape: false });
		await expect(running).rejects.toThrow(`Step 1 (click): ${TAKEOVER_MESSAGE}`);
		expect(snapshotAgentActivity(clock.ms + 5_000).spans).toEqual([
			{ kind: "wait", action: "wait", startMs: 1_000, endMs: 1_250 },
		]);
		expect(count("click")).toBe(0);
	});

	it("fails after 5 s with the nearest labels when the target never appears", async () => {
		const { agent, commands, count } = setup(
			{},
			{
				find: findOn([
					element("Register", 10, 10, { role: "AXLink" }),
					element("Log in", 100, 10),
					element("", 200, 10),
				]),
			},
		);
		await expect(
			agent.perform([{ action: "click", target: { text: "Sign in", role: "button" } }]),
		).rejects.toThrow(
			'Step 1 (click): "Sign in" (button) was not found in the window within 5 s. Nearest ' +
				'visible labels: "Log in" (AXButton) at (140, 25), "Register" (AXLink) at (50, 25).',
		);
		expect(count("find")).toBe(43);
		expect(commands.filter((command) => command.cmd === "find").pop()).toMatchObject({
			text: undefined,
			role: undefined,
		});
		expect(count("click")).toBe(0);
	});

	it("explains an index past the visible matches", async () => {
		const { agent } = setup({}, { find: findOn([element("Save", 300, 200)]) });
		await expect(
			agent.perform([{ action: "click", target: { text: "Save", index: 3 } }]),
		).rejects.toThrow(
			'Only 1 element matches "Save", so index 3 is not found: 0: "Save" (AXButton) at (340, 215).',
		);
	});

	it("scrolls a collapsed offscreen target into view with real wheel scrolls, then clicks it", async () => {
		let scrolls = 0;
		const { agent, commands } = setup(
			{},
			{
				find: findOn(() =>
					scrolls < 2
						? [element("Pricing", 100, 599, { width: 100, height: 1, visible: false })]
						: [element("Pricing", 100, 400)],
				),
				scroll: (command) => {
					scrolls += 1;
					return tick(command);
				},
				click: tick,
			},
		);
		await agent.perform([{ action: "click", target: { text: "Pricing" }, durationMs: 100 }]);
		expect(commands.filter((command) => command.cmd === "scroll")).toEqual([
			{ cmd: "scroll", x: 250, y: 625.5, ms: 600, dx: 0, dy: 480, modifiers: [] },
			{ cmd: "scroll", x: 250, y: 625.5, ms: 600, dx: 0, dy: 480, modifiers: [] },
		]);
		expect(commands.find((command) => command.cmd === "click")).toMatchObject({
			x: 240,
			y: 465,
		});
		expect(spansOf().slice(0, 4)).toEqual([
			"motion:scroll",
			"motion:scroll",
			"wait:wait",
			"motion:click",
		]);
		expect(snapshotAgentActivity(clock.ms).spans[0].target).toEqual({
			cx: 150 / 800,
			cy: 575.5 / 600,
		});
	});

	it("scrolls the exact distance, at the window's middle, toward an unclipped target above the window", async () => {
		let scrolled = false;
		const { agent, commands } = setup(
			{},
			{
				find: findOn(() =>
					scrolled
						? [element("Top", 300, 100)]
						: [element("Top", 300, -300, { visible: false })],
				),
				scroll: () => {
					scrolled = true;
					return {};
				},
			},
		);
		await agent.perform([{ action: "move", target: { text: "Top" } }]);
		expect(commands.find((command) => command.cmd === "scroll")).toEqual({
			cmd: "scroll",
			x: 440,
			y: 350,
			ms: 600,
			dx: 0,
			dy: -585,
			modifiers: [],
		});
	});

	it("clicks into a field before typing, preferring the control over its label", async () => {
		const { agent, deps, names, commands } = setup(
			{},
			{
				find: findOn([
					element("Email", 50, 200, { role: "AXStaticText", width: 60, height: 20 }),
					element("Email", 150, 195, { role: "AXTextField", width: 300 }),
				]),
			},
		);
		await agent.perform([{ action: "type", text: "a@b.co", into: { text: "Email" } }]);
		expect(names().slice(3, -1)).toEqual([
			"frontmost_window",
			"find",
			"find",
			"find",
			"cursor",
			"move",
			"find",
			"at",
			"click",
			"type",
		]);
		expect(commands.find((command) => command.cmd === "move")).toMatchObject({
			x: 400,
			y: 260,
			ms: 515,
		});
		expect(commands.find((command) => command.cmd === "click")).toEqual({
			cmd: "click",
			x: 400,
			y: 260,
			ms: 0,
			button: "left",
			count: 1,
			modifiers: [],
		});
		expect(deps.waitForStill).not.toHaveBeenCalled();
	});

	it("drags from one target to another, pacing the drag by its length", async () => {
		const { agent, commands } = setup(
			{},
			{ find: findOn([element("Card", 100, 100), element("Done", 400, 500)]) },
		);
		await agent.perform([{ action: "drag", from: { text: "Card" }, to: { text: "Done" } }]);
		expect(commands.find((command) => command.cmd === "drag")).toEqual({
			cmd: "drag",
			fromX: 240,
			fromY: 165,
			toX: 540,
			toY: 565,
			ms: 575,
			button: "left",
			modifiers: [],
		});
	});

	it("finds the drag's start again when scrolling to its end moved it", async () => {
		let scrolled = false;
		const { agent, commands } = setup(
			{},
			{
				find: findOn(() =>
					scrolled
						? [element("Card", 100, 200), element("Done", 500, 100)]
						: [
								element("Card", 500, 200),
								element("Done", 799, 100, { width: 1, visible: false }),
							],
				),
				scroll: () => {
					scrolled = true;
					return {};
				},
			},
		);
		await agent.perform([{ action: "drag", from: { text: "Card" }, to: { text: "Done" } }]);
		expect(commands.find((command) => command.cmd === "drag")).toMatchObject({
			fromX: 240,
			fromY: 265,
			toX: 640,
			toY: 165,
		});
	});

	it("refuses a drag whose start and end cannot be on screen together", async () => {
		let scrolls = 0;
		const { agent, count } = setup(
			{},
			{
				find: findOn(() =>
					scrolls % 2
						? [
								element("Card", 0, 200, { width: 1, visible: false }),
								element("Done", 500, 100),
							]
						: [
								element("Card", 500, 200),
								element("Done", 799, 100, { width: 1, visible: false }),
							],
				),
				scroll: () => {
					scrolls += 1;
					return {};
				},
			},
		);
		await expect(
			agent.perform([{ action: "drag", from: { text: "Card" }, to: { text: "Done" } }]),
		).rejects.toThrow("Step 1 (drag): The drag's start and end are not on screen together.");
		expect(count("drag")).toBe(0);
	});
});

describe("waitFor", () => {
	beforeEach(() => {
		clock.ms = 1_000;
		resetAgentActivity();
	});

	it("waits for an element to appear with one wait span and no input", async () => {
		let finds = 0;
		const { agent, names, commands } = setup(
			{},
			{
				find: findOn(() => {
					finds += 1;
					return finds > 3 ? [element("Saved", 10, 10, { role: "AXStaticText" })] : [];
				}),
			},
		);
		await expect(agent.perform([{ action: "waitFor", text: "Saved" }])).resolves.toEqual({
			performed: 1,
			durationMs: 750,
		});
		expect(names()).toEqual([
			"preflight",
			"frontmost_window",
			"arm",
			"find",
			"find",
			"find",
			"find",
			"find",
			"disarm",
		]);
		const query = { cmd: "find", pid: 42, windowId: 7, frame: FRAME, role: undefined };
		expect(commands[3]).toEqual({ ...query, text: "Saved", limit: 200 });
		expect(commands[7]).toEqual({ ...query, text: undefined, role: "AXWebArea", limit: 1 });
		expect(snapshotAgentActivity(clock.ms).spans).toEqual([
			{ kind: "wait", action: "wait", startMs: 1_000, endMs: 1_750 },
		]);
	});

	it("waits for an element to disappear", async () => {
		let finds = 0;
		const { agent, count } = setup(
			{},
			{
				find: findOn(() => {
					finds += 1;
					return finds > 2 ? [] : [element("Loading", 10, 10)];
				}),
			},
		);
		await agent.perform([{ action: "waitFor", text: "Loading", gone: true }]);
		expect(count("find")).toBe(3);
	});

	it.each([
		[
			"appear",
			{ action: "waitFor" as const, text: "Saved", timeoutMs: 1_000 },
			[],
			'Step 1 (waitFor): "Saved" did not appear within 1 s.',
		],
		[
			"disappear",
			{ action: "waitFor" as const, text: "Saving", gone: true, timeoutMs: 1_000 },
			[element("Saving", 10, 10)],
			'Step 1 (waitFor): "Saving" was still visible after 1 s.',
		],
	])("fails when an element does not %s in time", async (_, step, screen, message) => {
		const { agent } = setup({}, { find: findOn(screen) });
		await expect(agent.perform([step])).rejects.toThrow(message);
	});

	it("waits for the window to settle on its current frame, and proceeds when it never does", async () => {
		const waitForStill = vi.fn(
			async (_frame: unknown, { timeoutMs }: { timeoutMs: number }) => {
				clock.ms += timeoutMs;
				return { settled: false, elapsedMs: timeoutMs };
			},
		);
		const moved = { ...FRAME, x: 300 };
		const findWindow = vi
			.fn()
			.mockResolvedValueOnce({ pid: 42, frame: FRAME })
			.mockResolvedValue({ pid: 42, frame: moved });
		const { agent } = setup({ waitForStill, findWindow });
		await expect(
			agent.perform([{ action: "waitFor", settled: true, timeoutMs: 3_000 }]),
		).resolves.toEqual({ performed: 1, durationMs: 3_000 });
		expect(waitForStill).toHaveBeenCalledWith(moved, {
			timeoutMs: 3_000,
			signal: expect.any(AbortSignal),
		});
		expect(snapshotAgentActivity(clock.ms).spans).toEqual([
			{ kind: "wait", action: "wait", startMs: 1_000, endMs: 4_000 },
		]);
	});

	it("stops polling at once when the user takes over", async () => {
		const { agent, events, count } = setup(
			{
				sleep: async (ms) => {
					clock.ms += ms;
					await new Promise((resolve) => setImmediate(resolve));
				},
			},
			{ find: findOn([]) },
		);
		const running = agent.perform([{ action: "waitFor", text: "Saved" }]);
		await flush();
		events.emit("user-input", { event: "user-input", kind: "move", escape: false });
		await expect(running).rejects.toThrow(`Step 1 (waitFor): ${TAKEOVER_MESSAGE}`);
		const finds = count("find");
		await flush();
		expect(count("find")).toBe(finds);
		expect(count("disarm")).toBe(1);
	});

	it("aborts the settle detector when the user takes over", async () => {
		let signal: AbortSignal | undefined;
		const waitForStill = vi.fn(
			(_frame: unknown, options: { signal?: AbortSignal }) =>
				new Promise<never>((_, reject) => {
					signal = options.signal;
					signal?.addEventListener("abort", () => reject(signal?.reason));
				}),
		);
		const { agent, events } = setup({ waitForStill });
		const running = agent.perform([{ action: "waitFor", settled: true }]);
		await flush();
		events.emit("user-input", { event: "user-input", kind: "key", escape: true });
		await expect(running).rejects.toThrow(TAKEOVER_MESSAGE);
		expect(signal?.aborted).toBe(true);
	});
});

describe("automatic pacing", () => {
	beforeEach(() => {
		clock.ms = 1_000;
		resetAgentActivity();
	});

	it.each([
		[undefined, 575],
		["brisk" as const, 460],
		["normal" as const, 575],
		["relaxed" as const, 690],
	])("glides from the pointer for a time set by the distance, at pace %s", async (pace, ms) => {
		const { agent, commands } = setup();
		await agent.perform([{ action: "move", x: 300, y: 400 }], { pace });
		expect(commands.find((command) => command.cmd === "move")).toMatchObject({ ms });
	});

	it("keeps glides between 450 and 1100 ms", async () => {
		const near = setup();
		await near.agent.perform([{ action: "move", x: 1, y: 1 }]);
		const far = setup({}, { cursor: () => ({ x: 4_000, y: 3_000 }) });
		await far.agent.perform([{ action: "move", x: 1, y: 1 }]);
		expect(
			[near, far].map(
				({ commands }) =>
					commands.find((command) => command.cmd === "move") as { ms: number },
			),
		).toMatchObject([{ ms: 450 }, { ms: 1_100 }]);
	});

	it("keeps explicit durations without asking for the pointer", async () => {
		const { agent, commands, count } = setup();
		await agent.perform([
			{ action: "move", x: 300, y: 400, durationMs: 50 },
			{ action: "click", x: 1, y: 1, durationMs: 0 },
			{ action: "wait", ms: 10 },
		]);
		expect(
			commands.flatMap((command) => ("ms" in command ? [[command.cmd, command.ms]] : [])),
		).toEqual([
			["move", 50],
			["click", 0],
		]);
		expect(count("cursor")).toBe(0);
	});

	it.each([
		[undefined, 1_200],
		["brisk" as const, 720],
		["relaxed" as const, 1_920],
	])("settles then holds after a click or enter unless a wait, typing or a key follows, at pace %s", async (pace, holdMs) => {
		const sleep = vi.fn(async (ms: number) => {
			clock.ms += ms;
		});
		const waitForStill = vi.fn(async () => {
			clock.ms += 100;
			return { settled: true, elapsedMs: 100 };
		});
		const { agent } = setup(
			{ sleep, waitForStill },
			{ click: tick, key: tick, move: tick, type: tick },
		);
		await agent.perform(
			[
				{ action: "click", x: 10, y: 10, durationMs: 100 },
				{ action: "key", key: "Return" },
				{ action: "click", x: 20, y: 20, durationMs: 100 },
				{ action: "move", x: 25, y: 25, durationMs: 100 },
				{ action: "click", x: 30, y: 30, durationMs: 100 },
				{ action: "wait", ms: 500 },
				{ action: "click", x: 40, y: 40, durationMs: 100 },
				{ action: "waitFor", settled: true },
				{ action: "click", x: 50, y: 50, durationMs: 100 },
				{ action: "type", text: "a" },
				{ action: "key", key: "\n" },
			],
			{ pace },
		);
		const auto = { timeoutMs: 4_000, quietMs: 700, signal: expect.any(AbortSignal) };
		expect(waitForStill.mock.calls.map((call) => (call as unknown[])[1])).toEqual([
			auto,
			auto,
			{ timeoutMs: 10_000, signal: expect.any(AbortSignal) },
			auto,
		]);
		expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([holdMs, holdMs, 500, holdMs]);
		expect(
			snapshotAgentActivity(clock.ms).spans.map(({ kind, action }) => `${kind}:${action}`),
		).toEqual([
			"motion:click",
			"motion:key",
			"wait:wait",
			"hold:wait",
			"motion:click",
			"wait:wait",
			"hold:wait",
			"motion:move",
			"motion:click",
			"hold:wait",
			"motion:click",
			"wait:wait",
			"motion:click",
			"motion:type",
			"motion:key",
			"wait:wait",
			"hold:wait",
		]);
	});

	it("still holds when the settle check fails", async () => {
		const sleep = vi.fn(async () => undefined);
		const waitForStill = vi.fn(async () => {
			throw new Error("Recordly could not capture the screen.");
		});
		const { agent } = setup({ sleep, waitForStill });
		await expect(agent.perform([{ action: "click", x: 1, y: 1 }])).resolves.toMatchObject({
			performed: 1,
		});
		expect(sleep).toHaveBeenCalledWith(1_200);
	});
});

describe("dry runs and results", () => {
	beforeEach(() => {
		clock.ms = 1_000;
		resetAgentActivity();
	});

	it("resolves the current page's targets without input, raising or logging", async () => {
		const { agent, deps, names } = setup(
			{},
			{
				find: findOn([
					element("Save", 300, 200),
					element("Next", 100, 100),
					element("Next", 400, 100),
					element("Pricing", 100, 599, { width: 100, height: 1, visible: false }),
				]),
			},
		);
		await expect(
			agent.perform(
				[
					{ action: "click", target: { text: "Save" } },
					{ action: "type", text: "hi", into: { text: "Email" } },
					{ action: "click", target: { text: "Next" } },
					{ action: "move", target: { text: "Pricing" } },
					{ action: "key", key: "enter" },
					{ action: "move", x: 10, y: 20 },
					{ action: "waitFor", text: "Saved" },
					{ action: "waitFor", settled: true },
				],
				{ dryRun: true, title: "Check" },
			),
		).resolves.toEqual({
			performed: 0,
			durationMs: 0,
			dryRun: [
				{
					index: 1,
					action: "click",
					found: true,
					label: "Save",
					x: 340,
					y: 215,
					candidates: 1,
				},
				{ index: 2, action: "type", found: null, note: "validated at run time" },
				{ index: 3, action: "click", found: null, note: "validated at run time" },
				{ index: 4, action: "move", found: null, note: "validated at run time" },
				{ index: 5, action: "key", found: null, note: "validated at run time" },
				{ index: 6, action: "move", found: null, note: "validated at run time" },
				{ index: 7, action: "waitFor", found: null, note: "validated at run time" },
				{ index: 8, action: "waitFor", found: null, note: "validated at run time" },
			],
			page: "300,200,80,30 100,100,80,30 400,100,80,30",
		});
		expect(names()).toEqual(["find", "find", "find"]);
		expect(deps.waitForStill).not.toHaveBeenCalled();
		expect(snapshotAgentActivity(clock.ms)).toEqual({ version: 1, scenes: [], spans: [] });
	});

	it("tells an ambiguous target apart from a missing one", async () => {
		const { agent } = setup(
			{},
			{ find: findOn([element("Save", 300, 200), element("Save", 300, 400)]) },
		);
		await expect(
			agent.perform(
				[
					{ action: "move", target: { text: "Save" } },
					{ action: "move", target: { text: "Nope" } },
				],
				{ dryRun: true },
			),
		).resolves.toMatchObject({
			dryRun: [
				{
					index: 1,
					action: "move",
					found: false,
					ambiguous: true,
					candidates: 2,
					matches: [
						'0: "Save" (AXButton) at (340, 215)',
						'1: "Save" (AXButton) at (340, 415)',
					],
				},
				{ index: 2, action: "move", found: false, ambiguous: false, candidates: 0 },
			],
		});
	});

	it("refuses a dry run with a point outside the window", async () => {
		const { agent } = setup();
		await expect(
			agent.perform(
				[
					{ action: "wait", ms: 1 },
					{ action: "move", x: 900, y: 10 },
				],
				{ dryRun: true },
			),
		).rejects.toThrow("Step 2 (move): Point (900, 10) is outside the selected window");
	});

	it("returns the visible controls after the last step with then: elements", async () => {
		const { agent, commands } = setup({}, { find: findOn([element("Save", 300, 200)]) });
		await expect(
			agent.perform([{ action: "wait", ms: 10 }], { then: "elements" }),
		).resolves.toEqual({
			performed: 1,
			durationMs: 10,
			elements: [{ role: "AXButton", label: "Save", x: 300, y: 200, width: 80, height: 30 }],
			page: "300,200,80,30",
		});
		expect(commands.slice(-2)).toEqual([
			{ cmd: "disarm" },
			{
				cmd: "find",
				pid: 42,
				windowId: 7,
				frame: FRAME,
				text: undefined,
				role: undefined,
				limit: 30,
			},
		]);
	});

	it("treats options that are present but undefined as absent", async () => {
		const { agent } = setup();
		await expect(
			agent.perform([{ action: "wait", ms: 1 }], {
				title: undefined,
				pace: undefined,
				dryRun: undefined,
				then: undefined,
			}),
		).resolves.toEqual({ performed: 1, durationMs: 1 });
	});
});

describe("step checks", () => {
	it.each([
		[
			"coordinates and a target",
			{ action: "click", x: 1, y: 1, target: { text: "Save" } },
			"Step 2 (click): Give either x and y or target, not both.",
		],
		["neither", { action: "move" }, "Step 2 (move): Give x and y, or a target."],
		[
			"half a drag",
			{ action: "drag", fromX: 1, fromY: 1 },
			"Step 2 (drag): Give toX and toY, or a to.",
		],
		[
			"an empty target text",
			{ action: "click", target: { text: "  " } },
			"Step 2 (click): A target needs a text of 1 to 200 characters.",
		],
		[
			"a long field text",
			{ action: "type", text: "a", into: { text: "x".repeat(201) } },
			"Step 2 (type): A into needs a text of 1 to 200 characters.",
		],
		[
			"a negative index",
			{ action: "scroll", deltaY: 1, target: { text: "a", index: -1 } },
			"Step 2 (scroll): A target's index must be a whole number from 0.",
		],
		[
			"a fractional index",
			{ action: "drag", from: { text: "a", index: 1.5 }, toX: 1, toY: 1 },
			"Step 2 (drag): A from's index must be a whole number from 0.",
		],
		[
			"a waitFor with nothing to wait for",
			{ action: "waitFor" },
			"Step 2 (waitFor): A waitFor needs",
		],
		[
			"a waitFor with text and settled",
			{ action: "waitFor", text: "a", settled: true },
			"A waitFor needs",
		],
		[
			"a waitFor with gone and settled",
			{ action: "waitFor", settled: true, gone: true },
			"A waitFor needs",
		],
		[
			"a waitFor over 30 s",
			{ action: "waitFor", settled: true, timeoutMs: 30_001 },
			"timeoutMs must be more than 0 and at most 30000.",
		],
		["a wait over 30 s", { action: "wait", ms: 30_001 }, "Step 2 (wait): A wait step may last"],
	])("refuses %s before touching the helper, naming the step", async (_, step, message) => {
		const { agent, commands } = setup();
		await expect(agent.perform([{ action: "wait", ms: 1 }, step as AgentStep])).rejects.toThrow(
			message,
		);
		expect(commands).toHaveLength(0);
	});

	it("refuses an unknown pace, and counts waitFor timeouts toward the 10 minutes", async () => {
		const { agent, commands } = setup();
		await expect(
			agent.perform([{ action: "wait", ms: 1 }], { pace: "slow" as "brisk" }),
		).rejects.toThrow(/pace must be/);
		await expect(
			agent.perform(
				Array.from({ length: 21 }, () => ({
					action: "waitFor" as const,
					settled: true,
					timeoutMs: 30_000,
				})),
			),
		).rejects.toThrow(/10 minutes/);
		expect(commands).toHaveLength(0);
	});
});

describe("ranking, scrolling and limits", () => {
	beforeEach(() => {
		clock.ms = 1_000;
		resetAgentActivity();
	});

	const web = { web: true };
	const area = (x: number, y: number, width: number, height: number) => ({
		x: FRAME.x + x,
		y: FRAME.y + y,
		width,
		height,
	});
	const clickedAt = (commands: AgentCommand[]) =>
		commands.flatMap((command) => (command.cmd === "click" ? [[command.x, command.y]] : []));

	it("prefers page content over browser chrome, and stops at the first query when the best match is certain", async () => {
		const { agent, commands, count } = setup(
			{},
			{
				find: findOn([
					element("Pricing", 300, 5, { role: "AXRadioButton" }),
					element("Pricing", 100, 300, { role: "AXLink", ...web }),
				]),
			},
		);
		await agent.perform([{ action: "click", target: { text: "Pricing" } }]);
		expect(clickedAt(commands)).toEqual([[240, 365]]);
		expect(count("find")).toBe(3);
	});

	it("merges twins with the same label and frame, keeping the actionable one", async () => {
		const { agent, commands } = setup(
			{},
			{
				find: findOn([
					element("Save", 300, 200, { role: "AXStaticText", ...web }),
					element("Save", 300.5, 200.5, web),
					element("Save", 300, 200, web),
				]),
			},
		);
		await agent.perform([{ action: "click", target: { text: "Save" } }]);
		expect(clickedAt(commands)).toEqual([[440.5, 265.5]]);
	});

	it("ranks exact labels first, then controls, and counts index in that order", async () => {
		const screen = [
			element("Save draft", 100, 50, { role: "AXLink", ...web }),
			element("Save", 100, 100, { role: "AXStaticText", ...web }),
			element("Save", 100, 300, web),
			element("Save", 100, 500, web),
		];
		const indexed = setup({}, { find: findOn(screen) });
		await indexed.agent.perform([
			{ action: "click", target: { text: "Save", index: 0 } },
			{ action: "click", target: { text: "Save", index: 2 } },
			{ action: "click", target: { text: "Save", index: 3 } },
		]);
		expect(clickedAt(indexed.commands)).toEqual([
			[240, 365],
			[240, 165],
			[240, 115],
		]);
		const ambiguous = setup({}, { find: findOn(screen) });
		await expect(
			ambiguous.agent.perform([{ action: "click", target: { text: "Save" } }]),
		).rejects.toThrow(
			'2 elements match "Save" equally well. Add an index (0-based, best match first, then top ' +
				'to bottom): 0: "Save" (AXButton) at (140, 315), 1: "Save" (AXButton) at (140, 515), ' +
				'2: "Save" (AXStaticText) at (140, 115), 3: "Save draft" (AXLink) at (140, 65).',
		);
	});

	it("scrolls to an exact match out of view rather than click a looser visible one", async () => {
		let scrolled = false;
		const { agent, commands, count } = setup(
			{},
			{
				find: findOn(() => [
					element("Pricing plans", 100, 100, { role: "AXLink", ...web }),
					scrolled
						? element("Pricing", 300, 300, { role: "AXLink", ...web })
						: element("Pricing", 300, 599, {
								role: "AXLink",
								height: 1,
								visible: false,
								container: area(0, 80, 800, 520),
								...web,
							}),
				]),
				scroll: () => {
					scrolled = true;
					return {};
				},
			},
		);
		await agent.perform([{ action: "click", target: { text: "Pricing" } }]);
		expect(count("scroll")).toBe(1);
		expect(clickedAt(commands)).toEqual([[440, 365]]);
	});

	it("keeps the visible matches of the first query when the offscreen query is truncated", async () => {
		const { agent, commands } = setup(
			{},
			{
				find: (command) => {
					if (command.cmd !== "find") return {};
					return command.offscreen
						? {
								elements: [
									element("Save", 300, 900, { height: 1, visible: false }),
								],
								truncated: true,
							}
						: { elements: [element("Save", 300, 200)], truncated: false };
				},
			},
		);
		await agent.perform([{ action: "click", target: { text: "Save" } }]);
		expect(
			commands.flatMap((command) => (command.cmd === "find" ? [command.offscreen] : [])),
		).toEqual([undefined, true, undefined, undefined]);
		expect(clickedAt(commands)).toEqual([[440, 265]]);
	});

	it("scrolls inside the element's scroll area by the exact distance, centres it when it lands near the edge, then clicks", async () => {
		const positions = [700, 470, 290];
		let scrolls = 0;
		const { agent, commands } = setup(
			{},
			{
				find: findOn(() => {
					const y = positions[scrolls];
					return [
						element("Row 40", 20, y, {
							width: 160,
							height: 20,
							...(y > 500
								? { visible: false, container: area(0, 100, 200, 400) }
								: {}),
						}),
					];
				}),
				scroll: () => {
					scrolls += 1;
					return {};
				},
			},
		);
		await agent.perform([{ action: "click", target: { text: "Row 40" } }]);
		expect(commands.filter((command) => command.cmd === "scroll")).toEqual([
			{ cmd: "scroll", x: 200, y: 526, ms: 600, dx: 0, dy: 410, modifiers: [] },
			{ cmd: "scroll", x: 200, y: 530, ms: 600, dx: 0, dy: 180, modifiers: [] },
		]);
		expect(clickedAt(commands)).toEqual([[200, 350]]);
	});

	it.each([
		[
			"an unclipped element whose frame never changes",
			() => element("Item", 20, 700, { visible: false, container: area(0, 100, 200, 400) }),
			() => [],
		],
		[
			"a collapsed strip while nothing else moves",
			() => element("Item", 100, 599, { width: 100, height: 1, visible: false }),
			() => [],
		],
	])("fails after two scrolls that reveal nothing: %s", async (_, hidden, page) => {
		const { agent, count } = setup(
			{},
			{
				find: (command) =>
					command.cmd === "find" && command.text
						? findOn([hidden()])(command)
						: { elements: page(), truncated: false },
			},
		);
		await expect(
			agent.perform([{ action: "click", target: { text: "Item" } }]),
		).rejects.toThrow(
			`Step 1 (click): "Item" is hidden inside a section that scrolling doesn't reveal (a ` +
				"closed menu or panel?). Open it first, then try again.",
		);
		expect([count("scroll"), count("click")]).toEqual([2, 0]);
	});

	it("keeps scrolling toward a collapsed strip while the page moves, up to six scrolls", async () => {
		let scrolls = 0;
		const { agent, count } = setup(
			{},
			{
				find: findOn(() => [
					element("Item", 100, 599, { width: 100, height: 1, visible: false }),
					element("Header", 100, 300 - scrolls * 10),
				]),
				scroll: () => {
					scrolls += 1;
					return {};
				},
			},
		);
		await expect(
			agent.perform([{ action: "click", target: { text: "Item" } }]),
		).rejects.toThrow(/"Item" is hidden inside a section that scrolling doesn't reveal/);
		expect(count("scroll")).toBe(6);
	});

	it("counts a strip that moves along with the page as no progress", async () => {
		let scrolls = 0;
		const { agent, count } = setup(
			{},
			{
				find: findOn(() => [
					element("Item", 100, 400 - scrolls * 10, { height: 1, visible: false }),
					element("Header", 100, 300 - scrolls * 10),
				]),
				scroll: () => {
					scrolls += 1;
					return {};
				},
			},
		);
		await expect(
			agent.perform([{ action: "click", target: { text: "Item" } }]),
		).rejects.toThrow(/hidden inside a section/);
		expect(count("scroll")).toBe(2);
	});

	it("stops cleanly before a step once the perform passes 10 minutes", async () => {
		const { agent, count } = setup({
			sleep: async (ms) => {
				clock.ms += ms === 1 ? 600_000 : ms;
			},
		});
		await expect(
			agent.perform([
				{ action: "wait", ms: 1 },
				{ action: "click", x: 1, y: 1 },
			]),
		).rejects.toThrow("Step 2 (click): the perform passed its 10-minute limit.");
		expect([count("click"), count("disarm")]).toEqual([0, 1]);
		expect(snapshotAgentActivity(clock.ms).scenes[0].failed).toBe(true);
	});

	it("stops a waitFor poll once the perform passes 10 minutes", async () => {
		const { agent, count } = setup(
			{
				sleep: async (ms) => {
					clock.ms += ms === 1 ? 599_500 : ms;
				},
			},
			{ find: findOn([]) },
		);
		await expect(
			agent.perform([
				{ action: "wait", ms: 1 },
				{ action: "waitFor", text: "Saved", timeoutMs: 5_000 },
			]),
		).rejects.toThrow("Step 2 (waitFor): the perform passed its 10-minute limit.");
		expect(count("find")).toBe(3);
	});

	it("ignores the browser's tab title when waiting for page text, checking once that the window shows a page", async () => {
		const { agent, commands } = setup(
			{},
			{
				find: findOn([
					element("Loading…", 300, 5, { role: "AXRadioButton" }),
					element("Example", 0, 80, { role: "AXWebArea", width: 800, height: 520 }),
				]),
			},
		);
		await expect(
			agent.perform([{ action: "waitFor", text: "Loading", gone: true }]),
		).resolves.toMatchObject({ performed: 1 });
		await expect(
			agent.perform([{ action: "waitFor", text: "loading", timeoutMs: 500 }]),
		).rejects.toThrow('Step 1 (waitFor): "loading" did not appear within 0.5 s.');
		expect(
			commands.filter((command) => command.cmd === "find" && command.role === "AXWebArea"),
		).toHaveLength(1);
	});

	it("returns only the plain element fields from findElements", async () => {
		const { agent } = setup(
			{},
			{
				find: findOn([
					element("Save", 300, 200, { ...web, container: area(0, 0, 800, 600) }),
				]),
			},
		);
		await expect(agent.findElements({})).resolves.toEqual({
			elements: [{ role: "AXButton", label: "Save", x: 300, y: 200, width: 80, height: 30 }],
			truncated: false,
		});
	});
});

describe("aiming at a moving target", () => {
	beforeEach(() => {
		clock.ms = 1_000;
		resetAgentActivity();
	});

	const spansOf = () =>
		snapshotAgentActivity(clock.ms).spans.map(({ kind, action }) => `${kind}:${action}`);
	const posted = (commands: AgentCommand[], cmd: string) =>
		commands.flatMap((command) =>
			command.cmd === cmd && "x" in command ? [[command.x, command.y, command.ms]] : [],
		);
	const sliding = (label: string, from: number, rate: number, stop: number) =>
		findOn(() => [element(label, Math.min(stop, from + (clock.ms - 1_000) * rate), 200)]);
	const jumping = (label: string, from: number, to: number, at: number) =>
		findOn(() => [element(label, clock.ms >= at ? to : from, 200)]);

	it("waits for the frame to hold still for two samples before using it, logging the wait", async () => {
		const { agent, commands } = setup(
			{},
			{ find: sliding("Tasks", 54, 0.3, 414), click: tick },
		);
		await agent.perform([{ action: "click", target: { text: "Tasks" }, durationMs: 100 }]);
		expect(posted(commands, "click")).toEqual([[FRAME.x + 414 + 40, 265, 0]]);
		expect(spansOf()[0]).toBe("wait:wait");
		expect(snapshotAgentActivity(clock.ms).spans[0]).toMatchObject({
			kind: "wait",
			startMs: 1_000,
			endMs: 2_200,
		});
	});

	it("presses as-is when the frame holds still", async () => {
		const { agent, commands, count } = setup(
			{},
			{ find: findOn([element("Save", 300, 200)]), click: tick },
		);
		await agent.perform([{ action: "click", target: { text: "Save" }, durationMs: 100 }]);
		expect(posted(commands, "move")).toEqual([[440, 265, 100]]);
		expect(posted(commands, "click")).toEqual([[440, 265, 0]]);
		expect(count("at")).toBe(1);
	});

	it("nudges onto the new centre when the target shifts inside its own width", async () => {
		const { agent, commands } = setup(
			{},
			{ find: jumping("Tasks", 54, 74, 1_200), click: tick },
		);
		await agent.perform([{ action: "click", target: { text: "Tasks" }, durationMs: 200 }]);
		expect(posted(commands, "move")).toEqual([[194, 265, 200]]);
		expect(posted(commands, "click")).toEqual([[214, 265, 120]]);
	});

	it("resolves again and glides a second time when the target moves further than a nudge", async () => {
		const { agent, commands } = setup(
			{},
			{ find: jumping("Tasks", 54, 114, 1_200), click: tick },
		);
		await agent.perform([{ action: "click", target: { text: "Tasks" }, durationMs: 200 }]);
		expect(posted(commands, "move")).toEqual([
			[194, 265, 200],
			[254, 265, 200],
		]);
		expect(posted(commands, "click")).toEqual([[254, 265, 0]]);
	});

	it("fails with the not-found message when the target is gone by the press", async () => {
		const { agent, count } = setup(
			{},
			{
				find: findOn(() => (clock.ms >= 1_200 ? [] : [element("Tasks", 54, 200)])),
				click: tick,
			},
		);
		await expect(
			agent.perform([{ action: "click", target: { text: "Tasks" }, durationMs: 200 }]),
		).rejects.toThrow(/"Tasks" was not found in the window within 5 s/);
		expect(count("click")).toBe(0);
	});

	it("says the target kept moving instead of calling it not found", async () => {
		const { agent, count } = setup(
			{ findWindow: vi.fn(async () => ({ pid: 42, frame: { ...FRAME, width: 2800 } })) },
			{ find: sliding("Tasks", 54, 0.3, Number.POSITIVE_INFINITY), click: tick },
		);
		await expect(
			agent.perform([{ action: "click", target: { text: "Tasks" }, durationMs: 100 }]),
		).rejects.toThrow(
			/"Tasks" is in the window but kept moving, so the pointer never settled on it\. The view is still animating: add a waitFor for it, or waitFor settled: true, before this step, then try again\./,
		);
		expect(count("click")).toBe(0);
	});

	it("re-resolves both ends of a drag before pressing", async () => {
		const screen = () => [
			element("Card", clock.ms >= 1_150 ? 74 : 54, 200),
			element("Bin", 500, 400),
		];
		const { agent, commands } = setup({}, { find: findOn(screen), drag: tick });
		await agent.perform([
			{ action: "drag", from: { text: "Card" }, to: { text: "Bin" }, durationMs: 300 },
		]);
		expect(commands.find((command) => command.cmd === "drag")).toMatchObject({
			fromX: 214,
			fromY: 265,
			toX: 640,
			toY: 465,
		});
	});

	it("re-aims the click that a type with into makes", async () => {
		const { agent, commands } = setup(
			{},
			{
				find: findOn(() => [
					element("Email", clock.ms >= 1_150 ? 74 : 54, 200, { role: "AXTextField" }),
				]),
			},
		);
		await agent.perform([{ action: "type", text: "hi", into: { text: "Email" } }]);
		expect(posted(commands, "click")).toEqual([[214, 265, 120]]);
	});
});

describe("role ranks instead of filtering", () => {
	beforeEach(() => {
		clock.ms = 1_000;
		resetAgentActivity();
	});

	const link = { role: "AXLink" };

	it("raises ambiguity over the links a role filter used to delete", async () => {
		const { agent, commands, count } = setup(
			{},
			{
				find: findOn([
					element("Open assistant", 700, 500),
					element("Open", 100, 100, link),
					element("Open", 100, 200, link),
					element("Open", 100, 300, link),
				]),
			},
		);
		await expect(
			agent.perform([{ action: "click", target: { text: "Open", role: "button" } }]),
		).rejects.toThrow(
			'Step 1 (click): 3 elements match "Open" (button) equally well. Add an index ' +
				"(0-based, best match first, then top to bottom): " +
				'0: "Open" (AXLink) at (140, 115), 1: "Open" (AXLink) at (140, 215), ' +
				'2: "Open" (AXLink) at (140, 315), 3: "Open assistant" (AXButton) at (740, 515).',
		);
		expect(count("click")).toBe(0);
		expect(
			commands.flatMap((command) => (command.cmd === "find" ? [command.role] : [])),
		).toEqual([undefined, undefined]);
	});

	it("still resolves one match that the role singles out", async () => {
		const { agent, commands } = setup(
			{},
			{
				find: findOn([
					element("Save", 100, 200, { role: "AXStaticText" }),
					element("Save", 300, 200),
				]),
				click: tick,
			},
		);
		await agent.perform([{ action: "click", target: { text: "Save", role: "button" } }]);
		expect(commands.find((command) => command.cmd === "click")).toMatchObject({
			x: 440,
			y: 265,
		});
	});
});

describe("hit test before the press", () => {
	beforeEach(() => {
		clock.ms = 1_000;
		resetAgentActivity();
	});

	const save = findOn([element("Save", 300, 200)]);
	const hit = (role: string, label: string, box: Partial<AgentElement> = {}) => ({
		role,
		label,
		x: 400,
		y: 250,
		width: 80,
		height: 30,
		...box,
	});

	it("refuses after one retry, naming what covers the point", async () => {
		const { agent, count } = setup(
			{},
			{
				find: save,
				at: () => ({
					hit: hit("AXButton", "Ask AI", { x: 400, y: 200, width: 60, height: 60 }),
					parent: null,
				}),
			},
		);
		await expect(
			agent.perform([{ action: "click", target: { text: "Save" } }]),
		).rejects.toThrow(
			'Step 1 (click): "Save" is at (440, 265), but the point is covered by "Ask AI" ' +
				"(AXButton). Dismiss it, or aim at another element.",
		);
		expect(count("click")).toBe(0);
		expect(count("at")).toBe(2);
	});

	it("accepts the target's own label on the hit element's parent", async () => {
		const { agent, count } = setup(
			{},
			{
				find: save,
				at: () => ({
					hit: hit("AXStaticText", "Save", { x: 430, y: 260, width: 20, height: 10 }),
					parent: hit("AXButton", "Save"),
				}),
			},
		);
		await agent.perform([{ action: "click", target: { text: "Save" } }]);
		expect(count("click")).toBe(1);
	});

	it("accepts an unlabelled hit that overlaps the target enough", async () => {
		const { agent, count } = setup(
			{},
			{ find: save, at: () => ({ hit: hit("AXGroup", ""), parent: null }) },
		);
		await agent.perform([{ action: "click", target: { text: "Save" } }]);
		expect(count("click")).toBe(1);
	});

	it("presses anyway when the helper cannot answer the hit test", async () => {
		const { agent, count } = setup(
			{},
			{
				find: save,
				at: () => {
					throw new Error("unknown command: at");
				},
			},
		);
		await agent.perform([{ action: "click", target: { text: "Save" } }]);
		expect(count("click")).toBe(1);
	});
});

describe("Windows and Linux", () => {
	const DISPLAY = { id: 5, bounds: { x: 0, y: 0, width: 1000, height: 800 }, scaleFactor: 2 };
	const double = (rect: { x: number; y: number; width: number; height: number }) => ({
		x: rect.x * 2,
		y: rect.y * 2,
		width: rect.width * 2,
		height: rect.height * 2,
	});
	const halve = (rect: { x: number; y: number; width: number; height: number }) => ({
		x: rect.x / 2,
		y: rect.y / 2,
		width: rect.width / 2,
		height: rect.height / 2,
	});
	const screen = () =>
		({
			getAllDisplays: () => [DISPLAY],
			getPrimaryDisplay: () => DISPLAY,
			getDisplayNearestPoint: () => DISPLAY,
			dipToScreenPoint: ({ x, y }: { x: number; y: number }) => ({ x: x * 2, y: y * 2 }),
			screenToDipPoint: ({ x, y }: { x: number; y: number }) => ({ x: x / 2, y: y / 2 }),
			dipToScreenRect: (_: null, rect: typeof FRAME) => double(rect),
			screenToDipRect: (_: null, rect: typeof FRAME) => halve(rect),
		}) as never;
	const on = (platform: NodeJS.Platform) =>
		createAgentPlatform({
			platform,
			env: { DISPLAY: ":0", XDG_SESSION_TYPE: "x11" },
			ozonePlatform: () => "",
			ownPid: 1,
			ownWindowIds: () => [],
			screen,
		});
	const SAVE = double({ x: FRAME.x + 300, y: FRAME.y + 200, width: 80, height: 30 });
	const save = () => ({
		elements: [{ role: "Button", label: "Save", ...SAVE, container: double(FRAME) }],
		truncated: false,
	});

	beforeEach(() => {
		clock.ms = 1_000;
		resetAgentActivity();
	});

	it("sends physical pixels on Windows and reads elements and the cursor back in points", async () => {
		const { agent, commands } = setup({ platform: on("win32") }, { find: save });
		await agent.perform([{ action: "click", x: 10, y: 20 }]);
		expect(commands.find((command) => command.cmd === "click")).toEqual({
			cmd: "click",
			x: 220,
			y: 140,
			ms: 450,
			button: "left",
			count: 1,
			modifiers: [],
		});
		await expect(agent.findElements({ text: "Save" })).resolves.toEqual({
			elements: [{ role: "Button", label: "Save", x: 300, y: 200, width: 80, height: 30 }],
			truncated: false,
		});
		expect(commands.at(-1)).toMatchObject({ cmd: "find", frame: double(FRAME) });
	});

	it("drives a chosen window on Linux and logs targets against the recorded screen", async () => {
		const { agent, remote } = setup(
			{
				platform: on("linux"),
				getSelectedSource: () => ({ id: "screen:linux-portal", name: "Entire screen" }),
			},
			{ find: save, click: tick },
		);
		await expect(agent.perform([{ action: "wait", ms: 1 }])).rejects.toThrow(
			'Choose the window for the mouse and keyboard first: open_url, or select_source with a window id from list_sources. Recordly keeps recording the whole screen. The window in front is "Docs" (id window:7:0).',
		);
		await expect(agent.chooseWindow("window:7:0")).resolves.toMatchObject({
			id: "window:7:0",
			control: true,
		});
		await agent.perform([{ action: "click", target: { text: "Save" } }]);
		const click = snapshotAgentActivity(clock.ms).spans.find((span) => span.action === "click");
		expect(click?.target).toEqual({ cx: 0.44, cy: 265 / 800, width: 0.08, height: 30 / 800 });
		expect(remote.selectSource).not.toHaveBeenCalled();
	});

	it("does the re-aim maths in points, not helper pixels", async () => {
		const shifting = () => ({
			elements: [
				{
					role: "Button",
					label: "Save",
					...double({
						x: FRAME.x + (clock.ms >= 1_200 ? 320 : 300),
						y: FRAME.y + 200,
						width: 80,
						height: 30,
					}),
					container: double(FRAME),
				},
			],
			truncated: false,
		});
		const { agent, commands } = setup(
			{ platform: on("win32") },
			{ find: shifting, click: tick },
		);
		await agent.perform([{ action: "click", target: { text: "Save" }, durationMs: 200 }]);
		expect(commands.find((command) => command.cmd === "move")).toMatchObject({
			x: 880,
			y: 530,
			ms: 200,
		});
		expect(commands.find((command) => command.cmd === "at")).toEqual({
			cmd: "at",
			pid: 42,
			x: 920,
			y: 530,
		});
		expect(commands.find((command) => command.cmd === "click")).toMatchObject({
			x: 920,
			y: 530,
			ms: 120,
		});
	});

	it("sets the control window from open_url on Linux without changing the recorded source", async () => {
		const { agent, remote } = setup({
			platform: on("linux"),
			getSelectedSource: () => null,
		});
		await expect(agent.openUrl("https://example.com")).resolves.toMatchObject({
			source: { id: "window:7:0", control: true },
		});
		expect(remote.selectSource).not.toHaveBeenCalled();
		await expect(agent.perform([{ action: "move", x: 1, y: 1 }])).resolves.toMatchObject({
			performed: 1,
		});
	});

	it("explains how to expose a Linux app's controls when the helper cannot see them", async () => {
		const { agent } = setup(
			{ platform: on("linux") },
			{
				find: () => {
					throw new Error("window not found in process 42");
				},
			},
		);
		await agent.chooseWindow("7");
		await expect(agent.findElements({})).rejects.toThrow(/ACCESSIBILITY_ENABLED=1/);
	});
});

describe("input policy", () => {
	const pointer = { event: "user-input", kind: "move", escape: false } as const;
	const esc = { event: "user-input", kind: "key", escape: true } as const;

	beforeEach(() => {
		clock.ms = 1_000;
		resetAgentActivity();
	});

	const hangFirstWait = () => {
		let release!: () => void;
		let hung = false;
		const sleep = async (ms: number) => {
			if (ms === 5000 && !hung) {
				hung = true;
				await new Promise<void>((resolve) => {
					release = resolve;
				});
				return;
			}
			clock.ms += ms;
		};
		return { sleep, release: () => release() };
	};

	it("pauses on a takeover, waits for stillness, re-arms and finishes the remaining steps", async () => {
		const park = hangFirstWait();
		const {
			agent,
			events: bus,
			commands,
			count,
		} = setup({ sleep: park.sleep }, { click: tick });
		agent.setInputPolicy({ onTakeover: "pause", autoResumeAfterMs: 1_000 });
		const running = agent.perform([
			{ action: "click", x: 10, y: 10 },
			{ action: "wait", ms: 5000 },
			{ action: "click", x: 20, y: 20 },
		]);
		await flush();
		expect(count("click")).toBe(1);
		bus.emit("user-input", pointer);
		park.release();
		await expect(running).resolves.toEqual({ performed: 3, durationMs: expect.any(Number) });
		expect(count("arm")).toBe(2);
		expect(count("disarm")).toBe(1);
		expect(commands.filter((c) => c.cmd === "click")).toHaveLength(2);
		const waits = snapshotAgentActivity(clock.ms + 10_000).spans.filter(
			(span) => span.kind === "wait",
		);
		expect(waits.length).toBeGreaterThan(0);
		expect(bus.listenerCount("user-input")).toBe(0);
	});

	it("keeps waiting while the pointer keeps moving, then resumes", async () => {
		const park = hangFirstWait();
		const { agent, events, count } = setup({
			sleep: async (ms) => {
				await park.sleep(ms);
				if (ms !== 5000 && clock.ms < 3_000) events.emit("user-input", pointer);
			},
		});
		agent.setInputPolicy({ onTakeover: "pause", autoResumeAfterMs: 500 });
		const running = agent.perform([
			{ action: "wait", ms: 5000 },
			{ action: "click", x: 1, y: 1 },
		]);
		await flush();
		events.emit("user-input", pointer);
		park.release();
		await running;
		expect(count("click")).toBe(1);
		expect(count("arm")).toBe(2);
		expect(clock.ms).toBeGreaterThanOrEqual(3_000);
	});

	it("still aborts by default", async () => {
		const { agent, events } = setup({ sleep: () => new Promise(() => undefined) });
		const running = agent.perform([{ action: "wait", ms: 5000 }]);
		await flush();
		events.emit("user-input", pointer);
		await expect(running).rejects.toThrow(TAKEOVER_MESSAGE);
	});

	it.each(["abort", "pause"] as const)("Esc aborts under %s", async (onTakeover) => {
		const { agent, events, count } = setup({ sleep: () => new Promise(() => undefined) });
		agent.setInputPolicy({ onTakeover });
		const running = agent.perform([
			{ action: "wait", ms: 5000 },
			{ action: "click", x: 1, y: 1 },
		]);
		await flush();
		events.emit("user-input", esc);
		await expect(running).rejects.toThrow("Esc was pressed");
		expect(count("click")).toBe(0);
		expect(count("disarm")).toBe(1);
	});

	it("Esc during a pause aborts instead of resuming", async () => {
		const { agent, events, count } = setup({
			sleep: async (ms) => {
				if (ms === 5000) return new Promise(() => undefined);
				clock.ms += ms;
				events.emit("user-input", esc);
			},
		});
		agent.setInputPolicy({ onTakeover: "pause", autoResumeAfterMs: 2_000 });
		const running = agent.perform([{ action: "wait", ms: 5000 }]);
		await flush();
		events.emit("user-input", pointer);
		await expect(running).rejects.toThrow("Esc was pressed");
		expect(count("arm")).toBe(1);
	});

	it("sends the tolerance to the helper only when set", async () => {
		const plain = setup();
		await plain.agent.perform([{ action: "wait", ms: 1 }]);
		expect(plain.commands.find((c) => c.cmd === "arm")).toEqual({ cmd: "arm" });
		const tuned = setup();
		tuned.agent.setInputPolicy({ tolerancePx: 40 });
		await tuned.agent.perform([{ action: "wait", ms: 1 }]);
		expect(tuned.commands.find((c) => c.cmd === "arm")).toEqual({
			cmd: "arm",
			tolerancePx: 40,
		});
	});

	describe("requireTargets", () => {
		const raw = [{ action: "click", x: 50, y: 150 }] as AgentStep[];

		it("refuses raw coordinates while recording, naming the step and the fix, posting nothing", async () => {
			const { agent, names } = setup();
			agent.setInputPolicy({ requireTargets: true });
			await expect(agent.perform([{ action: "wait", ms: 1 }, ...raw])).rejects.toThrow(
				/Step 2 \(click\): .*Aim with a target.*requireTargets false/,
			);
			expect(names()).toEqual([]);
		});

		it("refuses in a dry run, including a step after a page change", async () => {
			const { agent, names } = setup();
			agent.setInputPolicy({ requireTargets: true });
			await expect(agent.perform(raw, { dryRun: true })).rejects.toThrow(/Step 1 \(click\)/);
			await expect(
				agent.perform([{ action: "key", key: "enter" }, ...raw], { dryRun: true }),
			).rejects.toThrow(/Step 2 \(click\)/);
			expect(names()).toEqual([]);
		});

		it("refuses a move and either end of a drag, but lets a drag with two targets through", async () => {
			const { agent } = setup({}, { find: findOn([element("Save", 10, 10)]) });
			agent.setInputPolicy({ requireTargets: true });
			await expect(agent.perform([{ action: "move", x: 1, y: 1 }])).rejects.toThrow(
				/Step 1 \(move\)/,
			);
			await expect(
				agent.perform([{ action: "drag", from: { text: "Save" }, toX: 5, toY: 5 }]),
			).rejects.toThrow(/Step 1 \(drag\)/);
			await expect(
				agent.perform([{ action: "drag", fromX: 5, fromY: 5, to: { text: "Save" } }]),
			).rejects.toThrow(/Step 1 \(drag\)/);
			await expect(
				agent.perform([{ action: "drag", from: { text: "Save" }, to: { text: "Save" } }]),
			).resolves.toMatchObject({ performed: 1 });
		});

		it("passes a step that aims with a target and a scroll at a coordinate", async () => {
			const { agent } = setup({}, { find: findOn([element("Save", 10, 10)]) });
			agent.setInputPolicy({ requireTargets: true });
			await expect(
				agent.perform([
					{ action: "click", target: { text: "Save" } },
					{ action: "scroll", x: 50, y: 150, dy: 3 },
				]),
			).resolves.toMatchObject({ performed: 2 });
		});

		it("allows coordinates again once turned off", async () => {
			const { agent } = setup();
			agent.setInputPolicy({ requireTargets: true });
			agent.setInputPolicy({ requireTargets: false });
			await expect(agent.perform(raw)).resolves.toMatchObject({ performed: 1 });
		});

		it("does not apply while no recording is running", async () => {
			const { agent } = setup();
			agent.setInputPolicy({ requireTargets: true });
			snapshotAgentActivity(clock.ms);
			await expect(agent.perform(raw)).resolves.toMatchObject({ performed: 1 });
		});
	});

	describe("sticky safeRegion", () => {
		const region = { x: 0, y: 100, width: 800, height: 400 };
		const outside = [{ action: "click", x: 50, y: 10 }] as AgentStep[];

		it("applies to every later perform", async () => {
			const { agent, names } = setup();
			agent.setInputPolicy({ safeRegion: region });
			await expect(agent.perform(outside)).rejects.toThrow(/outside the safe region/);
			await expect(agent.perform(outside)).rejects.toThrow(/outside the safe region/);
			expect(names()).toEqual(["preflight", "preflight"]);
		});

		it("lets the per-call region win", async () => {
			const { agent } = setup();
			agent.setInputPolicy({ safeRegion: region });
			await expect(
				agent.perform(outside, { safeRegion: { x: 0, y: 0, width: 800, height: 400 } }),
			).resolves.toMatchObject({ performed: 1 });
		});

		it("rejects a malformed rectangle when set, and keeps the previous policy", async () => {
			const { agent } = setup();
			agent.setInputPolicy({ safeRegion: region });
			expect(() =>
				agent.setInputPolicy({ safeRegion: { x: 0, y: 0, width: 0, height: 5 } }),
			).toThrow(/safeRegion needs numeric/);
			await expect(agent.perform(outside)).rejects.toThrow(/outside the safe region/);
		});

		it("is cleared by null", async () => {
			const { agent } = setup();
			agent.setInputPolicy({ safeRegion: region });
			agent.setInputPolicy({ safeRegion: null });
			await expect(agent.perform(outside)).resolves.toMatchObject({ performed: 1 });
		});

		it("works together with requireTargets", async () => {
			const { agent } = setup({}, { find: findOn([element("Save", 10, 10)]) });
			agent.setInputPolicy({ safeRegion: region, requireTargets: true });
			await expect(agent.perform(outside)).rejects.toThrow(/requires targets/);
			await expect(
				agent.perform([{ action: "click", target: { text: "Save" } }]),
			).rejects.toThrow(/outside the safe region/);
		});
	});
});

describe("window bounds, hold, expect, safeRegion and undo", () => {
	const BOUNDS = { x: 20, y: 30, width: 500, height: 400 };
	const on = (platform: NodeJS.Platform) =>
		createAgentPlatform({
			platform,
			env: { DISPLAY: ":0", XDG_SESSION_TYPE: "x11" },
			ozonePlatform: () => "",
			ownPid: 1,
			ownWindowIds: () => [],
			screen: () =>
				({
					getAllDisplays: () => [
						{
							id: 1,
							bounds: { x: 0, y: 0, width: 3000, height: 2000 },
							scaleFactor: 2,
						},
					],
					getPrimaryDisplay: () => ({
						id: 1,
						bounds: { x: 0, y: 0, width: 3000, height: 2000 },
						scaleFactor: 2,
					}),
					getDisplayNearestPoint: () => ({
						id: 1,
						bounds: { x: 0, y: 0, width: 3000, height: 2000 },
						scaleFactor: 2,
					}),
					dipToScreenRect: (_: null, r: typeof FRAME) => ({
						x: r.x * 2,
						y: r.y * 2,
						width: r.width * 2,
						height: r.height * 2,
					}),
					screenToDipRect: (_: null, r: typeof FRAME) => ({
						x: r.x / 2,
						y: r.y / 2,
						width: r.width / 2,
						height: r.height / 2,
					}),
					dipToScreenPoint: ({ x, y }: { x: number; y: number }) => ({
						x: x * 2,
						y: y * 2,
					}),
					screenToDipPoint: ({ x, y }: { x: number; y: number }) => ({
						x: x / 2,
						y: y / 2,
					}),
				}) as never,
		});

	beforeEach(() => {
		clock.ms = 1_000;
		resetAgentActivity();
	});

	it("sends points to the macOS helper and raises through the existing raise command", async () => {
		const { agent, commands } = setup(
			{},
			{ set_bounds: (c) => ({ frame: (c as { bounds: unknown }).bounds }) },
		);
		await expect(agent.setWindowBounds({ ...BOUNDS, raise: true })).resolves.toMatchObject({
			frame: BOUNDS,
			adjusted: false,
		});
		expect(commands).toEqual([
			{ cmd: "set_bounds", pid: 42, windowId: 7, frame: FRAME, bounds: BOUNDS },
			{ cmd: "raise", pid: 42, windowId: 7, frame: BOUNDS },
		]);
	});

	it.each([
		"win32",
		"linux",
	] as const)("converts bounds to helper pixels on %s and back", async (name) => {
		const { agent, commands } = setup(
			{ platform: on(name) },
			{ set_bounds: () => ({ frame: { x: 40, y: 60, width: 1000, height: 800 } }) },
		);
		if (name === "linux") await agent.chooseWindow("window:7:0");
		const result = await agent.setWindowBounds(BOUNDS);
		expect(commands[0]).toMatchObject({
			cmd: "set_bounds",
			frame: { x: 200, y: 100, width: 1600, height: 1200 },
			bounds: { x: 40, y: 60, width: 1000, height: 800 },
		});
		expect(result.frame).toEqual(BOUNDS);
	});

	it("reports an adjusted rectangle, accepts an off-display window by id, and refuses an unreachable target rectangle", async () => {
		const { agent, deps } = setup(
			{},
			{ set_bounds: () => ({ frame: { ...BOUNDS, width: 300 } }) },
		);
		await expect(
			agent.setWindowBounds({ ...BOUNDS, source: "window:9:0" }),
		).resolves.toMatchObject({
			adjusted: true,
		});
		expect(deps.findWindow).toHaveBeenCalledWith("window:9:0");
		await expect(agent.setWindowBounds({ ...BOUNDS, x: -9000 })).rejects.toThrow(
			/not on any display/,
		);
	});

	it("logs a hold step as a hold span, same as wait", async () => {
		const { agent } = setup();
		await agent.perform([{ action: "hold", ms: 500 }]);
		expect(snapshotAgentActivity(9_000).spans).toEqual([
			{ kind: "hold", action: "wait", startMs: 1_000, endMs: 1_500 },
		]);
		await expect(agent.perform([{ action: "hold", ms: 99_000 }])).rejects.toThrow(
			/hold step may last/,
		);
	});

	it("expect passes when present, and fails the step at once, without scrolling or waiting, when absent", async () => {
		const screen = [element("Save", 300, 200)];
		const { agent, names, deps } = setup({}, { find: findOn(screen) });
		await expect(
			agent.perform([{ action: "expect", target: { text: "Save" } }]),
		).resolves.toMatchObject({ performed: 1 });
		const sleeps = vi.spyOn(deps, "sleep");
		await expect(
			agent.perform([{ action: "expect", target: { text: "Missing" } }]),
		).rejects.toThrow(/Step 1 \(expect\).*"Missing" is not in the window/s);
		expect(names()).not.toContain("scroll");
		expect(sleeps).not.toHaveBeenCalled();
	});

	it("expect with visible: false fails when the target is there", async () => {
		const { agent } = setup({}, { find: findOn([element("Save", 300, 200)]) });
		await expect(
			agent.perform([{ action: "expect", target: { text: "Save" }, visible: false }]),
		).rejects.toThrow(/expected it to be absent/);
		await expect(
			agent.perform([{ action: "expect", target: { text: "Nope" }, visible: false }]),
		).resolves.toMatchObject({ performed: 1 });
	});

	it("refuses a click outside safeRegion before posting anything, naming the point and the region", async () => {
		const { agent, names } = setup();
		const safeRegion = { x: 0, y: 100, width: 800, height: 400 };
		await expect(
			agent.perform([{ action: "click", x: 50, y: 10 }], { safeRegion }),
		).rejects.toThrow(/Point \(50, 10\) is outside the safe region \(x 0, y 100, 800 × 400/);
		expect(names()).toEqual(["preflight"]);
		await expect(
			agent.perform([{ action: "drag", fromX: 5, fromY: 150, toX: 5, toY: 590 }], {
				safeRegion,
			}),
		).rejects.toThrow(/Point \(5, 590\)/);
		await expect(
			agent.perform([{ action: "click", x: 50, y: 150 }], { safeRegion }),
		).resolves.toMatchObject({ performed: 1 });
	});

	it("also checks a resolved target against safeRegion at run time", async () => {
		const { agent, count } = setup(
			{},
			{ find: findOn([element("Tab", 300, 10)]), click: tick },
		);
		await expect(
			agent.perform([{ action: "click", target: { text: "Tab" } }], {
				safeRegion: { x: 0, y: 100, width: 800, height: 400 },
			}),
		).rejects.toThrow(/outside the safe region/);
		expect(count("click")).toBe(0);
	});

	it("refuses a nudge that would carry the click outside safeRegion", async () => {
		const { agent, count } = setup(
			{},
			{
				find: findOn(() => [element("Tasks", clock.ms >= 1_200 ? 74 : 54, 200)]),
				click: tick,
			},
		);
		await expect(
			agent.perform([{ action: "click", target: { text: "Tasks" }, durationMs: 200 }], {
				safeRegion: { x: 0, y: 0, width: 100, height: 400 },
			}),
		).rejects.toThrow(/outside the safe region/);
		expect(count("click")).toBe(0);
	});

	it.each([
		["darwin", "cmd", "Cmd+Z"],
		["win32", "ctrl", "Ctrl+Z"],
		["linux", "ctrl", "Ctrl+Z"],
	] as const)("undo sends the %s chord and says it cannot un-click", async (name, modifier, sent) => {
		const { agent, commands } = setup({ platform: on(name) });
		const result = await agent.undoLastInput();
		expect(commands.at(-1)).toEqual({ cmd: "key", key: "z", modifiers: [modifier], repeat: 1 });
		expect(result).toMatchObject({ sent, app: "Google Chrome" });
		expect(result.note).toMatch(/cannot un-click/);
	});

	it("refuses to undo into Recordly's own window", async () => {
		const { agent, commands } = setup(
			{},
			{ frontmost_window: () => ({ window: { ...CHROME, pid: 1 } }) },
		);
		await expect(agent.undoLastInput()).rejects.toThrow(/own window has focus/);
		expect(commands.some((command) => command.cmd === "key")).toBe(false);
	});

	it("refuses a click at a target that moved outside safeRegion while the pointer approached", async () => {
		let finds = 0;
		const { agent, count } = setup(
			{},
			{
				find: findOn(() => {
					finds += 1;
					return [element("Tasks", finds >= 4 ? 200 : 54, 200)];
				}),
				click: tick,
			},
		);
		await expect(
			agent.perform([{ action: "click", target: { text: "Tasks" } }], {
				safeRegion: { x: 0, y: 0, width: 140, height: 400 },
			}),
		).rejects.toThrow(/Point \(240, 215\) is outside the safe region/);
		expect(count("click")).toBe(0);
	});

	it("says so when the helper could not measure the window it moved", async () => {
		const { agent } = setup({}, { set_bounds: () => ({}) });
		const result = await agent.setWindowBounds(BOUNDS);
		expect(result).toMatchObject({ frame: BOUNDS, adjusted: false });
		expect(result.note).toMatch(/could not read the window's rectangle back/);
	});

	it("keeps the moved rectangle when raising the window afterwards fails", async () => {
		const { agent } = setup(
			{},
			{
				set_bounds: (c) => ({ frame: (c as { bounds: unknown }).bounds }),
				raise: () => {
					throw new Error("the window vanished");
				},
			},
		);
		const result = await agent.setWindowBounds({ ...BOUNDS, raise: true });
		expect(result).toMatchObject({ frame: BOUNDS, adjusted: false });
		expect(result.note).toMatch(/bringing it to the front failed: the window vanished/);
	});

	it("expect says a target is off screen rather than missing", async () => {
		const { agent } = setup(
			{},
			{ find: findOn([element("Save", 300, 200, { visible: false })]) },
		);
		await expect(
			agent.perform([{ action: "expect", target: { text: "Save" } }]),
		).rejects.toThrow(/"Save" is in the window but off screen/);
	});
});

describe("recording a whole display", () => {
	const DISPLAYS = [
		{ id: 1, bounds: { x: 0, y: 0, width: 2000, height: 1200 }, scaleFactor: 1 },
		{ id: 2, bounds: { x: 2000, y: 0, width: 1600, height: 1000 }, scaleFactor: 1 },
	];
	const identity = <T>(_: null, rect: T) => rect;
	const on = (platform: NodeJS.Platform) =>
		createAgentPlatform({
			platform,
			env: { DISPLAY: ":0", XDG_SESSION_TYPE: "x11" },
			ozonePlatform: () => "",
			ownPid: 1,
			ownWindowIds: () => [],
			screen: () =>
				({
					getAllDisplays: () => DISPLAYS,
					getPrimaryDisplay: () => DISPLAYS[0],
					getDisplayNearestPoint: () => DISPLAYS[0],
					dipToScreenPoint: (point: unknown) => point,
					screenToDipPoint: (point: unknown) => point,
					dipToScreenRect: identity,
					screenToDipRect: identity,
				}) as never,
		});
	const displaySource = (display_id: string) => () => ({
		id: `screen:${display_id}:0`,
		name: "Entire screen",
		sourceType: "screen" as const,
		display_id,
	});

	beforeEach(() => {
		clock.ms = 1_000;
		resetAgentActivity();
	});

	it.each([
		"darwin",
		"win32",
	] as const)("drives a chosen window while %s records a display, and logs targets against it", async (name) => {
		const { agent, commands, remote } = setup(
			{ platform: on(name), getSelectedSource: displaySource("1") },
			{ click: tick },
		);
		await expect(agent.perform([{ action: "click", x: 10, y: 20 }])).rejects.toThrow(
			/Choose the window for the mouse and keyboard first/,
		);
		await expect(agent.chooseWindow("window:7:0")).resolves.toMatchObject({
			id: "window:7:0",
			control: true,
		});
		await agent.perform([{ action: "click", x: 10, y: 20 }]);
		expect(commands.find((command) => command.cmd === "click")).toMatchObject({
			x: 110,
			y: 70,
		});
		const click = snapshotAgentActivity(clock.ms).spans.find((span) => span.action === "click");
		expect(click?.target).toEqual({ cx: 110 / 2000, cy: 70 / 1200 });
		expect(remote.selectSource).not.toHaveBeenCalled();
	});

	it("marks a camera target so the video glides to each window it switches to", async () => {
		const { agent } = setup({
			platform: on("darwin"),
			getSelectedSource: displaySource("1"),
		});
		const chosen = await agent.chooseWindow("window:7:0");
		expect(chosen).toMatchObject({
			note: expect.stringContaining("glides to frame this window"),
		});
		expect(snapshotAgentActivity(clock.ms + 1).cameraTargets).toEqual([
			{
				atMs: clock.ms,
				x: FRAME.x / 2000,
				y: Math.round((FRAME.y / 1200) * 1e6) / 1e6,
				width: FRAME.width / 2000,
				height: FRAME.height / 1200,
			},
		]);
	});

	it("refuses a control window that is not on the recorded display", async () => {
		const { agent } = setup({
			platform: on("darwin"),
			getSelectedSource: displaySource("2"),
		});
		await agent.chooseWindow("window:7:0");
		await expect(agent.findElements({})).rejects.toThrow(/on a different display/);
	});

	it("reports a control window that closes mid-run", async () => {
		const findWindow = vi
			.fn<AgentControlDeps["findWindow"]>()
			.mockResolvedValueOnce({ pid: 42, frame: FRAME })
			.mockResolvedValue(null);
		const { agent } = setup({
			platform: on("darwin"),
			getSelectedSource: displaySource("1"),
			findWindow,
		});
		await agent.chooseWindow("window:7:0");
		await expect(agent.findElements({})).rejects.toThrow(/another desktop/);
	});

	it("switches the control window while recording", async () => {
		const { agent, commands, remote } = setup(
			{ platform: on("darwin"), getSelectedSource: displaySource("1") },
			{ find: () => ({ elements: [], truncated: false }) },
		);
		remote.getStatus.mockReturnValue({ state: "recording" } as never);
		await agent.chooseWindow("window:7:0");
		await agent.chooseWindow("window:8:0");
		await agent.findElements({});
		expect(commands.at(-1)).toMatchObject({ cmd: "find", windowId: 8 });
	});

	it.each([
		["a window id that does not exist", "window:404:0", /another desktop/],
		["an id that is not a window", "all of them", /Select a window first/],
	])("refuses %s", async (_, id, message) => {
		const { agent } = setup({
			platform: on("darwin"),
			getSelectedSource: displaySource("1"),
			findWindow: async (sourceId) =>
				sourceId === "window:7:0" ? { pid: 42, frame: FRAME } : null,
		});
		await expect(agent.chooseWindow(id)).rejects.toThrow(message);
	});

	it("refuses a control window while a window is the recorded source", async () => {
		const { agent } = setup({ platform: on("darwin") });
		await expect(agent.chooseWindow("window:9:0")).rejects.toThrow(
			/A window is being recorded, not a whole screen/,
		);
	});

	it("shows the control window by default and the whole display on request", async () => {
		const { agent, deps } = setup({
			platform: on("darwin"),
			getSelectedSource: displaySource("1"),
		});
		await agent.chooseWindow("window:7:0");
		await expect(agent.screenshot()).resolves.toMatchObject({ scope: "window" });
		expect(deps.capture).toHaveBeenLastCalledWith(FRAME, undefined);
		const region = { x: 0, y: 0, width: 100, height: 100 };
		await expect(agent.screenshot(region, "display")).resolves.toMatchObject({
			scope: "display",
			window: { x: 100, y: 50, width: 800, height: 600 },
			note: /whole recorded display/,
		});
		expect(deps.capture).toHaveBeenLastCalledWith(DISPLAYS[0].bounds, region);
	});

	it("says a display shot has no control window, and refuses one for a recorded window", async () => {
		const { agent } = setup({
			platform: on("darwin"),
			getSelectedSource: displaySource("1"),
		});
		const shot = await agent.screenshot(undefined, "display");
		expect(shot).toMatchObject({ scope: "display", note: /No window is chosen/ });
		expect(shot.window).toBeUndefined();
		const window = setup({ platform: on("darwin") });
		await expect(window.agent.screenshot(undefined, "display")).rejects.toThrow(
			/no recorded display to show/,
		);
		await expect(window.agent.screenshot(undefined, "screen" as never)).rejects.toThrow(
			/must be "window" or "display"/,
		);
	});

	it("says a display shot's control window is gone", async () => {
		const findWindow = vi
			.fn<AgentControlDeps["findWindow"]>()
			.mockResolvedValueOnce({ pid: 42, frame: FRAME })
			.mockResolvedValue(null);
		const { agent } = setup({
			platform: on("darwin"),
			getSelectedSource: displaySource("1"),
			findWindow,
		});
		await agent.chooseWindow("window:7:0");
		const shot = await agent.screenshot(undefined, "display");
		expect(shot).toMatchObject({ scope: "display", note: /is closed, minimized or not on/ });
		expect(shot.window).toBeUndefined();
	});
	it("hands the remote a provider that tracks the chosen window", async () => {
		const setControlWindowProvider = vi.fn();
		const fixture = setup({ platform: on("darwin"), getSelectedSource: displaySource("1") });
		const remote = { ...fixture.remote, setControlWindowProvider };
		const agent = createAgentControl(remote as never, fixture.deps);
		const provider = setControlWindowProvider.mock.calls[0][0] as () => number | null;
		expect(provider()).toBeNull();
		await agent.chooseWindow("window:7:0");
		expect(provider()).toBe(7);
	});
});
