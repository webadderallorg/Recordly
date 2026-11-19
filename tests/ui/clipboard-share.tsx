import { useRecordlyAuth } from "@/components/auth/useRecordlyAuth";
import { createRoot } from "react-dom/client";
import { CloudShareButton } from "@/components/video-editor/cloud/CloudShareButton";
import { Toaster } from "@/components/ui/toast";
import { I18nProvider } from "@/contexts/I18nContext";
import "@/index.css";

const recoverSession = new URLSearchParams(location.search).has("recover-session");
let statusCalls = 0;
const rejectedSession = new URLSearchParams(location.search).has("session-rejected");
const fail = new URLSearchParams(location.search).has("fail");
window.electronAPI = {
	...window.electronAPI,
	cloudBilling: async () => {
		statusCalls++;
		document.documentElement.dataset.statusCalls = String(statusCalls);
		return {
			success: false,
			httpStatus: recoverSession && (statusCalls === 1 || rejectedSession) ? 401 : 404,
		};
	},
	onAuthCallbackUrl: () => () => undefined,
	getPendingAuthCallbackUrl: async () => undefined,
	cloudShareManage: async () =>
		rejectedSession
			? { success: false, error: "Verified sign-in required" }
			: { success: true, videos: [] },
	onCloudShareProgress: () => () => undefined,
	cloudShareUpload: async (input: { title?: string; notes?: string }) => {
		document.documentElement.dataset.uploadMetadata = JSON.stringify({
			title: input.title,
			notes: input.notes ?? null,
		});
		return { success: true, shareUrl: "https://example.test/s/preview" };
	},
	cloudShareCancel: async () => ({ success: true }),
	writeClipboardText: async (text: string) => {
		if (fail) return { success: false };
		document.documentElement.dataset.copiedText = text;
		return { success: true };
	},
} as unknown as typeof window.electronAPI;
Object.defineProperty(navigator, "clipboard", {
	value: {
		writeText: async () => {
			throw new DOMException("Document is not focused", "NotAllowedError");
		},
	},
});
document.execCommand = () => false;

function SessionShare() {
	const auth = useRecordlyAuth();
	return (
		<CloudShareButton
			filePath="fixture.mp4"
			projectTitle="Fixture"
			authToken={auth.accessToken}
			accountId={auth.user?.id}
			inline
			onRequestSignIn={() => {
				document.documentElement.dataset.signInRequested = "true";
			}}
		/>
	);
}

createRoot(document.getElementById("root")!).render(
	<I18nProvider>
		<main className="mx-auto max-w-md p-8">
			{recoverSession ? (
				<SessionShare />
			) : (
				<CloudShareButton
					filePath="fixture.mp4"
					projectTitle="Fixture"
					authToken="fixture"
					accountId="fixture"
					inline
					onRequestSignIn={() => {
						document.documentElement.dataset.signInRequested = "true";
					}}
				/>
			)}
		</main>
		<Toaster />
	</I18nProvider>,
);
