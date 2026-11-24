import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { app, ipcMain, type WebContents } from "electron";
import { lock } from "proper-lockfile";
import { redactDiagnostic } from "../../../src/lib/feedback/diagnosticRedaction";
import {
	diagnosticSurface,
	type DiagnosticSurface,
	newDiagnosticId,
	OPERATION_HISTORY_LIMIT,
	type OperationEvent,
	parseOperationEvent,
	startDiagnosticOperation,
} from "../../../src/shared/operationDiagnostics";
import { collectSupportDeviceInfo } from "../../supportDeviceInfo";
import { isTrustedRenderer } from "../../trustedRenderer";

const MAX_FILE_BYTES = 480_000;
const APP_LOG_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Native process values; never decode Chromium's compatibility user-agent tokens. */
export function collectExportRuntimeInfo(): RendererExportRuntimeInfo {
	let osVersion: string | undefined;
	try {
		osVersion = process.getSystemVersion?.() || undefined;
	} catch {
		// Missing host-version data must not replace it with a kernel or UA guess.
	}
	return {
		appVersion: app.getVersion(),
		platform: process.platform,
		arch: process.arch,
		osVersion,
		kernelRelease: os.release(),
		versions: {
			electron: process.versions.electron,
			chromium: process.versions.chrome,
			node: process.versions.node,
			v8: process.versions.v8,
		},
	};
}

function createDiagnosticLog(filename: string, maxEntries: number, maxAgeMs?: number) {
	// One queue across all renderer windows prevents competing read/modify/write operations.
	let writes: Promise<{ success: boolean }> | undefined;
	const logPath = () => path.join(app.getPath("logs"), filename);
	const read = async (): Promise<string[]> => {
		try {
			if ((await fs.stat(logPath())).size > MAX_FILE_BYTES) return [];
			const parsed: unknown = JSON.parse(await fs.readFile(logPath(), "utf8"));
			const oldest = maxAgeMs ? new Date(Date.now() - maxAgeMs).toISOString() : undefined;
			return Array.isArray(parsed)
				? parsed
						.filter((value): value is string => typeof value === "string")
						.filter((entry) => !oldest || entry.slice(0, 24) >= oldest)
						.slice(-maxEntries)
						.map((value) => redactDiagnostic(value))
				: [];
		} catch {
			return [];
		}
	};
	const append = (entries: string[]) => {
		const write = (writes ?? Promise.resolve()).then(async () => {
			let release: (() => Promise<void>) | undefined;
			try {
				const directory = app.getPath("logs");
				await fs.mkdir(directory, { recursive: true });
				// Multiple Recordly processes can share the same log directory.
				release = await lock(logPath(), {
					realpath: false,
					retries: { retries: 3, minTimeout: 20, maxTimeout: 80 },
					onCompromised: () => undefined,
				});
				const logs = [...(await read()), ...entries.map(redactDiagnostic)].slice(
					-maxEntries,
				);
				while (Buffer.byteLength(JSON.stringify(logs), "utf8") > 120_000 && logs.length)
					logs.shift();
				// Replace atomically so a crash cannot leave half a JSON document.
				const temporary = `${logPath()}.${process.pid}.tmp`;
				await fs.writeFile(temporary, JSON.stringify(logs), { mode: 0o600 });
				await fs.rename(temporary, logPath());
				return { success: true };
			} catch {
				return { success: false };
			} finally {
				await release?.().catch(() => undefined);
			}
		});
		writes = write;
		const clearCompletedWrite = () => {
			if (writes === write) writes = undefined;
		};
		void write.then(clearCompletedWrite, clearCompletedWrite);
		return write;
	};
	return {
		append,
		pendingWrite: () => writes,
		async snapshot() {
			await writes;
			return { success: true, logs: await read() };
		},
	};
}

const exportLog = createDiagnosticLog("export-diagnostics.json", 60);
const appLog = createDiagnosticLog("app-diagnostics.json", 150, APP_LOG_MAX_AGE_MS);
const operationLog = createDiagnosticLog(
	"operation-diagnostics.json",
	OPERATION_HISTORY_LIMIT,
	APP_LOG_MAX_AGE_MS,
);
const appRunId = newDiagnosticId();
const rendererSurfaces = new WeakMap<WebContents, DiagnosticSurface>();
const pendingOperations: string[] = [];
let operationFlush: ReturnType<typeof setTimeout> | undefined;
const mainFailureFilename = "app-main-failure.log";

function flushOperations() {
	clearTimeout(operationFlush);
	operationFlush = undefined;
	if (pendingOperations.length) void operationLog.append(pendingOperations.splice(0));
}

export function drainAppProcessDiagnostics() {
	flushOperations();
	const writes = [exportLog.pendingWrite(), appLog.pendingWrite(), operationLog.pendingWrite()];
	return writes.some(Boolean) ? Promise.allSettled(writes) : undefined;
}

function recordOperation(event: OperationEvent, windowId?: number) {
	pendingOperations.push(
		`${event.timestamp} ${JSON.stringify({ ...event, appRunId, windowId })}`,
	);
	if (pendingOperations.length > OPERATION_HISTORY_LIMIT) pendingOperations.shift();
	operationFlush ??= setTimeout(flushOperations, 150);
}

export function startMainDiagnosticOperation(
	name: string,
	surface = "application",
	windowId?: number,
) {
	return startDiagnosticOperation((event) => recordOperation(event, windowId), {
		name,
		source: "main",
		surface: diagnosticSurface(surface),
	});
}

async function readOperations() {
	flushOperations();
	const { logs } = await operationLog.snapshot();
	return logs.flatMap((line) => {
		try {
			const parsed = parseOperationEvent(JSON.parse(line.slice(25)));
			return parsed ? [parsed] : [];
		} catch {
			return [];
		}
	});
}

export function recordAppProcessDiagnostic(level: "info" | "warn" | "error", message: string) {
	return appLog.append([`${new Date().toISOString()} ${level}: [electron] ${message}`]);
}

export function installAppProcessDiagnostics() {
	app.on("render-process-gone", (_event, contents, details) => {
		if (details.reason === "clean-exit") return;
		const operation = startMainDiagnosticOperation(
			"app.renderer-exit",
			rendererSurfaces.get(contents),
			contents.id,
		);
		operation.step(details.reason);
		operation.finish("failed");
		flushOperations();
	});
	app.on("child-process-gone", (_event, details) => {
		if (details.reason !== "clean-exit")
			void recordAppProcessDiagnostic(
				"error",
				`child process exited type=${details.type} reason=${details.reason} exitCode=${details.exitCode}`,
			);
	});
	// A fatal exception can exit before queued writes finish. Monitoring preserves
	// Node's default exit behavior and saves the last failure for the next launch.
	process.on("uncaughtExceptionMonitor", (error, origin) => {
		try {
			const directory = app.getPath("logs");
			mkdirSync(directory, { recursive: true });
			const file = path.join(directory, mainFailureFilename);
			const temporary = `${file}.${process.pid}.tmp`;
			const entry = redactDiagnostic(
				`${new Date().toISOString()} error: [electron] ${origin}\n${error.stack ?? error.message}`,
			);
			writeFileSync(temporary, entry, { mode: 0o600 });
			renameSync(temporary, file);
		} catch {
			// Logging must leave the original fatal exception intact.
		}
	});
}

async function readMainFailure() {
	try {
		const file = path.join(app.getPath("logs"), mainFailureFilename);
		if ((await fs.stat(file)).size > 8192) return [];
		const entry = redactDiagnostic(await fs.readFile(file, "utf8"));
		const timestamp = Date.parse(entry.slice(0, 24));
		if (timestamp >= Date.now() - APP_LOG_MAX_AGE_MS) return [entry];
	} catch {
		// A log may not exist yet or may be unavailable on this machine.
	}
	return [];
}

export function registerExportDiagnosticHandlers() {
	ipcMain.handle("app-diagnostics:device", async (event) => {
		if (!isTrustedRenderer(event)) return { success: false };
		try {
			return { success: true, device: await collectSupportDeviceInfo() };
		} catch {
			return { success: false };
		}
	});
	ipcMain.handle("export-diagnostics:runtime", (event) => {
		if (!isTrustedRenderer(event)) return { success: false };
		try {
			return { success: true, runtime: collectExportRuntimeInfo() };
		} catch {
			return { success: false };
		}
	});
	ipcMain.handle("export-diagnostics:append", (event, entry: unknown) =>
		isTrustedRenderer(event) && typeof entry === "string" && entry.length <= 2200
			? exportLog.append([entry])
			: { success: false },
	);
	ipcMain.handle("export-diagnostics:read", (event) =>
		isTrustedRenderer(event) ? exportLog.snapshot() : { success: false, logs: [] },
	);
	ipcMain.handle("app-diagnostics:append", (event, entries: unknown) => {
		if (
			!isTrustedRenderer(event) ||
			!Array.isArray(entries) ||
			entries.length < 1 ||
			entries.length > 30 ||
			!entries.every((entry) => typeof entry === "string" && entry.length <= 2200)
		)
			return { success: false };
		return appLog.append(entries);
	});
	ipcMain.handle("app-diagnostics:read", async (event) => {
		if (!isTrustedRenderer(event)) return { success: false, logs: [] };
		const windowId = event.sender.id;
		const [snapshot, mainFailure, operations] = await Promise.all([
			appLog.snapshot(),
			readMainFailure(),
			readOperations(),
		]);
		return {
			success: true,
			logs: [...snapshot.logs, ...mainFailure],
			operations,
			appRunId,
			windowId,
		};
	});
	ipcMain.handle("app-diagnostics:operation", (event, input: unknown) => {
		if (!isTrustedRenderer(event)) return;
		const parsed = parseOperationEvent(input);
		if (parsed?.source === "renderer" || parsed?.source === "ipc") {
			// IPC may complete after navigation. Keep the most recent renderer view for crash attribution.
			if (parsed.source === "renderer" && parsed.phase === "start")
				rendererSurfaces.set(event.sender, parsed.surface);
			recordOperation(parsed, event.sender.id);
		}
	});
}
