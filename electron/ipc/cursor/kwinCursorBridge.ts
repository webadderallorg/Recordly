import { type ChildProcess, execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const KWIN_CURSOR_BRIDGE_INTERFACE = "dev.recordly.CursorBridge";
const KWIN_SCRIPT_NAME = "recordly-cursor-bridge";
const KWIN_REPORT_INTERVAL_MS = 4;
const DBUS_MONITOR_READY_TIMEOUT_MS = 500;

export interface KwinCursorPoint {
	x: number;
	y: number;
}

// Wayland hides the global pointer from clients, so Electron's
// screen.getCursorScreenPoint() stays at 0,0 and the X11 input hook only sees
// XWayland windows. KWin exposes the real position to its own scripts.
export function isKdeWaylandSession(
	platform: NodeJS.Platform | string,
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	if (platform !== "linux" || env.XDG_SESSION_TYPE?.trim().toLowerCase() !== "wayland") {
		return false;
	}

	const desktops = `${env.XDG_CURRENT_DESKTOP ?? ""}:${env.XDG_SESSION_DESKTOP ?? ""}`
		.toLowerCase()
		.split(/[:;]/);
	return desktops.includes("kde") || env.KDE_FULL_SESSION === "true";
}

export function buildKwinCursorScript(): string {
	const iface = JSON.stringify(KWIN_CURSOR_BRIDGE_INTERFACE);
	return `var lastReportMs = 0;
function report(force) {
	var now = Date.now();
	if (!force && now - lastReportMs < ${KWIN_REPORT_INTERVAL_MS}) {
		return;
	}
	lastReportMs = now;
	callDBus(${iface}, "/", ${iface}, "Pos", workspace.cursorPos.x, workspace.cursorPos.y);
}
workspace.cursorPosChanged.connect(function () {
	report(false);
});
report(true);
`;
}

/** Parses `dbus-monitor` text output into the Pos(x, y) calls sent by the KWin script. */
export function createDbusMonitorCursorParser(onPoint: (point: KwinCursorPoint) => void) {
	const callMarker = `interface=${KWIN_CURSOR_BRIDGE_INTERFACE}; member=Pos`;
	let buffer = "";
	let pending: number[] | null = null;

	return (chunk: string) => {
		buffer += chunk;
		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";

		for (const line of lines) {
			if (line.includes(callMarker)) {
				pending = [];
				continue;
			}

			const value = pending
				? line.match(/^\s+(?:int32|double)\s+(-?\d+(?:\.\d+)?)\s*$/)
				: null;
			if (!pending || !value) {
				pending = null;
				continue;
			}

			pending.push(Number(value[1]));
			if (pending.length === 2) {
				onPoint({ x: pending[0], y: pending[1] });
				pending = null;
			}
		}
	};
}

function callKwin(objectPath: string, method: string, args: string[] = []) {
	return execFileAsync(
		"gdbus",
		[
			"call",
			"--session",
			"--dest",
			"org.kde.KWin",
			"--object-path",
			objectPath,
			"--method",
			method,
			...args,
		],
		{ timeout: 3000 },
	);
}

function waitForMonitorReady(monitor: ChildProcess) {
	return new Promise<void>((resolve, reject) => {
		const timer = setTimeout(resolve, DBUS_MONITOR_READY_TIMEOUT_MS);
		monitor.stdout?.once("data", () => {
			clearTimeout(timer);
			resolve();
		});
		monitor.once("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
	});
}

let kwinObjectCounter = 0;

/** Unique per start, so a late unload from a previous capture cannot hit the next one. */
export function nextKwinObjectName(prefix: string, separator = "-"): string {
	kwinObjectCounter += 1;
	return [prefix, process.pid, kwinObjectCounter].join(separator);
}

/** Streams the global cursor position from KWin. Resolves with a stop function. */
export async function startKwinCursorBridge(
	onPoint: (point: KwinCursorPoint) => void,
): Promise<() => void> {
	const scriptName = nextKwinObjectName(KWIN_SCRIPT_NAME);
	const scriptPath = path.join(os.tmpdir(), `${scriptName}.js`);
	const monitor = spawn(
		"dbus-monitor",
		["--session", `type='method_call',interface='${KWIN_CURSOR_BRIDGE_INTERFACE}'`],
		{ stdio: ["ignore", "pipe", "ignore"] },
	);
	const stop = () => {
		monitor.kill();
		void callKwin("/Scripting", "org.kde.kwin.Scripting.unloadScript", [scriptName])
			.catch(() => undefined)
			.then(() => fs.rm(scriptPath, { force: true }))
			.catch(() => undefined);
	};

	try {
		monitor.stdout?.setEncoding("utf-8");
		const ready = waitForMonitorReady(monitor);
		monitor.stdout?.on("data", createDbusMonitorCursorParser(onPoint));
		await ready;

		await fs.writeFile(scriptPath, buildKwinCursorScript(), "utf-8");
		await callKwin("/Scripting", "org.kde.kwin.Scripting.unloadScript", [scriptName]).catch(
			() => undefined,
		);
		const { stdout } = await callKwin("/Scripting", "org.kde.kwin.Scripting.loadScript", [
			scriptPath,
			scriptName,
		]);
		const scriptId = Number(stdout.match(/\((-?\d+),\)/)?.[1] ?? Number.NaN);
		if (!Number.isInteger(scriptId) || scriptId < 0) {
			throw new Error(`KWin refused the cursor script: ${stdout.trim()}`);
		}
		await callKwin(`/Scripting/Script${scriptId}`, "org.kde.kwin.Script.run");
	} catch (error) {
		stop();
		throw error;
	}

	return stop;
}
