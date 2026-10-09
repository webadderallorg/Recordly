import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ BrowserWindow: { getAllWindows: () => [] } }));

const ipc = vi.hoisted(() => ({
	state: {
		nativeCaptureTargetPath: null as string | null,
		lastNativeCaptureDiagnostics: null as {
			backend?: string;
			outputPath?: string | null;
		} | null,
		nativeScreenRecordingActive: false,
		windowsNativeCaptureActive: false,
		ffmpegScreenRecordingActive: false,
		setCurrentVideoPath: vi.fn(),
		setCurrentProjectPath: vi.fn(),
		setCurrentRecordingSession: vi.fn(),
	},
	mac: { recoverNativeMacCaptureOutput: vi.fn() },
	session: { resolveRecordingSession: vi.fn() },
	manager: { replaceApprovedSessionLocalReadPaths: vi.fn() },
	utils: { approveUserPath: vi.fn() },
}));
vi.mock("../ipc/state", () => ipc.state);
vi.mock("../ipc/recording/mac", () => ipc.mac);
vi.mock("../ipc/project/session", () => ipc.session);
vi.mock("../ipc/project/manager", () => ipc.manager);
vi.mock("../ipc/utils", () => ipc.utils);

const { createRemoteRecordings } = await import("./remoteRecordings");

function setup(overrides = {}) {
	const wiring = {
		openEditorWindow: vi.fn(() => ({ created: true })),
		waitForEditorState: vi.fn(async () => ({ videoPath: "/r/take.mp4" })),
		isExporting: vi.fn(() => false),
	};
	const deps = {
		list: vi.fn(async () => [
			{ path: "/r/old.mp4", name: "old.mp4", bytes: 10, createdAt: 1000 },
			{ path: "/r/new.mp4", name: "new.mp4", bytes: 20, createdAt: 2000 },
		]),
		setRemoved: vi.fn(async () => undefined),
		exists: vi.fn(async () => true),
		projectsReferencing: vi.fn(async () => ({ referencing: [], unchecked: [] })),
		validate: vi.fn(async () => ({ fileSizeBytes: 5000, durationSeconds: 90 })),
		activate: vi.fn(async () => ({ usedLiveCapture: false })),
		isCapturing: vi.fn(async () => false),
		isUnfinishedCaptureTarget: vi.fn(async () => false),
		switchTimeoutMs: 60,
		switchPollMs: 5,
		currentRecordingPath: vi.fn(async () => null as string | null),
		...overrides,
	};
	return { deps: { ...wiring, ...deps }, recordings: createRemoteRecordings(wiring, deps) };
}

describe("recoverRecording", () => {
	it("validates, then makes a valid file the current recording", async () => {
		const { deps, recordings } = setup();
		const result = await recordings.recoverRecording("/r/take.mp4");
		expect(deps.validate).toHaveBeenCalledWith("/r/take.mp4");
		expect(deps.activate).toHaveBeenCalledWith("/r/take.mp4");
		expect(result).toMatchObject({
			path: "/r/take.mp4",
			durationSeconds: 90,
			telemetrySaved: false,
		});
	});

	it("reports saved telemetry when the live capture was recovered", async () => {
		const { recordings } = setup({ activate: vi.fn(async () => ({ usedLiveCapture: true })) });
		expect((await recordings.recoverRecording("/r/take.mov")).telemetrySaved).toBe(true);
	});

	it("rejects a missing file without activating it", async () => {
		const { deps, recordings } = setup({
			validate: vi.fn(async () => {
				throw Object.assign(new Error("nope"), { code: "ENOENT" });
			}),
		});
		await expect(recordings.recoverRecording("/r/gone.mp4")).rejects.toThrow(/no file at/);
		expect(deps.activate).not.toHaveBeenCalled();
	});

	it("rejects a non-video extension and a file that will not decode", async () => {
		const { deps, recordings } = setup({
			validate: vi.fn(async () => {
				throw new Error("does not contain a readable video stream");
			}),
		});
		await expect(recordings.recoverRecording("/r/notes.txt")).rejects.toThrow(/not a video/);
		await expect(recordings.recoverRecording("/r/bad.mp4")).rejects.toThrow(/cannot play/);
		await expect(recordings.recoverRecording("bad.mp4")).rejects.toThrow(/absolute/);
		expect(deps.activate).not.toHaveBeenCalled();
	});

	it("refuses while a capture is still running", async () => {
		const { deps, recordings } = setup({ isCapturing: vi.fn(async () => true) });
		await expect(recordings.recoverRecording("/r/take.mp4")).rejects.toThrow(/still recording/);
		expect(deps.validate).not.toHaveBeenCalled();
		expect(deps.activate).not.toHaveBeenCalled();
	});

	it("refuses while an export is running, so the export keeps its video", async () => {
		const wiring = {
			openEditorWindow: vi.fn(() => ({ created: false })),
			waitForEditorState: vi.fn(async () => ({ videoPath: "/r/take.mp4" })),
			isExporting: vi.fn(() => true),
		};
		const deps = {
			validate: vi.fn(async () => ({ fileSizeBytes: 1, durationSeconds: 1 })),
			activate: vi.fn(async () => ({ usedLiveCapture: false })),
			isCapturing: vi.fn(async () => false),
		};
		const recordings = createRemoteRecordings(wiring, deps);
		await expect(recordings.recoverRecording("/r/take.mp4")).rejects.toThrow(
			/export is running/,
		);
		expect(deps.activate).not.toHaveBeenCalled();
	});

	it("warns that an open editor drops its unsaved edits", async () => {
		const { recordings } = setup();
		expect((await recordings.recoverRecording("/r/take.mp4")).note).toMatch(
			/unsaved edits included/,
		);
	});
});

describe("recovering an interrupted capture", () => {
	const unplayable = () =>
		vi.fn(async () => {
			throw new Error("Recorded output does not contain a readable video stream");
		});

	it("finalizes the capture that was in progress, then validates it", async () => {
		const validate = vi
			.fn()
			.mockRejectedValueOnce(new Error("moov atom not found"))
			.mockResolvedValueOnce({ fileSizeBytes: 9000, durationSeconds: 12 });
		const { deps, recordings } = setup({
			validate,
			isUnfinishedCaptureTarget: vi.fn(async () => true),
			activate: vi.fn(async () => ({ usedLiveCapture: true })),
		});
		const result = await recordings.recoverRecording("/r/take.mp4");
		expect(deps.activate).toHaveBeenCalledWith("/r/take.mp4");
		expect(result).toMatchObject({ durationSeconds: 12, telemetrySaved: true });
	});

	it("says the file is still unplayable when finalizing did not help", async () => {
		const { recordings } = setup({
			validate: unplayable(),
			isUnfinishedCaptureTarget: vi.fn(async () => true),
		});
		await expect(recordings.recoverRecording("/r/take.mp4")).rejects.toThrow(
			/interrupted, and finalizing it did not produce a playable file/,
		);
	});

	it("does not touch the session for an unplayable file that was not the live capture", async () => {
		const { deps, recordings } = setup({ validate: unplayable() });
		await expect(recordings.recoverRecording("/r/take.mp4")).rejects.toThrow(
			/cannot play \/r\/take\.mp4/,
		);
		expect(deps.activate).not.toHaveBeenCalled();
	});

	it("refuses while a capture is still running", async () => {
		const { deps, recordings } = setup({ isCapturing: vi.fn(async () => true) });
		await expect(recordings.recoverRecording("/r/take.mp4")).rejects.toThrow(/stop_recording/);
		expect(deps.activate).not.toHaveBeenCalled();
	});
});

describe("openEditor", () => {
	it("recovers the newest recording, opens the window and waits for the editor", async () => {
		const { deps, recordings } = setup();
		const result = await recordings.openEditor();
		expect(deps.activate).toHaveBeenCalledWith("/r/new.mp4");
		expect(deps.openEditorWindow).toHaveBeenCalled();
		expect(deps.waitForEditorState).toHaveBeenCalled();
		expect(result).toMatchObject({ path: "/r/new.mp4", windowCreated: true });
	});

	it("keeps the recording the app already has instead of recovering another", async () => {
		const { deps, recordings } = setup({
			currentRecordingPath: vi.fn(async () => "/r/take.mp4"),
			waitForEditorState: vi.fn(async () => ({ videoPath: "/r/take.mp4" })),
		});
		const result = await recordings.openEditor();
		expect(deps.activate).not.toHaveBeenCalled();
		expect(result).toMatchObject({ path: "/r/take.mp4", editorReady: true });
		expect(result.note).toMatch(/get_editor_state/);
	});

	it("loads the path it is given, and reports an existing window as not created", async () => {
		const { deps, recordings } = setup({
			currentRecordingPath: vi.fn(async () => "/r/other.mp4"),
			openEditorWindow: vi.fn(() => ({ created: false })),
		});
		const result = await recordings.openEditor({ path: "/r/take.mp4" });
		expect(deps.activate).toHaveBeenCalledWith("/r/take.mp4");
		expect(result).toMatchObject({
			path: "/r/take.mp4",
			windowCreated: false,
			editorReady: true,
		});
	});

	it("validates the path before opening anything", async () => {
		const { deps, recordings } = setup();
		await expect(recordings.openEditor({ path: "/r/notes.txt" })).rejects.toThrow(
			/not a video/,
		);
		await expect(recordings.openEditor({ path: "take.mp4" })).rejects.toThrow(/absolute/);
		expect(deps.openEditorWindow).not.toHaveBeenCalled();
	});

	it("says there is nothing to open when no recording exists", async () => {
		const { deps, recordings } = setup({ list: vi.fn(async () => []) });
		await expect(recordings.openEditor()).rejects.toThrow(/no recordings yet/);
		expect(deps.openEditorWindow).not.toHaveBeenCalled();
	});

	it("reports the window alone when the editor never finishes loading", async () => {
		const { recordings } = setup({
			waitForEditorState: vi.fn(async () => {
				throw new Error("The editor did not finish loading a recording within 45 s.");
			}),
		});
		const result = await recordings.openEditor();
		expect(result.editorReady).toBe(false);
		expect(result.note).toMatch(/Only the window is guaranteed/);
		expect(result.note).toMatch(/within 45 s/);
	});

	it("waits until the editor shows the requested recording, not just until it answers", async () => {
		const answers = ["/r/old.mp4", "/r/old.mp4", "/r/take.mp4"];
		const waitForEditorState = vi.fn(async () => ({
			videoPath: answers.shift() ?? "/r/take.mp4",
		}));
		const { recordings } = setup({
			currentRecordingPath: vi.fn(async () => "/r/old.mp4"),
			waitForEditorState,
		});
		const result = await recordings.openEditor({ path: "/r/take.mp4" });
		expect(waitForEditorState.mock.calls.length).toBeGreaterThanOrEqual(3);
		expect(result).toMatchObject({
			path: "/r/take.mp4",
			editorReady: true,
			showing: "/r/take.mp4",
		});
		expect(result.note).toMatch(/loaded/);
	});

	it("says the switch did not happen, and not to repeat the call, when the editor never switches", async () => {
		const { recordings } = setup({
			waitForEditorState: vi.fn(async () => ({ videoPath: "/r/other.mp4" })),
		});
		const result = await recordings.openEditor({ path: "/r/take.mp4" });
		expect(result).toMatchObject({ editorReady: true, showing: "/r/other.mp4" });
		expect(result.note).toMatch(/still showing \/r\/other\.mp4, not \/r\/take\.mp4/);
		expect(result.note).toMatch(/will not change that/);
		expect(result.note).not.toMatch(/Call open_editor again/);
	});

	it("re-sends the current recording once when an open but empty editor never picked it up", async () => {
		let ready = false;
		const waitForEditorState = vi.fn(async () => {
			if (!ready) throw new Error("There is no recording loaded in the editor.");
			return { videoPath: "/r/take.mp4" };
		});
		const activate = vi.fn(async () => {
			ready = true;
			return { usedLiveCapture: false };
		});
		const { recordings } = setup({
			currentRecordingPath: vi.fn(async () => "/r/take.mp4"),
			waitForEditorState,
			activate,
		});
		const result = await recordings.openEditor();
		expect(activate).toHaveBeenCalledTimes(1);
		expect(activate).toHaveBeenCalledWith("/r/take.mp4");
		expect(result).toMatchObject({ editorReady: true, showing: "/r/take.mp4" });
	});

	it("is a plain focus the second time around", async () => {
		const { deps, recordings } = setup({
			currentRecordingPath: vi.fn(async () => "/r/take.mp4"),
			openEditorWindow: vi.fn(() => ({ created: false })),
		});
		await recordings.openEditor();
		await recordings.openEditor();
		expect(deps.activate).not.toHaveBeenCalled();
		expect(deps.openEditorWindow).toHaveBeenCalledTimes(2);
	});
});

describe("the default activation", () => {
	const platform = process.platform;
	const recover = () =>
		createRemoteRecordings(
			{
				openEditorWindow: () => ({ created: false }),
				waitForEditorState: async () => ({ videoPath: "/r/take.mp4" }),
				isExporting: () => false,
			},
			{ validate: async () => ({ fileSizeBytes: 5000, durationSeconds: 90 }) },
		).recoverRecording("/r/take.mp4");

	beforeEach(() => {
		Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
		vi.clearAllMocks();
		ipc.state.nativeCaptureTargetPath = null;
		ipc.state.lastNativeCaptureDiagnostics = null;
		ipc.state.nativeScreenRecordingActive = false;
		ipc.session.resolveRecordingSession.mockResolvedValue(null);
		ipc.mac.recoverNativeMacCaptureOutput.mockResolvedValue(null);
		ipc.manager.replaceApprovedSessionLocalReadPaths.mockResolvedValue(undefined);
	});
	afterEach(() =>
		Object.defineProperty(process, "platform", { value: platform, configurable: true }),
	);

	it("saves the live telemetry when the capture held this exact file", async () => {
		ipc.state.nativeCaptureTargetPath = "/r/take.mp4";
		ipc.mac.recoverNativeMacCaptureOutput.mockResolvedValue({
			success: true,
			path: "/r/take.mp4",
		});
		expect((await recover()).telemetrySaved).toBe(true);
		expect(ipc.state.setCurrentRecordingSession).not.toHaveBeenCalled();
	});

	it("leaves the native recovery alone when it holds a different file", async () => {
		ipc.state.nativeCaptureTargetPath = "/r/live.mp4";
		ipc.state.lastNativeCaptureDiagnostics = {
			backend: "mac-screencapturekit",
			outputPath: "/r/take.mp4",
		};
		const result = await recover();
		expect(ipc.mac.recoverNativeMacCaptureOutput).not.toHaveBeenCalled();
		expect(result.telemetrySaved).toBe(false);
		expect(ipc.state.setCurrentVideoPath).toHaveBeenCalledWith("/r/take.mp4");
	});

	it("adopts the file anyway when the recovery wrote another one", async () => {
		ipc.state.nativeCaptureTargetPath = "/r/take.mp4";
		ipc.mac.recoverNativeMacCaptureOutput.mockResolvedValue({
			success: true,
			path: "/r/other.mp4",
		});
		const result = await recover();
		expect(result.telemetrySaved).toBe(false);
		expect(ipc.state.setCurrentVideoPath).toHaveBeenCalledWith("/r/take.mp4");
	});

	it("keeps the current recording when the session cannot be read", async () => {
		ipc.session.resolveRecordingSession.mockRejectedValue(new Error("manifest is unreadable"));
		await expect(recover()).rejects.toThrow(/manifest is unreadable/);
		expect(ipc.state.setCurrentVideoPath).not.toHaveBeenCalled();
		expect(ipc.utils.approveUserPath).not.toHaveBeenCalled();
	});
});

describe("list and delete", () => {
	it("lists newest first with size and ISO date", async () => {
		const { recordings } = setup();
		const { recordings: list } = await recordings.listRecordings();
		expect(list.map((entry) => entry.name)).toEqual(["new.mp4", "old.mp4"]);
		expect(list[0]).toMatchObject({ sizeBytes: 20, modifiedAt: new Date(2000).toISOString() });
	});

	const demo = { name: "Demo", path: "/p/Demo.recordly" };
	const untitled = { name: "Untitled Project 3", path: "/p/Untitled Project 3.recordly" };

	it("delete with no project using it goes through the reversible trash and says so", async () => {
		const { deps, recordings } = setup();
		const result = await recordings.deleteRecording("/r/old.mp4");
		expect(deps.setRemoved).toHaveBeenCalledWith(["/r/old.mp4"], true);
		expect(result.projects).toEqual([]);
		expect(result.note).toMatch(/No saved project uses it/);
		expect(result.note).toMatch(/restore_recording brings the recording back/);
	});

	it("refuses to delete a recording a project uses, names the projects and changes nothing", async () => {
		const { deps, recordings } = setup({
			projectsReferencing: vi.fn(async () => ({
				referencing: [demo, untitled],
				unchecked: [],
			})),
		});
		await expect(recordings.deleteRecording("/r/old.mp4")).rejects.toThrow(
			/2 saved project\(s\) use old\.mp4: "Demo", "Untitled Project 3".*force: true/,
		);
		expect(deps.setRemoved).not.toHaveBeenCalled();
	});

	it("force deletes the recording, keeps the projects and names them in the reply", async () => {
		const { deps, recordings } = setup({
			projectsReferencing: vi.fn(async () => ({ referencing: [demo], unchecked: [] })),
		});
		const result = await recordings.deleteRecording("/r/old.mp4", { force: true });
		expect(deps.setRemoved).toHaveBeenCalledWith(["/r/old.mp4"], true);
		expect(result.projects).toEqual([demo]);
		expect(result.note).toMatch(/"Demo".*not deleted/);
	});

	it("names unreadable project files instead of ignoring them", async () => {
		const bad = { name: "Broken", path: "/p/Broken.recordly" };
		const { recordings } = setup({
			projectsReferencing: vi.fn(async () => ({ referencing: [], unchecked: [bad] })),
		});
		const result = await recordings.deleteRecording("/r/old.mp4");
		expect(result.note).toMatch(/could not be read.*"Broken"/);
	});

	it("rejects a non-boolean force and a recording that is not there, before any change", async () => {
		const { deps, recordings } = setup({ exists: vi.fn(async () => false) });
		await expect(
			recordings.deleteRecording("/r/old.mp4", { force: "yes" as unknown as boolean }),
		).rejects.toThrow(/force must be true or false/);
		await expect(recordings.deleteRecording("/r/old.mp4")).rejects.toThrow(
			/no recording at \/r\/old\.mp4.*already be in Recordly's trash/,
		);
		expect(deps.projectsReferencing).not.toHaveBeenCalled();
		expect(deps.setRemoved).not.toHaveBeenCalled();
	});

	it("restore names the projects that work again, or says none do", async () => {
		const withProject = setup({
			projectsReferencing: vi.fn(async () => ({ referencing: [demo], unchecked: [] })),
		});
		const restored = await withProject.recordings.restoreRecording("/r/old.mp4");
		expect(withProject.deps.setRemoved).toHaveBeenLastCalledWith(["/r/old.mp4"], false);
		expect(restored.note).toMatch(/open normally: "Demo"/);
		const bare = await setup().recordings.restoreRecording("/r/old.mp4");
		expect(bare.note).toMatch(/No saved project uses it.*deleted separately/);
	});
});
