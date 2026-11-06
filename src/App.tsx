import { Card } from "@heroui/react";
import { lazy, Suspense, useEffect, useState } from "react";
import { HomeLoadingSkeleton } from "./components/video-editor/dashboard/HomeLoadingSkeleton";
import { EditorLoadingSkeleton } from "./components/video-editor/layout/EditorLoadingSkeleton";
import { useI18n } from "./contexts/I18nContext";
import { getStartupView } from "./lib/startupView";
import { RecordlyMark } from "./components/ui/RecordlyMark";

const HudWindow = lazy(() => import("./components/launch/HudWindow"));
const SourceSelector = lazy(() =>
	import("./components/launch/SourceSelector").then((module) => ({
		default: module.SourceSelector,
	})),
);
const CountdownOverlay = lazy(() =>
	import("./components/countdown/CountdownOverlay").then((module) => ({
		default: module.CountdownOverlay,
	})),
);
const UpdateToastWindow = lazy(() =>
	import("./components/launch/UpdateToastWindow").then((module) => ({
		default: module.UpdateToastWindow,
	})),
);
const EditorWindow = lazy(() => import("./components/video-editor/EditorWindow"));
const CapturePicker = lazy(() => import("./components/capture-picker/CapturePicker"));
const OnboardingWindow = lazy(() => import("./components/auth/OnboardingWindow"));
const PermissionAccessoryWindow = lazy(() => import("./components/auth/PermissionAccessoryWindow"));

export default function App() {
	const [windowType] = useState(
		() => new URLSearchParams(window.location.search).get("windowType") || "",
	);
	const { t } = useI18n();

	useEffect(() => {
		document.documentElement.dataset.windowType = windowType;
		const syncWindowChrome = (chrome: { trafficLightsVisible: boolean }) => {
			document.documentElement.dataset.nativeTrafficLights = String(chrome.trafficLightsVisible);
		};
		void window.electronAPI?.getWindowChrome?.().then(syncWindowChrome).catch(() => undefined);
		const unsubscribeWindowChrome = window.electronAPI?.onWindowChromeChanged?.(syncWindowChrome);

		if (
			windowType === "hud-overlay" ||
			windowType === "source-selector" ||
			windowType === "countdown" ||
			windowType === "update-toast" ||
			windowType === "permission-accessory" ||
			windowType === "capture-picker"
		) {
			document.body.style.background = "transparent";
			document.documentElement.style.background = "transparent";
			document.getElementById("root")?.style.setProperty("background", "transparent");
		}

		if (windowType === "hud-overlay") {
			document.documentElement.classList.add("hud-overlay-window");
			document.body.classList.add("hud-overlay-window");
			document.getElementById("root")?.classList.add("hud-overlay-window");
			window.electronAPI?.hudOverlaySetIgnoreMouse?.(true);
		} else if (windowType === "update-toast") {
			document.documentElement.style.overflow = "visible";
			document.body.style.overflow = "visible";
			document.getElementById("root")?.style.setProperty("overflow", "visible");
		}
		return () => unsubscribeWindowChrome?.();
	}, [windowType]);

	useEffect(() => {
		document.title =
			windowType === "onboarding"
				? t("onboarding.welcomeLabel", "Welcome to Recordly")
				: windowType === "editor"
					? t("app.editorTitle", "Recordly Editor")
					: t("app.name", "Recordly");
	}, [windowType, t]);

	let content;
	switch (windowType) {
		case "hud-overlay":
			content = <HudWindow />;
			break;
		case "source-selector":
			content = <SourceSelector />;
			break;
		case "countdown":
			content = <CountdownOverlay />;
			break;
		case "update-toast":
			content = <UpdateToastWindow />;
			break;
		case "editor":
			content = <EditorWindow />;
			break;
		case "capture-picker":
			content = <CapturePicker />;
			break;
		case "onboarding":
			content = <OnboardingWindow />;
			break;
		case "permission-accessory":
			content = <PermissionAccessoryWindow />;
			break;
		default:
			content = (
				<div className="flex h-full w-full items-center justify-center bg-editor-bg text-foreground">
					<Card className="flex-row items-center gap-4 px-6 py-5">
						<RecordlyMark className="size-12 text-accent" />
						<div>
							<h1 className="text-xl font-semibold tracking-tight">
								{t("app.name", "Recordly")}
							</h1>
							<p className="text-sm text-foreground/65">
								{t("app.subtitle", "Screen recording and editing")}
							</p>
						</div>
					</Card>
				</div>
			);
	}

	return (
		<Suspense
			fallback={
				windowType === "editor" ? (
					getStartupView() === "home" ? (
						<HomeLoadingSkeleton />
					) : (
						<EditorLoadingSkeleton />
					)
				) : null
			}
		>
			{content}
		</Suspense>
	);
}
