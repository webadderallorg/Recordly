import { afterEach, expect, it, vi } from "vitest";
vi.mock("react", () => ({ useCallback: <T>(value: T) => value }));
vi.mock("@/components/billing/BillingProvider", () => ({ useOptionalBilling: () => null }));
vi.mock("@/components/billing/captionFileAccess", () => ({ canExportCaptionFiles: () => false }));
vi.mock("@/components/ui/toast", () => ({
	toast: { info: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock("@/lib/feedback/exportDiagnostics", () => ({ recordExportDiagnostic: vi.fn() }));
import { useExportDialogActions } from "./useExportDialogActions";
import { toast } from "@/components/ui/toast";
function setup(finalize: () => Promise<unknown>, fileName = "fake.mp4") {
	const original = { projectId: "original", sourcePath: "/r/original.mp4" };
	const session = {
		pendingExportSaveRef: { current: { tempFilePath: `/tmp/${fileName}`, fileName } },
		exportIdentityRef: { current: original },
		setHasPendingExportSave: vi.fn(),
		setExportError: vi.fn(),
		setExportedFilePath: vi.fn(),
		setShowExportDropdown: vi.fn(),
	};
	vi.stubGlobal("window", { electronAPI: { finalizeExportedVideo: finalize } });
	const saved = vi.fn();
	const actions = useExportDialogActions({
		session,
		showExportSuccessToast: saved,
	} as unknown as Parameters<typeof useExportDialogActions>[0]);
	return { session, saved, actions, original };
}
afterEach(() => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});
it("reopens active export progress without resetting it", () => {
	const session = {
		isExporting: true,
		setShowExportDropdown: vi.fn(),
		setExportProgress: vi.fn(),
	};
	const actions = useExportDialogActions({
		videoPath: "/recording.mp4",
		session,
	} as unknown as Parameters<typeof useExportDialogActions>[0]);
	actions.handleOpenExportDropdown();
	expect(session.setShowExportDropdown).toHaveBeenCalledWith(true);
	expect(session.setExportProgress).not.toHaveBeenCalled();
});
it.each([
	{ success: false, canceled: true },
	{ success: false, message: "disk full" },
])("does not mark canceled or failed Save Again as exported: %o", async (result) => {
	const { actions, saved } = setup(async () => result);
	await actions.handleRetrySaveExport();
	expect(saved).not.toHaveBeenCalled();
});
it("Save Again keeps the original export identity while its save dialog is pending", async () => {
	let resolve!: (value: unknown) => void;
	const response = new Promise((r) => {
		resolve = r;
	});
	const { actions, session, saved, original } = setup(() => response);
	const pending = actions.handleRetrySaveExport();
	session.exportIdentityRef.current = { projectId: "other", sourcePath: "/r/other.mp4" };
	resolve({ success: true, path: "/saved/export.mp4" });
	await pending;
	expect(saved).toHaveBeenCalledWith("/saved/export.mp4", original);
});

it.each([
	["export.gif", "Failed to save GIF"],
	["export.GIF", "Failed to save GIF"],
	["export.mp4", "Failed to save video"],
])("Save Again reports the saved format for %s", async (fileName, message) => {
	const { actions, session, saved } = setup(
		async () => ({ success: false, message: "disk full" }),
		fileName,
	);
	await actions.handleRetrySaveExport();
	expect(session.setExportError).toHaveBeenCalledWith(`${message}: disk full`);
	expect(session.pendingExportSaveRef.current).not.toBeNull();
	expect(saved).not.toHaveBeenCalled();
});

it.each(
	(["disk", "memory"] as const).flatMap((storage) =>
		[undefined, false, true].map((captionSidecarFailed) => ({ storage, captionSidecarFailed })),
	),
)("Save Again keeps the $storage video successful with caption failure flag $captionSidecarFailed", async ({
	storage,
	captionSidecarFailed,
}) => {
	vi.clearAllMocks();
	const saveResult = {
		success: true,
		path: "/saved/export.mp4",
		captionSidecarFailed,
		message: "EACCES: /private/captions/transcript.vtt",
	};
	const { actions, session, saved, original } = setup(async () => saveResult);
	if (storage === "memory") {
		Object.assign(session.pendingExportSaveRef, {
			current: { fileName: "export.mp4", arrayBuffer: new ArrayBuffer(1) },
		});
		Object.assign(window.electronAPI, { saveExportedVideo: vi.fn(async () => saveResult) });
	}
	await actions.handleRetrySaveExport();
	expect(saved).toHaveBeenCalledWith(saveResult.path, original);
	expect(session.setExportedFilePath).toHaveBeenCalledWith(saveResult.path);
	expect(session.pendingExportSaveRef.current).toBeNull();
	expect(session.setHasPendingExportSave).toHaveBeenCalledWith(false);
	expect(session.setExportError).toHaveBeenCalledWith(null);
	expect(toast.error).not.toHaveBeenCalled();
	if (captionSidecarFailed) {
		expect(toast.warning).toHaveBeenCalledExactlyOnceWith(
			"Video saved, but some caption files could not be saved.",
			{ duration: Infinity },
		);
	} else {
		expect(toast.warning).not.toHaveBeenCalled();
	}
});
