import { afterEach, beforeEach, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({
	refs: [] as { current: unknown }[],
	cursor: 0,
	effects: [] as (() => void)[],
}));
vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	useRef: (value: unknown) => {
		const index = hooks.cursor++;
		hooks.refs[index] ??= { current: value };
		return hooks.refs[index];
	},
	useLayoutEffect: (effect: () => void) => hooks.effects.push(effect),
	useEffect: () => undefined,
	useCallback: (callback: unknown) => callback,
}));
vi.mock("@/components/ui/toast", () => ({
	toast: { error: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
}));
vi.mock("../dashboard/useProjectFolders", () => ({ moveProjectFolderReferences: vi.fn() }));
vi.mock("../cloud/projectShareLinks", () => ({ moveProjectShareLink: vi.fn() }));
import { useProjectSaveActions } from "./useProjectSaveActions";
import { toast } from "@/components/ui/toast";
import { persistEditorHistory, createProjectHistorySnapshot } from "../editorHistoryPersistence";
import { createEditorHistoryStack, recordEditorHistorySnapshot } from "../editorHistory";

type Input = Parameters<typeof useProjectSaveActions>[0];
const source = "/recordings/shared.mp4";
let bridge: {
	saveProjectFile: ReturnType<typeof vi.fn>;
	saveProjectFileNamed: ReturnType<typeof vi.fn>;
	createProjectFile: ReturnType<typeof vi.fn>;
};
const setters = { setCurrentProjectPath: vi.fn(), setLastSavedSnapshot: vi.fn() };
const remount = vi.fn();
afterEach(() => vi.unstubAllGlobals());
function render(
	path = "/projects/A.recordly",
	projectId = "A",
	thumbnail = async () => null as string | null,
	extraProject: Record<string, unknown> = {},
	history?: ReturnType<typeof persistEditorHistory>,
) {
	hooks.cursor = 0;
	hooks.effects = [];
	const actions = useProjectSaveActions({
		project: {
			currentProjectPath: path,
			lastSavedSnapshot: { projectId },
			loading: false,
			...setters,
			...extraProject,
		},
		currentSourcePath: source,
		currentProjectSnapshot: { version: 2, videoPath: source, projectId, editor: {}, history },
		currentPersistedEditorState: {},
		projectDisplayName: projectId,
		hasUnsavedChanges: true,
		captureProjectThumbnail: thumbnail,
		refreshProjectLibrary: async () => undefined,
		remountPreview: remount,
		projectNameInputRef: { current: null },
		projectSaveDialogInputRef: { current: null },
		resolveProjectSaveDialog: vi.fn(),
	} as unknown as Input);
	for (const effect of hooks.effects) effect();
	return actions;
}
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}
const options = { silent: true, captureThumbnail: false, refreshLibraryAfterSave: false };

it("reports a persistent autosave failure once and clears it after recovery", async () => {
	bridge.saveProjectFile.mockResolvedValue({ success: false, message: "Disk full" });
	const actions = render();
	expect(await actions.saveProject(false, options)).toBe(false);
	expect(await actions.saveProject(false, options)).toBe(false);
	expect(toast.error).toHaveBeenCalledOnce();
	expect(toast.error).toHaveBeenCalledWith(expect.any(String), {
		id: "project-save-error",
		description: "Disk full",
	});
	bridge.saveProjectFile.mockResolvedValue({
		success: true,
		path: "/projects/A.recordly",
		projectId: "A",
	});
	expect(await actions.saveProject(false, options)).toBe(true);
	expect(toast.dismiss).toHaveBeenCalledWith("project-save-error");
	bridge.saveProjectFile.mockResolvedValue({ success: false, message: "Disk full" });
	expect(await actions.saveProject(false, options)).toBe(false);
	expect(toast.error).toHaveBeenCalledTimes(2);
});

it.each(["save", "copy"])("retains history in the %s payload and saved baseline", async (mode) => {
	const stack = createEditorHistoryStack();
	recordEditorHistorySnapshot(stack, createProjectHistorySnapshot({}));
	recordEditorHistorySnapshot(stack, {
		...createProjectHistorySnapshot({}),
		selectedClipId: "clip-1",
	});
	const history = persistEditorHistory(stack);
	const result = { success: true, path: "/projects/Saved.recordly", projectId: "A" };
	bridge.saveProjectFile.mockResolvedValue(result);
	bridge.saveProjectFileNamed.mockResolvedValue(result);
	const actions = render(
		undefined,
		undefined,
		undefined,
		{
			projectSaveDialogDraft: "Saved",
			setIsSavingProjectDialog: vi.fn(),
		},
		history,
	);
	if (mode === "save") await actions.saveProject(false, options);
	else await actions.handleProjectSaveDialogSubmit();
	expect(
		(mode === "save" ? bridge.saveProjectFile : bridge.saveProjectFileNamed).mock.calls[0][0]
			.history,
	).toEqual(history);
	expect(setters.setLastSavedSnapshot).toHaveBeenCalledWith(expect.objectContaining({ history }));
});

it("deduplicates thrown autosave failures while keeping an explicit save failure visible", async () => {
	bridge.saveProjectFile.mockRejectedValue(new Error("Disconnected drive"));
	const actions = render();
	await actions.saveProject(false, options);
	await actions.saveProject(false, options);
	expect(toast.error).toHaveBeenCalledOnce();
	await actions.saveProject(false, { ...options, silent: false });
	expect(toast.error).toHaveBeenCalledTimes(2);
});

it("clears an autosave failure after saving a named copy", async () => {
	bridge.saveProjectFile.mockResolvedValue({ success: false, message: "Disk full" });
	bridge.saveProjectFileNamed.mockResolvedValue({
		success: true,
		path: "/projects/Copy.recordly",
		projectId: "copy",
	});
	const actions = render(undefined, undefined, undefined, {
		projectSaveDialogDraft: "Copy",
		setIsSavingProjectDialog: vi.fn(),
	});
	await actions.saveProject(false, options);
	await actions.handleProjectSaveDialogSubmit();
	expect(toast.dismiss).toHaveBeenCalledWith("project-save-error");
});

it.each([
	"result",
	"rejection",
])("ignores a stale save %s without suppressing the current project's error", async (kind) => {
	let finish!: () => void;
	bridge.saveProjectFile.mockReturnValueOnce(
		new Promise((resolve, reject) => {
			finish = () =>
				kind === "result"
					? resolve({ success: false, message: "Disk full" })
					: reject(new Error("Disk full"));
		}),
	);
	const previous = render().saveProject(false, options);
	await vi.waitFor(() => expect(bridge.saveProjectFile).toHaveBeenCalledOnce());
	const current = render("/projects/B.recordly", "B");
	finish();
	expect(await previous).toBe(false);
	expect(toast.error).not.toHaveBeenCalled();
	if (kind === "result")
		bridge.saveProjectFile.mockResolvedValue({ success: false, message: "Disk full" });
	else bridge.saveProjectFile.mockRejectedValue(new Error("Disk full"));
	expect(await current.saveProject(false, options)).toBe(false);
	expect(toast.error).toHaveBeenCalledOnce();
});
beforeEach(() => {
	hooks.refs = [];
	hooks.cursor = 0;
	vi.clearAllMocks();
	bridge = {
		saveProjectFile: vi.fn(),
		saveProjectFileNamed: vi.fn(),
		createProjectFile: vi.fn(),
	};
	vi.stubGlobal("window", { electronAPI: bridge });
});

it("does not overwrite another project sharing the source with a queued old save or restore an old completion", async () => {
	const disk = deferred<{ success: boolean; path: string; projectId: string }>();
	bridge.saveProjectFile.mockReturnValue(disk.promise);
	const a = render();
	const first = a.saveProject(false, options);
	const queued = a.saveProject(false, options);
	await vi.waitFor(() => expect(bridge.saveProjectFile).toHaveBeenCalledOnce());
	render("/projects/B.recordly", "B");
	disk.resolve({ success: true, path: "/projects/A.recordly", projectId: "A" });
	expect(await first).toBe(true);
	expect(await queued).toBe(false);
	expect(bridge.saveProjectFile).toHaveBeenCalledOnce();
	expect(bridge.saveProjectFile.mock.calls[0][2]).toBe("/projects/A.recordly");
	expect(setters.setCurrentProjectPath).not.toHaveBeenCalled();
	expect(setters.setLastSavedSnapshot).not.toHaveBeenCalled();
	expect(remount).not.toHaveBeenCalled();
});

it("does not dispatch a named save after project selection changes during thumbnail preparation", async () => {
	const thumbnail = deferred<string | null>();
	const capture = vi.fn(() => thumbnail.promise);
	const named = render(undefined, undefined, capture, {
		projectNameDraft: "Renamed",
		setIsSavingProjectName: vi.fn(),
		setIsEditingProjectName: vi.fn(),
	});
	const pending = named.handleProjectNameSubmit();
	await vi.waitFor(() => expect(capture).toHaveBeenCalledOnce());
	render("/projects/B.recordly", "B");
	thumbnail.resolve(null);
	await pending;
	expect(bridge.saveProjectFileNamed).not.toHaveBeenCalled();
	expect(setters.setCurrentProjectPath).not.toHaveBeenCalled();
	expect(remount).not.toHaveBeenCalled();
});

it("allows a current save and preserves its snapshot and selected path", async () => {
	bridge.saveProjectFile.mockResolvedValue({
		success: true,
		path: "/projects/A.recordly",
		projectId: "A",
	});
	expect(await render().saveProject(false, options)).toBe(true);
	expect(setters.setCurrentProjectPath).toHaveBeenCalledWith("/projects/A.recordly");
	expect(setters.setLastSavedSnapshot).toHaveBeenCalledWith(
		expect.objectContaining({ projectId: "A", videoPath: source }),
	);
	expect(remount).toHaveBeenCalledOnce();
});

it("invalidates an old save even after switching back to the same project", async () => {
	const disk = deferred<{ success: boolean; path: string; projectId: string }>();
	bridge.saveProjectFile.mockReturnValue(disk.promise);
	const a = render();
	const pending = a.saveProject(false, options);
	await vi.waitFor(() => expect(bridge.saveProjectFile).toHaveBeenCalledOnce());
	render("/projects/B.recordly", "B");
	render();
	disk.resolve({ success: true, path: "/projects/A.recordly", projectId: "A" });
	await pending;
	expect(setters.setCurrentProjectPath).not.toHaveBeenCalled();
	expect(setters.setLastSavedSnapshot).not.toHaveBeenCalled();
});

it("keeps queued saves following the same project's successful rename", async () => {
	bridge.saveProjectFileNamed.mockResolvedValue({
		success: true,
		path: "/projects/Renamed.recordly",
		projectId: "A",
	});
	bridge.saveProjectFile.mockResolvedValue({
		success: true,
		path: "/projects/Renamed.recordly",
		projectId: "A",
	});
	const a = render(undefined, undefined, undefined, {
		projectNameDraft: "Renamed",
		setIsSavingProjectName: vi.fn(),
		setIsEditingProjectName: vi.fn(),
	});
	const rename = a.handleProjectNameSubmit();
	const queued = a.saveProject(false, options);
	await rename;
	expect(await queued).toBe(true);
	expect(bridge.saveProjectFile.mock.calls[0][2]).toBe("/projects/Renamed.recordly");
});

it("does not overwrite a newly saved copy with queued original-project metadata", async () => {
	bridge.saveProjectFileNamed.mockResolvedValue({
		success: true,
		path: "/projects/Copy.recordly",
		projectId: "copy-id",
	});
	const a = render(undefined, undefined, undefined, {
		projectSaveDialogDraft: "Copy",
		setIsSavingProjectDialog: vi.fn(),
	});
	const copy = a.handleProjectSaveDialogSubmit();
	const queued = a.saveProject(false, options);
	await copy;
	expect(await queued).toBe(false);
	expect(bridge.saveProjectFile).not.toHaveBeenCalled();
	expect(setters.setLastSavedSnapshot).toHaveBeenCalledWith(
		expect.objectContaining({ projectId: "copy-id" }),
	);
});
