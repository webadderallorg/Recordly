import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ensureNativeWindowListBinary } from "../paths/binaries";
import {
	cachedNativeMacWindowSources,
	cachedNativeMacWindowSourcesAtMs,
	interactionCaptureCleanup,
	selectedSource,
	setCachedNativeMacWindowSources,
	setCachedNativeMacWindowSourcesAtMs,
	setInteractionCaptureCleanup,
	setSelectedWindowBounds,
	setSelectedWindowBoundsPending,
	setWindowBoundsCaptureInterval,
	windowBoundsCaptureInterval,
} from "../state";
import type { NativeMacWindowSource, SelectedSource, WindowBounds } from "../types";
import { parseWindowId } from "../utils";
import { resolveWindowsWindowBounds } from "../windowsWindowControl";

const execFileAsync = promisify(execFile);

export async function getNativeMacWindowSources(options?: {
	maxAgeMs?: number;
	allSpaces?: boolean;
}) {
	if (process.platform !== "darwin") {
		return [] as NativeMacWindowSource[];
	}

	const allSpaces = options?.allSpaces === true;
	const maxAgeMs = options?.maxAgeMs ?? 5000;
	const now = Date.now();
	if (
		!allSpaces &&
		cachedNativeMacWindowSources &&
		now - cachedNativeMacWindowSourcesAtMs < maxAgeMs
	) {
		return cachedNativeMacWindowSources;
	}

	try {
		const binaryPath = await ensureNativeWindowListBinary();
		const { stdout } = await execFileAsync(binaryPath, allSpaces ? ["--all-spaces"] : [], {
			timeout: 30000,
			maxBuffer: 10 * 1024 * 1024,
		});

		const parsed = JSON.parse(stdout);
		if (!Array.isArray(parsed)) {
			return [] as NativeMacWindowSource[];
		}

		const entries = parsed.filter((entry: unknown): entry is NativeMacWindowSource => {
			if (!entry || typeof entry !== "object") {
				return false;
			}

			const candidate = entry as Partial<NativeMacWindowSource>;
			return typeof candidate.id === "string" && typeof candidate.name === "string";
		});

		if (!allSpaces) {
			setCachedNativeMacWindowSources(entries);
			setCachedNativeMacWindowSourcesAtMs(now);
		}
		return entries;
	} catch {
		return allSpaces ? [] : (cachedNativeMacWindowSources ?? ([] as NativeMacWindowSource[]));
	}
}

export function getWindowBoundsFromNativeSource(
	source?: NativeMacWindowSource | null,
): WindowBounds | null {
	if (!source) {
		return null;
	}

	const { x, y, width, height } = source;
	if (
		typeof x !== "number" ||
		!Number.isFinite(x) ||
		typeof y !== "number" ||
		!Number.isFinite(y) ||
		typeof width !== "number" ||
		!Number.isFinite(width) ||
		typeof height !== "number" ||
		!Number.isFinite(height)
	) {
		return null;
	}

	if (width <= 0 || height <= 0) {
		return null;
	}

	return { x, y, width, height };
}

export async function findNativeMacWindow(
	sourceId: string | undefined,
	options?: { maxAgeMs?: number; allSpaces?: boolean },
) {
	const windowId = parseWindowId(sourceId);
	if (!windowId) {
		return null;
	}

	const nativeSources = await getNativeMacWindowSources(options);
	return nativeSources.find((entry) => parseWindowId(entry.id) === windowId) ?? null;
}

export async function isMacWindowOnScreen(sourceId: string) {
	if (process.platform !== "darwin") {
		return true;
	}

	const windowId = parseWindowId(sourceId);
	const nativeSources = await getNativeMacWindowSources({ maxAgeMs: 0, allSpaces: true });
	const entry = nativeSources.find((candidate) => parseWindowId(candidate.id) === windowId);
	return nativeSources.length === 0 || (entry !== undefined && entry.onScreen !== false);
}

export async function resolveMacWindowBounds(source: SelectedSource): Promise<WindowBounds | null> {
	try {
		return getWindowBoundsFromNativeSource(
			await findNativeMacWindow(source.id, { maxAgeMs: 250 }),
		);
	} catch {
		return null;
	}
}

export function parseXwininfoBounds(stdout: string): WindowBounds | null {
	const absX = stdout.match(/Absolute upper-left X:\s+(-?\d+)/);
	const absY = stdout.match(/Absolute upper-left Y:\s+(-?\d+)/);
	const width = stdout.match(/Width:\s+(\d+)/);
	const height = stdout.match(/Height:\s+(\d+)/);

	if (!absX || !absY || !width || !height) {
		return null;
	}

	return {
		x: Number.parseInt(absX[1], 10),
		y: Number.parseInt(absY[1], 10),
		width: Number.parseInt(width[1], 10),
		height: Number.parseInt(height[1], 10),
	};
}

export async function resolveLinuxWindowBounds(
	source: SelectedSource,
): Promise<WindowBounds | null> {
	const windowId = parseWindowId(source?.id);

	if (windowId) {
		try {
			const { stdout } = await execFileAsync("xwininfo", ["-id", String(windowId)], {
				timeout: 1500,
			});
			const bounds = parseXwininfoBounds(stdout);
			if (bounds && bounds.width > 0 && bounds.height > 0) {
				return bounds;
			}
		} catch {
			// fall back to title lookup below
		}
	}

	const windowTitle =
		typeof source.windowTitle === "string" ? source.windowTitle.trim() : source.name.trim();
	if (!windowTitle) {
		return null;
	}

	try {
		const { stdout } = await execFileAsync("xwininfo", ["-name", windowTitle], {
			timeout: 1500,
		});
		const bounds = parseXwininfoBounds(stdout);
		return bounds && bounds.width > 0 && bounds.height > 0 ? bounds : null;
	} catch {
		return null;
	}
}

export function stopInteractionCapture() {
	if (interactionCaptureCleanup) {
		interactionCaptureCleanup();
		setInteractionCaptureCleanup(null);
	}
}

export function stopWindowBoundsCapture() {
	if (windowBoundsCaptureInterval) {
		clearInterval(windowBoundsCaptureInterval);
		setWindowBoundsCaptureInterval(null);
	}
	setSelectedWindowBounds(null);
	setSelectedWindowBoundsPending(false);
}

async function refreshSelectedWindowBounds() {
	if (!selectedSource?.id?.startsWith("window:")) {
		setSelectedWindowBounds(null);
		setSelectedWindowBoundsPending(false);
		return;
	}

	let bounds: WindowBounds | null = null;

	try {
		if (process.platform === "darwin") {
			bounds = await resolveMacWindowBounds(selectedSource);
		} else if (process.platform === "win32") {
			bounds = await resolveWindowsWindowBounds(selectedSource);
		} else if (process.platform === "linux") {
			bounds = await resolveLinuxWindowBounds(selectedSource);
		}
	} finally {
		setSelectedWindowBoundsPending(false);
	}

	setSelectedWindowBounds(bounds);
}

export function startWindowBoundsCapture() {
	stopWindowBoundsCapture();

	if (
		!["darwin", "win32", "linux"].includes(process.platform) ||
		!selectedSource?.id?.startsWith("window:")
	) {
		return;
	}

	setSelectedWindowBoundsPending(process.platform === "darwin");
	void refreshSelectedWindowBounds();
	setWindowBoundsCaptureInterval(
		setInterval(() => {
			void refreshSelectedWindowBounds();
		}, 250),
	);
}
