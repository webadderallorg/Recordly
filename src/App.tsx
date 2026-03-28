import { Gift } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
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

const UPDATE_TOAST_ID = "recordly-update-ready";

function formatDelayHours(delayMs: number) {
	const hours = Math.max(1, Math.round(delayMs / (60 * 60 * 1000)));
	return `${hours}h`;
}

export default function App() {
	const [windowType, setWindowType] = useState("");
	const { locale, t } = useI18n();

	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		const type = params.get("windowType") || "";
		setWindowType(type);
		const root = document.getElementById("root");

		if (
			type === "hud-overlay" ||
			type === "source-selector" ||
			type === "countdown" ||
			type === "update-toast"
		) {
			document.body.style.background = "transparent";
			document.documentElement.style.background = "transparent";
			if (root) {
				root.style.setProperty("background", "transparent");
				root.style.setProperty("max-width", "none");
				root.style.setProperty("margin", "0");
				root.style.setProperty("padding", "0");
				root.style.setProperty("width", "100%");
				root.style.setProperty("height", "100%");
			}
		}

		if (type === "hud-overlay" || type === "update-toast") {
			document.documentElement.style.overflow = "visible";
			document.body.style.overflow = "visible";
			root?.style.setProperty("overflow", "visible");
		}

		loadAllCustomFonts().catch((error) => {
			console.error("Failed to load custom fonts:", error);
		});
	}, []);

	useEffect(() => {
		document.title =
			windowType === "editor" ? t("app.editorTitle", "Recordly Editor") : t("app.name", "Recordly");
	}, [windowType, locale, t]);

	useEffect(() => {
		if (
			windowType === "countdown" ||
			windowType === "source-selector" ||
			windowType === "update-toast" ||
			typeof window.electronAPI?.onUpdateReadyToast !== "function"
		) {
			return;
		}

		return window.electronAPI.onUpdateReadyToast((payload) => {
			toast.custom(
				(toastInstance) => (
					<div className="pointer-events-auto flex w-[390px] items-start gap-3 rounded-2xl border border-sky-300/20 bg-[#0d1117]/95 p-4 text-white shadow-2xl shadow-black/40 backdrop-blur-xl">
						<div className="mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-sky-400/15 text-sky-300">
							<Gift className="h-5 w-5" />
						</div>
						<div className="min-w-0 flex-1">
							<div className="flex items-center gap-2">
								<p className="text-sm font-semibold tracking-tight">
									{payload.isPreview ? "Update Toast Preview" : `Recordly ${payload.version} is ready`}
								</p>
								{payload.isPreview ? (
									<span className="rounded-full border border-sky-300/20 bg-sky-400/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.18em] text-sky-200">
										Dev
									</span>
								) : null}
							</div>
							<p className="mt-1 text-sm leading-5 text-white/70">{payload.detail}</p>
							<div className="mt-3 flex flex-wrap items-center gap-2">
								<button
									type="button"
									onClick={async () => {
										toast.dismiss(toastInstance);
										if (payload.isPreview) {
											toast.success("Preview only. No real update was installed.");
											return;
										}

										await window.electronAPI.installDownloadedUpdate();
									}}
									className="rounded-xl bg-sky-400 px-3 py-2 text-xs font-semibold text-[#031a2c] transition-colors hover:bg-sky-300"
								>
									Update Now
								</button>
								<button
									type="button"
									onClick={async () => {
										const result = await window.electronAPI.deferDownloadedUpdate(payload.delayMs);
										toast.dismiss(toastInstance);
										if (result.success) {
											toast.success(`Okay, we'll remind you in ${formatDelayHours(payload.delayMs)}.`);
										} else if (result.message) {
											toast.error(result.message);
										}
									}}
									className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-white/85 transition-colors hover:bg-white/10"
								>
									Update Later ({formatDelayHours(payload.delayMs)})
								</button>
							</div>
						</div>
					</div>
				),
				{ id: UPDATE_TOAST_ID, duration: Number.POSITIVE_INFINITY },
			);
		});
	}, [windowType]);

	switch (windowType) {
		case "hud-overlay":
				return (
					<>
						<LaunchWindow />
						<Toaster theme="dark" className="pointer-events-auto" />
					</>
				);
		case "source-selector":
			return <SourceSelector />;
		case "update-toast":
			return <UpdateToastWindow />;
		case "countdown":
			return <CountdownOverlay />;
		case "editor":
			return (
				<ShortcutsProvider>
					<VideoEditor />
					<ShortcutsConfigDialog />
				</ShortcutsProvider>
			);
		default:
			return (
				<div className="flex h-full w-full items-center justify-center bg-slate-950 text-white">
					<div className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/5 px-6 py-5 shadow-2xl shadow-black/30 backdrop-blur-xl">
						<img
							src="/app-icons/recordly-128.png"
							alt={t("app.name", "Recordly")}
							className="h-12 w-12 rounded-xl"
						/>
						<div>
							<h1 className="text-xl font-semibold tracking-tight">{t("app.name", "Recordly")}</h1>
							<p className="text-sm text-white/65">
								{t("app.subtitle", "Screen recording and editing")}
							</p>
						</div>
					</div>
				</div>
			);
	}
}
