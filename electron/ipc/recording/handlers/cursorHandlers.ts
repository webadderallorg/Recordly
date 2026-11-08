import fs from "node:fs/promises";
import { ipcMain } from "electron";
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

function normalizeRendererTimestampMs(value: unknown) {
	const nowMs = Date.now();
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return nowMs;
	}

	return Math.min(Math.max(0, Math.round(value)), nowMs);
}

export function registerCursorHandlers() {
	ipcMain.handle("get-system-cursor-assets", async () => {
		try {
			return { success: true, cursors: await getSystemCursorAssets() };
		} catch (error) {
			console.error("Failed to load system cursor assets:", error);
			return { success: false, cursors: {}, error: String(error) };
		}
	});

	ipcMain.handle("pause-cursor-capture", (_, pausedAtMs?: unknown) => {
		pauseCursorCaptureAtBoundary(normalizeRendererTimestampMs(pausedAtMs));
		return { success: true };
	});

	ipcMain.handle("resume-cursor-capture", (_, resumedAtMs?: unknown) => {
		resumeCursorCapture(normalizeRendererTimestampMs(resumedAtMs));
		sampleCursorPoint();
		return { success: true };
	});

	ipcMain.handle("get-cursor-telemetry", async (_, videoPath?: string) => {
		const targetVideoPath = normalizeVideoSourcePath(videoPath ?? currentVideoPath);
		if (!targetVideoPath) {
			return { success: true, samples: [] };
		}

		const telemetryPath = getTelemetryPathForVideo(targetVideoPath);
		try {
			const content = await fs.readFile(telemetryPath, "utf-8");
			const parsed = parseJsonWithByteOrderMark<unknown>(content);
			const samples = normalizeCursorTelemetrySamples(parsed);

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

	ipcMain.handle(
		"set-cursor-telemetry",
		async (_, videoPath: string | undefined, samples: CursorTelemetryPoint[]) => {
			const targetVideoPath = normalizeVideoSourcePath(videoPath ?? currentVideoPath);
			if (!targetVideoPath) {
				return {
					success: false,
					samples: [],
					message: "No video path available for cursor telemetry",
					error: "Missing video path",
				};
			}

			try {
				const normalizedSamples = await writeCursorTelemetry(targetVideoPath, samples);
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
		},
	);
}
