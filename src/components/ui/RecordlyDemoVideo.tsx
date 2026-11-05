import { useEffect, useRef, useState } from "react";
import "./RecordlyDemoVideo.css";

const STILL_DURATION_MS = 2500;

/** Shared theme-matched still → silent demo loop for account and Cloud banners. */
export function RecordlyDemoVideo({ className = "" }: { className?: string }) {
	const rootRef = useRef<HTMLSpanElement>(null);
	const videoRef = useRef<HTMLVideoElement>(null);
	const [phase, setPhase] = useState<"loading" | "still" | "video">("loading");

	useEffect(() => {
		const root = rootRef.current;
		const video = videoRef.current;
		if (!root || !video) return;
		const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
		let timer: ReturnType<typeof setTimeout> | undefined;
		let disposed = false;
		let imagesReady = false;
		const clearTimer = () => clearTimeout(timer);
		const startStill = () => {
			clearTimer();
			video.pause();
			video.currentTime = 0;
			if (!imagesReady) return;
			setPhase("still");
			if (reducedMotion.matches || document.hidden || video.error) return;
			timer = setTimeout(() => {
				// Keep the still visible until the browser actually starts the video.
				video.muted = true;
				void video.play().catch(() => {
					// Autoplay or decoding failed; retain the theme-matched still.
				});
			}, STILL_DURATION_MS);
		};
		const onPlaying = () => {
			if (reducedMotion.matches || document.hidden) video.pause();
			else setPhase("video");
		};
		video.addEventListener("playing", onPlaying);
		video.addEventListener("ended", startStill);
		video.addEventListener("error", startStill);
		document.addEventListener("visibilitychange", startStill);
		reducedMotion.addEventListener("change", startStill);
		// Count the 2.5 seconds after the images are ready to display.
		void Promise.all(
			Array.from(root.querySelectorAll("img")).map((image) =>
				image.decode().catch(() => {
					// A missing still must not prevent the video from being playable.
				}),
			),
		).then(() => {
			if (disposed) return;
			imagesReady = true;
			startStill();
		});
		return () => {
			disposed = true;
			clearTimer();
			video.removeEventListener("playing", onPlaying);
			video.removeEventListener("ended", startStill);
			video.removeEventListener("error", startStill);
			document.removeEventListener("visibilitychange", startStill);
			reducedMotion.removeEventListener("change", startStill);
			video.pause();
		};
	}, []);

	return (
		<span
			ref={rootRef}
			data-recordly-demo
			data-banner-phase={phase}
			aria-hidden="true"
			className={`recordly-banner-preview size-full ${className}`}
		>
			<span className="recordly-banner-stage">
				<span className="recordly-banner-still">
					<img
						src={`${import.meta.env.BASE_URL}auth/recordly-banner-light.png`}
						className="recordly-banner-light"
						alt=""
					/>
					<img
						src={`${import.meta.env.BASE_URL}auth/recordly-banner-dark.png`}
						className="recordly-banner-dark"
						alt=""
					/>
				</span>
				<video
					ref={videoRef}
					src={`${import.meta.env.BASE_URL}auth/recordly-demo.mp4?v=20261105-png-video-loop`}
					muted
					playsInline
					preload="auto"
				/>
			</span>
		</span>
	);
}
