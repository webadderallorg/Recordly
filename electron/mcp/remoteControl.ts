import { randomUUID } from "node:crypto";
import { BrowserWindow, ipcMain, screen, systemPreferences } from "electron";
import { isMacWindowOnScreen } from "../ipc/cursor/bounds";
import { isCursorCapturePaused } from "../ipc/cursor/telemetry";
import {
	isLikelyLinuxWaylandSession,
	LINUX_PORTAL_SCREEN_SOURCE_ID,
} from "../ipc/register/sourceMapping";
import { getSources, selectSource, showRecordingHud } from "../ipc/register/sources";
import { countdownInProgress, currentVideoPath, selectedSource } from "../ipc/state";
import { type SelectedSource, WINDOW_OFF_SCREEN_MESSAGE } from "../ipc/types";
import { closeCountdownWindow, getHudOverlayWindow } from "../windows";
import { recordingSignals } from "./signals";

export type RemoteRecordingState =
	| "idle"
	| "starting"
	| "countdown"
	| "recording"
	| "paused"
	| "stopping"
	| "finalizing";

export const MAX_COUNTDOWN_SECONDS = 10;
const CLOSING_LIMIT_MS = 300_000;
const HUD_CRASHED =
	"The Recordly recording controls crashed. Ask the user to quit and reopen Recordly.";
const ON_SCREEN_POLL_MS = 200;
const SHARE_DIALOG_WAITING =
	"Waiting for the user to choose a screen in the system share dialog — ask them to pick one; " +
	"get_status shows when recording starts.";
const ACCESSIBILITY_MISSING =
	"Recordly does not have Accessibility permission (needed for cursor tracking). Ask the user " +
	"to enable Recordly in System Settings > Privacy & Security > Accessibility, then quit and " +
	"reopen Recordly.";

type MacPermissions = { screenRecording: string; accessibility: "granted" | "denied" };
type RawSource = {
	id: string;
	name: string;
	sourceType?: "screen" | "window";
	appName?: string;
	windowTitle?: string;
	pid?: number;
	onScreen?: boolean;
	needsUser?: boolean;
	display_id?: string;
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	[key: string]: unknown;
};
type Listener = (...args: never[]) => void;
type Emitter = {
	on(event: string, listener: Listener): unknown;
	once(event: string, listener: Listener): unknown;
	removeListener(event: string, listener: Listener): unknown;
};
type Contents = Emitter & {
	send(channel: string, command: RemoteRecordingCommand): void;
	isCrashed(): boolean;
};
type Hud = Emitter & { webContents: Contents; isDestroyed(): boolean };
type IpcListener = (event: { sender: unknown }, ...args: never[]) => void;
type Ipc = {
	on(channel: string, listener: IpcListener): unknown;
};

export type DisplayInfo = {
	id: number | string;
	label?: string;
	bounds: { x: number; y: number; width: number; height: number };
	scaleFactor?: number;
	primary: boolean;
};

export type RemoteControlDeps = {
	getPermissions: () => MacPermissions | undefined;
	getSelectedSource: () => SelectedSource | null;
	getLastVideoPath: () => string | null;
	isCountdownActive: () => boolean;
	isCapturePaused: () => boolean;
	getHud: () => Hud | null;
	showHud: () => void;
	cancelCountdown: () => void;
	listSources: () => Promise<RawSource[]>;
	getDisplays: () => DisplayInfo[];
	selectSource: (source: SelectedSource) => Promise<unknown>;
	isWindowOnScreen: (sourceId: string) => Promise<boolean>;
	raiseWindow: (sourceId: string) => Promise<void>;
	platform: NodeJS.Platform;
	isWayland: () => boolean;
	ipc: Ipc;
	signals: typeof recordingSignals;
	createId: () => string;
	timeouts: {
		hudReadyMs: number;
		ackMs: number;
		startMs: number;
		stopMs: number;
		onScreenMs: number;
		waylandStartMs: number;
	};
};

function readMacPermissions(): MacPermissions | undefined {
	if (process.platform !== "darwin") return undefined;
	return {
		screenRecording: systemPreferences.getMediaAccessStatus("screen"),
		accessibility: systemPreferences.isTrustedAccessibilityClient(false) ? "granted" : "denied",
	};
}

function findEditorWindow() {
	return (
		BrowserWindow.getAllWindows().find(
			(window) =>
				!window.isDestroyed() && window.webContents.getURL().includes("windowType=editor"),
		) ?? null
	);
}

const defaultDeps = (): RemoteControlDeps => ({
	getPermissions: readMacPermissions,
	getSelectedSource: () => selectedSource,
	getLastVideoPath: () => currentVideoPath,
	isCountdownActive: () => countdownInProgress,
	isCapturePaused: () => isCursorCapturePaused(),
	getHud: () => getHudOverlayWindow() as unknown as Hud | null,
	showHud: () => showRecordingHud(findEditorWindow(), { focus: false }),
	cancelCountdown: () => closeCountdownWindow(),
	listSources: () =>
		getSources({
			types: ["screen", "window"],
			thumbnailSize: { width: 0, height: 0 },
			allSpaces: true,
		}) as Promise<RawSource[]>,
	getDisplays: () => {
		const primaryId = screen.getPrimaryDisplay().id;
		return screen.getAllDisplays().map((display) => ({
			id: display.id,
			label: display.label,
			bounds: display.bounds,
			scaleFactor: display.scaleFactor,
			primary: display.id === primaryId,
		}));
	},
	selectSource: (source) => selectSource(source, { focusApp: false }),
	isWindowOnScreen: isMacWindowOnScreen,
	raiseWindow: async (sourceId) => {
		const [{ parseWindowId }, { agentInput }, { agentPlatform }] = await Promise.all([
			import("../ipc/utils"),
			import("./agentInput"),
			import("./agentPlatform"),
		]);
		const windowId = parseWindowId(sourceId);
		const found = await agentPlatform.findWindow(sourceId);
		if (!windowId || !found?.pid || !found.frame) return;
		await agentInput.request({
			cmd: "raise",
			pid: found.pid,
			windowId,
			frame: agentPlatform.toHelperRect(found.frame),
		});
	},
	platform: process.platform,
	isWayland: () => isLikelyLinuxWaylandSession(process.env),
	ipc: ipcMain as unknown as Ipc,
	signals: recordingSignals,
	createId: randomUUID,
	timeouts: {
		hudReadyMs: 10_000,
		ackMs: 5_000,
		startMs: 30_000,
		stopMs: 120_000,
		onScreenMs: 2_000,
		waylandStartMs: 120_000,
	},
});

const WINDOW_FIELDS = [
	"windowTitle",
	"pid",
	"onScreen",
	"needsUser",
	"x",
	"y",
	"width",
	"height",
] as const;

const GHOST_MAX_SIDE = 500;

function isHelperGhost(source: RawSource) {
	return (
		source.id.startsWith("window:") &&
		source.onScreen === false &&
		typeof source.width === "number" &&
		typeof source.height === "number" &&
		source.width <= GHOST_MAX_SIDE &&
		source.height <= GHOST_MAX_SIDE
	);
}

function displayOf(source: RawSource, displays: DisplayInfo[]) {
	if (source.display_id === undefined) return undefined;
	const screen =
		(source.sourceType ?? (source.id.startsWith("window:") ? "window" : "screen")) === "screen";
	if (!screen) return undefined;
	return displays.find((display) => String(display.id) === String(source.display_id));
}

function displayFacts(display: DisplayInfo | undefined) {
	if (!display) return {};
	const { x, y, width, height } = display.bounds;
	const scale = display.scaleFactor;
	const known = typeof scale === "number" && Number.isFinite(scale) && scale > 0;
	return {
		...(display.label ? { displayName: display.label } : {}),
		x,
		y,
		width,
		height,
		...(known
			? {
					scaleFactor: scale,
					pixelWidth: Math.round(width * scale),
					pixelHeight: Math.round(height * scale),
				}
			: {}),
		primary: display.primary,
	};
}

function describeCandidate(source: RawSource, displays: DisplayInfo[]) {
	const display = displayOf(source, displays);
	if (!display) return `${source.name} (id: ${source.id})`;
	const { x, y, width, height } = display.bounds;
	const label = display.label ? `"${display.label}", ` : "";
	return `${source.name} (id: ${source.id}, ${label}${width}x${height} at ${x},${y}${display.primary ? ", primary" : ""})`;
}

function summarize(source: RawSource, displays: DisplayInfo[] = []) {
	return {
		id: source.id,
		name: source.name,
		type: source.sourceType ?? (source.id.startsWith("window:") ? "window" : "screen"),
		...(source.appName ? { appName: source.appName } : {}),
		...Object.fromEntries(
			WINDOW_FIELDS.filter((field) => source[field] !== undefined).map((field) => [
				field,
				source[field],
			]),
		),
		...displayFacts(displayOf(source, displays)),
	};
}

function onMainFrameNavigation(contents: Contents, listener: () => void) {
	const handler = (_event: unknown, _url: unknown, isInPlace: boolean, isMainFrame: boolean) => {
		if (isMainFrame && !isInPlace) listener();
	};
	contents.on("did-start-navigation", handler);
	return () => contents.removeListener("did-start-navigation", handler);
}

type Pending = {
	id: string;
	action: RemoteRecordingAction;
	hud: Hud;
	done: Promise<string | null>;
	finish: (result: Error | string | null) => void;
	linger: boolean;
};

export function createRemoteControl(overrides: Partial<RemoteControlDeps> = {}) {
	const deps = { ...defaultDeps(), ...overrides };
	let recording = false;
	let controlWindowId: () => number | null = () => null;
	let recordingHud: Hud | null = null;
	let closingHud: Hud | null = null;
	let closingSince = 0;
	let pending: Pending | null = null;
	let hudReady: Promise<Hud> | null = null;
	let onHudReady: (() => void) | null = null;
	const readyContents = new WeakSet<object>();
	const watchedContents = new WeakSet<object>();

	function getState(): RemoteRecordingState {
		if (deps.isCountdownActive()) return "countdown";
		if (pending?.action === "stop") return "stopping";
		if (recording) return deps.isCapturePaused() ? "paused" : "recording";
		if (pending?.action === "start") return "starting";
		if (closingHud && !closingHud.isDestroyed() && Date.now() - closingSince < CLOSING_LIMIT_MS)
			return "finalizing";
		return "idle";
	}

	deps.ipc.on("remote-recording-ready", (event) => {
		const contents = event.sender as Contents;
		readyContents.add(contents);
		if (!watchedContents.has(contents)) {
			watchedContents.add(contents);
			const forget = () => readyContents.delete(contents);
			contents.on("destroyed", forget);
			contents.on("render-process-gone", forget);
			onMainFrameNavigation(contents, forget);
		}
		onHudReady?.();
	});

	deps.ipc.on("remote-recording-result", (event, result: RemoteCommandResult) => {
		const current = pending;
		if (!current || result?.id !== current.id || event.sender !== current.hud.webContents)
			return;
		if (!result.ok) {
			current.finish(
				new Error(result.error || `Recordly could not ${current.action} the recording.`),
			);
		} else if (current.action === "start") {
			current.finish(
				new Error("Recording did not start (it was cancelled or blocked in Recordly)."),
			);
		} else if (current.action !== "stop") {
			current.finish(null);
		}
	});

	deps.signals.on("videoPath", (path, sender) => {
		const hud = deps.getHud();
		if (!hud || sender !== hud.webContents) return;
		if (pending?.action !== "stop") return;
		pending.finish(path);
		closingHud = hud;
		closingSince = Date.now();
		hud.once("closed", () => {
			if (closingHud === hud) closingHud = null;
		});
	});

	const onRecordingHudClosed = () => {
		recording = false;
		recordingHud = null;
	};

	function send(
		hud: Hud,
		action: RemoteRecordingAction,
		timeoutMs: number,
		extra: Partial<RemoteRecordingCommand> = {},
		linger = false,
	) {
		if (pending)
			throw new Error(`Recordly is still handling "${pending.action}". Try again shortly.`);
		const id = deps.createId();
		let finish!: Pending["finish"];
		const done = new Promise<string | null>((resolve, reject) => {
			const timer = linger
				? undefined
				: setTimeout(
						() =>
							finish(
								new Error(
									`Recordly did not confirm "${action}" within ${Math.round(timeoutMs / 1000)} s.` +
										(action === "start"
											? " It may still start — call get_status."
											: ""),
								),
							),
						timeoutMs,
					);
			const onGone = () =>
				finish(
					new Error(
						`The Recordly recording controls closed before confirming "${action}".`,
					),
				);
			hud.on("closed", onGone);
			hud.webContents.on("render-process-gone", onGone);
			const stopWatchingNavigation = onMainFrameNavigation(hud.webContents, onGone);
			finish = (result) => {
				clearTimeout(timer);
				hud.removeListener("closed", onGone);
				hud.webContents.removeListener("render-process-gone", onGone);
				stopWatchingNavigation();
				if (pending?.id === id) pending = null;
				if (result instanceof Error) reject(result);
				else resolve(result);
			};
		});
		pending = { id, action, hud, done, finish, linger };
		try {
			hud.webContents.send("remote-recording-command", {
				...extra,
				id,
				action,
				expiresAt: Date.now() + timeoutMs,
			});
		} catch {
			finish(new Error(`Recordly could not reach its recording controls to "${action}".`));
		}
		return done;
	}

	function requireHud() {
		const hud = deps.getHud();
		if (!hud) throw new Error("The Recordly recording controls are not open.");
		if (hud.webContents.isCrashed()) throw new Error(HUD_CRASHED);
		return hud;
	}

	function ensureHud() {
		if (deps.getHud()?.webContents.isCrashed()) return Promise.reject(new Error(HUD_CRASHED));
		hudReady ??= new Promise<Hud>((resolve, reject) => {
			const timer = setTimeout(() => {
				onHudReady = null;
				reject(new Error("The Recordly recording controls did not become ready in time."));
			}, deps.timeouts.hudReadyMs);
			const check = () => {
				const hud = deps.getHud();
				if (!hud || !readyContents.has(hud.webContents)) return false;
				clearTimeout(timer);
				onHudReady = null;
				resolve(hud);
				return true;
			};
			deps.showHud();
			if (check()) return;
			onHudReady = check;
		}).finally(() => {
			hudReady = null;
		});
		return hudReady;
	}

	function waitForShareDialog(done: Promise<unknown>) {
		return new Promise<void>((resolve, reject) => {
			const timer = setTimeout(
				() => reject(new Error(SHARE_DIALOG_WAITING)),
				deps.timeouts.waylandStartMs,
			);
			done.then(
				() => {
					clearTimeout(timer);
					resolve();
				},
				(error) => {
					clearTimeout(timer);
					reject(error);
				},
			);
		});
	}

	const isWayland = () => deps.platform === "linux" && deps.isWayland();

	async function rawSources(): Promise<RawSource[]> {
		if (deps.platform !== "linux") return deps.listSources();
		const portal: RawSource = {
			id: LINUX_PORTAL_SCREEN_SOURCE_ID,
			name: isWayland() ? "Screen (chosen in the system share dialog)" : "Entire screen",
			sourceType: "screen",
			...(isWayland() ? { needsUser: true } : {}),
		};
		if (isWayland()) return [portal];
		const sources = await deps.listSources();
		return [
			portal,
			...sources.filter((source) => !/^(screen|window):fallback:/.test(source.id)),
		];
	}

	function preflight() {
		if (!deps.getSelectedSource() && deps.platform !== "linux") {
			throw new Error(
				"No capture source is selected. Call list_sources, then select_source.",
			);
		}
		const permissions = deps.getPermissions();
		if (permissions && permissions.screenRecording !== "granted") {
			throw new Error(
				"Recordly does not have Screen Recording permission. Ask the user to enable Recordly in " +
					"System Settings > Privacy & Security > Screen Recording, then quit and reopen Recordly.",
			);
		}
		if (permissions && permissions.accessibility !== "granted") {
			throw new Error(ACCESSIBILITY_MISSING);
		}
	}

	async function waitUntilOnScreen(sourceId: string) {
		if (!(await deps.isWindowOnScreen(sourceId))) {
			await deps.raiseWindow(sourceId).catch(() => undefined);
		}
		const deadline = Date.now() + deps.timeouts.onScreenMs;
		while (!(await deps.isWindowOnScreen(sourceId))) {
			if (Date.now() >= deadline) return false;
			await new Promise((resolve) => setTimeout(resolve, ON_SCREEN_POLL_MS));
		}
		return true;
	}

	function drivenWindow() {
		const sourceId = deps.getSelectedSource()?.id;
		if (sourceId?.startsWith("window:")) return { id: sourceId, role: "recorded" as const };
		const controlId = controlWindowId();
		return controlId === null
			? null
			: { id: `window:${controlId}:0`, role: "control" as const };
	}

	function getStatus() {
		const source = deps.getSelectedSource();
		return {
			state: getState(),
			selectedSource: source ? { id: source.id ?? null, name: source.name } : null,
			drivenWindow: drivenWindow(),
			lastRecordingPath: deps.getLastVideoPath(),
			permissions: deps.getPermissions(),
		};
	}

	return {
		setControlWindowProvider(provider: () => number | null) {
			controlWindowId = provider;
		},
		onRecordingStateChange(next: boolean) {
			if (next) {
				const hud = deps.getHud();
				if (hud !== recordingHud) {
					recordingHud?.removeListener("closed", onRecordingHudClosed);
					recordingHud?.webContents.removeListener(
						"render-process-gone",
						onRecordingHudClosed,
					);
					recordingHud = hud;
					hud?.on("closed", onRecordingHudClosed);
					hud?.webContents.on("render-process-gone", onRecordingHudClosed);
				}
			}
			recording = next;
			if (next && pending?.action === "start") pending.finish(null);
		},
		getStatus,
		async listSources() {
			const displays = deps.getDisplays();
			return (await rawSources())
				.filter((source) => !isHelperGhost(source))
				.map((source) => summarize(source, displays));
		},
		async selectSource({ id, name }: { id?: string; name?: string }) {
			const needle = name?.trim().toLowerCase();
			if (name !== undefined && !needle) throw new Error("The name must not be empty.");
			if (!id === !needle) throw new Error("Pass exactly one of id or name.");
			const state = getState();
			if (state !== "idle") {
				throw new Error(`The source cannot change while Recordly is ${state}.`);
			}
			const sources = await rawSources();
			const displays = deps.getDisplays();
			let matches = sources.filter((source) =>
				id
					? source.id === id
					: [source.name, source.appName, displayOf(source, displays)?.label].some(
							(value) => value?.toLowerCase().includes(needle ?? ""),
						),
			);
			const exact = matches.filter((source) => source.name.toLowerCase() === needle);
			if (matches.length > 1 && exact.length === 1) matches = exact;
			if (matches.length === 0) {
				throw new Error(
					`No capture source matches ${id ? `id "${id}"` : `"${name}"`}. Call list_sources to see what is available.`,
				);
			}
			if (matches.length > 1) {
				const candidates = matches
					.map((source) => describeCandidate(source, displays))
					.join("; ");
				throw new Error(
					`${matches.length} sources match "${id ?? name}": ${candidates}. Use a more specific name or the id.`,
				);
			}
			const {
				thumbnail: _thumbnail,
				appIcon: _appIcon,
				needsUser: _needsUser,
				...source
			} = matches[0];
			if (
				source.id.startsWith("window:") &&
				deps.getPermissions()?.accessibility === "denied"
			) {
				throw new Error(ACCESSIBILITY_MISSING);
			}
			await deps.selectSource(source);
			if (deps.platform !== "darwin" || !source.id.startsWith("window:")) {
				return summarize(matches[0], displays);
			}
			const onScreen = await waitUntilOnScreen(source.id);
			return {
				...summarize(matches[0], displays),
				onScreen,
				...(onScreen ? {} : { warning: WINDOW_OFF_SCREEN_MESSAGE }),
			};
		},
		async startRecording({
			countdownSeconds,
			hideCursor,
		}: {
			countdownSeconds?: number;
			hideCursor?: boolean;
			scenes?: readonly string[];
		} = {}) {
			const state = getState();
			if (state === "recording" || state === "paused") {
				throw new Error(
					"A recording is already running. Call stop_recording or cancel_recording first.",
				);
			}
			if (state === "starting" || state === "countdown") {
				if (pending?.action === "start" && pending.linger) {
					await waitForShareDialog(pending.done);
					return getStatus();
				}
				throw new Error("A recording is already starting.");
			}
			if (state === "stopping" || state === "finalizing") {
				throw new Error(
					"The previous recording is still being saved. Try again in a few seconds.",
				);
			}
			preflight();
			const sourceId = deps.getSelectedSource()?.id;
			if (
				deps.platform === "darwin" &&
				sourceId?.startsWith("window:") &&
				!(await waitUntilOnScreen(sourceId))
			) {
				throw new Error(WINDOW_OFF_SCREEN_MESSAGE);
			}
			const hud = await ensureHud();
			const countdownMs = (countdownSeconds ?? MAX_COUNTDOWN_SECONDS) * 1000;
			const extra = {
				...(countdownSeconds === undefined ? {} : { countdownSeconds }),
				...(hideCursor === undefined ? {} : { hideCursor }),
			};
			if (isWayland()) {
				await waitForShareDialog(
					send(hud, "start", deps.timeouts.waylandStartMs + countdownMs, extra, true),
				);
			} else {
				await send(hud, "start", deps.timeouts.startMs + countdownMs, extra);
			}
			return getStatus();
		},
		async stopRecording() {
			const state = getState();
			if (state === "countdown") {
				throw new Error(
					"The countdown is still running. Call cancel_recording to abort it.",
				);
			}
			if (state === "stopping") throw new Error("The recording is already stopping.");
			if (state !== "recording" && state !== "paused")
				throw new Error("Recordly is not recording.");
			const videoPath = await send(requireHud(), "stop", deps.timeouts.stopMs);
			return { videoPath };
		},
		async pauseRecording() {
			const state = getState();
			if (state !== "recording") {
				throw new Error(
					state === "paused"
						? "The recording is already paused."
						: "Recordly is not recording.",
				);
			}
			await send(requireHud(), "pause", deps.timeouts.ackMs);
		},
		async resumeRecording() {
			if (getState() !== "paused") throw new Error("The recording is not paused.");
			await send(requireHud(), "resume", deps.timeouts.ackMs);
		},
		async cancelRecording() {
			if (getState() === "countdown") {
				const start = pending?.action === "start" ? pending.done : null;
				deps.cancelCountdown();
				await start?.catch(() => undefined);
				if (!recording) return;
			}
			const state = getState();
			if (state === "starting")
				throw new Error("The recording is still starting. Try again in a moment.");
			if (state !== "recording" && state !== "paused")
				throw new Error("Recordly is not recording.");
			await send(requireHud(), "cancel", deps.timeouts.ackMs);
		},
	};
}

export type RemoteControl = ReturnType<typeof createRemoteControl>;
