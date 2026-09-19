import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import {
	hasLoggedInteractionHookFailure,
	interactionCaptureCleanup,
	isCursorCaptureActive,
	isKeystrokeCaptureActive,
	lastLeftClick,
	setHasLoggedInteractionHookFailure,
	setInteractionCaptureCleanup,
	setLastLeftClick,
	setLinuxCursorScreenPoint,
} from "../state";
import type {
	CursorInteractionType,
	HookKeyboardEvent,
	HookMouseEvent,
	KeystrokeModifier,
	UiohookLike,
	UiohookModuleNamespace,
} from "../types";
import { recordKeystroke } from "./keystrokeTelemetry";
import {
	getCursorCaptureElapsedMs,
	getHookCursorScreenPoint,
	getNormalizedCursorPoint,
	isCursorCapturePaused,
	pushCursorSample,
} from "./telemetry";

const nodeRequire = createRequire(import.meta.url);

export function normalizeHookMouseButton(rawButton: unknown): 1 | 2 | 3 {
	if (typeof rawButton !== "number" || !Number.isFinite(rawButton)) {
		return 1;
	}

	if (rawButton === 2 || rawButton === 39) {
		return 2;
	}

	if (rawButton === 3 || rawButton === 38) {
		return 3;
	}

	return 1;
}

export function getHookMouseButton(event: HookMouseEvent | null | undefined): 1 | 2 | 3 {
	return normalizeHookMouseButton(
		event?.button ?? event?.mouseButton ?? event?.data?.button ?? event?.data?.mouseButton,
	);
}

export function stopInteractionCapture() {
	if (interactionCaptureCleanup) {
		interactionCaptureCleanup();
		setInteractionCaptureCleanup(null);
	}
}

function isUiohookLike(value: unknown): value is UiohookLike {
	const candidate = value as Partial<UiohookLike> | null;
	return typeof candidate?.on === "function" && typeof candidate?.start === "function";
}

function resolveUiohookModule(moduleExports: UiohookModuleNamespace) {
	const defaultExport = moduleExports.default;

	if (moduleExports.uIOhook) {
		return moduleExports.uIOhook;
	}

	if (moduleExports.uiohook) {
		return moduleExports.uiohook;
	}

	if (moduleExports.Uiohook) {
		return moduleExports.Uiohook;
	}

	if (isUiohookLike(defaultExport)) {
		return defaultExport;
	}

	if (defaultExport?.uIOhook) {
		return defaultExport.uIOhook;
	}

	if (defaultExport?.uiohook) {
		return defaultExport.uiohook;
	}

	if (defaultExport?.Uiohook) {
		return defaultExport.Uiohook;
	}

	return null;
}

function shouldRepairBundledUiohookBinary(error: unknown): error is NodeJS.ErrnoException {
	if (process.platform !== "darwin") {
		return false;
	}

	if (process.arch !== "arm64") {
		return false;
	}

	const candidate = error as NodeJS.ErrnoException | null;
	return (
		candidate?.code === "ERR_DLOPEN_FAILED" &&
		typeof candidate.message === "string" &&
		candidate.message.includes("incompatible architecture")
	);
}

export function repairBundledUiohookBinaryForCurrentArch(
	error: unknown,
	options?: {
		packageRoot?: string;
		platform?: NodeJS.Platform;
		arch?: string;
		log?: (message: string) => void;
	},
) {
	const platform = options?.platform ?? process.platform;
	const arch = options?.arch ?? process.arch;

	if (platform !== "darwin" || arch !== "arm64") {
		return false;
	}

	const candidate = error as NodeJS.ErrnoException | null;
	if (
		candidate?.code !== "ERR_DLOPEN_FAILED" ||
		typeof candidate.message !== "string" ||
		!candidate.message.includes("incompatible architecture")
	) {
		return false;
	}

	const packageRoot =
		options?.packageRoot ?? path.dirname(nodeRequire.resolve("uiohook-napi/package.json"));
	const prebuildPath = path.join(packageRoot, "prebuilds", `darwin-${arch}`, "node.napi.node");
	const buildPath = path.join(packageRoot, "build", "Release", "uiohook_napi.node");

	if (!fs.existsSync(prebuildPath)) {
		return false;
	}

	try {
		fs.mkdirSync(path.dirname(buildPath), { recursive: true });
		fs.copyFileSync(prebuildPath, buildPath);
		(options?.log ?? console.warn)(
			"[CursorTelemetry] Repaired stale uiohook-napi binary using bundled darwin-arm64 prebuild.",
		);
		return true;
	} catch {
		return false;
	}
}

function loadUiohookModule() {
	try {
		const moduleExports = nodeRequire("uiohook-napi") as UiohookModuleNamespace;
		return resolveUiohookModule(moduleExports);
	} catch (error) {
		if (!shouldRepairBundledUiohookBinary(error)) {
			throw error;
		}

		if (!repairBundledUiohookBinaryForCurrentArch(error)) {
			throw error;
		}

		delete nodeRequire.cache[nodeRequire.resolve("uiohook-napi")];
		const moduleExports = nodeRequire("uiohook-napi") as UiohookModuleNamespace;
		return resolveUiohookModule(moduleExports);
	}
}

export function shouldStartGlobalInteractionHook(platform: NodeJS.Platform = process.platform) {
	// On macOS, uiohook can block forever while its native event tap starts
	// (notably when Accessibility permission is unavailable or stale). Because
	// start() executes synchronously, that freezes Electron's main thread and
	// makes every window, including the recording HUD, unresponsive. Cursor
	// position and visual-state telemetry still come from the existing native
	// macOS monitor and Electron sampler.
	return platform !== "darwin";
}

const KEY_TOKEN_ALIASES: Record<string, string> = {
	return: "enter",
	enter: "enter",
	escape: "esc",
	arrow_left: "arrowleft",
	left: "arrowleft",
	arrow_right: "arrowright",
	right: "arrowright",
	arrow_up: "arrowup",
	up: "arrowup",
	arrow_down: "arrowdown",
	down: "arrowdown",
	page_up: "pageup",
	page_down: "pagedown",
	ctrlright: "ctrl",
	altright: "alt",
	altgr: "alt",
	shiftright: "shift",
	metaright: "meta",
};

export function resolveUiohookKeyToken(
	keycode: number,
	keyTable: Record<string, number>,
): string | null {
	if (!Number.isFinite(keycode)) {
		return null;
	}

	let name: string | null = null;
	for (const [key, code] of Object.entries(keyTable)) {
		if (code === keycode) {
			name = key;
			break;
		}
	}
	if (!name) {
		return null;
	}

	const token = name.toLowerCase();
	return KEY_TOKEN_ALIASES[token] ?? token;
}

function loadUiohookKeyTable(moduleExports: UiohookModuleNamespace): Record<string, number> {
	const table = moduleExports.UiohookKey;
	if (!table || typeof table !== "object") {
		return {};
	}
	return table;
}

function modifiersFromHookEvent(event: HookKeyboardEvent): KeystrokeModifier[] {
	const modifiers: KeystrokeModifier[] = [];
	if (event.metaKey) {
		modifiers.push("meta");
	}
	if (event.ctrlKey) {
		modifiers.push("ctrl");
	}
	if (event.altKey) {
		modifiers.push("alt");
	}
	if (event.shiftKey) {
		modifiers.push("shift");
	}
	return modifiers;
}

export function recordCursorMouseDown(button: 1 | 2 | 3) {
	if (!isCursorCaptureActive || isCursorCapturePaused()) {
		return;
	}

	const point = getNormalizedCursorPoint();
	if (!point) {
		return;
	}

	const timeMs = getCursorCaptureElapsedMs();
	let interactionType: CursorInteractionType = "click";

	if (button === 2) {
		interactionType = "right-click";
	} else if (button === 3) {
		interactionType = "middle-click";
	} else {
		const thresholdMs = 350;
		const distance = lastLeftClick
			? Math.hypot(point.cx - lastLeftClick.cx, point.cy - lastLeftClick.cy)
			: Number.POSITIVE_INFINITY;

		if (lastLeftClick && timeMs - lastLeftClick.timeMs <= thresholdMs && distance <= 0.04) {
			interactionType = "double-click";
		}

		setLastLeftClick({ timeMs, cx: point.cx, cy: point.cy });
	}

	pushCursorSample(point.cx, point.cy, timeMs, interactionType);
}

export function recordCursorMouseUp() {
	if (!isCursorCaptureActive || isCursorCapturePaused()) {
		return;
	}

	const point = getNormalizedCursorPoint();
	if (!point) {
		return;
	}

	pushCursorSample(point.cx, point.cy, getCursorCaptureElapsedMs(), "mouseup");
}

export async function startInteractionCapture() {
	if (!isCursorCaptureActive) {
		return;
	}

	if (!["darwin", "win32", "linux"].includes(process.platform)) {
		return;
	}

	if (!shouldStartGlobalInteractionHook()) {
		console.warn("[CursorTelemetry] Skipping the blocking global interaction hook on macOS.");
		return;
	}

	stopInteractionCapture();

	try {
		const hook = loadUiohookModule();
		console.log(
			"[CursorTelemetry] hook loaded:",
			!!hook,
			"has.on:",
			typeof hook?.on,
			"has.start:",
			typeof hook?.start,
		);
		if (!isCursorCaptureActive) {
			return;
		}

		if (!hook || typeof hook.on !== "function" || typeof hook.start !== "function") {
			console.log("[CursorTelemetry] hook unusable — aborting interaction capture");
			return;
		}

		const onMouseDown = (event: HookMouseEvent) => {
			recordCursorMouseDown(getHookMouseButton(event));
		};

		const onMouseUp = () => {
			recordCursorMouseUp();
		};

		const onMouseMove = (event: HookMouseEvent) => {
			if (process.platform !== "linux" || !isCursorCaptureActive || isCursorCapturePaused()) {
				return;
			}

			const point = getHookCursorScreenPoint(event);
			if (!point) {
				return;
			}

			setLinuxCursorScreenPoint({ x: point.x, y: point.y, updatedAt: Date.now() });
		};

		const keyTable = isKeystrokeCaptureActive
			? loadUiohookKeyTable(nodeRequire("uiohook-napi") as UiohookModuleNamespace)
			: {};
		const captureKeys = isKeystrokeCaptureActive;
		const onKeyDown = (event: HookKeyboardEvent) => {
			if (typeof event.keycode !== "number") {
				return;
			}
			const token = resolveUiohookKeyToken(event.keycode, keyTable);
			if (!token) {
				return;
			}
			recordKeystroke(token, modifiersFromHookEvent(event));
		};

		hook.on("mousedown", onMouseDown);
		hook.on("mouseup", onMouseUp);
		if (process.platform === "linux") {
			hook.on("mousemove", onMouseMove);
		}
		if (captureKeys) {
			hook.on("keydown", onKeyDown);
		}

		setInteractionCaptureCleanup(() => {
			try {
				if (typeof hook.off === "function") {
					hook.off("mousedown", onMouseDown);
					hook.off("mouseup", onMouseUp);
					if (process.platform === "linux") {
						hook.off("mousemove", onMouseMove);
					}
					if (captureKeys) {
						hook.off("keydown", onKeyDown);
					}
				} else if (typeof hook.removeListener === "function") {
					hook.removeListener("mousedown", onMouseDown);
					hook.removeListener("mouseup", onMouseUp);
					if (process.platform === "linux") {
						hook.removeListener("mousemove", onMouseMove);
					}
					if (captureKeys) {
						hook.removeListener("keydown", onKeyDown);
					}
				}
			} catch {
				// ignore listener cleanup errors
			}

			try {
				if (typeof hook.stop === "function") {
					hook.stop();
				}
			} catch {
				// ignore hook shutdown errors
			}
		});

		hook.start();
	} catch (error) {
		if (!hasLoggedInteractionHookFailure) {
			setHasLoggedInteractionHookFailure(true);
			console.warn("[CursorTelemetry] Global interaction capture unavailable:", error);
		}
	}
}
