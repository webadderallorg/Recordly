import { useEffect } from "react";
import { ShortcutsProvider } from "../../contexts/ShortcutsContext";
import { loadAllCustomFonts } from "../../lib/customFonts";
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
