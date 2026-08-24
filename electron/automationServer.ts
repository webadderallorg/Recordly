import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, desktopCapturer } from "electron";

import {
	windowsCaptureTargetPath,
	windowsNativeCaptureActive,
	windowsPendingVideoPath,
} from "./ipc/state";
import type { NativeMacRecordingOptions, SelectedSource } from "./ipc/types";

const PORT = Number(process.env.RECORDLY_AUTOMATION_PORT ?? 17373);

// Local-only control API for external tools (CI, AI coding agents, custom
// scripts) that need to start/stop a recording without driving the UI.
//
// Binds to 127.0.0.1 only. Recording is driven through a hidden window that
// runs the app's own preload, so every command goes through the exact same
// IPC pipeline the UI uses (source selection -> native capture -> cursor
// telemetry). No recording logic is duplicated here.

export type AutomationSource = {
	id: string;
	name: string;
	sourceType: "screen" | "window";
	display_id?: string;
};

export function pickSource(
	sources: AutomationSource[],
	body: { sourceId?: unknown; sourceName?: unknown },
): AutomationSource | undefined {
	if (typeof body.sourceId === "string") {
		const byId = sources.find((source) => source.id === body.sourceId);
		if (byId) return byId;
	}
	if (typeof body.sourceName === "string") {
		const wanted = body.sourceName.toLowerCase();
		const byName = sources.find((source) => source.name.toLowerCase().includes(wanted));
		if (byName) return byName;
	}
	return sources.find((source) => source.sourceType === "screen");
}

let clientWindow: BrowserWindow | null = null;

async function getClientWindow(): Promise<BrowserWindow> {
	if (clientWindow && !clientWindow.isDestroyed()) {
		return clientWindow;
	}

	const electronDir = path.dirname(fileURLToPath(import.meta.url));
	clientWindow = new BrowserWindow({
		show: false,
		webPreferences: {
			preload: path.join(electronDir, "preload.mjs"),
			nodeIntegration: false,
			contextIsolation: true,
			webSecurity: false,
		},
	});
	await clientWindow.loadURL("data:text/html,<html><body></body></html>");
	return clientWindow;
}

async function invokeClient<T>(expression: string): Promise<T> {
	const win = await getClientWindow();
	return (await win.webContents.executeJavaScript(`window.electronAPI.${expression}`)) as T;
}

async function listSources(): Promise<AutomationSource[]> {
	const sources = await desktopCapturer.getSources({
		types: ["screen", "window"],
		thumbnailSize: { width: 0, height: 0 },
		fetchWindowIcons: false,
	});
	const ownNames = new Set(
		[
			app.getName(),
			...BrowserWindow.getAllWindows().flatMap((win) => {
				const title = win.getTitle().trim();
				return title ? [title] : [];
			}),
		].filter(Boolean),
	);

	return sources.flatMap((source): AutomationSource[] => {
		const isScreen = source.id.startsWith("screen:");
		if (!isScreen && ownNames.has(source.name)) {
			return [];
		}
		return [
			{
				id: source.id,
				name: source.name,
				sourceType: isScreen ? "screen" : "window",
				display_id: source.display_id,
			},
		];
	});
}

async function handleStart(body: Record<string, unknown>) {
	const sources = await listSources();
	const picked = pickSource(sources, body);
	if (!picked) {
		return { success: false, message: "No recordable source found" };
	}

	const selected: SelectedSource = picked;
	await invokeClient(`selectSource(${JSON.stringify(selected)})`);
	const options: NativeMacRecordingOptions = {
		capturesSystemAudio: Boolean(body.systemAudio),
		capturesMicrophone: Boolean(body.microphone),
	};
	const result = await invokeClient<{ success: boolean; message?: string }>(
		`startNativeScreenRecording(${JSON.stringify(selected)}, ${JSON.stringify(options)})`,
	);
	if (result.success) {
		// Starts cursor telemetry capture, which powers the editor's auto-zoom suggestions.
		await invokeClient("setRecordingState(true)");
	}

	return { ...result, source: { id: picked.id, name: picked.name } };
}

async function handleStop() {
	const result = await invokeClient<{
		success: boolean;
		path?: string;
		message?: string;
	}>("stopNativeScreenRecording()");
	await invokeClient("setRecordingState(false)");
	return result;
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown) {
	res.writeHead(status, { "content-type": "application/json" });
	res.end(JSON.stringify(payload));
}

function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
	return new Promise((resolve, reject) => {
		let raw = "";
		req.on("data", (chunk) => {
			raw += chunk;
		});
		req.on("end", () => {
			if (!raw) {
				resolve({});
				return;
			}
			try {
				resolve(JSON.parse(raw));
			} catch (error) {
				reject(error);
			}
		});
		req.on("error", reject);
	});
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
	try {
		if (req.method === "GET" && req.url === "/health") {
			sendJson(res, 200, { ok: true, app: app.getName() });
			return;
		}
		if (req.method === "GET" && req.url === "/sources") {
			sendJson(res, 200, { success: true, sources: await listSources() });
			return;
		}
		if (req.method === "GET" && req.url === "/recording/status") {
			sendJson(res, 200, {
				success: true,
				recording: windowsNativeCaptureActive,
				targetPath: windowsCaptureTargetPath,
				pendingPath: windowsPendingVideoPath,
			});
			return;
		}
		if (req.method === "POST" && req.url === "/recording/start") {
			const body = await readJsonBody(req);
			sendJson(res, 200, await handleStart(body));
			return;
		}
		if (req.method === "POST" && req.url === "/recording/stop") {
			sendJson(res, 200, await handleStop());
			return;
		}
		sendJson(res, 404, { success: false, message: "Not found" });
	} catch (error) {
		sendJson(res, 500, {
			success: false,
			message: error instanceof Error ? error.message : String(error),
		});
	}
}

export function startAutomationServer(): void {
	const server = http.createServer((req, res) => {
		void handleRequest(req, res);
	});
	server.on("error", (error) => {
		console.warn(`[automation] server error: ${error.message}`);
	});
	server.listen(PORT, "127.0.0.1", () => {
		console.log(
			`[automation] Recordly automation API on http://127.0.0.1:${PORT} (health/sources/recording/start|stop|status)`,
		);
	});
}
