import { randomBytes } from "node:crypto";
import { chmodSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { app, clipboard, ipcMain, screen } from "electron";
import { USER_DATA_PATH } from "../appPaths";
import { getFfmpegBinaryPath } from "../ipc/ffmpeg/binary";
import { setPlannedSceneTitles } from "./agentActivity";
import { createAgentControl } from "./agentControl";
import { agentInput } from "./agentInput";
import { agentPlatform } from "./agentPlatform";
import { waitUntilQuiet } from "./armRecording";
import { restoreDoNotDisturb, setDoNotDisturb } from "./doNotDisturb";
import { createOpenFile } from "./openFile";
import type { RemoteControl } from "./remoteControl";
import { createRemoteEditor, runFfmpegProcess } from "./remoteEditor";
import { createRemoteExport } from "./remoteExport";
import { createRemoteRecordings } from "./remoteRecordings";
import { createRemoteReview } from "./reviewRecording";
import { waitForStillWindow } from "./screenshot";
import { createMcpHttpServer, MCP_PATH } from "./server";
import { createThumbnail } from "./thumbnail";
import { buildRecordlyMcpServer } from "./tools";

const SETTINGS_FILE = path.join(USER_DATA_PATH, "mcp-server.json");
const PORT = 43831;

type StoredSettings = { enabled: boolean; token: string; controlEnabled: boolean };

function readSettings(): StoredSettings {
	try {
		const parsed = JSON.parse(readFileSync(SETTINGS_FILE, "utf-8")) as Partial<StoredSettings>;
		return {
			enabled: parsed.enabled === true,
			token: typeof parsed.token === "string" ? parsed.token : "",
			controlEnabled: parsed.controlEnabled === true,
		};
	} catch {
		return { enabled: false, token: "", controlEnabled: false };
	}
}

const PORT_UNAVAILABLE = new Set(["EACCES", "EADDRNOTAVAIL"]);

function writeSettings(settings: StoredSettings) {
	const contents = JSON.stringify(settings, null, 2);
	const options = { encoding: "utf-8", mode: 0o600 } as const;
	const tempFile = `${SETTINGS_FILE}.${process.pid}.tmp`;
	try {
		writeFileSync(tempFile, contents, options);
		renameSync(tempFile, SETTINGS_FILE);
	} catch {
		writeFileSync(SETTINGS_FILE, contents, options);
		if (process.platform !== "win32") chmodSync(SETTINGS_FILE, 0o600);
	} finally {
		rmSync(tempFile, { force: true });
	}
}

const createToken = () => randomBytes(32).toString("base64url");

export function setupMcpServer({
	isDev,
	remote,
	openEditorWindow,
}: {
	isDev: boolean;
	remote: RemoteControl;
	openEditorWindow: () => { created: boolean };
}) {
	const port = isDev ? PORT + 1 : PORT;
	const url = `http://127.0.0.1:${port}${MCP_PATH}`;
	let settings = readSettings();
	let error: McpServerState["error"] = null;
	let applying = Promise.resolve();
	const editor = createRemoteEditor();
	const remoteExport = createRemoteExport({
		loadScenes: async (signal) =>
			(await editor.requestEditor<{ scenes: unknown }>("get_state", undefined, { signal }))
				.scenes as never,
		loadCardSpans: async (signal) => {
			const state = await editor.requestEditor<{ annotations?: unknown }>(
				"get_state",
				undefined,
				{ signal },
			);
			const { cardSpans } = await import(
				"../../src/components/video-editor/export/editorOps/cardPlate"
			);
			return cardSpans((state.annotations ?? []) as never);
		},
	});
	const recordings = createRemoteRecordings({
		openEditorWindow,
		waitForEditorState: (opts) => editor.getState(opts),
		isExporting: () => {
			const state = remoteExport.getStatus().state;
			return state === "exporting" || state === "waiting-for-editor";
		},
	});
	const agent = createAgentControl(remote);
	const review = createRemoteReview({ remote });
	const thumbnail = createThumbnail({
		requestEditor: editor.requestEditor,
		runFfmpeg: runFfmpegProcess,
		ffmpegBinary: getFfmpegBinaryPath,
	});
	const isControlEnabled = () => settings.enabled && settings.controlEnabled;
	const files = createOpenFile({
		selectFrontWindow: (appName?: string) =>
			isControlEnabled()
				? agent.selectFrontWindow(appName)
				: Promise.reject(new Error("Mouse and keyboard control is off.")),
	});
	let hideCursor = false;
	const capture = {
		// windows.ts registers ipcMain handlers at module scope, so it loads on first use.
		setOverlay: async (options: import("../windows").HudOverlayOptions) =>
			(await import("../windows")).setHudOverlayOptions(options),
		setDoNotDisturb,
		rememberScenes: setPlannedSceneTitles,
		setHideCursor: (hidden: boolean) => {
			hideCursor = hidden;
		},
		getHideCursor: () => hideCursor,
		waitUntilQuiet: (options: { quietMs?: number; timeoutMs?: number; signal?: AbortSignal }) =>
			waitUntilQuiet(
				screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).bounds,
				options,
				{
					waitForStill: waitForStillWindow,
					lastInputAt: agent.lastInputAt,
					now: Date.now,
					sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
				},
			),
	};
	app.on("will-quit", () => {
		restoreDoNotDisturb().catch(() => undefined);
	});
	const server = createMcpHttpServer({
		port,
		getToken: () => settings.token,
		buildServer: () =>
			buildRecordlyMcpServer(remote, remoteExport, app.getVersion(), {
				agent,
				isControlEnabled,
				platform: process.platform,
				support: agentPlatform.support(),
				review,
				editor,
				recordings,
				files,
				capture,
				thumbnail,
			}),
	});

	function save(next: StoredSettings) {
		writeSettings(next);
		settings = next;
	}

	async function applyNow() {
		error = null;
		if (!settings.enabled) {
			await server.close();
			return;
		}
		try {
			await server.start();
		} catch (startError) {
			const code = (startError as NodeJS.ErrnoException).code;
			error =
				code === "EADDRINUSE"
					? "port-in-use"
					: code && PORT_UNAVAILABLE.has(code)
						? "port-unavailable"
						: "start-failed";
			console.warn("[mcp-server] Could not start:", startError);
		}
	}

	function apply() {
		applying = applying.then(applyNow, applyNow);
		return applying;
	}

	function getState(): McpServerState {
		const control = agentPlatform.support();
		return {
			enabled: settings.enabled,
			running: server.isRunning(),
			url,
			error,
			controlEnabled: settings.controlEnabled,
			controlSupported: control.supported,
			controlUnsupportedReason: control.reason,
		};
	}

	if (settings.enabled && !settings.token) {
		try {
			save({ ...settings, token: createToken() });
		} catch (saveError) {
			console.warn("[mcp-server] Could not save a new token:", saveError);
			settings = { ...settings, enabled: false };
		}
	}

	ipcMain.handle("mcp-server:get-state", () => getState());
	ipcMain.handle("mcp-server:set-enabled", async (_, enabled: unknown) => {
		save({ ...settings, enabled: enabled === true, token: settings.token || createToken() });
		await apply();
		return getState();
	});
	ipcMain.handle("mcp-server:set-control-enabled", (_, enabled: unknown) => {
		save({ ...settings, controlEnabled: enabled === true });
		return getState();
	});
	ipcMain.handle("mcp-server:regenerate-token", () => {
		save({ ...settings, token: createToken() });
		return getState();
	});
	ipcMain.handle("mcp-server:copy-setup-command", () => {
		if (!settings.enabled || !settings.token) {
			throw new Error("Turn on AI agent control first.");
		}
		clipboard.writeText(
			`claude mcp add --scope user --transport http recordly ${url} --header "Authorization: Bearer ${settings.token}"`,
		);
	});

	void apply();
	return {
		close: () => {
			agentInput.stop();
			applying = applying.then(() => server.close());
			return applying;
		},
	};
}
