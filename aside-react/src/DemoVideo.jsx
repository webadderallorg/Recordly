import React, { useEffect, useRef } from "react";

export default function DemoVideo({ src, poster, label, className, width = 1920, height = 1198, enabled = true, controls = true, onPlaybackFrame }) {
	const videoRef = useRef(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: a new source needs a fresh playback-frame subscription.
	useEffect(() => {
		if (!onPlaybackFrame) return;
		const video = videoRef.current;
		let frame;
		const sync = () => onPlaybackFrame(video.currentTime, video.duration);
		const stop = () => {
			cancelAnimationFrame(frame);
			sync();
		};
		const tick = () => {
			sync();
			if (!video.paused && !video.ended) frame = requestAnimationFrame(tick);
		};
		const start = () => { cancelAnimationFrame(frame); tick(); };
		const events = { play: start, pause: stop, ended: stop, loadedmetadata: sync, durationchange: sync, seeked: sync };
		for (const [event, handler] of Object.entries(events)) video.addEventListener(event, handler);
		start();
		return () => {
			cancelAnimationFrame(frame);
			for (const [event, handler] of Object.entries(events)) video.removeEventListener(event, handler);
		};
	}, [src, onPlaybackFrame]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-evaluate visibility playback when the video source changes.
	useEffect(() => {
		const video = videoRef.current;
		const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
		let inView = false;
		const updatePlayback = () => {
			if (!enabled || !inView || document.hidden || reducedMotion.matches) video.pause();
			else video.play().catch(() => {
				// Autoplay may be blocked; the video controls still allow manual playback.
			});
		};
		const observer = new IntersectionObserver(([entry]) => {
			inView = entry.isIntersecting && entry.intersectionRatio >= .1;
			updatePlayback();
		}, { threshold: .1 });
		observer.observe(video);
		reducedMotion.addEventListener("change", updatePlayback);
		document.addEventListener("visibilitychange", updatePlayback);
		return () => {
			observer.disconnect();
			reducedMotion.removeEventListener("change", updatePlayback);
			document.removeEventListener("visibilitychange", updatePlayback);
		};
	}, [src, enabled]);
	return <video ref={videoRef} src={src} poster={poster} className={className}
		aria-label={label} width={width} height={height} muted loop playsInline controls={controls} preload="none">
		<a href={src}>Watch {label}</a>
	</video>;
}
