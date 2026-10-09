import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import { BrowserWindow } from "electron";
import {
	ensureNativeCursorMonitorBinary,
	getCursorMonitorExePath,
	getPrebundledNativeHelperPath,
} from "../paths/binaries";
import {
	currentCursorVisualType,
	nativeCursorMonitorOutputBuffer,
	nativeCursorMonitorProcess,
	setCurrentCursorVisualType,
	setLinuxCursorScreenPoint,
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

		const positionMatch = line.match(/^POSITION:(-?\d+):(-?\d+)$/);
		if (positionMatch && process.platform === "linux") {
			// Authoritative X server coordinates from the native helper; the
			// same state the uiohook mousemove cache feeds on Linux.
			setLinuxCursorScreenPoint({
				x: Number(positionMatch[1]),
				y: Number(positionMatch[2]),
				updatedAt: Date.now(),
			});
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
	intentionalStop = true;
	if (respawnTimer !== null) {
		clearTimeout(respawnTimer);
		respawnTimer = null;
	}
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

/* The helper owns shape detection for the whole recording; if it crashes, the
 * cursor used to stay "arrow" until the next recording started. Respawn after
 * an unexpected close, with growing delays so a helper that dies on startup
 * cannot spin; a healthy run longer than HEALTHY_UPTIME resets the ladder. */
const CURSOR_MONITOR_RESPAWN_DELAYS_MS = [500, 1000, 2000, 4000, 8000];
const CURSOR_MONITOR_HEALTHY_UPTIME_MS = 10_000;

let intentionalStop = false;
let respawnAttempts = 0;
let respawnTimer: ReturnType<typeof setTimeout> | null = null;
let spawnStartedAtMs = 0;

function scheduleCursorMonitorRespawn() {
	if (intentionalStop || respawnTimer !== null || nativeCursorMonitorProcess !== null) {
		return;
	}
	if (spawnStartedAtMs > 0 && Date.now() - spawnStartedAtMs >= CURSOR_MONITOR_HEALTHY_UPTIME_MS) {
		respawnAttempts = 0;
	}
	if (respawnAttempts >= CURSOR_MONITOR_RESPAWN_DELAYS_MS.length) {
		console.warn(
			"Cursor monitor helper keeps crashing; not respawning until the next recording.",
		);
		return;
	}
	const delayMs = CURSOR_MONITOR_RESPAWN_DELAYS_MS[respawnAttempts];
	respawnAttempts += 1;
	respawnTimer = setTimeout(() => {
		respawnTimer = null;
		void startNativeCursorMonitor(false);
	}, delayMs);
}

/* resetRespawnLadder is false for respawns: the crash ladder must survive
 * across them or the give-up cap can never be reached. */
export async function startNativeCursorMonitor(resetRespawnLadder = true) {
	stopNativeCursorMonitor();
	intentionalStop = false;
	if (resetRespawnLadder) {
		respawnAttempts = 0;
	}

	if (
		process.platform !== "darwin" &&
		process.platform !== "win32" &&
		process.platform !== "linux"
	) {
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
		} else if (process.platform === "linux") {
			helperPath = getPrebundledNativeHelperPath("cursor-monitor");
			try {
				await fs.access(helperPath, fsConstants.X_OK);
			} catch {
				// Missing helper (e.g. built without libx11-dev): position falls
				// back to the uiohook cache and the cursor type stays "arrow".
				console.warn("Linux cursor monitor helper missing:", helperPath);
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
		spawnStartedAtMs = Date.now();
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
			scheduleCursorMonitorRespawn();
		});
	} catch (error) {
		console.warn("Failed to start native cursor monitor:", error);
		setNativeCursorMonitorProcess(null);
		setNativeCursorMonitorOutputBuffer("");
		setCurrentCursorVisualType("arrow");
	}
}
