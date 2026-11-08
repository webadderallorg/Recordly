import { ipcMain } from "electron";
import { beforeEach, expect, it, vi } from "vitest";
import {
	currentProjectPath,
	setCurrentProjectPath,
	setCurrentRecordingSession,
	setCurrentVideoPath,
} from "../state";

const mocks = vi.hoisted(() => ({
	getProjectsDir: vi.fn(),
	write: vi.fn(),
	thumbnail: vi.fn(),
	recent: vi.fn(),
	unlink: vi.fn(),
	rm: vi.fn(),
	stat: vi.fn(),
	readFile: vi.fn(),
	create: vi.fn(),
	saveDialog: vi.fn(),
}));
vi.mock("electron", () => ({
	app: { isPackaged: false, getPath: () => "/recordly-user", getAppPath: () => "/recordly" },
	ipcMain: { handle: vi.fn() },
	BrowserWindow: {},
	dialog: { showSaveDialog: mocks.saveDialog },
	shell: {},
}));
vi.mock("../../trustedRenderer", () => ({ isTrustedRenderer: () => true }));
vi.mock("../../nativeI18n", () => ({ nativeT: (key: string) => key }));
vi.mock("../../mediaServer", () => ({ getMediaServerBaseUrl: vi.fn(), buildMediaUrl: vi.fn() }));
vi.mock("node:fs/promises", () => ({
	default: {
		stat: mocks.stat,
		readFile: mocks.readFile,
		realpath: vi.fn(async (value: string) => value),
		unlink: mocks.unlink,
		rm: mocks.rm,
	},
}));
vi.mock("../project/atomicSave", () => ({
	writeProjectFileAtomically: mocks.write,
	getProjectBackupPath: (value: string) => `${value}.backup`,
}));
vi.mock("../project/createUntitledProject", () => ({ createUntitledProject: mocks.create }));
vi.mock("../project/manager", () => ({
	getProjectsDir: mocks.getProjectsDir,
	isTrustedProjectPath: (value: unknown) =>
		typeof value === "string" && value.startsWith("/projects/"),
	isPathInsideDirectory: () => true,
	saveProjectThumbnail: mocks.thumbnail,
	rememberRecentProject: mocks.recent,
	getProjectThumbnailPath: (value: string) => `${value}.png`,
	loadRecentProjectPaths: async () => ["/projects/A.recordly", "/projects/B.recordly"],
	saveRecentProjectPaths: vi.fn(),
}));
import { registerProjectHandlers } from "./project";
let handlers: Map<string, Parameters<typeof ipcMain.handle>[1]>;
const event = {} as Electron.IpcMainInvokeEvent;
const project = { projectId: "A", videoPath: "/video/shared.mp4" };
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((finish) => {
		resolve = finish;
	});
	return { promise, resolve };
}
beforeEach(() => {
	vi.clearAllMocks();
	mocks.stat.mockReset().mockRejectedValue({ code: "ENOENT" });
	mocks.readFile.mockReset();
	mocks.unlink.mockResolvedValue(undefined);
	mocks.rm.mockResolvedValue(undefined);
	mocks.getProjectsDir.mockReset().mockResolvedValue("/projects");
	mocks.write.mockReset().mockResolvedValue(undefined);
	mocks.create.mockReset().mockResolvedValue("/projects/Untitled Project.recordly");
	mocks.saveDialog.mockReset().mockResolvedValue({ filePath: "/projects/Saved.recordly" });
	setCurrentProjectPath("/projects/A.recordly");
	setCurrentVideoPath(project.videoPath);
	registerProjectHandlers();
	handlers = new Map(vi.mocked(ipcMain.handle).mock.calls);
});

it.each([
	"rename",
	"copy",
])("keeps the original named %s source when a new project opens during directory lookup", async (mode) => {
	const directory = deferred<string>();
	mocks.getProjectsDir.mockReturnValueOnce(directory.promise);
	const saving = handlers.get("save-project-file-named")!(event, project, "Saved", null, mode);
	// Both projects use the same recording, so source-video equality cannot distinguish them.
	setCurrentProjectPath("/projects/B.recordly");
	directory.resolve("/projects");
	expect(await saving).toMatchObject({ success: true, path: "/projects/Saved.recordly" });
	expect(currentProjectPath).toBe("/projects/B.recordly");
	expect(mocks.unlink).not.toHaveBeenCalled();
	expect(mocks.unlink).not.toHaveBeenCalledWith("/projects/B.recordly");
});

it.each([
	"existing",
	"dialog",
	"create",
])("does not replace a newly opened project after an in-flight %s save", async (mode) => {
	const directory = deferred<string>();
	mocks.getProjectsDir.mockReturnValueOnce(directory.promise);
	const saving =
		mode === "create"
			? handlers.get("create-project-file")!(event, project)
			: handlers.get("save-project-file")!(
					event,
					project,
					"Saved",
					mode === "existing" ? "/projects/A.recordly" : undefined,
				);
	setCurrentProjectPath("/projects/B.recordly");
	directory.resolve("/projects");
	expect(await saving).toMatchObject({ success: true });
	expect(currentProjectPath).toBe("/projects/B.recordly");
});

it("preserves a reopened original path while an older named save completes", async () => {
	const writing = deferred<void>();
	mocks.write.mockReturnValueOnce(writing.promise);
	const saving = handlers.get("save-project-file-named")!(event, project, "Saved", null, "copy");
	await vi.waitFor(() => expect(mocks.write).toHaveBeenCalled());
	setCurrentProjectPath("/projects/B.recordly");
	setCurrentProjectPath("/projects/A.recordly");
	writing.resolve();
	expect(await saving).toMatchObject({ success: true });
	expect(currentProjectPath).toBe("/projects/A.recordly");
});

it.each([
	"rename",
	"copy",
])("still selects the saved project in an uninterrupted named %s", async (mode) => {
	expect(
		await handlers.get("save-project-file-named")!(event, project, "Saved", null, mode),
	).toMatchObject({ success: true, path: "/projects/Saved.recordly" });
	expect(currentProjectPath).toBe("/projects/Saved.recordly");
	if (mode === "rename")
		expect(mocks.unlink).toHaveBeenCalledExactlyOnceWith("/projects/A.recordly");
	else expect(mocks.unlink).not.toHaveBeenCalled();
});

it("does not authorize overwriting the newly opened project's file as the old save source", async () => {
	const directory = deferred<string>();
	mocks.getProjectsDir.mockReturnValueOnce(directory.promise);
	mocks.stat.mockResolvedValue({});
	mocks.readFile.mockResolvedValue(JSON.stringify({ ...project, projectId: "B" }));
	const saving = handlers.get("save-project-file-named")!(event, project, "B", null, "rename");
	setCurrentProjectPath("/projects/B.recordly");
	directory.resolve("/projects");
	expect(await saving).toMatchObject({ success: false });
	expect(mocks.write).not.toHaveBeenCalled();
	expect(mocks.unlink).not.toHaveBeenCalled();
	expect(currentProjectPath).toBe("/projects/B.recordly");
});

it("does not adopt an old save after loading another project from the same path", async () => {
	const writing = deferred<void>();
	mocks.write.mockReturnValueOnce(writing.promise);
	const saving = handlers.get("save-project-file-named")!(
		event,
		project,
		"Saved",
		null,
		"rename",
	);
	await vi.waitFor(() => expect(mocks.write).toHaveBeenCalled());
	setCurrentRecordingSession({ videoPath: project.videoPath });
	writing.resolve();
	expect(await saving).toMatchObject({ success: true });
	expect(currentProjectPath).toBe("/projects/A.recordly");
	expect(mocks.unlink).not.toHaveBeenCalled();
});

it("invalidates a pending save as soon as the same recording starts loading again", async () => {
	const writing = deferred<void>();
	mocks.write.mockReturnValueOnce(writing.promise);
	const saving = handlers.get("save-project-file-named")!(
		event,
		project,
		"Saved",
		null,
		"rename",
	);
	await vi.waitFor(() => expect(mocks.write).toHaveBeenCalled());
	// A same-video load sets the source before awaiting its recording manifest.
	setCurrentVideoPath(project.videoPath);
	writing.resolve();
	expect(await saving).toMatchObject({ success: true });
	expect(currentProjectPath).toBe("/projects/A.recordly");
	expect(mocks.unlink).not.toHaveBeenCalled();
});
