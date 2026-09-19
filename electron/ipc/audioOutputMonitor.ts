import { spawn, type SpawnOptions } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import { BrowserWindow, ipcMain } from "electron";
import { getWindowsCaptureExePath } from "./paths/binaries";

export type AudioOutputLevelEvent = {
	deviceId: string;
	rms: number;
	peak: number;
	level: number;
};

type MonitorChildProcess = {
	stdin: { write: (chunk: string) => unknown };
	stdout: { on: (event: "data", listener: (chunk: Buffer | string) => void) => unknown };
	stderr: { on: (event: "data", listener: (chunk: Buffer | string) => void) => unknown };
	once: {
		(event: "close", listener: (code: number | null) => void): unknown;
		(event: "error", listener: (error: Error) => void): unknown;
	};
	kill: () => unknown;
};

type AudioOutputMonitorDependencies = {
	isWindows?: () => boolean;
	getHelperPath?: () => string;
	access?: (path: string, mode: number) => Promise<void>;
	spawn?: (
		helperPath: string,
		args: string[],
		options: SpawnOptions & { windowsHide: boolean },
	) => MonitorChildProcess;
	broadcast?: (event: AudioOutputLevelEvent) => void;
};

const clamp = (value: number, min: number, max: number) =>
	Math.min(max, Math.max(min, value));

export function parseAudioOutputLevelLine(line: string): AudioOutputLevelEvent | null {
	const fields = line.split("\t");
	if (fields.length !== 4 || fields[0] !== "AUDIO_LEVEL") {
		return null;
	}

	const deviceId = fields[1]?.trim();
	const rms = Number(fields[2]);
	const peak = Number(fields[3]);
	if (
		!deviceId ||
		!Number.isFinite(rms) ||
		!Number.isFinite(peak)
	) {
		return null;
	}

	const normalizedRms = clamp(rms, 0, 1);
	const normalizedPeak = clamp(peak, 0, 1);
	return {
		deviceId,
		rms: normalizedRms,
		peak: normalizedPeak,
		level: clamp(Math.max(normalizedRms * 200, normalizedPeak * 100), 0, 100),
	};
}

export function splitAudioOutputMonitorLines(input: string): {
	events: AudioOutputLevelEvent[];
	remainder: string;
} {
	const lines = input.split(/\r?\n/u);
	const remainder = lines.pop() ?? "";
	const events = lines
		.map((line) => parseAudioOutputLevelLine(line))
		.filter((event): event is AudioOutputLevelEvent => event !== null);
	return { events, remainder };
}

function defaultBroadcast(event: AudioOutputLevelEvent) {
	BrowserWindow.getAllWindows().forEach((window) => {
		if (!window.isDestroyed()) {
			window.webContents.send("audio-output-level", event);
		}
	});
}

export function createAudioOutputLevelMonitorManager(
	dependencies: AudioOutputMonitorDependencies = {},
) {
	const isWindows = dependencies.isWindows ?? (() => process.platform === "win32");
	const getHelperPath = dependencies.getHelperPath ?? getWindowsCaptureExePath;
	const access = dependencies.access ?? ((path, mode) => fs.access(path, mode));
	const spawnMonitor =
		dependencies.spawn ??
		((helperPath, args, options) =>
			spawn(helperPath, args, options) as unknown as MonitorChildProcess);
	const broadcast = dependencies.broadcast ?? defaultBroadcast;

	let monitorProcess: MonitorChildProcess | null = null;
	let outputBuffer = "";
	let stopping: Promise<{ success: boolean }> | null = null;
	let starting: Promise<{ success: boolean; error?: string }> | null = null;

	const clearProcess = (processToClear: MonitorChildProcess) => {
		if (monitorProcess !== processToClear) return;
		monitorProcess = null;
		outputBuffer = "";
	};

	const stop = async (): Promise<{ success: boolean }> => {
		if (stopping) return stopping;
		if (starting) {
			try {
				await starting;
			} catch {
				// A failed startup leaves no process to stop.
			}
		}
		const current = monitorProcess;
		if (!current) return { success: true };

		stopping = new Promise((resolve) => {
			let settled = false;
			const timer = setTimeout(() => {
				try {
					current.kill();
				} catch {
					// The process may already have exited.
				}
				finish();
			}, 1000);
			const finish = () => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				clearProcess(current);
				resolve({ success: true });
			};

			current.once("close", () => finish());
			current.once("error", () => finish());
			try {
				current.stdin.write("stop\n");
			} catch {
				try {
					current.kill();
				} catch {
					// Ignore a process that has already exited.
				}
				finish();
			}
		});

		try {
			return await stopping;
		} finally {
			stopping = null;
		}
	};

	const start = async (): Promise<{ success: boolean; error?: string }> => {
		if (stopping) await stopping;
		if (monitorProcess) return { success: true };
		if (starting) return starting;

		starting = (async () => {
			if (!isWindows()) {
				return { success: false, error: "System audio level monitoring is Windows-only" };
			}

			const helperPath = getHelperPath();
			try {
				await access(helperPath, fsConstants.F_OK);
			} catch {
				console.warn("Windows audio output level monitor helper missing:", helperPath);
				return { success: false, error: "Audio output level monitor helper is unavailable" };
			}

			let child: MonitorChildProcess;
			try {
				child = spawnMonitor(helperPath, ["--monitor-audio-outputs"], {
					stdio: ["pipe", "pipe", "pipe"],
					windowsHide: true,
				});
			} catch (error) {
				console.warn("Failed to spawn audio output level monitor:", error);
				return { success: false, error: String(error) };
			}

			monitorProcess = child;
			outputBuffer = "";
			child.stdout.on("data", (chunk) => {
				outputBuffer += chunk.toString();
				const result = splitAudioOutputMonitorLines(outputBuffer);
				outputBuffer = result.remainder;
				result.events.forEach(broadcast);
			});
			child.stderr.on("data", () => {
				// Drain stderr so helper diagnostics cannot block stdout telemetry.
			});
			child.once("error", (error) => {
				console.warn("Audio output level monitor process error:", error);
				clearProcess(child);
			});
			child.once("close", () => clearProcess(child));

			return { success: true };
		})();

		try {
			return await starting;
		} finally {
			starting = null;
		}
	};

	return { start, stop };
}

const defaultMonitorManager = createAudioOutputLevelMonitorManager();
let handlersRegistered = false;

export function registerAudioOutputMonitorHandlers() {
	if (handlersRegistered) return;
	handlersRegistered = true;
	ipcMain.handle("start-audio-output-level-monitor", () => defaultMonitorManager.start());
	ipcMain.handle("stop-audio-output-level-monitor", () => defaultMonitorManager.stop());
}
