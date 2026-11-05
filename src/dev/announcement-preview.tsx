// Install isolated storage before any application module initializes auth or preferences.
import "./preview-bridge";

import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AnnouncementDialog } from "@/components/announcements/AnnouncementDialog";
import { LiveAnnouncementNotifications } from "@/components/announcements/LiveAnnouncementNotifications";
import { BillingProvider } from "@/components/billing/BillingProvider";
import { Toaster, toast } from "@/components/ui/toast";
import { Dashboard } from "@/components/video-editor/dashboard/Dashboard";
import VideoEditor from "@/components/video-editor/VideoEditor";
import { I18nProvider } from "@/contexts/I18nContext";
import { ShortcutsProvider } from "@/contexts/ShortcutsContext";
import { ThemeProvider, useTheme } from "@/contexts/ThemeContext";
import { type StudioUpdate, setPreviewUpdate } from "./preview-bridge";
import "@/index.css";
import "./announcement-preview.css";

function Surface({ update }: { update: StudioUpdate }) {
	const { setPreference } = useTheme();
	useEffect(() => setPreference(update.theme), [setPreference, update.theme]);
	const audience = update.surface === "editor" ? "editor" : "all";
	return (
		<>
			{update.surface === "editor" ? (
				<VideoEditor />
			) : (
				<BillingProvider>
					<Dashboard
						announcementConfig={update.dashboardBanner}
						open
						entries={[]}
						error={null}
						onOpenChange={() => undefined}
						onOpenProject={async () => undefined}
						onImportFile={async () => undefined}
						onSignIn={() => undefined}
						onDeleteProjects={async () => []}
						onRenameProject={async (_path, name) => name}
						onShareProject={async () => undefined}
					/>
				</BillingProvider>
			)}
			{update.surface === "dashboard" && <Toaster />}
			<AnnouncementDialog audience={audience} />
			<LiveAnnouncementNotifications audience={audience} />
		</>
	);
}

function Preview() {
	const [draft, setDraft] = useState<{ update: StudioUpdate; revision: number } | null>(null);
	useEffect(() => {
		const host = window.parent === window ? window.opener : window.parent;
		const receive = (event: MessageEvent) => {
			if (event.source !== host || event.origin !== location.origin) return;
			const update = event.data as StudioUpdate;
			if (
				update?.type !== "recordly-studio:update" ||
				(!update.announcement && !update.dashboardBanner) ||
				(update.surface !== "dashboard" && update.surface !== "editor") ||
				(update.theme !== "dark" && update.theme !== "light")
			)
				return;
			toast.dismiss();
			setPreviewUpdate(update);
			setDraft((previous) => ({ update, revision: (previous?.revision ?? 0) + 1 }));
		};
		window.addEventListener("message", receive);
		// A snapshot also boots standalone windows if their ready event races navigation.
		if (window.parent === window && location.hash.startsWith("#draft=")) {
			try {
				receive(
					new MessageEvent("message", {
						source: host,
						origin: location.origin,
						data: JSON.parse(decodeURIComponent(location.hash.slice(7))),
					}),
				);
				history.replaceState(null, "", location.pathname);
			} catch {
				/* A malformed fragment leaves the preview waiting for a valid update. */
			}
		}
		host?.postMessage({ type: "recordly-studio:ready" }, location.origin);
		return () => window.removeEventListener("message", receive);
	}, []);
	if (!draft) return <p className="studio-preview-waiting">Waiting for announcement preview…</p>;
	return (
		<ThemeProvider key={draft.revision}>
			<I18nProvider>
				<ShortcutsProvider>
					<Surface update={draft.update} />
				</ShortcutsProvider>
			</I18nProvider>
		</ThemeProvider>
	);
}

createRoot(document.getElementById("root")!).render(<Preview />);
