import { useEffect, useRef, useState } from "react";
import { loadOnboardingLogo, playOnboardingGlass } from "./onboardingGlass";
import "./OnboardingIntroWindow.css";

const iconUrl = `${import.meta.env.BASE_URL}app-icons/recordlymac-512.png`;
const LOGO_HOLD_MS = 400;

export default function OnboardingIntroWindow() {
	const canvas = useRef<HTMLCanvasElement>(null);
	const [mode, setMode] = useState<"loading" | "glass" | "fallback">("loading");
	const [releasing, setReleasing] = useState(false);

	useEffect(() => {
		const report = window.electronAPI?.reportOnboardingIntro;
		let disposed = false;
		let usingFallback = false;
		let finishing = false;
		let stopGlass: (() => void) | undefined;
		let holdTimer: ReturnType<typeof setTimeout>;
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
			clearTimeout(holdTimer);
			stopGlass?.();
			setMode("fallback");
			holdTimer = setTimeout(finish, 720 + LOGO_HOLD_MS);
		};

		const play = () => {
			preparationDeadline = setTimeout(fallback, 3000);
			void loadOnboardingLogo(iconUrl)
				.then((logo) => {
					if (disposed || usingFallback || !canvas.current) return;
					stopGlass = playOnboardingGlass(
						canvas.current,
						logo,
						() => {
							holdTimer = setTimeout(finish, LOGO_HOLD_MS);
						},
						fallback,
					);
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
			unsubscribe = window.electronAPI?.onOnboardingIntroShown?.(play);
			report?.("ready");
			if (!unsubscribe) play();
		});

		return () => {
			disposed = true;
			unsubscribe?.();
			clearTimeout(preparationDeadline);
			clearTimeout(holdTimer);
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
