import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExportBranchContext } from "./exportBranchContext";
import { runGifExport } from "./runGifExport";

const mocks = vi.hoisted(() => ({ exportGif: vi.fn(), saveBlob: vi.fn() }));
vi.mock("@/lib/exporter/gifExporter", () => ({
	GifExporter: class {
		export = mocks.exportGif;
		cancel() {}
	},
}));
vi.mock("./buildExportRenderOptions", () => ({ buildExportRenderOptions: () => ({}) }));
vi.mock("./exportPersistence", () => ({
	saveExportBlob: mocks.saveBlob,
	streamExportBlobToTempFile: vi.fn(),
}));
vi.mock("@/components/ui/toast", () => ({ toast: { info: vi.fn(), error: vi.fn() } }));
vi.mock("@/i18n/runtime", () => ({ translate: (_key: string, fallback: string) => fallback }));

function context() {
	const session = {
		setExportProgress: vi.fn(),
		setExportError: vi.fn(),
		setExportedFilePath: vi.fn(),
		setHasPendingExportSave: vi.fn(),
		exporterRef: { current: null },
		pendingExportSaveRef: { current: null },
	};
	const discard = vi.fn();
	const value = {
		input: {
			projectName: "Walkthrough",
			videoPath: "file:///recording.mp4",
			appearance: {},
			timeline: {},
			exportSession: session,
			smokeExportConfig: { enabled: false },
		},
		settings: {
			format: "gif",
			gifConfig: { width: 320, height: 180, frameRate: 15, loop: true, sizePreset: "medium" },
		},
		options: { destination: "download" },
		diagnostics: { record: vi.fn(), result: vi.fn() },
		exportWasCancelled: () => false,
		discardCancelledTemp: discard,
	};
	return { value: value as unknown as ExportBranchContext, session, discard };
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.exportGif.mockResolvedValue({ success: true, blob: new Blob(["gif"]) });
});

describe("GIF failure recovery", () => {
	it.each([
		{ fileName: "Walkthrough.gif", tempFilePath: "/tmp/finished.gif" },
		{ fileName: "Walkthrough.gif", arrayBuffer: new ArrayBuffer(3) },
	])("retains a finished GIF after a failed save: %o", async (pendingSave) => {
		const { value, session } = context();
		mocks.saveBlob.mockResolvedValue({
			saveResult: { success: false, message: "Disk full" },
			pendingSave,
		});
		await expect(runGifExport(value)).resolves.toEqual({ exit: false });
		expect(session.pendingExportSaveRef.current).toBe(pendingSave);
		expect(session.setHasPendingExportSave).toHaveBeenCalledWith(true);
		expect(session.setExportError).toHaveBeenCalledWith("Failed to save GIF: Disk full");
		expect(mocks.exportGif).toHaveBeenCalledOnce();
	});

	it("keeps render failures visible without offering a nonexistent saved render", async () => {
		const { value, session } = context();
		mocks.exportGif.mockResolvedValue({ success: false, error: "Decoder unavailable" });
		await runGifExport(value);
		expect(session.setExportError).toHaveBeenCalledWith(
			"GIF export failed: Decoder unavailable",
		);
		expect(session.setHasPendingExportSave).not.toHaveBeenCalled();
		expect(mocks.saveBlob).not.toHaveBeenCalled();
	});

	it("discards a finished GIF if the export is canceled while saving", async () => {
		const { value, session, discard } = context();
		const pendingSave = { fileName: "Walkthrough.gif", tempFilePath: "/tmp/finished.gif" };
		let canceled = false;
		value.exportWasCancelled = () => canceled;
		mocks.saveBlob.mockImplementation(async () => {
			canceled = true;
			return { saveResult: { success: false, message: "Disk full" }, pendingSave };
		});
		await expect(runGifExport(value)).resolves.toEqual({ exit: true });
		expect(discard).toHaveBeenCalledWith(pendingSave);
		expect(session.setHasPendingExportSave).not.toHaveBeenCalled();
	});
});
