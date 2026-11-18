import { useEffect, useRef, useState } from "react";
import { isMac } from "@/utils/platformUtils";
import desktopIconUrl from "../../../icons/icons/png/512x512.png";
import { loadOnboardingLogo, playOnboardingGlass } from "./onboardingGlass";
import "./OnboardingIntroWindow.css";

const macIconUrl = `${import.meta.env.BASE_URL}app-icons/recordlymac-512.png`;

export default function OnboardingIntroWindow() {
	const canvas = useRef<HTMLCanvasElement>(null);
	const [iconUrl, setIconUrl] = useState(desktopIconUrl);
	const [mode, setMode] = useState<"loading" | "glass" | "fallback">("loading");
	const [releasing, setReleasing] = useState(false);

	useEffect(() => {
		const report = window.electronAPI?.reportOnboardingIntro;
		let disposed = false;
		let usingFallback = false;
		let finishing = false;
		let stopGlass: (() => void) | undefined;
		let fallbackHold: ReturnType<typeof setTimeout>;
		let releaseTimer: ReturnType<typeof setTimeout>;
		let preparationDeadline: ReturnType<typeof setTimeout>;
		let unsubscribe: (() => void) | undefined;
		const finish = () => {
			if (disposed || finishing) return;
			finishing = true;
			setReleasing(true);
			releaseTimer = setTimeout(() => report?.("finished"), 180);
		};
		const fallback = () => {
			if (disposed || usingFallback || finishing) return;
			usingFallback = true;
			clearTimeout(preparationDeadline);
			stopGlass?.();
			setMode("fallback");
			fallbackHold = setTimeout(finish, 720);
		};

		const play = () => {
			preparationDeadline = setTimeout(fallback, 3000);
			void isMac()
				.then((mac) => {
					const url = mac ? macIconUrl : desktopIconUrl;
					if (!disposed) setIconUrl(url);
					return loadOnboardingLogo(url);
				})
				.then((logo) => {
					if (disposed || usingFallback || !canvas.current) return;
					stopGlass = playOnboardingGlass(canvas.current, logo, finish, fallback);
					clearTimeout(preparationDeadline);
					setMode("glass");
				})
				.catch((error) => {
					console.warn("[onboarding] Could not start glass reveal", error);
					fallback();
				});
		};
		// Let the effect settle without waiting for a frame in a hidden window.
		queueMicrotask(() => {
			if (disposed) return;
			if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
				report?.("skipped");
				return;
			}
			unsubscribe = window.electronAPI?.onOnboardingIntroShown?.(play);
			report?.("ready");
			if (!unsubscribe) play();
		});

		return () => {
			disposed = true;
			unsubscribe?.();
			clearTimeout(preparationDeadline);
			clearTimeout(fallbackHold);
			clearTimeout(releaseTimer);
			stopGlass?.();
		};
	}, []);

	return (
		<div className="onboarding-intro" aria-hidden="true">
			<div className="onboarding-intro-backdrop" />
			<div className="onboarding-intro-brand" data-releasing={releasing}>
				<div className="onboarding-intro-logo" data-mode={mode}>
					<canvas ref={canvas} />
					{mode === "fallback" && (
						<img alt="" className="onboarding-intro-fallback" src={iconUrl} />
					)}
				</div>
			</div>
		</div>
	);
}
