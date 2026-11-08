import { type ComponentProps, useState } from "react";
import { createRoot } from "react-dom/client";
import { EditorExportMenu } from "@/components/video-editor/layout/EditorExportMenu";
import { I18nProvider, useI18n } from "@/contexts/I18nContext";
import "@/index.css";
import { loadEditorPreferences } from "@/components/video-editor/editorPreferences";
import { useExportSettings } from "@/components/video-editor/export/useExportSettings";
import { removeProjectShareLinksByUrl } from "@/components/video-editor/cloud/projectShareLinks";
import { CloudShareButton } from "@/components/video-editor/cloud/CloudShareButton";

const noop = () => undefined;
let begunUploadId: string | undefined;
let finishUpload: (() => void) | undefined;
let finishPreparation: (() => void) | undefined;
const pendingCapacityChecks: (() => void)[] = [];
let capacityChecks = 0;
let reportUpload:
	| ((event: { uploadId: string; uploadedBytes: number; totalBytes: number }) => void)
	| undefined;
window.electronAPI = {
	writeClipboardText: async (text: string) => {
		document.documentElement.dataset.copiedShareUrl = text;
		return { success: true };
	},
	cloudShareBeginExport: async ({ uploadId }: { uploadId: string }) => {
		begunUploadId = uploadId;
		return { success: true };
	},
	cloudShareManage: async ({ token }: { token: string }) => {
		if (new URLSearchParams(location.search).has("controlled-capacity")) {
			document.documentElement.dataset.capacityChecks = String(++capacityChecks);
			await new Promise<void>((resolve) => pendingCapacityChecks.push(resolve));
		}
		return {
			success: true,
			videos:
				token === "fixture" && new URLSearchParams(location.search).has("full")
					? Array(5).fill({ ready: true })
					: [],
		};
	},
	onCloudShareProgress: (callback: typeof reportUpload) => {
		reportUpload = callback;
		return () => {
			reportUpload = undefined;
		};
	},
	discardExportedTemp: async (filePath: string) => {
		document.documentElement.dataset.discardedTemp = filePath;
		return {};
	},
	cloudShareUpload: async ({ uploadId }: { uploadId: string }) => {
		document.documentElement.dataset.uploadStarted = "true";
		document.body.dataset.shareUploadIdPreserved = String(uploadId === begunUploadId);
		await new Promise((resolve) => setTimeout(resolve, 800));
		reportUpload?.({ uploadId, uploadedBytes: 50, totalBytes: 100 });
		if (new URLSearchParams(location.search).has("controlled")) {
			await new Promise<void>((resolve) => {
				finishUpload = resolve;
			});
		} else {
			await new Promise((resolve) => setTimeout(resolve, 12000));
		}
		if (new URLSearchParams(location.search).has("fail"))
			throw new Error("Fixture old-account upload failed");
		return { success: true, shareUrl: "https://example.test/s/preview" };
	},
	cloudShareCancel: async (uploadId: string) => {
		document.documentElement.dataset.canceledUpload = uploadId;
		document.documentElement.dataset.canceledExpectedUpload = String(
			uploadId === begunUploadId,
		);
		return { success: true };
	},
} as unknown as typeof window.electronAPI;
function Preview() {
	const [mounted, setMounted] = useState(true);
	const [open, setOpen] = useState(false);
	const [authToken, setAuthToken] = useState<string | undefined>("fixture");
	const [accountId, setAccountId] = useState<string | undefined>("fixture-account");
	const [percentage, setPercentage] = useState(0);
	const [isExporting, setIsExporting] = useState(false);
	const { t } = useI18n();
	const [preferences] = useState(loadEditorPreferences);
	const exportSettings = useExportSettings(preferences, [], []);
	const props = {
		projectPath: new URLSearchParams(location.search).has("saved")
			? "/fixture.recordly"
			: undefined,
		projectRevision: new URLSearchParams(location.search).has("edited")
			? "revision-2"
			: "revision-1",
		t,
		projectTitle: "Preview",
		authToken,
		accountId,
		shareRequestNonce: 0,
		exportSettings,
		exportSession: {
			showExportDropdown: open,
			setShowExportDropdown: setOpen,
			exportProgress: { percentage },
			isExporting,
			exportError: new URLSearchParams(location.search).has("export-error")
				? "[VIDEO_DECODE_ENCODING_ERROR] sourceTimeSec=0.500"
				: undefined,
		},
		exportDimensions: {
			gifOutputDimensions: { width: 800, height: 450 },
			mp4OutputDimensions: Object.fromEntries(
				["hd", "custom", "medium", "good", "high", "source"].map((quality) => [
					quality,
					{ width: 1920, height: 1080 },
				]),
			),
		},
		exportStatus: {},
		handleOpenExportDropdown: () => setOpen(true),
		handleExportDropdownClose: () => setOpen(false),
		handleCancelExport: () => {
			document.documentElement.dataset.preparationCanceled = "true";
		},
		handleStartExportFromDropdown: noop,
		prepareExportForShare: async () => {
			document.body.dataset.shareArmedBeforeExport = String(Boolean(begunUploadId));
			document.documentElement.dataset.preparationStarted = "true";
			setPercentage(0);
			setIsExporting(true);
			if (new URLSearchParams(location.search).has("controlled-preparation")) {
				await new Promise<void>((resolve) => {
					finishPreparation = resolve;
				});
			}
			await new Promise((resolve) => setTimeout(resolve, 800));
			setPercentage(50);
			await new Promise((resolve) => setTimeout(resolve, 800));
			setPercentage(100);
			setIsExporting(false);
			return "synthetic-preview.mp4";
		},
		onRequestShareSignIn: noop,
	} as unknown as ComponentProps<typeof EditorExportMenu>;
	return (
		<div className="flex justify-end p-12">
			{new URLSearchParams(location.search).has("controlled-capacity") && (
				<button
					type="button"
					onClick={() => pendingCapacityChecks.splice(0).forEach((resolve) => resolve())}
				>
					Fixture finish capacity checks
				</button>
			)}
			{new URLSearchParams(location.search).has("switch") && (
				<div>
					<button
						type="button"
						onClick={() =>
							removeProjectShareLinksByUrl("https://example.test/s/original")
						}
					>
						Fixture delete original share
					</button>
					<button type="button" onClick={() => setMounted(false)}>
						Fixture unmount sharing
					</button>
					<button type="button" onClick={() => setMounted(true)}>
						Fixture mount sharing
					</button>
					<button type="button" onClick={() => finishPreparation?.()}>
						Fixture finish preparation
					</button>
					<button type="button" onClick={() => finishUpload?.()}>
						Fixture finish upload
					</button>
					<button type="button" onClick={() => setAuthToken("refreshed-fixture")}>
						Fixture refresh token
					</button>
					<button
						type="button"
						onClick={() => {
							setAuthToken(undefined);
							setAccountId(undefined);
						}}
					>
						Fixture sign out
					</button>
					<button
						type="button"
						onClick={() => {
							setAuthToken("other");
							setAccountId("other-account");
						}}
					>
						Fixture switch account
					</button>
				</div>
			)}
			{mounted &&
				(new URLSearchParams(location.search).has("stale-prop") ? (
					<CloudShareButton
						inline
						projectTitle="Preview"
						authToken={authToken}
						accountId={accountId}
						existingShareUrl="https://example.test/s/original"
					/>
				) : (
					<EditorExportMenu {...props} />
				))}
		</div>
	);
}
createRoot(document.getElementById("root")!).render(
	<I18nProvider>
		<Preview />
	</I18nProvider>,
);
