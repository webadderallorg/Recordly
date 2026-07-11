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
	UiohookLike,
	UiohookModuleNamespace,
} from "../types";
import {
	getCursorCaptureElapsedMs,
	getHookCursorScreenPoint,
	getNormalizedCursorPoint,
	isCursorCapturePaused,
	pushCursorSample,
	pushKeystrokeSample,
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

/**
 * Build a keycode → semantic-token map from uiohook-napi's UiohookKey table so
 * the renderer never has to know raw platform keycodes. Tolerant of the table
 * being absent — callers fall back to the numeric keycode string.
 */
function buildKeycodeTokenMap(): Map<number, string> {
	const map = new Map<number, string>();
	try {
		const moduleExports = nodeRequire("uiohook-napi") as {
			UiohookKey?: Record<string, number>;
		};
		const table = moduleExports?.UiohookKey;
		if (table) {
			for (const [name, code] of Object.entries(table)) {
				if (typeof code === "number" && !map.has(code)) {
					map.set(code, name);
				}
			}
		}
	} catch {
		// Table unavailable — renderer falls back to the numeric keycode string.
	}
	return map;
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
			if (process.platform !== "linux" || !isCursorCaptureActive || isCursorCapturePaused()) {
				return;
			}

			const point = getHookCursorScreenPoint(event);
			if (!point) {
				return;
			}

			setLinuxCursorScreenPoint({ x: point.x, y: point.y, updatedAt: Date.now() });
		};

		const keycodeTokens = buildKeycodeTokenMap();
		let lastKeystrokeCode = -1;
		let lastKeystrokeTimeMs = Number.NEGATIVE_INFINITY;

		const onKeyDown = (event: HookKeyboardEvent) => {
			// Privacy gate: only record keystrokes when the overlay is enabled.
			if (!isCursorCaptureActive || !isKeystrokeCaptureActive || isCursorCapturePaused()) {
				return;
			}

			const keycode = typeof event.keycode === "number" ? event.keycode : event.data?.keycode;
			if (typeof keycode !== "number") {
				return;
			}

			const timeMs = getCursorCaptureElapsedMs();

			// Collapse auto-repeat: ignore the same physical key re-firing rapidly.
			// Bump the timestamp on collapsed repeats too, so a held key stays
			// suppressed for its whole duration instead of leaking every other repeat.
			if (keycode === lastKeystrokeCode && timeMs - lastKeystrokeTimeMs < 45) {
				lastKeystrokeTimeMs = timeMs;
				return;
			}
			lastKeystrokeCode = keycode;
			lastKeystrokeTimeMs = timeMs;

			pushKeystrokeSample({
				timeMs,
				key: keycodeTokens.get(keycode) ?? String(keycode),
				ctrl: Boolean(event.ctrlKey ?? event.data?.ctrlKey),
				alt: Boolean(event.altKey ?? event.data?.altKey),
				shift: Boolean(event.shiftKey ?? event.data?.shiftKey),
				meta: Boolean(event.metaKey ?? event.data?.metaKey),
			});
		};

		hook.on("mousedown", onMouseDown);
		hook.on("mouseup", onMouseUp);
		hook.on("keydown", onKeyDown);
		if (process.platform === "linux") {
			hook.on("mousemove", onMouseMove);
		}

		setInteractionCaptureCleanup(() => {
			try {
				if (typeof hook.off === "function") {
					hook.off("mousedown", onMouseDown);
					hook.off("mouseup", onMouseUp);
					hook.off("keydown", onKeyDown);
					if (process.platform === "linux") {
						hook.off("mousemove", onMouseMove);
					}
				} else if (typeof hook.removeListener === "function") {
					hook.removeListener("mousedown", onMouseDown);
					hook.removeListener("mouseup", onMouseUp);
					hook.removeListener("keydown", onKeyDown);
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
