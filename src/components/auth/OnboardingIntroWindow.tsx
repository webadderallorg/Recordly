import { useEffect, useRef, useState } from "react";
import desktopIconUrl from "../../../icons/icons/png/512x512.png";
import { loadOnboardingLogo, playOnboardingGlass } from "./onboardingGlass";
import "./OnboardingIntroWindow.css";

const WORDMARK = "Recordly";
const WORDMARK_SLIDE = "520ms";
const WORDMARK_DISPLAY_MS = 1580;

export default function OnboardingIntroWindow() {
	const canvas = useRef<HTMLCanvasElement>(null);
	const wordmark = useRef<HTMLDivElement>(null);
	const wordmarkBlur = useRef<SVGAnimationElement>(null);
	const [mode, setMode] = useState<"loading" | "glass" | "fallback">("loading");
	const [presentation, setPresentation] = useState<"mark" | "wordmark" | "releasing">("mark");

	useEffect(() => {
		const report = window.electronAPI?.reportOnboardingIntro;
		const wordmarkElement = wordmark.current;
		const startWordmarkBlur = (event: TransitionEvent) => {
			if (event.target === wordmarkElement && event.propertyName === "transform") {
				wordmarkBlur.current?.beginElement();
			}
		};
		wordmarkElement?.addEventListener("transitionstart", startWordmarkBlur);
		let disposed = false;
		let usingFallback = false;
		let wordmarkStarted = false;
		let stopGlass: (() => void) | undefined;
		let next: ReturnType<typeof setTimeout>;
		let preparationDeadline: ReturnType<typeof setTimeout>;
		const finish = () => {
			setPresentation("releasing");
			next = setTimeout(() => report?.("finished"), 180);
		};
		const showWordmark = () => {
			if (disposed || wordmarkStarted) return;
			wordmarkStarted = true;
			setPresentation("wordmark");
			next = setTimeout(finish, WORDMARK_DISPLAY_MS);
		};
		const fallback = () => {
			if (disposed || usingFallback) return;
			usingFallback = true;
			clearTimeout(preparationDeadline);
			stopGlass?.();
			setMode("fallback");
			if (!wordmarkStarted) {
				clearTimeout(next);
				next = setTimeout(showWordmark, 720);
			}
		};

		const startFrame = requestAnimationFrame(() => {
			if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
				report?.("skipped");
				return;
			}
			report?.("ready");
			preparationDeadline = setTimeout(fallback, 1200);
			void loadOnboardingLogo(desktopIconUrl)
				.then((logo) => {
					if (disposed || usingFallback || !canvas.current) return;
					stopGlass = playOnboardingGlass(canvas.current, logo, showWordmark, fallback);
					clearTimeout(preparationDeadline);
					setMode("glass");
				})
				.catch(fallback);
		});

		return () => {
			disposed = true;
			wordmarkElement?.removeEventListener("transitionstart", startWordmarkBlur);
			cancelAnimationFrame(startFrame);
			clearTimeout(preparationDeadline);
			clearTimeout(next);
			stopGlass?.();
		};
	}, []);

	return (
		<div className="onboarding-intro" aria-hidden="true">
			<svg className="absolute" width="0" height="0">
				<filter id="onboarding-intro-motion-blur" x="-25%" width="150%">
					<feGaussianBlur stdDeviation="0 0">
						<animate
							ref={wordmarkBlur}
							attributeName="stdDeviation"
							begin="indefinite"
							dur={WORDMARK_SLIDE}
							keyTimes="0;0.18;0.5;0.82;1"
							values="0 0;0 0;1.25 0;0 0;0 0"
						/>
					</feGaussianBlur>
				</filter>
			</svg>
			<div className="onboarding-intro-backdrop" />
			<div className="onboarding-intro-brand" data-presentation={presentation}>
				<div className="onboarding-intro-logo-track">
					<div className="onboarding-intro-logo" data-mode={mode}>
						<canvas ref={canvas} />
						{mode === "fallback" && (
							<img
								alt=""
								className="onboarding-intro-fallback"
								src={desktopIconUrl}
							/>
						)}
					</div>
				</div>
				<div
					ref={wordmark}
					className="onboarding-intro-wordmark"
					style={{ transitionDuration: WORDMARK_SLIDE }}
				>
					<span>{WORDMARK}</span>
				</div>
			</div>
		</div>
	);
}
