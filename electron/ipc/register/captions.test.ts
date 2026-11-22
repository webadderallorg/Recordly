import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
	generate: vi.fn(),
	remove: vi.fn(),
	pickFile: vi.fn(),
	approveLiteral: vi.fn(),
	approveSelected: vi.fn(),
	setProjectPath: vi.fn(),
}));
vi.mock("electron", () => ({
	ipcMain: {
		handle: (name: string, handler: (...args: unknown[]) => Promise<unknown>) =>
			state.handlers.set(name, handler),
	},
	BrowserWindow: { getAllWindows: () => [] },
	dialog: { showOpenDialog: state.pickFile },
}));
vi.mock("../captions/generate", () => ({ generateAutoCaptionsFromVideo: state.generate }));
vi.mock("../captions/captionModels", () => ({
	deleteCaptionModel: state.remove,
	downloadCaptionModel: vi.fn(),
	getCaptionModelStatus: vi.fn(),
	sendCaptionModelDownloadProgress: vi.fn(),
}));
vi.mock("../captions/parakeetModel", () => ({
	deleteParakeetModel: state.remove,
	downloadParakeetModel: vi.fn(),
	getParakeetModelStatus: vi.fn(),
	sendParakeetModelDownloadProgress: vi.fn(),
}));
vi.mock("../captions/whisper", () => ({
	deleteWhisperSmallModel: state.remove,
	downloadWhisperSmallModel: vi.fn(),
	getWhisperSmallModelStatus: vi.fn(),
	sendWhisperModelDownloadProgress: vi.fn(),
}));
vi.mock("../constants", () => ({
	LEGACY_PROJECT_FILE_EXTENSIONS: [],
	PROJECT_FILE_EXTENSION: "recordly",
}));
vi.mock("../project/manager", () => ({
	hasProjectFileExtension: vi.fn(),
	loadProjectFromPath: vi.fn(),
	rememberApprovedLocalReadPath: state.approveSelected,
}));
vi.mock("../state", () => ({ setCurrentProjectPath: state.setProjectPath }));
vi.mock("../utils", () => ({ approveUserPath: state.approveLiteral, getRecordingsDir: vi.fn() }));
vi.mock("./wallpaperVideo", () => ({ registerWallpaperVideoHandler: vi.fn() }));

import { registerCaptionHandlers } from "./captions";

beforeEach(() => {
	state.handlers.clear();
	state.generate.mockReset();
	state.remove.mockReset();
	state.pickFile.mockReset();
	state.approveLiteral.mockClear();
	state.approveSelected.mockClear();
	state.setProjectPath.mockClear();
	registerCaptionHandlers();
});

it("approves a timeline import without clearing the open project path", async () => {
	state.pickFile.mockResolvedValue({ canceled: false, filePaths: ["/selected.mp4"] });
	const pick = state.handlers.get("open-video-file-picker")!;
	await expect(pick({}, { preserveProjectPath: true })).resolves.toMatchObject({
		success: true,
		kind: "media",
		path: "/selected.mp4",
	});
	expect(state.approveSelected).toHaveBeenCalledExactlyOnceWith("/selected.mp4");
	expect(state.setProjectPath).not.toHaveBeenCalled();

	await expect(pick({})).resolves.toMatchObject({ success: true, kind: "media" });
	expect(state.approveLiteral).toHaveBeenCalledExactlyOnceWith("/selected.mp4");
	expect(state.setProjectPath).toHaveBeenCalledExactlyOnceWith(null);
});

it("blocks generation while another window removes a model, then releases the lock", async () => {
	let finish!: () => void;
	state.remove.mockImplementationOnce(
		() =>
			new Promise<void>((resolve) => {
				finish = resolve;
			}),
	);
	const removing = state.handlers.get("delete-caption-model")!({}, "whisper-base");
	expect(
		await state.handlers.get("generate-auto-captions")!({}, { captionModelId: "whisper-base" }),
	).toMatchObject({ success: false });
	expect(state.generate).not.toHaveBeenCalled();
	finish();
	expect(await removing).toEqual({ success: true });
	state.generate.mockResolvedValue({ cues: [], audioSourceLabel: "recording" });
	expect(
		await state.handlers.get("generate-auto-captions")!({}, { captionModelId: "whisper-base" }),
	).toMatchObject({ success: true });
});

it("blocks model removal during generation and releases the lock after generation failure", async () => {
	let fail!: (reason: Error) => void;
	state.generate.mockImplementationOnce(
		() =>
			new Promise((_resolve, reject) => {
				fail = reject;
			}),
	);
	const generation = state.handlers.get("generate-auto-captions")!(
		{},
		{ captionModelId: "whisper-base" },
	);
	expect(await state.handlers.get("delete-caption-model")!({}, "whisper-base")).toMatchObject({
		success: false,
	});
	expect(state.remove).not.toHaveBeenCalled();
	const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
	try {
		fail(new Error("Transcription stopped"));
		expect(await generation).toMatchObject({ success: false });
	} finally {
		consoleError.mockRestore();
	}
	state.remove.mockResolvedValue(undefined);
	expect(await state.handlers.get("delete-caption-model")!({}, "whisper-base")).toEqual({
		success: true,
	});
});
