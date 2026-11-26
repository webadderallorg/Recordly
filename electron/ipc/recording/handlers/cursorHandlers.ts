import fs from "node:fs/promises";
import { type IpcMainInvokeEvent, ipcMain } from "electron";
import { isTrustedRenderer } from "../../../trustedRenderer";
import {
	normalizeCursorTelemetrySamples,
	pauseCursorCaptureAtBoundary,
	resumeCursorCapture,
	sampleCursorPoint,
	writeCursorTelemetry,
} from "../../cursor/telemetry";
import { currentVideoPath } from "../../state";
import { type CursorTelemetryPoint } from "../../types";
import {
	getTelemetryPathForVideo,
	normalizeVideoSourcePath,
	parseJsonWithByteOrderMark,
} from "../../utils";
import { getSystemCursorAssets } from "./systemCursorAssets";

function assertTrustedCursorCaller(event: IpcMainInvokeEvent) {
	if (!isTrustedRenderer(event)) {
		throw new Error("Untrusted recording caller");
	}
}

function resolveTargetVideoPath(videoPath: unknown): { valid: boolean; path: string | null } {
	if (videoPath !== undefined && videoPath !== null && typeof videoPath !== "string") {
		return { valid: false, path: null };
	}

	return {
		valid: true,
		path: normalizeVideoSourcePath(videoPath ?? currentVideoPath),
	};
}

function normalizeRendererTimestampMs(value: unknown) {
	const nowMs = Date.now();
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return nowMs;
	}

	return Math.min(Math.max(0, Math.round(value)), nowMs);
}

export function registerCursorHandlers() {
	ipcMain.handle("get-system-cursor-assets", async (event) => {
		assertTrustedCursorCaller(event);
		try {
			return { success: true, cursors: await getSystemCursorAssets() };
		} catch (error) {
			console.error("Failed to load system cursor assets:", error);
			return { success: false, cursors: {}, error: String(error) };
		}
	});

	ipcMain.handle("pause-cursor-capture", (event, pausedAtMs?: unknown) => {
		assertTrustedCursorCaller(event);
		pauseCursorCaptureAtBoundary(normalizeRendererTimestampMs(pausedAtMs));
		return { success: true };
	});

	ipcMain.handle("resume-cursor-capture", (event, resumedAtMs?: unknown) => {
		assertTrustedCursorCaller(event);
		resumeCursorCapture(normalizeRendererTimestampMs(resumedAtMs));
		sampleCursorPoint();
		return { success: true };
	});

	ipcMain.handle("get-cursor-telemetry", async (event, videoPath?: unknown) => {
		assertTrustedCursorCaller(event);
		const resolved = resolveTargetVideoPath(videoPath);
		if (!resolved.valid) {
			return {
				success: false,
				message: "Invalid video path for cursor telemetry",
				error: "Invalid video path",
				samples: [],
			};
		}

		const targetVideoPath = resolved.path;
		if (!targetVideoPath) {
			return { success: true, samples: [] };
		}

		const telemetryPath = getTelemetryPathForVideo(targetVideoPath);
		try {
			const content = await fs.readFile(telemetryPath, "utf-8");
			const parsed = parseJsonWithByteOrderMark<unknown>(content);
			const samples = normalizeCursorTelemetrySamples(parsed);
			if (samples.some((sample) => sample.interactionType === "manual-zoom")) {
				return {
					success: true,
					samples: samples.filter((sample) => sample.interactionType !== "manual-zoom"),
					recordingZoomMarkers: samples
						.filter((sample) => sample.interactionType === "manual-zoom")
						.map(({ timeMs, cx, cy }) => ({ timeMs, cx, cy })),
				};
			}

			return { success: true, samples };
		} catch (error) {
			const nodeError = error as NodeJS.ErrnoException;
			if (nodeError.code === "ENOENT") {
				return { success: true, samples: [] };
			}
			console.error("Failed to load cursor telemetry:", error);
			return {
				success: false,
				message: "Failed to load cursor telemetry",
				error: String(error),
				samples: [],
			};
		}
	});

	ipcMain.handle("set-cursor-telemetry", async (event, videoPath: unknown, samples: unknown) => {
		assertTrustedCursorCaller(event);
		const resolved = resolveTargetVideoPath(videoPath);
		if (!resolved.valid) {
			return {
				success: false,
				samples: [],
				message: "Invalid video path for cursor telemetry",
				error: "Invalid video path",
			};
		}

		if (!Array.isArray(samples)) {
			return {
				success: false,
				samples: [],
				message: "Invalid cursor telemetry samples",
				error: "Expected an array of cursor samples",
			};
		}

		const targetVideoPath = resolved.path;
		if (!targetVideoPath) {
			return {
				success: false,
				samples: [],
				message: "No video path available for cursor telemetry",
				error: "Missing video path",
			};
		}

		try {
			const normalizedSamples = await writeCursorTelemetry(
				targetVideoPath,
				samples as CursorTelemetryPoint[],
			);
			return { success: true, samples: normalizedSamples };
		} catch (error) {
			console.error("Failed to save cursor telemetry:", error);
			return {
				success: false,
				samples: [],
				message: "Failed to save cursor telemetry",
				error: String(error),
			};
		}
	});
}
