import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import { BrowserWindow } from "electron";
import { ensureNativeCursorMonitorBinary, getCursorMonitorExePath } from "../paths/binaries";
import {
	currentCursorVisualType,
	nativeCursorMonitorOutputBuffer,
	nativeCursorMonitorProcess,
	setCurrentCursorVisualType,
	setNativeCursorMonitorOutputBuffer,
	setNativeCursorMonitorProcess,
} from "../state";
import type { CursorVisualType } from "../types";
import { recordCursorMouseDown, recordCursorMouseUp } from "./interaction";

export function emitCursorStateChanged(cursorType: CursorVisualType) {
	BrowserWindow.getAllWindows().forEach((window) => {
		if (!window.isDestroyed()) {
			window.webContents.send("cursor-state-changed", { cursorType });
		}
	});
}

export function handleCursorMonitorStdout(chunk: Buffer) {
	setNativeCursorMonitorOutputBuffer(nativeCursorMonitorOutputBuffer + chunk.toString());
	const lines = nativeCursorMonitorOutputBuffer.split(/\r?\n/);
	setNativeCursorMonitorOutputBuffer(lines.pop() ?? "");

	for (const line of lines) {
		const interactionMatch = line.match(/^INTERACTION:(mousedown|mouseup)(?::([123]))?$/);
		if (interactionMatch) {
			if (interactionMatch[1] === "mouseup") {
				recordCursorMouseUp();
			} else {
				const button = Number(interactionMatch[2]);
				recordCursorMouseDown(button === 2 || button === 3 ? button : 1);
			}
			continue;
		}

		const match = line.match(/^STATE:(.+)$/);
		if (!match) continue;
		const next = match[1].trim() as CursorVisualType;
		if (
			next === "arrow" ||
			next === "text" ||
			next === "pointer" ||
			next === "crosshair" ||
			next === "open-hand" ||
			next === "closed-hand" ||
			next === "resize-ew" ||
			next === "resize-ns" ||
			next === "not-allowed"
		) {
			if (currentCursorVisualType !== next) {
				setCurrentCursorVisualType(next);
				// sampleCursorStateChange is called from cursor/telemetry.ts via the handler
				emitCursorStateChanged(next);
			}
		}
	}
}

export function stopNativeCursorMonitor() {
	setCurrentCursorVisualType("arrow");

	if (!nativeCursorMonitorProcess) {
		return;
	}

	try {
		nativeCursorMonitorProcess.stdin.write("stop\n");
	} catch {
		// ignore stop signal issues
	}
	try {
		nativeCursorMonitorProcess.kill();
	} catch {
		// ignore kill issues
	}

	setNativeCursorMonitorProcess(null);
	setNativeCursorMonitorOutputBuffer("");
}

export async function startNativeCursorMonitor() {
	stopNativeCursorMonitor();

	if (process.platform !== "darwin" && process.platform !== "win32") {
		setCurrentCursorVisualType("arrow");
		return;
	}

	try {
		let helperPath: string;
		if (process.platform === "win32") {
			helperPath = getCursorMonitorExePath();
			try {
				// Use F_OK on Windows — X_OK is meaningless and can give false positives
				await fs.access(helperPath, fsConstants.F_OK);
			} catch {
				console.warn("Windows cursor monitor helper missing:", helperPath);
				setCurrentCursorVisualType("arrow");
				return;
			}
		} else {
			helperPath = await ensureNativeCursorMonitorBinary();
		}

		setNativeCursorMonitorOutputBuffer("");
		setCurrentCursorVisualType("arrow");

		let proc: ReturnType<typeof spawn> | null;
		try {
			proc = spawn(helperPath, [], {
				stdio: ["pipe", "pipe", "pipe"],
			});
		} catch (spawnError) {
			console.warn("Failed to spawn cursor monitor:", spawnError);
			setNativeCursorMonitorProcess(null);
			setCurrentCursorVisualType("arrow");
			return;
		}

		setNativeCursorMonitorProcess(proc as Parameters<typeof setNativeCursorMonitorProcess>[0]);
		const spawned = proc;
		if (!spawned) {
			setNativeCursorMonitorProcess(null);
			setCurrentCursorVisualType("arrow");
			return;
		}

		spawned.once("error", (error) => {
			console.warn("Native cursor monitor process error:", error);
			if (nativeCursorMonitorProcess === spawned) {
				setNativeCursorMonitorProcess(null);
				setNativeCursorMonitorOutputBuffer("");
				setCurrentCursorVisualType("arrow");
			}
		});

		if (spawned.stdout) spawned.stdout.on("data", handleCursorMonitorStdout);
		if (spawned.stderr) {
			spawned.stderr.on("data", () => {
				// Drain stderr so helper logging cannot block the process.
			});
		}

		spawned.once("close", () => {
			if (nativeCursorMonitorProcess === spawned) {
				setNativeCursorMonitorProcess(null);
				setNativeCursorMonitorOutputBuffer("");
				setCurrentCursorVisualType("arrow");
			}
		});
	} catch (error) {
		console.warn("Failed to start native cursor monitor:", error);
		setNativeCursorMonitorProcess(null);
		setNativeCursorMonitorOutputBuffer("");
		setCurrentCursorVisualType("arrow");
	}
}
