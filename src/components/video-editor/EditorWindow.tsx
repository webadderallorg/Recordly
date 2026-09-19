import { useEffect } from "react";
import { ShortcutsProvider } from "../../contexts/ShortcutsContext";
import { loadAllCustomFonts } from "../../lib/customFonts";
import { setFocusModeEnabledRef, setFocusModeInitialized } from "../../lib/focusMode";
import { AnnouncementDialog } from "../announcements/AnnouncementDialog";
import { LiveAnnouncementNotifications } from "../announcements/LiveAnnouncementNotifications";
import { ShortcutsConfigDialog } from "./ShortcutsConfigDialog";
import VideoEditor from "./VideoEditor";

export default function EditorWindow() {
	useEffect(() => {
		loadAllCustomFonts().catch((error) => {
			console.error("Failed to load custom fonts:", error);
		});
	}, []);

	// Sync focus-mode state into the module-level ref so that the toast wrapper
	// suppresses notifications in the editor window too, matching the HUD.
	useEffect(() => {
		let cancelled = false;

		void window.electronAPI?.getFocusModeStatus?.().then((result) => {
			if (!cancelled && result?.success) {
				setFocusModeEnabledRef(result.enabled);
				setFocusModeInitialized();
			}
		});

		const cleanup = window.electronAPI?.onFocusModeChanged?.((result) => {
			if (result.success) {
				setFocusModeEnabledRef(result.enabled);
			}
		});

		return () => {
			cancelled = true;
			cleanup?.();
		};
	}, []);

	return (
		<>
			<ShortcutsProvider>
				<VideoEditor />
				<ShortcutsConfigDialog />
			</ShortcutsProvider>
			<AnnouncementDialog audience="editor" />
			<LiveAnnouncementNotifications audience="editor" />
		</>
	);
}
