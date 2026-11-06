import { afterEach, expect, it, vi } from "vitest";
vi.mock("react", () => ({ useCallback: <T>(value: T) => value }));
vi.mock("@/components/billing/BillingProvider", () => ({ useOptionalBilling: () => null }));
vi.mock("@/components/billing/captionFileAccess", () => ({ canExportCaptionFiles: () => false }));
vi.mock("@/components/ui/toast", () => ({ toast: { info: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/feedback/exportDiagnostics", () => ({ recordExportDiagnostic: vi.fn() }));
import { useExportDialogActions } from "./useExportDialogActions";
function setup(finalize: () => Promise<unknown>) {
	const original = { projectId: "original", sourcePath: "/r/original.mp4" };
	const session = {
		pendingExportSaveRef: { current: { tempFilePath: "/tmp/fake.mp4", fileName: "fake.mp4" } },
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
afterEach(() => vi.unstubAllGlobals());
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
