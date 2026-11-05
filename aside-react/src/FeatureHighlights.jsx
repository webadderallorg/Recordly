import React, { useCallback, useEffect, useRef, useState } from "react";
import DemoVideo from "./DemoVideo";
import { resolveShowcaseRewind } from "./showcaseScroll";
import "./FeatureHighlights.css";

// The example video stays continuous while the feature text advances independently.
const example = {
	video: "/assets/recordly-hero.mp4?v=20261102-redacted",
	poster: "/assets/recordly-hero-poster.jpg?v=20261102-redacted",
	label: "An example video made with Recordly",
};

const highlights = [
	{
		id: "zoom",
		title: "Automatic zoom",
		description: "Bring every click into focus with automatic zooms that follow the action.",
	},
	{
		id: "cursor",
		title: "Smooth cursors",
		description: "Keep every movement easy to follow with a smooth, polished cursor.",
	},
	{
		id: "background",
		title: "Beautiful backgrounds",
		description: "Make it yours with backgrounds, padding, shadows, and rounded corners.",
	},
];

const FEATURE_DURATION = 6000;
const TIMELINE_DURATION = FEATURE_DURATION * highlights.length;

export default function FeatureHighlights() {
	const sectionRef = useRef(null);
	const stageRef = useRef(null);
	const featuresRef = useRef(null);
	const timelineRef = useRef(0);
	const activeIndexRef = useRef(0);
	const completedRef = useRef(false);
	const fullScrollDistanceRef = useRef(1);
	const rewindUntilRef = useRef(0);
	const rewoundToStartRef = useRef(false);
	const [activeIndex, setActiveIndex] = useState(0);
	const [completed, setCompleted] = useState(false);
	const [visible, setVisible] = useState(false);
	const [documentVisible, setDocumentVisible] = useState(!document.hidden);
	const [reducedMotion, setReducedMotion] = useState(false);

	const releaseSection = useCallback(() => {
		const section = sectionRef.current;
		const stage = stageRef.current;
		const bounds = section.getBoundingClientRect();
		const top = Number.parseFloat(getComputedStyle(stage).top) || 0;
		const padding = Number.parseFloat(getComputedStyle(section).paddingBottom) || 0;
		fullScrollDistanceRef.current = Math.max(1, bounds.height - stage.offsetHeight - padding);
		const consumed = Math.max(0, top - bounds.top);
		// End the sticky range at its current position, preserving the stage's location.
		section.style.height = `${Math.min(bounds.height, consumed + stage.offsetHeight + padding)}px`;
	}, []);

	const updateTimeline = useCallback((time) => {
		const position = Math.max(0, Math.min(TIMELINE_DURATION, time));
		const index = Math.min(highlights.length - 1, Math.floor(position / FEATURE_DURATION));
		timelineRef.current = position;
		// All pill fills derive from this one value, independent of React's text update.
		featuresRef.current?.style.setProperty("--feature-position", String(position / FEATURE_DURATION));
		if (activeIndexRef.current !== index) {
			activeIndexRef.current = index;
			setActiveIndex(index);
		}
		const finished = position === TIMELINE_DURATION;
		if (completedRef.current !== finished) {
			completedRef.current = finished;
			if (finished) releaseSection();
			else sectionRef.current.style.removeProperty("height");
			setCompleted(finished);
		}
	}, [releaseSection]);

	const selectFeature = useCallback((index) => {
		rewoundToStartRef.current = false;
		rewindUntilRef.current = 0;
		updateTimeline(index * FEATURE_DURATION);
	}, [updateTimeline]);

	useEffect(() => {
		const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
		const updateMotion = () => setReducedMotion(motion.matches);
		const updateVisibility = () => setDocumentVisible(!document.hidden);
		const observer = new IntersectionObserver(([entry]) => {
			setVisible(entry.isIntersecting && entry.intersectionRatio >= .25);
		}, { threshold: .25 });
		observer.observe(stageRef.current);
		updateMotion();
		motion.addEventListener("change", updateMotion);
		document.addEventListener("visibilitychange", updateVisibility);
		return () => {
			observer.disconnect();
			motion.removeEventListener("change", updateMotion);
			document.removeEventListener("visibilitychange", updateVisibility);
		};
	}, []);

	useEffect(() => {
		let frame = 0;
		let previousScrollY = window.scrollY;
		let touchY = null;
		const geometry = () => {
			const section = sectionRef.current.getBoundingClientRect();
			const stage = stageRef.current;
			const top = Number.parseFloat(getComputedStyle(stage).top) || 0;
			const padding = Number.parseFloat(getComputedStyle(sectionRef.current).paddingBottom) || 0;
			const distance = Math.max(1, section.height - stage.offsetHeight - padding);
			const progressDistance = completedRef.current ? fullScrollDistanceRef.current : distance;
			return { distance, progressDistance, start: window.scrollY + section.top - top };
		};
		const holdRewind = (deltaY, scrollY = window.scrollY) => {
			const result = resolveShowcaseRewind({ ...geometry(), scrollY, deltaY, progress: timelineRef.current / TIMELINE_DURATION });
			if (!result) return false;
			cancelAnimationFrame(frame);
			frame = 0;
			rewindUntilRef.current = performance.now() + 300;
			updateTimeline(result.progress * TIMELINE_DURATION);
			rewoundToStartRef.current = result.progress === 0;
			window.scrollTo({ top: result.scrollY, behavior: "instant" });
			previousScrollY = window.scrollY;
			return true;
		};
		const updateFromScroll = () => {
			frame = 0;
			const scrollY = window.scrollY;
			if (scrollY < previousScrollY && holdRewind(scrollY - previousScrollY, previousScrollY)) return;
			const { distance, progressDistance, start } = geometry();
			// Count only the part of this scroll that moves through the sticky section.
			const current = Math.max(0, Math.min(distance, scrollY - start));
			const previous = Math.max(0, Math.min(distance, previousScrollY - start));
			previousScrollY = scrollY;
			if (current !== previous) {
				if (current < previous) rewindUntilRef.current = performance.now() + 300;
				else rewoundToStartRef.current = false;
				updateTimeline(timelineRef.current + (current - previous) / progressDistance * TIMELINE_DURATION);
				if (current < previous && timelineRef.current === 0) rewoundToStartRef.current = true;
			}
		};
		const handleIntent = (event, deltaY) => {
			if (event.defaultPrevented || !event.cancelable || deltaY >= 0) return;
			if (frame) {
				cancelAnimationFrame(frame);
				updateFromScroll();
			}
			const { start, distance } = geometry();
			if (window.scrollY >= start && window.scrollY + deltaY < start + distance) {
				rewindUntilRef.current = performance.now() + 300;
				if (timelineRef.current === 0) rewoundToStartRef.current = true;
			}
			if (holdRewind(deltaY)) event.preventDefault();
		};
		const onWheel = (event) => {
			if (event.ctrlKey || event.metaKey) return;
			const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1;
			handleIntent(event, event.deltaY * unit);
		};
		const onKeyDown = (event) => {
			if (event.ctrlKey || event.metaKey || event.altKey || event.target.closest?.("input, textarea, select, [contenteditable='true']")) return;
			if (event.key === "ArrowUp") handleIntent(event, -40);
			else if (event.key === "PageUp") handleIntent(event, -window.innerHeight * .875);
			else if (event.key === "Home") handleIntent(event, -window.scrollY);
			else if (event.key === " " && event.shiftKey && !event.target.closest?.("button, a")) handleIntent(event, -window.innerHeight * .875);
		};
		const onTouchStart = (event) => { touchY = event.touches.length === 1 ? event.touches[0].clientY : null; };
		const onTouchMove = (event) => {
			if (event.touches.length !== 1 || touchY === null) return;
			const nextY = event.touches[0].clientY;
			handleIntent(event, touchY - nextY);
			touchY = nextY;
		};
		const onTouchEnd = () => { touchY = null; };
		const scheduleUpdate = () => {
			if (!frame) frame = requestAnimationFrame(updateFromScroll);
		};
		const resetScrollBaseline = () => {
			cancelAnimationFrame(frame);
			frame = 0;
			if (completedRef.current) {
				sectionRef.current.style.removeProperty("height");
				releaseSection();
			}
			previousScrollY = window.scrollY;
		};
		window.addEventListener("scroll", scheduleUpdate, { passive: true });
		window.addEventListener("resize", resetScrollBaseline);
		window.addEventListener("wheel", onWheel, { passive: false });
		window.addEventListener("keydown", onKeyDown);
		window.addEventListener("touchstart", onTouchStart, { passive: true });
		window.addEventListener("touchmove", onTouchMove, { passive: false });
		window.addEventListener("touchend", onTouchEnd, { passive: true });
		window.addEventListener("touchcancel", onTouchEnd, { passive: true });
		return () => {
			cancelAnimationFrame(frame);
			window.removeEventListener("scroll", scheduleUpdate);
			window.removeEventListener("resize", resetScrollBaseline);
			window.removeEventListener("wheel", onWheel);
			window.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("touchstart", onTouchStart);
			window.removeEventListener("touchmove", onTouchMove);
			window.removeEventListener("touchend", onTouchEnd);
			window.removeEventListener("touchcancel", onTouchEnd);
		};
	}, [updateTimeline, releaseSection]);

	useEffect(() => {
		if (completed || !visible || !documentVisible || reducedMotion) return;
		let frame;
		let previousTime;
		const tick = (time) => {
			if (previousTime !== undefined && !rewoundToStartRef.current && time >= rewindUntilRef.current) {
				updateTimeline(timelineRef.current + time - previousTime);
			}
			previousTime = time;
			if (!completedRef.current) frame = requestAnimationFrame(tick);
		};
		frame = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frame);
	}, [completed, visible, documentVisible, reducedMotion, updateTimeline]);

	return (
		<section className="recording-showcase" id="showcase" ref={sectionRef} data-completed={completed} aria-label="Example video and features">
			<div className="showcase-stage" ref={stageRef}>
				<div className="showcase-player">
					<DemoVideo
						className="showcase-example"
						src={example.video}
						poster={example.poster}
						label={example.label}
						width={1920}
						height={1222}
						controls={false}
					/>
				</div>
				<div className="showcase-features" ref={featuresRef} aria-label="Recording features">
					<div className="showcase-feature-window">
						<div className="showcase-feature-track" style={{ "--feature-index": activeIndex }}>
							{highlights.map(({ id, title, description }, index) => (
								<article className="showcase-feature-text" key={id} aria-hidden={index !== activeIndex} aria-labelledby={`showcase-${id}`}>
									<h3 id={`showcase-${id}`}>{title}</h3>
									<p>{description}</p>
								</article>
							))}
						</div>
					</div>
					<div className="showcase-feature-controls">
						<div className="showcase-feature-progress" aria-label="Choose a feature">
							{highlights.map(({ id, title }, index) => (
								<button type="button" className="showcase-feature-selector" key={id} style={{ "--segment-index": index }} aria-label={`Show ${title}`} aria-pressed={index === activeIndex} onClick={() => selectFeature(index)}>
									<span className="showcase-progress-track" aria-hidden="true"><span /></span>
								</button>
							))}
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}
