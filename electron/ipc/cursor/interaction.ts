import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { HookKeyboardEvent, HookMouseEvent, UiohookLike, UiohookModuleNamespace, CursorInteractionType } from "../types";
import {
	isCursorCaptureActive,
	interactionCaptureCleanup,
	setInteractionCaptureCleanup,
	hasLoggedInteractionHookFailure,
	setHasLoggedInteractionHookFailure,
	lastLeftClick,
	setLastLeftClick,
	setLinuxCursorScreenPoint,
} from "../state";
import {
	getNormalizedCursorPoint,
	getCursorCaptureElapsedMs,
	getHookCursorScreenPoint,
	isCursorCapturePaused,
	pushCursorSample,
	pushKeystroke,
} from "./telemetry";

// Maps uiohook-napi keycodes to Web KeyboardEvent.key values for common keys.
// Full keycode table: https://github.com/kwhat/uiohook/blob/master/include/uiohook.h
const KEYCODE_MAP: Record<number, string> = {
	1: "Escape", 2: "1", 3: "2", 4: "3", 5: "4", 6: "5", 7: "6", 8: "7", 9: "8", 10: "9",
	11: "0", 12: "-", 13: "=", 14: "Backspace", 15: "Tab",
	16: "q", 17: "w", 18: "e", 19: "r", 20: "t", 21: "y", 22: "u", 23: "i", 24: "o", 25: "p",
	26: "[", 27: "]", 28: "Enter",
	30: "a", 31: "s", 32: "d", 33: "f", 34: "g", 35: "h", 36: "j", 37: "k", 38: "l",
	39: ";", 40: "'", 41: "`", 43: "\\",
	44: "z", 45: "x", 46: "c", 47: "v", 48: "b", 49: "n", 50: "m",
	51: ",", 52: ".", 53: "/", 57: " ",
	58: "CapsLock",
	59: "F1", 60: "F2", 61: "F3", 62: "F4", 63: "F5", 64: "F6",
	65: "F7", 66: "F8", 67: "F9", 68: "F10", 87: "F11", 88: "F12",
	71: "7", 72: "8", 73: "9", 75: "4", 76: "5", 77: "6", 79: "1", 80: "2", 81: "3", 82: "0",
	3639: "Meta", 3640: "Shift", 3641: "Control", 3642: "Alt",
	3675: "Meta", 3676: "Meta",
	57416: "ArrowUp", 57419: "ArrowLeft", 57421: "ArrowRight", 57424: "ArrowDown",
	57426: "Insert", 57427: "Delete", 57418: "PageUp", 57422: "PageDown",
	57423: "End", 57415: "Home",
};

const MODIFIER_KEYCODES = new Set([3640, 3641, 3642, 3643, 3675, 3676, 3639]);

function keycodeToKey(keycode: number | undefined): string | null {
	if (keycode === undefined) return null;
	return KEYCODE_MAP[keycode] ?? null;
}

// Track active modifiers during recording
const _activeModifiers = new Set<string>();

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

export async function startInteractionCapture() {
	if (!isCursorCaptureActive) {
		return;
	}

	if (!["darwin", "win32", "linux"].includes(process.platform)) {
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
			if (!isCursorCaptureActive || isCursorCapturePaused()) {
				return;
			}

			const point = getNormalizedCursorPoint();
			if (!point) {
				return;
			}

			const timeMs = getCursorCaptureElapsedMs();
			const button = getHookMouseButton(event);
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

				if (
					lastLeftClick &&
					timeMs - lastLeftClick.timeMs <= thresholdMs &&
					distance <= 0.04
				) {
					interactionType = "double-click";
				}

				setLastLeftClick({ timeMs, cx: point.cx, cy: point.cy });
			}

			pushCursorSample(point.cx, point.cy, timeMs, interactionType);
		};

		const onMouseUp = () => {
			if (!isCursorCaptureActive || isCursorCapturePaused()) {
				return;
			}

			const point = getNormalizedCursorPoint();
			if (!point) {
				return;
			}

			const timeMs = getCursorCaptureElapsedMs();
			pushCursorSample(point.cx, point.cy, timeMs, "mouseup");
		};

		const onMouseMove = (event: HookMouseEvent) => {
			if (
				process.platform !== "linux" ||
				!isCursorCaptureActive ||
				isCursorCapturePaused()
			) {
				return;
			}

			const point = getHookCursorScreenPoint(event);
			if (!point) {
				return;
			}

			setLinuxCursorScreenPoint({ x: point.x, y: point.y, updatedAt: Date.now() });
		};

		const onKeyDown = (event: HookKeyboardEvent) => {
			if (!isCursorCaptureActive || isCursorCapturePaused()) return;
			const key = keycodeToKey(event.keycode);
			if (!key) return;
			if (MODIFIER_KEYCODES.has(event.keycode ?? -1)) {
				_activeModifiers.add(key);
				return; // don't emit bare modifier events
			}
			const timeMs = getCursorCaptureElapsedMs();
			pushKeystroke({ timeMs, key, modifiers: Array.from(_activeModifiers) });
		};

		const onKeyUp = (event: HookKeyboardEvent) => {
			const key = keycodeToKey(event.keycode);
			if (key) _activeModifiers.delete(key);
		};

		hook.on("mousedown", onMouseDown);
		hook.on("mouseup", onMouseUp);
		hook.on("keydown", onKeyDown);
		hook.on("keyup", onKeyUp);
		if (process.platform === "linux") {
			hook.on("mousemove", onMouseMove);
		}

		setInteractionCaptureCleanup(() => {
			_activeModifiers.clear();
			try {
				if (typeof hook.off === "function") {
					hook.off("mousedown", onMouseDown);
					hook.off("mouseup", onMouseUp);
					hook.off("keydown", onKeyDown);
					hook.off("keyup", onKeyUp);
					if (process.platform === "linux") {
						hook.off("mousemove", onMouseMove);
					}
				} else if (typeof hook.removeListener === "function") {
					hook.removeListener("mousedown", onMouseDown);
					hook.removeListener("mouseup", onMouseUp);
					hook.removeListener("keydown", onKeyDown);
					hook.removeListener("keyup", onKeyUp);
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
