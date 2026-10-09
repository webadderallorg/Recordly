import fs from "node:fs/promises";
import path from "node:path";
import { BrowserWindow } from "electron";

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".mkv", ".m4v"]);

export type RecordingSummary = {
	path: string;
	name: string;
	sizeBytes: number;
	modifiedAt: string;
};

type Validation = { fileSizeBytes: number; durationSeconds: number | null };

export type RemoteRecordingsWiring = {
	/** Focuses the editor window, creating one when the app has none. */
	openEditorWindow: () => { created: boolean } | Promise<{ created: boolean }>;
	/** Settles only once an editor renderer reports a fully loaded recording. */
	waitForEditorState: (opts?: { signal?: AbortSignal }) => Promise<{ videoPath: string }>;
	isExporting: () => boolean;
};

export type RemoteRecordingsDeps = RemoteRecordingsWiring & {
	list: () => Promise<{ path: string; name: string; bytes: number; createdAt: number }[]>;
	setRemoved: (paths: string[], removed: boolean) => Promise<void>;
	exists: (videoPath: string) => Promise<boolean>;
	projectsReferencing: (videoPath: string) => Promise<{
		referencing: { name: string; path: string }[];
		unchecked: { name: string; path: string }[];
	}>;
	validate: (videoPath: string) => Promise<Validation>;
	/** Returns true only when this was the take still being captured, telemetry and all. */
	activate: (videoPath: string) => Promise<{ usedLiveCapture: boolean }>;
	isCapturing: () => Promise<boolean>;
	isUnfinishedCaptureTarget: (videoPath: string) => Promise<boolean>;
	switchTimeoutMs?: number;
	switchPollMs?: number;
	currentRecordingPath: () => Promise<string | null>;
};

const SWITCH_TIMEOUT_MS = 15_000;
const SWITCH_POLL_MS = 250;

type CaptureState = typeof import("../ipc/state");

function liveCaptureTarget(state: CaptureState) {
	const diagnostics = state.lastNativeCaptureDiagnostics;
	return (
		state.nativeCaptureTargetPath ??
		(diagnostics?.backend === "mac-screencapturekit" ? diagnostics.outputPath : null)
	);
}

async function defaultActivate(videoPath: string) {
	const [state, mac, session, manager, utils] = await Promise.all([
		import("../ipc/state"),
		import("../ipc/recording/mac"),
		import("../ipc/project/session"),
		import("../ipc/project/manager"),
		import("../ipc/utils"),
	]);
	// recoverNativeMacCaptureOutput finalizes whatever the capture state points at, with this same
	// precedence, so it may only run when that is this exact file.
	const captureTarget = liveCaptureTarget(state);
	if (
		process.platform === "darwin" &&
		captureTarget &&
		path.resolve(captureTarget) === videoPath
	) {
		const recovered = await mac.recoverNativeMacCaptureOutput();
		if (recovered?.success && recovered.path && path.resolve(recovered.path) === videoPath) {
			return { usedLiveCapture: true };
		}
	}
	const resolved = (await session.resolveRecordingSession(videoPath)) ?? {
		videoPath,
		webcamPath: null,
		timeOffsetMs: 0,
	};
	state.setCurrentVideoPath(videoPath);
	state.setCurrentProjectPath(null);
	utils.approveUserPath(videoPath);
	state.setCurrentRecordingSession(resolved);
	await manager.replaceApprovedSessionLocalReadPaths([resolved.videoPath, resolved.webcamPath]);
	for (const window of BrowserWindow.getAllWindows()) {
		if (!window.isDestroyed()) window.webContents.send("recording-session-changed", resolved);
	}
	return { usedLiveCapture: false };
}

const defaultDeps = (): Omit<RemoteRecordingsDeps, keyof RemoteRecordingsWiring> => ({
	list: async () => (await import("../ipc/recording/library")).listRecordings(),
	setRemoved: async (paths, removed) =>
		(await import("../ipc/recording/library")).setRecordingsRemoved(paths, removed),
	exists: (videoPath) =>
		fs.stat(videoPath).then(
			(stat) => stat.isFile(),
			() => false,
		),
	projectsReferencing: async (videoPath) => {
		const [
			{ listProjectLibraryEntries, normalizeVideoSourcePath },
			{ findProjectsReferencing },
		] = await Promise.all([
			import("../ipc/project/manager"),
			import("../ipc/project/recordingReferences"),
		]);
		const { entries } = await listProjectLibraryEntries();
		return findProjectsReferencing(videoPath, entries, normalizeVideoSourcePath);
	},
	validate: async (videoPath) =>
		(await import("../ipc/recording/diagnostics")).validateRecordedVideo(videoPath),
	activate: defaultActivate,
	isCapturing: async () => {
		const state = await import("../ipc/state");
		return (
			state.nativeScreenRecordingActive ||
			state.windowsNativeCaptureActive ||
			state.ffmpegScreenRecordingActive
		);
	},
	isUnfinishedCaptureTarget: async (videoPath) => {
		if (process.platform !== "darwin") return false;
		const target = liveCaptureTarget(await import("../ipc/state"));
		return Boolean(target) && path.resolve(target as string) === videoPath;
	},
	currentRecordingPath: async () => {
		const state = await import("../ipc/state");
		return state.currentRecordingSession?.videoPath ?? state.currentVideoPath ?? null;
	},
});

function requireAbsolute(filePath: string, what: string) {
	if (typeof filePath !== "string" || !path.isAbsolute(filePath)) {
		throw new Error(`${what} must be an absolute path: ${filePath}`);
	}
	return path.resolve(filePath);
}

export function createRemoteRecordings(
	wiring: RemoteRecordingsWiring,
	overrides: Partial<RemoteRecordingsDeps> = {},
) {
	const deps = { ...defaultDeps(), ...wiring, ...overrides };

	async function recoverRecording(filePath: string) {
		const videoPath = requireAbsolute(filePath, "path");
		if (!VIDEO_EXTENSIONS.has(path.extname(videoPath).toLowerCase())) {
			throw new Error(
				`${path.basename(videoPath)} is not a video Recordly can open (.mp4, .mov, .webm, .mkv or .m4v).`,
			);
		}
		if (await deps.isCapturing()) {
			throw new Error(
				"Recordly is still recording. Call stop_recording first, then recover_recording.",
			);
		}
		if (deps.isExporting()) {
			throw new Error(
				"An export is running. Wait for it to finish before recovering: switching the recording now would pull the video out from under the export.",
			);
		}
		const validateOrExplain = async () => {
			try {
				return await deps.validate(videoPath);
			} catch (error) {
				const message =
					(error as NodeJS.ErrnoException).code === "ENOENT"
						? `There is no file at ${videoPath}.`
						: `Recordly cannot play ${videoPath}: ${(error as Error).message}`;
				throw new Error(message);
			}
		};
		let validation: Validation | null = null;
		let unfinished = false;
		try {
			validation = await validateOrExplain();
		} catch (error) {
			unfinished = await deps.isUnfinishedCaptureTarget(videoPath);
			if (!unfinished) throw error;
		}
		const { usedLiveCapture } = await deps.activate(videoPath);
		if (!validation) {
			try {
				validation = await validateOrExplain();
			} catch (error) {
				throw new Error(
					`${(error as Error).message} This was the capture still in progress when it was interrupted, and finalizing it did not produce a playable file.`,
				);
			}
		}
		return {
			path: videoPath,
			sizeBytes: validation.fileSizeBytes,
			durationSeconds: validation.durationSeconds,
			telemetrySaved: usedLiveCapture,
			note: usedLiveCapture
				? "Recovered the unfinished capture, including its cursor data. An open editor switches to it and drops what it held, unsaved edits included."
				: "It is now the current recording. An open editor switches to it and drops what it held, unsaved edits included, so call project.save first if you need them. It has no new cursor data unless a .cursor.json already sits next to it. If no editor is open, call open_editor; then review_recording or export_video.",
		};
	}

	async function listRecordings(): Promise<{ recordings: RecordingSummary[] }> {
		const entries = await deps.list();
		return {
			recordings: [...entries]
				.sort((a, b) => b.createdAt - a.createdAt)
				.map((entry) => ({
					path: entry.path,
					name: entry.name,
					sizeBytes: entry.bytes,
					modifiedAt: new Date(entry.createdAt).toISOString(),
				})),
		};
	}

	async function newestRecordingPath() {
		const { recordings } = await listRecordings();
		const newest = recordings[0];
		if (!newest) {
			throw new Error(
				"There are no recordings yet, so there is nothing to open. Record one first, or pass open_editor the path to a video.",
			);
		}
		return newest.path;
	}

	async function openEditor({
		path: filePath,
		signal,
	}: {
		path?: string;
		signal?: AbortSignal;
	} = {}) {
		if (filePath !== undefined && typeof filePath !== "string") {
			throw new Error("open_editor: path must be an absolute path to a recording.");
		}
		const current = filePath === undefined ? await deps.currentRecordingPath() : null;
		let recovered: Awaited<ReturnType<typeof recoverRecording>> | null = null;
		let target: string;
		if (current) {
			target = path.resolve(current);
		} else {
			recovered = await recoverRecording(filePath ?? (await newestRecordingPath()));
			target = recovered.path;
		}
		const { created } = await deps.openEditorWindow();
		const opened = {
			path: target,
			windowCreated: created,
			...(recovered ? { recoveredNote: recovered.note } : {}),
		};
		const timeoutMs = deps.switchTimeoutMs ?? SWITCH_TIMEOUT_MS;
		const pollMs = deps.switchPollMs ?? SWITCH_POLL_MS;
		const deadline = Date.now() + timeoutMs;
		let showing: string | null = null;
		let lastError: Error | null = null;
		let resent = recovered !== null;
		for (;;) {
			try {
				showing = path.resolve((await deps.waitForEditorState({ signal })).videoPath);
				lastError = null;
				if (showing === target) break;
			} catch (error) {
				if (signal?.aborted) throw error;
				lastError = error as Error;
			}
			if (!resent) {
				resent = true;
				await deps.activate(target);
			}
			if (Date.now() >= deadline) break;
			await new Promise((resolve) => setTimeout(resolve, pollMs));
		}
		if (showing === target) {
			return {
				...opened,
				editorReady: true,
				showing,
				note: "The editor is open with this recording loaded, so get_editor_state and the edit tools will answer.",
			};
		}
		if (showing) {
			return {
				...opened,
				editorReady: true,
				showing,
				note: `The editor is open and answering, but after ${Math.round(timeoutMs / 1000)} seconds it is still showing ${showing}, not ${target}. Calling open_editor again will not change that. Do not edit: every edit tool would act on the wrong recording. Ask the user to close the editor window and call open_editor again; if it still shows the wrong file, the recording may be unplayable, so try review_recording or recover_recording on it.`,
			};
		}
		return {
			...opened,
			editorReady: false,
			note: `Recordly opened the editor window, but the editor never reported a loaded recording: ${lastError?.message ?? "no answer"} Only the window is guaranteed. Call get_editor_state again once ${path.basename(target)} has finished loading.`,
		};
	}

	return {
		recoverRecording,
		listRecordings,
		openEditor,

		async deleteRecording(filePath: string, { force }: { force?: boolean } = {}) {
			const target = requireAbsolute(filePath, "path");
			if (force !== undefined && typeof force !== "boolean") {
				throw new Error("delete_recording: force must be true or false.");
			}
			const name = path.basename(target);
			if (!(await deps.exists(target))) {
				throw new Error(
					`There is no recording at ${target}. It may already be in Recordly's trash (restore_recording brings it back) or never existed.`,
				);
			}
			const { referencing, unchecked } = await deps.projectsReferencing(target);
			const names = referencing.map((project) => `"${project.name}"`).join(", ");
			const uncheckedNote = unchecked.length
				? ` ${unchecked.length} project file(s) could not be read, so they were not checked: ${unchecked.map((project) => `"${project.name}"`).join(", ")}.`
				: "";
			if (referencing.length && !force) {
				throw new Error(
					`Not deleted: ${referencing.length} saved project(s) use ${name}: ${names}. Their edits would be left pointing at a missing video and could not be opened. Nothing was changed. Pass force: true to delete the recording anyway; the projects are kept and open again once restore_recording brings the video back.${uncheckedNote}`,
				);
			}
			await deps.setRemoved([target], true);
			return {
				path: target,
				removed: true,
				projects: referencing,
				unchecked,
				note: `${
					referencing.length
						? `Moved to Recordly's trash with force. ${referencing.length} project(s) still point at it and show a missing-video error until it is restored: ${names}. They were not deleted. `
						: "Moved to Recordly's trash. No saved project uses it. "
				}restore_recording brings the recording back until the next removal or until Recordly quits; after that it is in the system Trash, and projects that use it stay unopenable until you relink or restore the file from there.${uncheckedNote}`,
			};
		},

		async restoreRecording(filePath: string) {
			const target = requireAbsolute(filePath, "path");
			await deps.setRemoved([target], false);
			const { referencing } = await deps.projectsReferencing(target);
			return {
				path: target,
				removed: false,
				projects: referencing,
				note: referencing.length
					? `Restored. ${referencing.length} saved project(s) use it again and open normally: ${referencing.map((project) => `"${project.name}"`).join(", ")}.`
					: "Restored. No saved project uses it, so any projects that did were deleted separately and are not brought back by this.",
			};
		},
	};
}

export type RemoteRecordings = ReturnType<typeof createRemoteRecordings>;
