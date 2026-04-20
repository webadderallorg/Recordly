import fs from "node:fs/promises"
import { BrowserWindow, ipcMain } from "electron"
import { showCursor } from "../../../cursorHider"
import {
	currentVideoPath,
	selectedSource,
	setActiveCursorSamples,
	setCursorCaptureStartTimeMs,
	setIsCursorCaptureActive,
	setLastLeftClick,
	setLinuxCursorScreenPoint,
	setPendingCursorSamples,
} from "../../state"
import type { CursorTelemetryPoint } from "../../types"
import { getTelemetryPathForVideo, normalizeVideoSourcePath } from "../../utils"
import {
	clamp,
	sampleCursorPoint,
	snapshotCursorTelemetryForPersistence,
	startCursorSampling,
	stopCursorCapture,
} from "../../cursor/telemetry"
import { startWindowBoundsCapture, stopWindowBoundsCapture } from "../../cursor/bounds"
import { startInteractionCapture, stopInteractionCapture } from "../../cursor/interaction"
import { startNativeCursorMonitor, stopNativeCursorMonitor } from "../../cursor/monitor"

export function registerRecordingTelemetryHandlers(
	onRecordingStateChange?: (recording: boolean, sourceName: string) => void,
) {
	ipcMain.handle("set-recording-state", (_, recording: boolean) => {
		if (recording) {
			stopCursorCapture()
			stopInteractionCapture()
			startWindowBoundsCapture()
			void startNativeCursorMonitor()
			setIsCursorCaptureActive(true)
			setActiveCursorSamples([])
			setPendingCursorSamples([])
			setCursorCaptureStartTimeMs(Date.now())
			setLinuxCursorScreenPoint(null)
			setLastLeftClick(null)
			sampleCursorPoint()
			startCursorSampling()
			void startInteractionCapture()
		} else {
			setIsCursorCaptureActive(false)
			stopCursorCapture()
			stopInteractionCapture()
			stopWindowBoundsCapture()
			stopNativeCursorMonitor()
			showCursor()
			setLinuxCursorScreenPoint(null)
			snapshotCursorTelemetryForPersistence()
			setActiveCursorSamples([])
		}

		const source = selectedSource || { name: "Screen" }
		for (const window of BrowserWindow.getAllWindows()) {
			if (!window.isDestroyed()) {
				window.webContents.send("recording-state-changed", {
					recording,
					sourceName: source.name,
				})
			}
		}

		onRecordingStateChange?.(recording, source.name)
	})

	ipcMain.handle("get-cursor-telemetry", async (_, videoPath?: string) => {
		const targetVideoPath = normalizeVideoSourcePath(videoPath ?? currentVideoPath)
		if (!targetVideoPath) {
			return { success: true, samples: [] }
		}

		const telemetryPath = getTelemetryPathForVideo(targetVideoPath)
		try {
			const content = await fs.readFile(telemetryPath, "utf-8")
			const parsed = JSON.parse(content)
			const rawSamples = Array.isArray(parsed)
				? parsed
				: Array.isArray(parsed?.samples)
					? parsed.samples
					: []

			const samples: CursorTelemetryPoint[] = rawSamples
				.filter((sample: unknown) => Boolean(sample && typeof sample === "object"))
				.map((sample: unknown) => {
					const point = sample as Partial<CursorTelemetryPoint>
					return {
						timeMs:
							typeof point.timeMs === "number" && Number.isFinite(point.timeMs)
								? Math.max(0, point.timeMs)
								: 0,
						cx:
							typeof point.cx === "number" && Number.isFinite(point.cx)
								? clamp(point.cx, 0, 1)
								: 0.5,
						cy:
							typeof point.cy === "number" && Number.isFinite(point.cy)
								? clamp(point.cy, 0, 1)
								: 0.5,
						interactionType:
							point.interactionType === "click" ||
							point.interactionType === "double-click" ||
							point.interactionType === "right-click" ||
							point.interactionType === "middle-click" ||
							point.interactionType === "move" ||
							point.interactionType === "mouseup"
								? point.interactionType
								: undefined,
						cursorType:
							point.cursorType === "arrow" ||
							point.cursorType === "text" ||
							point.cursorType === "pointer" ||
							point.cursorType === "crosshair" ||
							point.cursorType === "open-hand" ||
							point.cursorType === "closed-hand" ||
							point.cursorType === "resize-ew" ||
							point.cursorType === "resize-ns" ||
							point.cursorType === "not-allowed"
								? point.cursorType
								: undefined,
					}
				})
				.sort((left: CursorTelemetryPoint, right: CursorTelemetryPoint) => left.timeMs - right.timeMs)

			return { success: true, samples }
		} catch (error) {
			const nodeError = error as NodeJS.ErrnoException
			if (nodeError.code === "ENOENT") {
				return { success: true, samples: [] }
			}
			console.error("Failed to load cursor telemetry:", error)
			return {
				success: false,
				message: "Failed to load cursor telemetry",
				error: String(error),
				samples: [],
			}
		}
	})
}