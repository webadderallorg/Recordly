import { enablePitchPreservingPlayback } from "@/lib/mediaTiming";
import {
	type ClipRegion,
	findClipAtTimelineTime,
	getClipSourceStartMs,
	getTimelineDurationMs,
	sortClipRegions,
} from "../types";

/** The playhead may stop at the timeline end; that is not a black gap. */
export function findPreviewClipAtTimelineTime(
	timeMs: number,
	clips: ClipRegion[],
): ClipRegion | null {
	const active = findClipAtTimelineTime(timeMs, clips);
	if (active) return active;
	const last = sortClipRegions(clips)[clips.length - 1];
	return last && Math.abs(timeMs - last.endMs) < 1e-7 ? last : null;
}

/** Timeline time advances at 1x; only the source media uses the clip's speed. */
export function createClipPlayback({
	video,
	getClips,
	onTime,
	onPlaying,
	onError,
	onSourceSeek,
}: {
	video: HTMLVideoElement;
	getClips: () => ClipRegion[];
	onTime: (timelineSeconds: number, sourceSeconds: number | null) => void;
	onPlaying: (playing: boolean) => void;
	onError: (error: unknown) => void;
	onSourceSeek?: (reason: "cut" | "seek") => void;
}) {
	let timeMs = 0;
	let playing = false;
	let request: number | null = null;
	let lastTick = 0;
	let activeClip: ClipRegion | null = null;
	let playRequest = 0;
	const duration = () => getTimelineDurationMs(getClips(), 0);

	const pause = () => {
		playRequest++;
		playing = false;
		if (request !== null) cancelAnimationFrame(request);
		request = null;
		video.pause();
		onPlaying(false);
	};
	const playSource = () => {
		const request = ++playRequest;
		void video.play().catch((error) => {
			// A deliberate seek/pause can interrupt a pending play request.
			if (!playing || request !== playRequest) return;
			pause();
			onError(error);
		});
	};
	const sync = (seek = false) => {
		const clips = getClips();
		// Empty timeline space is skipped during playback. Clip positions and
		// paused seeks stay intact so editing a gap never moves source footage.
		if (playing && !findPreviewClipAtTimelineTime(timeMs, clips)) {
			const next = sortClipRegions(clips).find((clip) => clip.startMs > timeMs);
			if (next) timeMs = next.startMs;
		}
		const clip = findPreviewClipAtTimelineTime(timeMs, clips);
		const sourceMs = clip
			? getClipSourceStartMs(clip) + (timeMs - clip.startMs) * clip.speed
			: null;
		if (clip && sourceMs !== null) {
			enablePitchPreservingPlayback(video);
			try {
				video.playbackRate = clip.speed;
			} catch (error) {
				pause();
				onError(error);
				return;
			}
			if (seek || clip !== activeClip) {
				// Clip out-points are exclusive. At the final timeline endpoint,
				// request a frame inside the clip, not EOF or the following footage.
				const atEnd = timeMs >= clip.endMs - 1e-7;
				const targetMs = atEnd
					? Math.max(getClipSourceStartMs(clip), sourceMs - 0.001)
					: sourceMs;
				const target = Math.max(
					0,
					Math.min(
						Number.isFinite(video.duration)
							? Math.max(0, video.duration - 0.000001)
							: Infinity,
						targetMs / 1000,
					),
				);
				// Assigning currentTime even to its current value starts another
				// asynchronous seek in Chromium (especially disruptive at zero).
				if (Math.abs(video.currentTime - target) > 1e-8) {
					onSourceSeek?.(playing && !seek ? "cut" : "seek");
					if (playing) {
						playRequest++;
						video.pause();
					}
					video.currentTime = target;
				}
			}
			if (playing && (seek || clip !== activeClip) && !video.seeking) playSource();
		} else {
			playRequest++;
			video.pause();
		}
		activeClip = clip;
		onTime(timeMs / 1000, sourceMs === null ? null : sourceMs / 1000);
	};
	const tick = (now: number) => {
		request = null;
		if (!playing) return;
		// Follow the media inside footage (buffering must not skip content).
		// With no clips loaded, elapsed real time is the fallback clock.
		if (!activeClip) timeMs += now - lastTick;
		else if (!video.seeking) {
			timeMs = video.ended
				? activeClip.endMs
				: Math.min(
						activeClip.endMs,
						Math.max(
							activeClip.startMs,
							activeClip.startMs +
								(video.currentTime * 1000 - getClipSourceStartMs(activeClip)) /
									activeClip.speed,
						),
					);
		}
		timeMs = Math.min(duration(), timeMs);
		lastTick = now;
		sync();
		if (!playing) return;
		if (timeMs >= duration()) {
			pause();
		} else {
			if (activeClip && !video.seeking && video.paused) playSource();
			request = requestAnimationFrame(tick);
		}
	};
	return {
		get isPlaying() {
			return playing;
		},
		play: async () => {
			if (playing || getClips().length === 0) return;
			if (timeMs >= duration()) timeMs = 0;
			playing = true;
			onPlaying(true);
			lastTick = performance.now();
			sync(true);
			if (playing) request = requestAnimationFrame(tick);
		},
		pause,
		seek: (seconds: number) => {
			timeMs = Math.max(0, Math.min(duration(), seconds * 1000));
			lastTick = performance.now();
			sync(true);
		},
		refresh: () => {
			timeMs = Math.min(timeMs, duration());
			sync(true);
		},
		dispose: pause,
	};
}
