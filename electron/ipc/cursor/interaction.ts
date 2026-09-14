import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { ShortcutBinding } from "../../../src/lib/shortcuts";
import {
	hasLoggedInteractionHookFailure,
	interactionCaptureCleanup,
	isCursorCaptureActive,
	lastLeftClick,
	setHasLoggedInteractionHookFailure,
	setInteractionCaptureCleanup,
	setLastLeftClick,
	setLinuxCursorScreenPoint,
} from "../state";
import type {
	CursorInteractionType,
	HookKeyboardEvent,
	HookKeyboardEventListener,
	HookMouseEvent,
	UiohookLike,
	UiohookModuleNamespace,
} from "../types";
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

const UIOHOOK_KEY_TO_EVENT_KEY = new Map<number, string>([
	[0x0001, "escape"],
	[0x000e, "backspace"],
	[0x000f, "tab"],
	[0x001c, "enter"],
	[0x0039, " "],
	[0x0e49, "pageup"],
	[0x0e51, "pagedown"],
	[0x0e4f, "end"],
	[0x0e47, "home"],
	[0xe04b, "arrowleft"],
	[0xe048, "arrowup"],
	[0xe04d, "arrowright"],
	[0xe050, "arrowdown"],
	[0x0e52, "insert"],
	[0x0e53, "delete"],
	[0x000b, "0"],
	[0x0002, "1"],
	[0x0003, "2"],
	[0x0004, "3"],
	[0x0005, "4"],
	[0x0006, "5"],
	[0x0007, "6"],
	[0x0008, "7"],
	[0x0009, "8"],
	[0x000a, "9"],
	[0x001e, "a"],
	[0x0030, "b"],
	[0x002e, "c"],
	[0x0020, "d"],
	[0x0012, "e"],
	[0x0021, "f"],
	[0x0022, "g"],
	[0x0023, "h"],
	[0x0017, "i"],
	[0x0024, "j"],
	[0x0025, "k"],
	[0x0026, "l"],
	[0x0032, "m"],
	[0x0031, "n"],
	[0x0018, "o"],
	[0x0019, "p"],
	[0x0010, "q"],
	[0x0013, "r"],
	[0x001f, "s"],
	[0x0014, "t"],
	[0x0016, "u"],
	[0x002f, "v"],
	[0x0011, "w"],
	[0x002d, "x"],
	[0x0015, "y"],
	[0x002c, "z"],
	[0x003b, "f1"],
	[0x003c, "f2"],
	[0x003d, "f3"],
	[0x003e, "f4"],
	[0x003f, "f5"],
	[0x0040, "f6"],
	[0x0041, "f7"],
	[0x0042, "f8"],
	[0x0043, "f9"],
	[0x0044, "f10"],
	[0x0057, "f11"],
	[0x0058, "f12"],
]);

export function getHookKeyboardKey(event: HookKeyboardEvent | null | undefined): string | null {
	if (typeof event?.keycode !== "number") return null;
	return UIOHOOK_KEY_TO_EVENT_KEY.get(event.keycode) ?? null;
}

export function matchesHookKeyboardShortcut(
	event: HookKeyboardEvent,
	binding: ShortcutBinding,
	isMacPlatform: boolean,
): boolean {
	const key = getHookKeyboardKey(event);
	if (!key || key !== binding.key.toLowerCase()) return false;

	const primaryMod = isMacPlatform ? event.metaKey : event.ctrlKey;
	if (!!primaryMod !== !!binding.ctrl) return false;
	if (!!event.shiftKey !== !!binding.shift) return false;
	if (!!event.altKey !== !!binding.alt) return false;

	return true;
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

export async function startInteractionCapture(
	options: { onKeyDown?: HookKeyboardEventListener; onKeyUp?: HookKeyboardEventListener } = {},
) {
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

		const onKeyDown = (event: HookKeyboardEvent) => {
			options.onKeyDown?.(event);
		};

		const onKeyUp = (event: HookKeyboardEvent) => {
			options.onKeyUp?.(event);
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

		hook.on("mousedown", onMouseDown);
		hook.on("mouseup", onMouseUp);
		if (options.onKeyDown) {
			hook.on("keydown", onKeyDown);
		}
		if (options.onKeyUp) {
			hook.on("keyup", onKeyUp);
		}
		if (process.platform === "linux") {
			hook.on("mousemove", onMouseMove);
		}

		setInteractionCaptureCleanup(() => {
			try {
				if (typeof hook.off === "function") {
					hook.off("mousedown", onMouseDown);
					hook.off("mouseup", onMouseUp);
					if (options.onKeyDown) {
						hook.off("keydown", onKeyDown);
					}
					if (options.onKeyUp) {
						hook.off("keyup", onKeyUp);
					}
					if (process.platform === "linux") {
						hook.off("mousemove", onMouseMove);
					}
				} else if (typeof hook.removeListener === "function") {
					hook.removeListener("mousedown", onMouseDown);
					hook.removeListener("mouseup", onMouseUp);
					if (options.onKeyDown) {
						hook.removeListener("keydown", onKeyDown);
					}
					if (options.onKeyUp) {
						hook.removeListener("keyup", onKeyUp);
					}
					if (process.platform === "linux") {
						hook.removeListener("mousemove", onMouseMove);
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
