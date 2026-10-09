import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ BrowserWindow: {}, ipcMain: {}, systemPreferences: {} }));
vi.mock("../ipc/cursor/bounds", () => ({ isMacWindowOnScreen: vi.fn() }));
vi.mock("../ipc/cursor/telemetry", () => ({}));
vi.mock("../ipc/register/sources", () => ({}));
vi.mock("../ipc/state", () => ({}));
vi.mock("../windows", () => ({}));

import type { SelectedSource } from "../ipc/types";
import { createRemoteControl, type DisplayInfo, type RemoteControlDeps } from "./remoteControl";

const SOURCES = [
	{
		id: "screen:1",
		name: "Screen 1 (Primary)",
		sourceType: "screen" as const,
		thumbnail: "data:",
	},
	{ id: "window:1", name: "Docs", appName: "Google Chrome", sourceType: "window" as const },
	{
		id: "window:2",
		name: "Slack",
		appName: "Slack",
		sourceType: "window" as const,
		appIcon: "data:",
	},
	{ id: "window:3", name: "Mail", appName: "Google Chrome", sourceType: "window" as const },
	{
		id: "window:4",
		name: "Google Chrome",
		appName: "Google Chrome",
		sourceType: "window" as const,
	},
];

async function flush() {
	for (let i = 0; i < 10; i++) await Promise.resolve();
}

function createHud() {
	const send = vi.fn();
	const webContents = Object.assign(new EventEmitter(), { send, isCrashed: vi.fn(() => false) });
	return Object.assign(new EventEmitter(), { webContents, isDestroyed: () => false });
}

type FakeHud = ReturnType<typeof createHud>;

function setup(overrides: Partial<RemoteControlDeps> = {}, { ready = true } = {}) {
	const ipc = new EventEmitter();
	const signals = new EventEmitter<{ videoPath: [path: string, sender: unknown] }>();
	const hud = createHud();
	const state = {
		countdown: false,
		paused: false,
		hud: hud as FakeHud | null,
		source: { id: "screen:1", name: "Screen 1" } as SelectedSource | null,
	};
	let nextId = 0;
	const deps = {
		getPermissions: () => ({ screenRecording: "granted", accessibility: "granted" as const }),
		getSelectedSource: () => state.source,
		getLastVideoPath: () => null,
		isCountdownActive: () => state.countdown,
		isCapturePaused: () => state.paused,
		getHud: () => state.hud,
		showHud: vi.fn(),
		cancelCountdown: vi.fn(),
		listSources: async () => SOURCES,
		getDisplays: () => [],
		selectSource: vi.fn(async () => undefined),
		isWindowOnScreen: vi.fn(async () => true),
		raiseWindow: vi.fn(async () => undefined),
		platform: "darwin" as NodeJS.Platform,
		isWayland: () => false,
		ipc,
		signals,
		createId: () => `cmd-${++nextId}`,
		timeouts: {
			hudReadyMs: 1000,
			ackMs: 1000,
			startMs: 1000,
			stopMs: 1000,
			onScreenMs: 2000,
			waylandStartMs: 5000,
		},
		...overrides,
	} satisfies Partial<RemoteControlDeps>;
	const remote = createRemoteControl(deps);
	const markReady = (target: FakeHud = hud) =>
		ipc.emit("remote-recording-ready", { sender: target.webContents });
	if (ready) markReady();
	const commands = () =>
		hud.webContents.send.mock.calls.map(([, command]) => command as RemoteRecordingCommand);
	const lastCommand = () => commands().at(-1);
	const ack = (result: Omit<RemoteCommandResult, "id">, sender: unknown = hud.webContents) =>
		ipc.emit("remote-recording-result", { sender }, { id: lastCommand()?.id, ...result });
	const savePath = (path: string, sender: unknown = hud.webContents) =>
		signals.emit("videoPath", path, sender);
	return { remote, ipc, hud, state, deps, markReady, commands, lastCommand, ack, savePath };
}

async function startRecording(fixture: ReturnType<typeof setup>) {
	const started = fixture.remote.startRecording({ countdownSeconds: 0 });
	await flush();
	fixture.remote.onRecordingStateChange(true);
	await started;
}

afterEach(() => vi.useRealTimers());

describe("start_recording", () => {
	it("refuses without a source or macOS permissions, before touching the HUD", async () => {
		const noSource = setup();
		noSource.state.source = null;
		await expect(noSource.remote.startRecording()).rejects.toThrow(/select_source/);

		const noScreen = setup({
			getPermissions: () => ({ screenRecording: "denied", accessibility: "granted" }),
		});
		await expect(noScreen.remote.startRecording()).rejects.toThrow(/Screen Recording/);

		const noAccessibility = setup({
			getPermissions: () => ({ screenRecording: "granted", accessibility: "denied" }),
		});
		await expect(noAccessibility.remote.startRecording()).rejects.toThrow(/Accessibility/);

		for (const { commands, deps } of [noSource, noScreen, noAccessibility]) {
			expect(commands()).toHaveLength(0);
			expect(deps.showHud).not.toHaveBeenCalled();
		}
	});

	it("resolves once capture runs, carrying the countdown override and an expiry", async () => {
		vi.useFakeTimers({ now: 50_000 });
		const { remote, lastCommand } = setup();
		const started = remote.startRecording({ countdownSeconds: 2 });
		await flush();
		expect(lastCommand()).toEqual({
			id: "cmd-1",
			action: "start",
			countdownSeconds: 2,
			expiresAt: 50_000 + 1000 + 2000,
		});
		expect(remote.getStatus().state).toBe("starting");
		remote.onRecordingStateChange(true);
		await expect(started).resolves.toMatchObject({ state: "recording" });
	});

	it("rejects with the HUD's error ack and ignores acks from other windows", async () => {
		const { remote, ack } = setup();
		const started = remote.startRecording();
		await flush();
		ack({ ok: false, error: "spoofed" }, {});
		ack({ ok: false, error: "Failed to start recording: boom" });
		await expect(started).rejects.toThrow("Failed to start recording: boom");
		expect(remote.getStatus().state).toBe("idle");
	});

	it("treats a start that ends without capture as not started", async () => {
		const { remote, ack } = setup();
		const started = remote.startRecording();
		await flush();
		ack({ ok: true });
		await expect(started).rejects.toThrow(/did not start/);
	});

	it("times out after the countdown plus the start budget", async () => {
		vi.useFakeTimers();
		const { remote } = setup();
		const started = remote.startRecording({ countdownSeconds: 2 });
		const outcome = expect(started).rejects.toThrow(/did not confirm "start".*call get_status/);
		await vi.advanceTimersByTimeAsync(2999);
		expect(remote.getStatus().state).toBe("starting");
		await vi.advanceTimersByTimeAsync(1);
		await outcome;
		expect(remote.getStatus().state).toBe("idle");
	});

	it("refuses while recording or still starting", async () => {
		const { remote } = setup();
		const started = remote.startRecording();
		await flush();
		await expect(remote.startRecording()).rejects.toThrow(/already starting/);
		remote.onRecordingStateChange(true);
		await started;
		await expect(remote.startRecording()).rejects.toThrow(/already running/);
	});
});

describe("HUD readiness", () => {
	it("opens a HUD once for concurrent starts and waits for its remote listener", async () => {
		const fixture = setup({}, { ready: false });
		const { remote, hud, state, deps, markReady, commands } = fixture;
		state.hud = null;
		const first = remote.startRecording();
		const second = remote.startRecording();
		await flush();
		expect(deps.showHud).toHaveBeenCalledOnce();
		state.hud = hud;
		await flush();
		expect(commands()).toHaveLength(0);
		markReady();
		await expect(second).rejects.toThrow(/still handling "start"/);
		expect(commands()).toHaveLength(1);
		remote.onRecordingStateChange(true);
		await first;
	});

	it("shows an existing HUD that is still loading and waits for it", async () => {
		const { remote, deps, markReady, commands } = setup({}, { ready: false });
		const started = remote.startRecording();
		await flush();
		expect(deps.showHud).toHaveBeenCalledOnce();
		expect(commands()).toHaveLength(0);
		markReady();
		await flush();
		expect(commands()).toHaveLength(1);
		remote.onRecordingStateChange(true);
		await started;
	});

	it.each([
		[
			"reloads",
			(hud: FakeHud) => hud.webContents.emit("did-start-navigation", {}, "", false, true),
		],
		["crashes", (hud: FakeHud) => hud.webContents.emit("render-process-gone")],
	])("forgets readiness when the HUD %s, then times out", async (_, lose) => {
		vi.useFakeTimers();
		const { remote, hud, commands } = setup();
		hud.webContents.emit("did-start-navigation", {}, "", true, true);
		hud.webContents.emit("did-start-navigation", {}, "", false, false);
		lose(hud);
		const started = remote.startRecording();
		const outcome = expect(started).rejects.toThrow(/did not become ready/);
		await vi.advanceTimersByTimeAsync(1000);
		await outcome;
		expect(commands()).toHaveLength(0);
	});
});

describe("HUD dying mid-command", () => {
	it.each([
		["closes", (hud: FakeHud) => hud.emit("closed")],
		["crashes", (hud: FakeHud) => hud.webContents.emit("render-process-gone")],
		[
			"navigates",
			(hud: FakeHud) => hud.webContents.emit("did-start-navigation", {}, "", false, true),
		],
	])("settles a pending command when the HUD %s", async (_, kill) => {
		const { remote, hud } = setup();
		const started = remote.startRecording();
		await flush();
		kill(hud);
		await expect(started).rejects.toThrow(/closed before confirming "start"/);
		expect(remote.getStatus().state).toBe("idle");
		expect(hud.listenerCount("closed")).toBe(0);
		expect(hud.webContents.listenerCount("render-process-gone")).toBe(1);
	});

	it("drops the recording state when the recording HUD closes, without stacking listeners", async () => {
		const fixture = setup();
		await startRecording(fixture);
		fixture.remote.onRecordingStateChange(true);
		expect(fixture.hud.listenerCount("closed")).toBe(1);
		fixture.hud.emit("closed");
		expect(fixture.remote.getStatus().state).toBe("idle");
	});
});

describe("stop_recording", () => {
	it("reports stopping, returns the path, then blocks a start until the HUD closes", async () => {
		const fixture = setup();
		const { remote, hud, lastCommand, savePath } = fixture;
		await startRecording(fixture);
		const stopped = remote.stopRecording();
		expect(lastCommand()?.action).toBe("stop");
		expect(remote.getStatus().state).toBe("stopping");
		remote.onRecordingStateChange(false);
		expect(remote.getStatus().state).toBe("stopping");
		savePath("/rec/recording-1.mp4");
		await expect(stopped).resolves.toEqual({ videoPath: "/rec/recording-1.mp4" });

		expect(remote.getStatus().state).toBe("finalizing");
		await expect(remote.startRecording()).rejects.toThrow(/still being saved/);
		hud.emit("closed");
		expect(remote.getStatus().state).toBe("idle");
	});

	it("ignores paths reported by other windows", async () => {
		const fixture = setup();
		await startRecording(fixture);
		const stopped = fixture.remote.stopRecording();
		fixture.remote.onRecordingStateChange(false);
		fixture.savePath("/editor/opened.mp4", {});
		expect(fixture.remote.getStatus().state).toBe("stopping");
		fixture.savePath("/rec/recording-2.mp4");
		await expect(stopped).resolves.toEqual({ videoPath: "/rec/recording-2.mp4" });
	});

	it("rejects with a finalize failure ack, and refuses when not recording", async () => {
		const fixture = setup();
		await expect(fixture.remote.stopRecording()).rejects.toThrow(/not recording/);
		await startRecording(fixture);
		const stopped = fixture.remote.stopRecording();
		fixture.ack({ ok: true });
		fixture.ack({ ok: false, error: "The recording captured no video data" });
		await expect(stopped).rejects.toThrow("The recording captured no video data");
	});
});

describe("pause / resume", () => {
	it("resolve only on the HUD ack and refuse in the wrong state", async () => {
		const fixture = setup();
		const { remote, state, ack, lastCommand } = fixture;
		await expect(remote.pauseRecording()).rejects.toThrow(/not recording/);
		await startRecording(fixture);
		await expect(remote.resumeRecording()).rejects.toThrow(/not paused/);

		let settled = false;
		const paused = remote.pauseRecording().then(() => {
			settled = true;
		});
		expect(lastCommand()?.action).toBe("pause");
		await flush();
		expect(settled).toBe(false);
		ack({ ok: true });
		await paused;
		state.paused = true;
		expect(remote.getStatus().state).toBe("paused");
		await expect(remote.pauseRecording()).rejects.toThrow(/already paused/);

		const resumed = remote.resumeRecording();
		expect(lastCommand()?.action).toBe("resume");
		ack({ ok: false, error: "Recordly could not resume the recording." });
		await expect(resumed).rejects.toThrow("could not resume");
	});
});

describe("cancel_recording", () => {
	it("aborts a countdown through cancel-countdown, never the HUD's cancelRecording", async () => {
		const { remote, state, deps, commands, ack } = setup();
		const started = remote.startRecording({ countdownSeconds: 3 });
		const startOutcome = expect(started).rejects.toThrow(/did not start/);
		await flush();
		state.countdown = true;
		const cancelled = remote.cancelRecording();
		expect(deps.cancelCountdown).toHaveBeenCalledOnce();
		state.countdown = false;
		ack({ ok: true });
		await cancelled;
		await startOutcome;
		expect(commands().map((command) => command.action)).toEqual(["start"]);
	});

	it("cancels the capture when the countdown had already finished", async () => {
		const { remote, state, commands, ack } = setup();
		const started = remote.startRecording({ countdownSeconds: 3 });
		await flush();
		state.countdown = true;
		const cancelled = remote.cancelRecording();
		state.countdown = false;
		remote.onRecordingStateChange(true);
		await started;
		await flush();
		expect(commands().map((command) => command.action)).toEqual(["start", "cancel"]);
		ack({ ok: true });
		await cancelled;
	});

	it("sends cancel while recording and does not mark the HUD as closing", async () => {
		const fixture = setup();
		await startRecording(fixture);
		const cancelled = fixture.remote.cancelRecording();
		expect(fixture.lastCommand()?.action).toBe("cancel");
		fixture.remote.onRecordingStateChange(false);
		fixture.ack({ ok: true });
		await cancelled;
		fixture.savePath("/somewhere/opened-later.mp4");
		expect(fixture.remote.getStatus().state).toBe("idle");
	});
});

describe("select_source", () => {
	it("matches a name case-insensitively and strips image data", async () => {
		const { remote, deps } = setup();
		await expect(remote.selectSource({ name: "slack" })).resolves.toEqual({
			id: "window:2",
			name: "Slack",
			type: "window",
			appName: "Slack",
			onScreen: true,
		});
		expect(deps.selectSource).toHaveBeenCalledWith({
			id: "window:2",
			name: "Slack",
			appName: "Slack",
			sourceType: "window",
		});
	});

	it("errors on zero or several matches, listing candidates", async () => {
		const { remote, deps } = setup();
		await expect(remote.selectSource({ name: "Figma" })).rejects.toThrow(/No capture source/);
		const many = remote.selectSource({ name: "o" });
		await expect(many).rejects.toThrow(/sources match/);
		await expect(many).rejects.toThrow(/window:1.*window:3/);
		expect(deps.selectSource).not.toHaveBeenCalled();
	});

	it("prefers a single exact name match among several", async () => {
		const { remote } = setup();
		await expect(remote.selectSource({ name: "google chrome" })).resolves.toMatchObject({
			id: "window:4",
		});
	});

	it("rejects an empty or whitespace-only name", async () => {
		const { remote, deps } = setup();
		await expect(remote.selectSource({ name: "   " })).rejects.toThrow(/must not be empty/);
		await expect(remote.selectSource({ name: "" })).rejects.toThrow(/must not be empty/);
		expect(deps.selectSource).not.toHaveBeenCalled();
	});

	it("refuses a window without Accessibility instead of triggering the macOS prompt", async () => {
		const { remote, deps } = setup({
			getPermissions: () => ({ screenRecording: "granted", accessibility: "denied" }),
		});
		await expect(remote.selectSource({ name: "slack" })).rejects.toThrow(/Accessibility/);
		expect(deps.selectSource).not.toHaveBeenCalled();
		await expect(remote.selectSource({ id: "screen:1" })).resolves.toMatchObject({
			type: "screen",
		});
	});

	it("selects by exact id and lists sources without thumbnails", async () => {
		const { remote } = setup();
		await expect(remote.selectSource({ id: "screen:1" })).resolves.toMatchObject({
			type: "screen",
		});
		const listed = await remote.listSources();
		expect(listed).toHaveLength(SOURCES.length);
		expect(JSON.stringify(listed)).not.toContain("data:");
	});

	it("lists windows with pid, title, on-screen flag and bounds", async () => {
		const chrome = {
			id: "window:5:0",
			name: "Google Chrome — Docs",
			appName: "Google Chrome",
			windowTitle: "Docs",
			sourceType: "window" as const,
			pid: 42,
			onScreen: false,
			x: 10,
			y: 20,
			width: 800,
			height: 600,
			thumbnail: "data:",
			bundleId: "com.google.Chrome",
		};
		const { remote } = setup({ listSources: async () => [SOURCES[0], chrome] });
		await expect(remote.listSources()).resolves.toEqual([
			{ id: "screen:1", name: "Screen 1 (Primary)", type: "screen" },
			{
				id: "window:5:0",
				name: "Google Chrome — Docs",
				type: "window",
				appName: "Google Chrome",
				windowTitle: "Docs",
				pid: 42,
				onScreen: false,
				x: 10,
				y: 20,
				width: 800,
				height: 600,
			},
		]);
	});

	it("raises the window, then waits until it is on screen", async () => {
		vi.useFakeTimers();
		const onScreen = [false, false, true];
		const order: string[] = [];
		const { remote } = setup({
			selectSource: vi.fn(async () => {
				order.push("select");
			}),
			isWindowOnScreen: vi.fn(async () => {
				order.push("check");
				return onScreen.shift() ?? true;
			}),
		});
		const selected = remote.selectSource({ name: "slack" });
		await vi.advanceTimersByTimeAsync(400);
		await expect(selected).resolves.toEqual({
			id: "window:2",
			name: "Slack",
			type: "window",
			appName: "Slack",
			onScreen: true,
		});
		expect(order).toEqual(["select", "check", "check", "check"]);
	});

	it("gives up waiting after 2 s and says the window is on another desktop", async () => {
		vi.useFakeTimers();
		const { remote } = setup({ isWindowOnScreen: vi.fn(async () => false) });
		const selected = remote.selectSource({ name: "slack" });
		await vi.advanceTimersByTimeAsync(2200);
		await expect(selected).resolves.toMatchObject({
			onScreen: false,
			warning: expect.stringMatching(/another desktop/),
		});
	});
});

describe("start_recording window checks", () => {
	it("refuses a window that stays off screen even after raising it, before touching the HUD", async () => {
		vi.useFakeTimers();
		const { remote, state, commands, deps } = setup({
			isWindowOnScreen: vi.fn(async () => false),
		});
		state.source = { id: "window:2", name: "Slack" };
		const started = expect(remote.startRecording()).rejects.toThrow(
			/minimized or on another desktop/,
		);
		await vi.advanceTimersByTimeAsync(2200);
		await started;
		expect(deps.raiseWindow).toHaveBeenCalledWith("window:2");
		expect(commands()).toHaveLength(0);
		expect(deps.showHud).not.toHaveBeenCalled();
	});

	it("raises a window on another desktop and proceeds once it is on screen", async () => {
		vi.useFakeTimers();
		let raised = false;
		const fixture = setup({
			raiseWindow: vi.fn(async () => {
				raised = true;
			}),
			isWindowOnScreen: vi.fn(async () => raised),
		});
		fixture.state.source = { id: "window:2", name: "Slack" };
		await startRecording(fixture);
		expect(fixture.deps.raiseWindow).toHaveBeenCalledWith("window:2");
	});

	it("does not check screens", async () => {
		const fixture = setup();
		await startRecording(fixture);
		expect(fixture.deps.isWindowOnScreen).not.toHaveBeenCalled();
	});
});

describe("Linux", () => {
	const PORTAL = {
		id: "screen:linux-portal",
		name: "Screen (chosen in the system share dialog)",
		type: "screen",
		needsUser: true,
	};

	it("lists only the share-dialog screen on Wayland, without enumerating sources", async () => {
		const listSources = vi.fn(async () => SOURCES);
		const { remote, deps } = setup({ platform: "linux", isWayland: () => true, listSources });
		await expect(remote.listSources()).resolves.toEqual([PORTAL]);
		await expect(remote.selectSource({ id: "screen:1" })).rejects.toThrow(/No capture source/);
		await expect(remote.selectSource({ name: "screen" })).resolves.toEqual(PORTAL);
		expect(deps.selectSource).toHaveBeenCalledWith({
			id: "screen:linux-portal",
			name: PORTAL.name,
			sourceType: "screen",
		});
		expect(listSources).not.toHaveBeenCalled();
	});

	it("puts the unattended screen first on X11 and drops fallback entries", async () => {
		const { remote } = setup({
			platform: "linux",
			listSources: async () => [
				{ id: "screen:fallback:1", name: "Screen 2", sourceType: "screen" as const },
				SOURCES[1],
			],
		});
		const listed = await remote.listSources();
		expect(listed.map((source) => source.id)).toEqual(["screen:linux-portal", "window:1"]);
		expect(listed[0]).not.toHaveProperty("needsUser");
		expect(listed[1]).not.toHaveProperty("onScreen");
	});

	it("starts without a selected source, since the HUD falls back to the system screen", async () => {
		const fixture = setup({ platform: "linux" });
		fixture.state.source = null;
		await startRecording(fixture);
		expect(fixture.lastCommand()?.action).toBe("start");
	});

	it("keeps a Wayland start pending past the timeout and lets a retry wait for it", async () => {
		vi.useFakeTimers();
		const { remote, commands } = setup({ platform: "linux", isWayland: () => true });
		const started = remote.startRecording({ countdownSeconds: 0 });
		const outcome = expect(started).rejects.toThrow(/system share dialog/);
		await vi.advanceTimersByTimeAsync(5000);
		await outcome;
		expect(remote.getStatus().state).toBe("starting");
		const retry = remote.startRecording({ countdownSeconds: 0 });
		await vi.advanceTimersByTimeAsync(1000);
		remote.onRecordingStateChange(true);
		await expect(retry).resolves.toMatchObject({ state: "recording" });
		expect(commands()).toHaveLength(1);

		const cancelled = setup({ platform: "linux", isWayland: () => true });
		const pending = cancelled.remote.startRecording({ countdownSeconds: 0 });
		const pendingOutcome = expect(pending).rejects.toThrow(/system share dialog/);
		await vi.advanceTimersByTimeAsync(5000);
		await pendingOutcome;
		cancelled.ack({ ok: false, error: "Permission denied" });
		expect(cancelled.remote.getStatus().state).toBe("idle");
	});

	it("leaves onScreen out of select_source off macOS", async () => {
		const { remote, deps } = setup({ platform: "win32" });
		await expect(remote.selectSource({ name: "slack" })).resolves.not.toHaveProperty(
			"onScreen",
		);
		expect(deps.isWindowOnScreen).not.toHaveBeenCalled();
	});

	it("names the id when several sources share it", async () => {
		const { remote } = setup({ listSources: async () => [SOURCES[1], SOURCES[1]] });
		await expect(remote.selectSource({ id: "window:1" })).rejects.toThrow(
			'2 sources match "window:1"',
		);
	});
});

describe("HUD lifecycle", () => {
	it("shows a hidden HUD that is already ready before starting", async () => {
		const fixture = setup();
		await startRecording(fixture);
		expect(fixture.deps.showHud).toHaveBeenCalledOnce();
	});

	it("only treats the HUD as finalizing after a remote stop, and not forever", async () => {
		vi.useFakeTimers({ now: 0 });
		const cancelled = setup();
		await startRecording(cancelled);
		const cancelling = cancelled.remote.cancelRecording();
		cancelled.remote.onRecordingStateChange(false);
		cancelled.ack({ ok: true });
		await cancelling;
		cancelled.savePath("/rec/opened-from-hud.mp4");
		expect(cancelled.remote.getStatus().state).toBe("idle");

		const failed = setup();
		await startRecording(failed);
		const stopping = failed.remote.stopRecording();
		failed.ack({ ok: false, error: "The recording captured no video data" });
		await expect(stopping).rejects.toThrow("no video data");
		failed.remote.onRecordingStateChange(false);
		failed.savePath("/rec/opened-from-hud.mp4");
		expect(failed.remote.getStatus().state).toBe("idle");

		const stopped = setup();
		await startRecording(stopped);
		const saving = stopped.remote.stopRecording();
		stopped.remote.onRecordingStateChange(false);
		stopped.savePath("/rec/recording-3.mp4");
		await saving;
		expect(stopped.remote.getStatus().state).toBe("finalizing");
		await expect(stopped.remote.selectSource({ name: "slack" })).rejects.toThrow(
			"while Recordly is finalizing",
		);
		vi.setSystemTime(300_000);
		expect(stopped.remote.getStatus().state).toBe("idle");
	});

	it("releases the pending command when the HUD cannot be reached", async () => {
		const { remote, hud, commands } = setup();
		hud.webContents.send.mockImplementationOnce(() => {
			throw new Error("Object has been destroyed");
		});
		await expect(remote.startRecording()).rejects.toThrow(/could not reach/);
		expect(remote.getStatus().state).toBe("idle");
		const retry = remote.startRecording({ countdownSeconds: 0 });
		await flush();
		expect(commands().at(-1)?.action).toBe("start");
		remote.onRecordingStateChange(true);
		await retry;
	});

	it("drops the recording when the HUD crashes and refuses a crashed HUD at once", async () => {
		const fixture = setup();
		await startRecording(fixture);
		fixture.hud.webContents.isCrashed.mockReturnValue(true);
		fixture.hud.webContents.emit("render-process-gone");
		expect(fixture.remote.getStatus().state).toBe("idle");
		await expect(fixture.remote.startRecording()).rejects.toThrow(/crashed/);
		expect(fixture.commands()).toHaveLength(1);
	});
});

describe("display geometry", () => {
	const display = (id: number, over: Partial<DisplayInfo> = {}): DisplayInfo => ({
		id,
		bounds: { x: 0, y: 0, width: 1440, height: 900 },
		scaleFactor: 2,
		primary: id === 1,
		...over,
	});
	const screenSource = (n: number, displayId: string) => ({
		id: `screen:${n}:0`,
		name: n === 1 ? "Screen 1 (Primary)" : `Screen ${n}`,
		sourceType: "screen" as const,
		display_id: displayId,
	});

	it("leaves a window's own rect alone, even though it belongs to a display", async () => {
		const { remote } = setup({
			listSources: async () => [
				{
					id: "window:330:0",
					name: "Code",
					sourceType: "window",
					appName: "Code",
					display_id: "1",
					x: 0,
					y: 30,
					width: 1440,
					height: 800,
				} as never,
			],
			getDisplays: () => [display(1)],
		});
		await expect(remote.listSources()).resolves.toEqual([
			{
				id: "window:330:0",
				name: "Code",
				type: "window",
				appName: "Code",
				x: 0,
				y: 30,
				width: 1440,
				height: 800,
			},
		]);
	});

	it("gives each screen bounds, scale, pixel size and primary", async () => {
		const { remote } = setup({
			listSources: async () => [screenSource(1, "1"), screenSource(2, "2")],
			getDisplays: () => [
				display(1),
				display(2, {
					label: "LG HDR",
					bounds: { x: 1440, y: -200, width: 2560, height: 1440 },
					scaleFactor: 1,
				}),
			],
		});
		await expect(remote.listSources()).resolves.toEqual([
			{
				id: "screen:1:0",
				name: "Screen 1 (Primary)",
				type: "screen",
				x: 0,
				y: 0,
				width: 1440,
				height: 900,
				scaleFactor: 2,
				pixelWidth: 2880,
				pixelHeight: 1800,
				primary: true,
			},
			{
				id: "screen:2:0",
				name: "Screen 2",
				type: "screen",
				displayName: "LG HDR",
				x: 1440,
				y: -200,
				width: 2560,
				height: 1440,
				scaleFactor: 1,
				pixelWidth: 2560,
				pixelHeight: 1440,
				primary: false,
			},
		]);
	});

	it("omits scale and pixels when the scale factor is unavailable", async () => {
		for (const scaleFactor of [undefined, 0, Number.NaN]) {
			const { remote } = setup({
				listSources: async () => [screenSource(1, "1")],
				getDisplays: () => [display(1, { scaleFactor })],
			});
			const [entry] = await remote.listSources();
			expect(entry).toMatchObject({ width: 1440, primary: true });
			expect(entry).not.toHaveProperty("scaleFactor");
			expect(entry).not.toHaveProperty("pixelWidth");
		}
	});

	it("adds no geometry when the display is unknown, and leaves windows alone", async () => {
		const { remote } = setup({
			listSources: async () => [screenSource(3, "99"), SOURCES[1]],
			getDisplays: () => [display(1)],
		});
		const listed = await remote.listSources();
		expect(listed[0]).toEqual({ id: "screen:3:0", name: "Screen 3", type: "screen" });
		expect(listed[1]).toEqual({
			id: "window:1",
			name: "Docs",
			type: "window",
			appName: "Google Chrome",
		});
	});

	it("gives the Wayland portal entry no fake geometry", async () => {
		const { remote } = setup({
			platform: "linux",
			isWayland: () => true,
			getDisplays: () => [display(1)],
		});
		const [portal] = await remote.listSources();
		expect(portal).toEqual({
			id: "screen:linux-portal",
			name: "Screen (chosen in the system share dialog)",
			type: "screen",
			needsUser: true,
		});
	});

	it("tells two displays apart when a name is ambiguous, and matches a display label", async () => {
		const fixture = {
			listSources: async () => [screenSource(1, "1"), screenSource(2, "2")],
			getDisplays: () => [
				display(1, { label: "Built-in" }),
				display(2, {
					label: "LG HDR",
					bounds: { x: 1440, y: 0, width: 2560, height: 1440 },
				}),
			],
		};
		const { remote, deps } = setup(fixture);
		const ambiguous = remote.selectSource({ name: "screen" });
		await expect(ambiguous).rejects.toThrow(/1440x900 at 0,0, primary/);
		await expect(ambiguous).rejects.toThrow(/"LG HDR", 2560x1440 at 1440,0\)/);
		expect(deps.selectSource).not.toHaveBeenCalled();
		await expect(remote.selectSource({ name: "lg hdr" })).resolves.toMatchObject({
			id: "screen:2:0",
			displayName: "LG HDR",
		});
	});

	it("reports a display unplugged since list_sources as an unknown id", async () => {
		let displays = [display(1), display(2)];
		let sources = [screenSource(1, "1"), screenSource(2, "2")];
		const { remote, deps } = setup({
			listSources: async () => sources,
			getDisplays: () => displays,
		});
		const listed = await remote.listSources();
		expect(listed).toHaveLength(2);
		displays = [display(1)];
		sources = [screenSource(1, "1")];
		await expect(remote.selectSource({ id: "screen:2:0" })).rejects.toThrow(
			/No capture source matches id "screen:2:0"/,
		);
		expect(deps.selectSource).not.toHaveBeenCalled();
	});
});

describe("helper-window filtering and driven window", () => {
	const ghost = (id: string, width: number, height: number, name = "CursorUIViewService") => ({
		id,
		name,
		appName: name,
		sourceType: "window" as const,
		onScreen: false,
		width,
		height,
	});
	const real = {
		id: "window:100:0",
		name: "Docs",
		sourceType: "window" as const,
		onScreen: true,
		width: 800,
		height: 600,
	};
	const ids = async (remote: ReturnType<typeof setup>["remote"]) =>
		(await remote.listSources()).map((source) => source.id);

	it("hides small off-screen helper windows and keeps everything else", async () => {
		const minimizedBig = { ...ghost("window:4:0", 800, 600, "Minimized"), name: "Minimized" };
		const { remote } = setup({
			listSources: async () => [
				SOURCES[0],
				ghost("window:1:0", 64, 64),
				ghost("window:2:0", 312, 237, "AutoFill (Notes)"),
				ghost("window:3:0", 500, 500, "Open and Save Panel Service (Preview)"),
				minimizedBig,
				real,
			],
		});
		expect(await ids(remote)).toEqual(["screen:1", "window:4:0", "window:100:0"]);
	});

	it("keeps a tiny window that is on screen or whose size is unknown", async () => {
		const tiny = { ...real, id: "window:5:0", width: 64, height: 64 };
		const unknown = { ...ghost("window:6:0", 1, 1), width: undefined, height: undefined };
		const { remote } = setup({ listSources: async () => [tiny, unknown] });
		expect(await ids(remote)).toEqual(["window:5:0", "window:6:0"]);
	});

	it("lists only the screen when there are no windows", async () => {
		const { remote } = setup({ listSources: async () => [SOURCES[0]] });
		expect(await ids(remote)).toEqual(["screen:1"]);
	});

	it("still selects a hidden helper window by id", async () => {
		const { remote, deps } = setup({ listSources: async () => [ghost("window:1:0", 64, 64)] });
		await expect(remote.selectSource({ id: "window:1:0" })).resolves.toMatchObject({
			id: "window:1:0",
		});
		expect(deps.selectSource).toHaveBeenCalled();
	});

	it("still selects a hidden helper window by name", async () => {
		const { remote, deps } = setup({
			listSources: async () => [ghost("window:1:0", 64, 64, "AutoFill (Notes)")],
		});
		await expect(remote.selectSource({ name: "autofill" })).resolves.toMatchObject({
			id: "window:1:0",
		});
		expect(deps.selectSource).toHaveBeenCalled();
	});

	it("does not filter the Wayland portal entry", async () => {
		const { remote } = setup({
			platform: "linux",
			isWayland: () => true,
			listSources: async () => [ghost("window:1:0", 64, 64)],
		});
		expect(await ids(remote)).toEqual(["screen:linux-portal"]);
	});

	it("reports no driven window when a screen is recorded and none is chosen", () => {
		const { remote } = setup();
		expect(remote.getStatus().drivenWindow).toBeNull();
	});

	it("reports the chosen control window while a screen is recorded", () => {
		const { remote } = setup();
		remote.setControlWindowProvider(() => 330);
		expect(remote.getStatus()).toMatchObject({
			selectedSource: { id: "screen:1" },
			drivenWindow: { id: "window:330:0", role: "control" },
		});
	});

	it("reports the recorded window as the driven one, ignoring a stale control window", () => {
		const { remote, state } = setup();
		remote.setControlWindowProvider(() => 330);
		state.source = { id: "window:9:0", name: "Docs" } as SelectedSource;
		expect(remote.getStatus().drivenWindow).toEqual({ id: "window:9:0", role: "recorded" });
	});
});
