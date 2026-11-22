import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { app, type IpcMainInvokeEvent, ipcMain } from "electron";
import { redactDiagnostic } from "../../../src/lib/feedback/diagnosticRedaction";
import { getPackagedRendererBaseUrl } from "../../rendererServer";

const MAX_ENTRIES = 60;
const MAX_FILE_BYTES = 480_000;

function trustedSender(event: IpcMainInvokeEvent) {
	const frame = event.senderFrame;
	if (!frame || frame !== event.sender.mainFrame) return false;
	try {
		const candidate = new URL(frame.url);
		if (candidate.username || candidate.password) return false;
		return [
			process.env.VITE_DEV_SERVER_URL,
			getPackagedRendererBaseUrl(),
			pathToFileURL(path.join(process.env.APP_ROOT || app.getAppPath(), "dist", "index.html"))
				.href,
		].some((value) => {
			if (!value) return false;
			const base = new URL(value);
			return candidate.origin === base.origin && candidate.pathname === base.pathname;
		});
	} catch {
		return false;
	}
}

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

export function registerExportDiagnosticHandlers() {
	ipcMain.handle("export-diagnostics:runtime", (event) => {
		if (!trustedSender(event)) return { success: false };
		try {
			return { success: true, runtime: collectExportRuntimeInfo() };
		} catch {
			return { success: false };
		}
	});
	// One queue across all renderer windows prevents competing read/modify/write operations.
	let writes: Promise<unknown> = Promise.resolve();
	const logPath = () => path.join(app.getPath("logs"), "export-diagnostics.json");
	const read = async (): Promise<string[]> => {
		try {
			if ((await fs.stat(logPath())).size > MAX_FILE_BYTES) return [];
			const parsed: unknown = JSON.parse(await fs.readFile(logPath(), "utf8"));
			return Array.isArray(parsed)
				? parsed
						.filter((value): value is string => typeof value === "string")
						.slice(-MAX_ENTRIES)
						.map((value) => redactDiagnostic(value))
				: [];
		} catch {
			return [];
		}
	};
	ipcMain.handle("export-diagnostics:append", async (event, entry: unknown) => {
		if (!trustedSender(event) || typeof entry !== "string" || entry.length > 2200)
			return { success: false };
		const write = writes.then(async () => {
			try {
				const logs = [...(await read()), redactDiagnostic(entry)].slice(-MAX_ENTRIES);
				while (Buffer.byteLength(JSON.stringify(logs), "utf8") > 120_000 && logs.length)
					logs.shift();
				await fs.mkdir(app.getPath("logs"), { recursive: true });
				// Replace atomically so a crash cannot leave half a JSON document.
				await fs.writeFile(`${logPath()}.tmp`, JSON.stringify(logs), { mode: 0o600 });
				await fs.rename(`${logPath()}.tmp`, logPath());
				return { success: true };
			} catch {
				return { success: false };
			}
		});
		writes = write;
		return write;
	});
	ipcMain.handle("export-diagnostics:read", async (event) => {
		if (!trustedSender(event)) return { success: false, logs: [] };
		await writes;
		return { success: true, logs: await read() };
	});
}
