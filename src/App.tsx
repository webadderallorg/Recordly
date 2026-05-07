import { useEffect, useState } from "react";
import { CountdownOverlay } from "./components/countdown/CountdownOverlay";
import { LaunchWindow } from "./components/launch/LaunchWindow";
import { SourceSelector } from "./components/launch/SourceSelector";
import { UpdateToastWindow } from "./components/launch/UpdateToastWindow";
import { Toaster } from "./components/ui/sonner";
import { ShortcutsConfigDialog } from "./components/video-editor/ShortcutsConfigDialog";
import VideoEditor from "./components/video-editor/VideoEditor";
import { useI18n } from "./contexts/I18nContext";
import { ShortcutsProvider } from "./contexts/ShortcutsContext";
import { loadAllCustomFonts } from "./lib/customFonts";

export default function App() {
	const [windowType, setWindowType] = useState("");
	const { t } = useI18n();

	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		const type = params.get("windowType") || "";
		const isMacOS = /mac/i.test(navigator.platform);
		setWindowType(type);
		document.documentElement.dataset.windowType = type;

		if (
			type === "hud-overlay" ||
			type === "source-selector" ||
			type === "countdown" ||
			(type === "update-toast" && isMacOS)
		) {
			document.body.style.background = "transparent";
			document.documentElement.style.background = "transparent";
			document.getElementById("root")?.style.setProperty("background", "transparent");
		}

		if (type === "hud-overlay") {
			document.documentElement.classList.add("hud-overlay-window");
			document.body.classList.add("hud-overlay-window");
			document.getElementById("root")?.classList.add("hud-overlay-window");
		} else if (type === "update-toast") {
			document.documentElement.style.overflow = "visible";
			document.body.style.overflow = "visible";
			document.getElementById("root")?.style.setProperty("overflow", "visible");
		}

		loadAllCustomFonts().catch((error) => {
			console.error("Failed to load custom fonts:", error);
		});
	}, []);

	useEffect(() => {
		document.title =
			windowType === "editor"
				? t("app.editorTitle", "Recordly Editor")
				: t("app.name", "Recordly");
	}, [windowType, t]);

	switch (windowType) {
		case "hud-overlay":
			return (
				<>
					<LaunchWindow />
					<Toaster className="pointer-events-auto" />
				</>
			);
		case "source-selector":
			return <SourceSelector />;
		case "countdown":
			return <CountdownOverlay />;
		case "update-toast":
			return <UpdateToastWindow />;
		case "editor":
			return (
				<ShortcutsProvider>
					<VideoEditor />
					<ShortcutsConfigDialog />
				</ShortcutsProvider>
			);
		default:
			return (
				<div className="flex h-full w-full items-center justify-center bg-editor-bg text-foreground">
					<div className="flex items-center gap-4 rounded-2xl border border-foreground/10 bg-foreground/5 px-6 py-5 shadow-2xl shadow-black/30 backdrop-blur-xl">
						<img
							src="/app-icons/recordly-128.png"
							alt={t("app.name", "Recordly")}
							className="h-12 w-12 rounded-xl"
						/>
						<div>
							<h1 className="text-xl font-semibold tracking-tight">
								{t("app.name", "Recordly")}
							</h1>
							<p className="text-sm text-foreground/65">
								{t("app.subtitle", "Screen recording and editing")}
							</p>
						</div>
					</div>
				</div>
			);
	}
}
