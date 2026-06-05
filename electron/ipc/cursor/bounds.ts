import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { NativeMacWindowSource, WindowBounds, SelectedSource } from "../types";
import {
	selectedSource,
	selectedWindowBounds,
	selectedWindowsWgcCaptureSize,
	setSelectedWindowBounds,
	setSelectedWindowsWgcCaptureSize,
	interactionCaptureCleanup,
	setInteractionCaptureCleanup,
	windowBoundsCaptureInterval,
	setWindowBoundsCaptureInterval,
	cachedNativeMacWindowSources,
	setCachedNativeMacWindowSources,
	cachedNativeMacWindowSourcesAtMs,
	setCachedNativeMacWindowSourcesAtMs,
} from "../state";
import { getScreen, parseWindowId } from "../utils";
import { ensureNativeWindowListBinary } from "../paths/binaries";

const execFileAsync = promisify(execFile);
const WINDOWS_WINDOW_BOUNDS_TIMEOUT_MS = 8000;

function resolveWindowsWindowBoundsScriptPath(): string {
	const candidates = [
		process.env.APP_ROOT
			? path.join(process.env.APP_ROOT, "electron", "ipc", "cursor", "get-window-bounds.ps1")
			: null,
		process.env.APP_ROOT
			? path.join(process.env.APP_ROOT, "dist-electron", "get-window-bounds.ps1")
			: null,
		path.join(path.dirname(fileURLToPath(import.meta.url)), "get-window-bounds.ps1"),
	].filter((candidate): candidate is string => Boolean(candidate));

	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			return candidate;
		}
	}

	return candidates[candidates.length - 1] ?? "get-window-bounds.ps1";
}

export async function getNativeMacWindowSources(options?: { maxAgeMs?: number }) {
	if (process.platform !== "darwin") {
		return [] as NativeMacWindowSource[];
	}

	const maxAgeMs = options?.maxAgeMs ?? 5000;
	const now = Date.now();
	if (cachedNativeMacWindowSources && now - cachedNativeMacWindowSourcesAtMs < maxAgeMs) {
		return cachedNativeMacWindowSources;
	}

	try {
		const binaryPath = await ensureNativeWindowListBinary();
		const { stdout } = await execFileAsync(binaryPath, [], {
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

		setCachedNativeMacWindowSources(entries);
		setCachedNativeMacWindowSourcesAtMs(now);
		return entries;
	} catch {
		return cachedNativeMacWindowSources ?? ([] as NativeMacWindowSource[]);
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

export async function resolveMacWindowBounds(source: SelectedSource): Promise<WindowBounds | null> {
	const windowId = parseWindowId(source.id);
	if (!windowId) {
		return null;
	}

	try {
		const nativeSources = await getNativeMacWindowSources({ maxAgeMs: 250 });
		const matchedSource = nativeSources.find((entry) => parseWindowId(entry.id) === windowId);
		return getWindowBoundsFromNativeSource(matchedSource);
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

export async function resolveLinuxWindowBounds(source: SelectedSource): Promise<WindowBounds | null> {
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

export type WindowsWindowBounds = WindowBounds & {
	dpi?: number;
};

export function parseWgcCaptureSize(
	output: string,
): { width: number; height: number } | null {
	const match = output.match(/CAPTURE_SIZE:(\d+)x(\d+)/);
	if (!match) {
		return null;
	}

	const width = Number.parseInt(match[1], 10);
	const height = Number.parseInt(match[2], 10);
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
		return null;
	}

	return { width, height };
}

export function normalizeWindowsWindowBoundsToElectronDip(
	bounds: WindowsWindowBounds,
): WindowBounds {
	const centerX = bounds.x + bounds.width / 2;
	const centerY = bounds.y + bounds.height / 2;
	const display = getScreen().getDisplayNearestPoint({ x: centerX, y: centerY });
	const electronSf = display.scaleFactor || 1;
	const boundsSf = (bounds.dpi ?? 96) / 96;

	if (Math.abs(electronSf - boundsSf) < 0.01) {
		return {
			x: bounds.x,
			y: bounds.y,
			width: bounds.width,
			height: bounds.height,
		};
	}

	const physicalX = bounds.x * boundsSf;
	const physicalY = bounds.y * boundsSf;
	const physicalWidth = bounds.width * boundsSf;
	const physicalHeight = bounds.height * boundsSf;

	return {
		x: physicalX / electronSf,
		y: physicalY / electronSf,
		width: Math.max(1, physicalWidth / electronSf),
		height: Math.max(1, physicalHeight / electronSf),
	};
}

export function alignWindowBoundsToWgcCaptureSize(
	bounds: Pick<WindowBounds, "x" | "y">,
	captureSize: { width: number; height: number },
	scaleFactor: number,
): WindowBounds {
	const scale = scaleFactor > 0 ? scaleFactor : 1;

	return {
		x: bounds.x,
		y: bounds.y,
		width: Math.max(1, captureSize.width / scale),
		height: Math.max(1, captureSize.height / scale),
	};
}

export function resolveWindowsWindowTelemetryBounds(
	windowsBounds: WindowsWindowBounds,
	captureSize: { width: number; height: number } | null = null,
): WindowBounds {
	const dipBounds = normalizeWindowsWindowBoundsToElectronDip(windowsBounds);
	if (!captureSize) {
		return dipBounds;
	}

	const display = getScreen().getDisplayNearestPoint({
		x: dipBounds.x + dipBounds.width / 2,
		y: dipBounds.y + dipBounds.height / 2,
	});

	return alignWindowBoundsToWgcCaptureSize(
		dipBounds,
		captureSize,
		display.scaleFactor || 1,
	);
}

export async function applyWindowsWindowTelemetryBounds(
	source: SelectedSource,
	captureSize: { width: number; height: number } | null = selectedWindowsWgcCaptureSize,
): Promise<WindowBounds | null> {
	const windowsBounds = await resolveWindowsWindowBounds(source);
	if (!windowsBounds) {
		return null;
	}

	const telemetryBounds = resolveWindowsWindowTelemetryBounds(windowsBounds, captureSize);
	setSelectedWindowBounds(telemetryBounds);
	return telemetryBounds;
}

export async function ensureSelectedWindowBoundsReady(): Promise<boolean> {
	if (!selectedSource?.id?.startsWith("window:")) {
		return true;
	}

	if (selectedWindowBounds) {
		return true;
	}

	for (let attempt = 0; attempt < 6; attempt += 1) {
		await refreshSelectedWindowBounds();
		if (selectedWindowBounds) {
			return true;
		}

		if (process.platform === "win32") {
			const resolved = await applyWindowsWindowTelemetryBounds(selectedSource);
			if (resolved) {
				return true;
			}
		}

		if (attempt < 5) {
			await new Promise((resolve) => setTimeout(resolve, 200));
		}
	}

	return selectedWindowBounds !== null;
}

export async function resolveWindowsWindowBounds(
	source: SelectedSource,
): Promise<WindowsWindowBounds | null> {
	const windowId = parseWindowId(source?.id);
	const windowTitle =
		typeof source.windowTitle === "string" ? source.windowTitle.trim() : source.name.trim();

	if (!windowId && !windowTitle) {
		return null;
	}

	try {
		const { stdout } = await execFileAsync(
			"powershell.exe",
			[
				"-NoProfile",
				"-ExecutionPolicy",
				"Bypass",
				"-File",
				resolveWindowsWindowBoundsScriptPath(),
				String(windowId ?? ""),
				windowTitle,
			],
			{ timeout: WINDOWS_WINDOW_BOUNDS_TIMEOUT_MS },
		);

		const trimmedStdout = stdout.trim();
		if (!trimmedStdout) {
			return null;
		}

		const bounds = JSON.parse(trimmedStdout) as WindowsWindowBounds;
		if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
			return null;
		}

		return bounds;
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
	setSelectedWindowsWgcCaptureSize(null);
}

async function refreshSelectedWindowBounds() {
	if (!selectedSource?.id?.startsWith("window:")) {
		setSelectedWindowBounds(null);
		return;
	}

	let bounds: WindowBounds | null = null;

	if (process.platform === "darwin") {
		bounds = await resolveMacWindowBounds(selectedSource);
	} else if (process.platform === "win32") {
		const windowsBounds = await resolveWindowsWindowBounds(selectedSource);
		bounds = windowsBounds
			? resolveWindowsWindowTelemetryBounds(windowsBounds, selectedWindowsWgcCaptureSize)
			: null;
	} else if (process.platform === "linux") {
		bounds = await resolveLinuxWindowBounds(selectedSource);
	}

	if (bounds) {
		setSelectedWindowBounds(bounds);
	}
}

export function startWindowBoundsCapture() {
	if (windowBoundsCaptureInterval) {
		clearInterval(windowBoundsCaptureInterval);
		setWindowBoundsCaptureInterval(null);
	}

	if (
		!["darwin", "win32", "linux"].includes(process.platform) ||
		!selectedSource?.id?.startsWith("window:")
	) {
		return;
	}

	void refreshSelectedWindowBounds();
	setWindowBoundsCaptureInterval(setInterval(() => {
		void refreshSelectedWindowBounds();
	}, 250));
}
