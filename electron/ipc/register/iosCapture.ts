import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
	app,
	BrowserWindow,
	dialog,
	ipcMain,
	powerSaveBlocker,
	shell,
	systemPreferences,
	type IpcMainEvent,
	type IpcMainInvokeEvent,
	type WebContents,
} from "electron";
import {
	type CommittedIOSRecording,
	type IOSMediaInspection,
	parseIOSCaptureCommand,
} from "../../../src/shared/iosCapture";
import { getPackagedRendererBaseUrl } from "../../rendererServer";
import { getHudOverlayWindow } from "../../windows";
import { ensureIOSDeviceCaptureHelperBinary } from "../paths/binaries";
import { rememberApprovedLocalReadPath } from "../project/manager";
import { IOSCaptureController } from "../recording/ios/controller";
import { isIOSCaptureEnabled } from "../recording/ios/featurePolicy";
import { finalizeIOSRecording, runIOSFFmpeg } from "../recording/ios/finalize";
import { IOSHelperProcess } from "../recording/ios/helperProcess";
import { IOSRecordingHandoff } from "../recording/ios/handoff";
import { getRecordingLease } from "../recording/recordingLease";
import { assertIOSCaptureSender, parseIOSPrepareInput } from "../recording/ios/ipcPolicy";
import { prepareIOSPermissions } from "../recording/ios/permissions";
import type { IOSPreviewFrame } from "../recording/ios/preview";
import { IOSRecoveryRegistry } from "../recording/ios/recovery";
import {
	allocateIOSSessionStorage,
	availableIOSStorageBytes,
	checkIOSStorageCapacity,
	IOS_ARTIFACT_NAMES,
	IOS_SESSION_UUID,
	readIOSJournal,
	resolveIOSArtifact,
	updateIOSJournal,
	validateIOSStorage,
} from "../recording/ios/storage";
import { setCurrentProjectPath, setCurrentRecordingSession, setCurrentVideoPath } from "../state";
import { getRecordingsDir } from "../utils";

let activeController: IOSCaptureController | undefined;
let validateSelectionSender: ((event: IpcMainInvokeEvent) => void) | undefined;
export function assertIOSCaptureClient(event: IpcMainInvokeEvent) {
	if (!validateSelectionSender) throw new Error("UNSUPPORTED_PLATFORM");
	validateSelectionSender(event);
}
export function validateIOSSourceSelection(event: IpcMainInvokeEvent, source: unknown) {
	assertIOSCaptureClient(event);
	if (!activeController || !validateSelectionSender) throw new Error("UNSUPPORTED_PLATFORM");
	const state = activeController.getSnapshot();
	if (state.phase === "unavailable" || !source || typeof source !== "object")
		throw new Error("INVALID_REQUEST");
	const input = source as Record<string, unknown>;
	const found = state.devices.find(
		(device) =>
			device.deviceToken === input.deviceToken &&
			device.id === input.id &&
			device.generation === input.generation,
	);
	if (!found) throw new Error("DEVICE_NOT_FOUND");
	return found;
}
export function getIOSCaptureController() {
	return activeController;
}
export async function shutdownIOSCapture() {
	await activeController?.shutdown();
}
export async function interruptIOSCapture(reason = "system-suspend") {
	const state = activeController?.getSnapshot();
	if (
		state?.sessionId &&
		["starting", "recording", "stopping", "finalising"].includes(state.phase)
	) {
		try {
			await activeController?.stop(state.sessionId, reason);
		} catch {
			/* Retained for recovery. */
		}
	}
}

export function registerIOSCaptureHandlers(input: {
	getMainWindow: () => BrowserWindow | null;
	getSourceSelectorWindow: () => BrowserWindow | null;
	createEditorWindow: () => void;
	onRecordingStateChange?: (recording: boolean, sourceName: string) => void;
}) {
	if (activeController) throw new Error("iOS capture handlers already registered");
	const enabled = isIOSCaptureEnabled(process.platform, app.isPackaged, process.env);
	const root = async () => fs.realpath(await getRecordingsDir());
	const createHelper = async () =>
		new IOSHelperProcess({ binaryPath: await ensureIOSDeviceCaptureHelperBinary() });
	const subscribers = new Map<WebContents, number>();
	const discoveryClients = new Set<WebContents>();
	const previews = new Map<
		WebContents,
		{ pending?: { generation: number; sequence: number }; latest?: IOSPreviewFrame }
	>();
	const watched = new Set<WebContents>();
	let powerId: number | undefined;
	const editorHandoff = new IOSRecordingHandoff(async (recording) => {
		await rememberApprovedLocalReadPath(recording.videoPath);
		setCurrentProjectPath(null);
		setCurrentVideoPath(recording.videoPath);
		setCurrentRecordingSession(recording);
		for (const win of BrowserWindow.getAllWindows()) {
			if (!win.isDestroyed()) win.webContents.send("recording-session-changed", recording);
		}
		input.createEditorWindow();
	});
	const handoff = (recording: CommittedIOSRecording) => editorHandoff.run(recording);
	const inspectMedia = async (filePath: string): Promise<IOSMediaInspection> => {
		const directory = path.dirname(filePath);
		const sessionId = path.basename(directory).slice(4);
		await validateIOSStorage({
			sessionId,
			directory,
			journalPath: path.join(directory, "capture-journal.json"),
		});
		const relativeName = path.basename(filePath);
		await resolveIOSArtifact(
			{ sessionId, directory, journalPath: path.join(directory, "capture-journal.json") },
			relativeName,
		);
		const helper = await createHelper();
		try {
			await helper.request({ command: "hello" });
			const response = await helper.request({
				command: "inspectMedia",
				sessionId,
				payload: { relativeName },
				storage: { sessionRoot: directory, allowedRelativeNames: [relativeName] },
			});
			if (response.event !== "accepted" || !("inspection" in response.payload))
				throw new Error("FINALIZATION_FAILED");
			return response.payload.inspection;
		} finally {
			await helper.shutdown();
		}
	};
	const finalizeDeps = { inspectMedia };
	const recovery = new IOSRecoveryRegistry(finalizeDeps, process.platform === "darwin");
	const controller: IOSCaptureController = new IOSCaptureController({
		enabled,
		createHelper,
		allocate: async (id) => allocateIOSSessionStorage(await root(), id),
		permissions: (options) =>
			prepareIOSPermissions(options, {
				status: (media) => systemPreferences.getMediaAccessStatus(media),
				request: (media) => systemPreferences.askForMediaAccess(media),
			}),
		journal: updateIOSJournal,
		finalize: (storage, nativeResult, signal) =>
			finalizeIOSRecording(
				{ storage, nativeResult },
				{ ...finalizeDeps, runFFmpeg: (args) => runIOSFFmpeg(args, { signal }) },
			),
		discard: async (storage) => {
			await validateIOSStorage(storage);
			await fs.rm(storage.directory, { recursive: true });
		},
		checkSpace: async (storage, elapsedMs) => {
			const sizes = await Promise.all(
				["source-video.mov", "device-audio.mov", "microphone.mov"].map(async (name) => {
					try {
						return (await fs.stat(await resolveIOSArtifact(storage, name))).size;
					} catch (error) {
						if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
						throw error;
					}
				}),
			);
			const options = controller.getSnapshot().options;
			return checkIOSStorageCapacity({
				availableBytes: await availableIOSStorageBytes(storage.directory),
				videoBytes: sizes[0],
				observedBytes: sizes.reduce((a, b) => a + b, 0),
				elapsedMs,
				mixing: !!(options?.deviceAudio || options?.microphoneToken),
			});
		},
		onCommitted: handoff,
		setCapturing: (capturing) => {
			if (capturing && powerId === undefined)
				powerId = powerSaveBlocker.start("prevent-app-suspension");
			if (!capturing && powerId !== undefined) {
				powerSaveBlocker.stop(powerId);
				powerId = undefined;
			}
			input.onRecordingStateChange?.(
				capturing,
				controller.getSnapshot().source?.displayName ?? "iPhone / iPad",
			);
		},
	});
	activeController = controller;
	function assertSender(event: IpcMainInvokeEvent | IpcMainEvent) {
		const win = BrowserWindow.fromWebContents(event.sender);
		const trustedUrls = [pathToFileURL(path.join(app.getAppPath(), "dist", "index.html")).href];
		if (process.env.VITE_DEV_SERVER_URL) trustedUrls.push(process.env.VITE_DEV_SERVER_URL);
		const packagedUrl = getPackagedRendererBaseUrl();
		if (packagedUrl) trustedUrls.push(new URL("/", packagedUrl).href);
		assertIOSCaptureSender({
			knownWindow:
				!!win &&
				[
					input.getMainWindow(),
					input.getSourceSelectorWindow(),
					getHudOverlayWindow(),
				].includes(win),
			mainFrame: event.senderFrame === event.sender.mainFrame,
			url: event.senderFrame?.url ?? "",
			trustedUrls,
		});
		if (!watched.has(event.sender)) {
			watched.add(event.sender);
			const cleanup = (crashed: boolean) => {
				const participated =
					subscribers.has(event.sender) || discoveryClients.has(event.sender);
				subscribers.delete(event.sender);
				discoveryClients.delete(event.sender);
				previews.delete(event.sender);
				watched.delete(event.sender);
				void controller.setPreviewEnabled(previews.size > 0).catch(() => {
					/* Failure is retained by the authoritative controller. */
				});
				if (crashed && participated) void interruptIOSCapture("renderer-loss");
				if (!subscribers.size && !discoveryClients.size) {
					const state = controller.getSnapshot();
					if (state.sessionId && ["ready", "preparing"].includes(state.phase))
						void controller.release(state.sessionId).catch(() => {
							/* Closing retains any media for recovery. */
						});
					else void controller.shutdown();
				}
			};
			event.sender.once("destroyed", () => cleanup(false));
			event.sender.once("render-process-gone", () => cleanup(true));
		}
	}
	function handle(
		channel: string,
		action: (event: IpcMainInvokeEvent, value: unknown) => unknown,
	) {
		ipcMain.handle(`ios-capture:${channel}`, (event, value: unknown) => {
			assertSender(event);
			if (value !== undefined && Buffer.byteLength(JSON.stringify(value)) > 64 * 1024)
				throw new Error("INVALID_REQUEST");
			return action(event, value);
		});
	}
	validateSelectionSender = assertSender;
	function session(value: unknown): string {
		if (typeof value !== "string" || !IOS_SESSION_UUID.test(value))
			throw new Error("INVALID_REQUEST");
		return value;
	}
	function sendPreview(client: WebContents) {
		const preview = previews.get(client);
		if (!preview || preview.pending || !preview.latest || client.isDestroyed()) return;
		const frame = preview.latest;
		preview.latest = undefined;
		preview.pending = { generation: frame.generation, sequence: frame.sequence };
		client.send("ios-capture:preview", frame);
	}
	controller.subscribe((state) => {
		for (const client of subscribers.keys())
			if (!client.isDestroyed()) client.send("ios-capture:state", state);
	});
	controller.onPreview((frame) => {
		for (const [client, preview] of previews) {
			preview.latest = frame;
			sendPreview(client);
		}
	});
	handle("capabilities", () => ({ enabled }));
	handle("snapshot", () => controller.getSnapshot());
	handle("subscribe", (event) => {
		subscribers.set(event.sender, (subscribers.get(event.sender) ?? 0) + 1);
		event.sender.send("ios-capture:state", controller.getSnapshot());
	});
	handle("unsubscribe", (event) => {
		const count = (subscribers.get(event.sender) ?? 1) - 1;
		if (count) subscribers.set(event.sender, count);
		else subscribers.delete(event.sender);
	});
	handle("discover", () => controller.discover());
	handle("prepare", async (_event, value) => {
		const state = await controller.prepare(parseIOSPrepareInput(value));
		await controller.setPreviewEnabled(previews.size > 0);
		return state;
	});
	for (const command of ["start", "stop", "release"] as const)
		handle(command, (_event, value) => {
			const sessionId = session(value);
			parseIOSCaptureCommand({ protocolVersion: 1, requestId: "ipc", command, sessionId });
			return controller[command](sessionId);
		});
	handle("cancel", async (_event, value) => {
		if (!value || typeof value !== "object") throw new Error("INVALID_REQUEST");
		const v = value as Record<string, unknown>;
		if (
			Object.keys(v).some((key) => !["sessionId", "discardAcceptedMedia"].includes(key)) ||
			typeof v.discardAcceptedMedia !== "boolean"
		)
			throw new Error("INVALID_REQUEST");
		const id = session(v.sessionId);
		if (id !== controller.getSnapshot().sessionId) throw new Error("INVALID_REQUEST");
		if (v.discardAcceptedMedia) {
			const { response } = await dialog.showMessageBox({
				type: "warning",
				message: "Discard this recording?",
				buttons: ["Keep recording", "Discard"],
				defaultId: 0,
				cancelId: 0,
			});
			if (response !== 1) return;
			if (id !== controller.getSnapshot().sessionId) throw new Error("INVALID_REQUEST");
		}
		return controller.cancel(id, v.discardAcceptedMedia);
	});
	handle("preview-enabled", async (event, value) => {
		if (typeof value !== "boolean") throw new Error("INVALID_REQUEST");
		if (value) {
			if (!previews.has(event.sender)) previews.set(event.sender, {});
		} else previews.delete(event.sender);
		await controller.setPreviewEnabled(previews.size > 0);
	});
	ipcMain.on("ios-capture:preview-ack", (event, value: unknown) => {
		try {
			assertSender(event);
			if (!value || typeof value !== "object") return;
			const v = value as Record<string, unknown>;
			const preview = previews.get(event.sender);
			if (
				preview &&
				preview.pending?.generation === v.generation &&
				preview.pending?.sequence === v.sequence
			) {
				preview.pending = undefined;
				sendPreview(event.sender);
			}
		} catch {
			/* Untrusted preview acknowledgements cannot affect capture. */
		}
	});
	handle("discovery-active", async (event, value) => {
		if (typeof value !== "boolean") throw new Error("INVALID_REQUEST");
		if (value) discoveryClients.add(event.sender);
		else discoveryClients.delete(event.sender);
		if (!discoveryClients.size && !controller.getSnapshot().sessionId)
			await controller.shutdown();
	});
	handle("recovery-list", async () => {
		const state = controller.getSnapshot();
		const excluded =
			state.sessionId && !canRecoverSession(state.sessionId)
				? new Set([state.sessionId])
				: new Set<string>();
		return recovery.scan(await root(), excluded);
	});
	function canRecoverSession(id: string) {
		const state = controller.getSnapshot();
		return (
			id !== state.sessionId ||
			(["failed", "recoveryAvailable"].includes(state.phase) &&
				getRecordingLease()?.owner !== "ios-device")
		);
	}
	function recoverySession(value: unknown) {
		const id = session(value);
		if (!canRecoverSession(id)) throw new Error("RECORDING_BUSY");
		return id;
	}
	handle("recover", async (_event, value) => {
		if (!value || typeof value !== "object") throw new Error("INVALID_REQUEST");
		const v = value as Record<string, unknown>;
		if (
			Object.keys(v).some((key) => !["sessionId", "mode"].includes(key)) ||
			!["with-audio", "video-only"].includes(String(v.mode))
		)
			throw new Error("INVALID_REQUEST");
		const id = recoverySession(v.sessionId);
		const recording = await recovery.recover({
			sessionId: id,
			mode: v.mode as "with-audio" | "video-only",
		});
		await handoff(recording);
		return recording;
	});
	handle("recovery-folder", async (_event, value) => {
		await shell.openPath(await recovery.resolveDirectory(recoverySession(value)));
	});
	handle("recovery-discard", async (_event, value) => {
		const id = recoverySession(value);
		await recovery.resolveDirectory(id);
		const { response } = await dialog.showMessageBox({
			type: "warning",
			message: "Discard this recording?",
			buttons: ["Keep recording", "Discard"],
			defaultId: 0,
			cancelId: 0,
		});
		if (response === 1) await recovery.discard(recoverySession(id));
	});
	handle("diagnostics", async (_event, value) => {
		const id = recoverySession(value);
		const directory = await recovery.resolveDirectory(id);
		const journal = await readIOSJournal({
			sessionId: id,
			directory,
			journalPath: path.join(directory, "capture-journal.json"),
		});
		const result = await dialog.showSaveDialog({
			title: "Export recording diagnostics",
			defaultPath: "recording-diagnostics.json",
			filters: [{ name: "JSON", extensions: ["json"] }],
		});
		if (!result.canceled && result.filePath)
			await fs.writeFile(
				result.filePath,
				JSON.stringify(
					{
						version: 1,
						appVersion: app.getVersion(),
						platform: process.platform,
						architecture: process.arch,
						state: journal.state,
						mode: journal.mode,
						expectedFiles: IOS_ARTIFACT_NAMES,
					},
					null,
					2,
				),
			);
	});
	return controller;
}
