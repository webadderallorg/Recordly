import React, { useCallback, useLayoutEffect, useRef, useState } from "react";
import { motion, useMotionValue, useScroll, useTransform } from "motion/react";
import DemoVideo from "./DemoVideo";
import editorFrameUrl from "./assets/hero-editor-current.png";
import "./HeroVideo.css";

// Preview bounds in the 1470 × 923 capture of the current editor (121% UI scale).
// The demo timeline was reconstructed from the surviving hero recording.
// Overlap by one CSS pixel to cover image filtering at fractional display scales.
const CANVAS = {
	left: "calc(41.118197% - 1px)", top: "calc(15.728264% - 1px)",
	width: "calc(50.029762% + 2px)", height: "calc(50.710997% + 2px)",
};
const INTRO_HOLD_SECONDS = 1.3;

export default function HeroVideo() {
	const trackRef = useRef(null);
	const stageRef = useRef(null);
	const [stageHeight, setStageHeight] = useState(0);
	const playbackProgress = useMotionValue(0);
	const playbackTime = useMotionValue(0);
	const syncPlayback = useCallback((currentTime, duration) => {
		// The encoded first-frame hold is outside the editor's recording timeline.
		const time = Number.isFinite(currentTime) ? Math.max(0, currentTime - INTRO_HOLD_SECONDS) : 0;
		const recordingDuration = duration - INTRO_HOLD_SECONDS;
		playbackProgress.set(Number.isFinite(recordingDuration) && recordingDuration > 0 ? Math.max(0, Math.min(1, time / recordingDuration)) : 0);
		playbackTime.set(time);
	}, [playbackProgress, playbackTime]);
	// Clip bounds measured in the same capture; the one-pixel cursor is centered.
	const playheadLeft = useTransform(playbackProgress, [0, 1], ["2.304422%", "97.694515%"]);
	const playbackLabel = useTransform(playbackTime, (time) => `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, "0")}`);
	useLayoutEffect(() => {
		const stage = stageRef.current;
		const measure = () => {
			const height = stage.getBoundingClientRect().height;
			setStageHeight(height);
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(stage);
		window.addEventListener("resize", measure);
		return () => {
			observer.disconnect();
			window.removeEventListener("resize", measure);
		};
	}, []);
	const { scrollYProgress } = useScroll({
		target: trackRef,
		// Use the video's natural center, before the sticky position holds it there.
		offset: [`${stageHeight / 2}px center`, `${stageHeight / 2}px -0.30`],
	});
	// Complete the shrink over 80% of the viewport, then briefly hold the editor.
	const progress = scrollYProgress;
	const left = useTransform(progress, [0, 1], ["calc(0% - 0px)", CANVAS.left]);
	const top = useTransform(progress, [0, 1], ["calc(0% - 0px)", CANVAS.top]);
	const width = useTransform(progress, [0, 1], ["calc(100% + 0px)", CANVAS.width]);
	const height = useTransform(progress, [0, 1], ["calc(100% + 0px)", CANVAS.height]);
	const borderRadius = useTransform(progress, [0, 1], [6, 0]);
	const boxShadow = useTransform(progress, [0, 1], [
		"0px 16px 45px rgba(0, 0, 0, 0.1333)", "0px 16px 45px rgba(0, 0, 0, 0)",
	]);
	const editorOpacity = useTransform(progress, [0, .65], [0, 1]);

	return (
		<div className="hero-scroll-track" ref={trackRef} style={{
			"--hero-stage-height": `${stageHeight}px`,
			"--hero-canvas-left": CANVAS.left, "--hero-canvas-top": CANVAS.top,
			"--hero-canvas-width": CANVAS.width, "--hero-canvas-height": CANVAS.height,
		}}>
			<div className="hero-demo-sticky">
				<div className="hero-demo-stage" ref={stageRef} role="group" aria-label="Recordly recording in the video editor">
					<motion.div className="hero-editor-frame-layer" style={{ opacity: editorOpacity }}>
						<img className="hero-editor-frame" src={editorFrameUrl}
							alt="Recordly editor with scene settings, video preview and zoom timeline"
							width="2940" height="1846" />
					</motion.div>
					<motion.div className="hero-editor-playhead" aria-hidden="true" style={{ left: playheadLeft, opacity: editorOpacity }} />
					<motion.span className="hero-editor-time" aria-hidden="true" style={{ opacity: editorOpacity }}>{playbackLabel}</motion.span>
					<motion.div className="hero-video-window" style={{ left, top, width, height, borderRadius, boxShadow }}>
						<DemoVideo className="hero-video" src="/assets/recordly-hero-intro-hold-1p3.mp4" controls={false}
							onPlaybackFrame={syncPlayback}
							poster="/assets/recordly-hero-intro-poster.jpg" label="Recordly screen recording demo" />
					</motion.div>
				</div>
			</div>
		</div>
	);
}
