/**
 * useEditorAudioSync – manages per-region and source-audio HTML elements
 * and keeps them in sync with the video playback position.
 *
 * This hook owns the HTMLAudioElement lifecycle entirely – it creates,
 * updates and destroys elements in response to region / path changes.
 */
import { useEffect, useRef } from "react";
import { resolveMediaElementSource } from "@/lib/exporter/localMediaSource";
import {
	clampMediaTimeToDuration,
	estimateCompanionAudioStartDelaySeconds,
	getMediaSyncPlaybackRate,
} from "@/lib/mediaTiming";
import type { AudioRegion, SpeedRegion } from "../types";

interface UseEditorAudioSyncParams {
	audioRegions: AudioRegion[];
	speedRegions: SpeedRegion[];
	sourceAudioFallbackPaths: string[];
	isPlaying: boolean;
	currentTime: number;
	duration: number;
	previewVolume: number;
	mapSourceTimeToTimelineTime: (timeMs: number) => number;
}

export function useEditorAudioSync({
	audioRegions,
	speedRegions,
	sourceAudioFallbackPaths,
	isPlaying,
	currentTime,
	duration,
	previewVolume,
	mapSourceTimeToTimelineTime,
}: UseEditorAudioSyncParams) {
	const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
	const audioElementRevokersRef = useRef<Map<string, () => void>>(new Map());
	const audioElementResourcesRef = useRef<Map<string, string>>(new Map());
	const sourceAudioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
	const sourceAudioElementRevokersRef = useRef<Map<string, () => void>>(new Map());
	const sourceAudioElementResourcesRef = useRef<Map<string, string>>(new Map());
	const lastSourceAudioSyncTimeRef = useRef<number | null>(null);

	// Create/update/destroy per-region audio elements
	useEffect(() => {
		let cancelled = false;
		const existing = audioElementsRef.current;
		const currentIds = new Set(audioRegions.map((region) => region.id));

		for (const [id, audio] of existing) {
			if (!currentIds.has(id)) {
				audio.pause();
				audio.src = "";
				audioElementRevokersRef.current.get(id)?.();
				audioElementRevokersRef.current.delete(id);
				audioElementResourcesRef.current.delete(id);
				existing.delete(id);
			}
		}

		for (const region of audioRegions) {
			let audio = existing.get(region.id);
			if (!audio) {
				audio = new Audio();
				audio.preload = "auto";
				existing.set(region.id, audio);
			}

			if (audioElementResourcesRef.current.get(region.id) !== region.audioPath) {
				audio.pause();
				audio.src = "";
				audioElementRevokersRef.current.get(region.id)?.();
				audioElementRevokersRef.current.delete(region.id);
				audioElementResourcesRef.current.set(region.id, region.audioPath);

				const capturedAudio = audio;
				const capturedPath = region.audioPath;
				void (async () => {
					const resolved = await resolveMediaElementSource(capturedPath);
					const latestAudio = existing.get(region.id);
					if (
						cancelled ||
						latestAudio !== capturedAudio ||
						audioElementResourcesRef.current.get(region.id) !== capturedPath
					) {
						resolved.revoke();
						return;
					}
					audioElementRevokersRef.current.set(region.id, resolved.revoke);
					latestAudio.src = resolved.src;
				})();
			}

			audio.volume = Math.max(0, Math.min(1, region.volume * previewVolume));
		}

		return () => {
			cancelled = true;
		};
	}, [audioRegions, previewVolume]);

	// Create/update/destroy source-audio fallback elements
	useEffect(() => {
		let cancelled = false;
		const existing = sourceAudioElementsRef.current;
		const currentIds = new Set(sourceAudioFallbackPaths);

		for (const [id, audio] of existing) {
			if (!currentIds.has(id)) {
				audio.pause();
				audio.src = "";
				sourceAudioElementRevokersRef.current.get(id)?.();
				sourceAudioElementRevokersRef.current.delete(id);
				sourceAudioElementResourcesRef.current.delete(id);
				existing.delete(id);
			}
		}

		for (const audioPath of sourceAudioFallbackPaths) {
			let audio = existing.get(audioPath);
			if (!audio) {
				audio = new Audio();
				audio.preload = "auto";
				existing.set(audioPath, audio);
			}

			if (sourceAudioElementResourcesRef.current.get(audioPath) !== audioPath) {
				audio.pause();
				audio.src = "";
				sourceAudioElementRevokersRef.current.get(audioPath)?.();
				sourceAudioElementRevokersRef.current.delete(audioPath);
				sourceAudioElementResourcesRef.current.set(audioPath, audioPath);

				const capturedAudio = audio;
				void (async () => {
					const resolved = await resolveMediaElementSource(audioPath);
					const latestAudio = existing.get(audioPath);
					if (
						cancelled ||
						latestAudio !== capturedAudio ||
						sourceAudioElementResourcesRef.current.get(audioPath) !== audioPath
					) {
						resolved.revoke();
						return;
					}
					sourceAudioElementRevokersRef.current.set(audioPath, resolved.revoke);
					latestAudio.src = resolved.src;
				})();
			}

			audio.volume = Math.max(0, Math.min(1, previewVolume));
		}

		if (sourceAudioFallbackPaths.length === 0) {
			lastSourceAudioSyncTimeRef.current = null;
		}

		return () => {
			cancelled = true;
		};
	}, [previewVolume, sourceAudioFallbackPaths]);

	// Cleanup on unmount
	useEffect(() => {
		return () => {
			for (const audio of audioElementsRef.current.values()) {
				audio.pause();
				audio.src = "";
			}
			for (const revoke of audioElementRevokersRef.current.values()) {
				revoke();
			}
			audioElementsRef.current.clear();
			audioElementRevokersRef.current.clear();
			audioElementResourcesRef.current.clear();
			for (const audio of sourceAudioElementsRef.current.values()) {
				audio.pause();
				audio.src = "";
			}
			for (const revoke of sourceAudioElementRevokersRef.current.values()) {
				revoke();
			}
			sourceAudioElementsRef.current.clear();
			sourceAudioElementRevokersRef.current.clear();
			sourceAudioElementResourcesRef.current.clear();
			lastSourceAudioSyncTimeRef.current = null;
		};
	}, []);

	// Sync per-region audio elements with video playback
	useEffect(() => {
		const currentTimeMs = currentTime * 1000;
		const timelineMs = mapSourceTimeToTimelineTime(currentTimeMs);

		for (const region of audioRegions) {
			const audio = audioElementsRef.current.get(region.id);
			if (!audio) continue;
			const isInRegion = timelineMs >= region.startMs && timelineMs < region.endMs;
			if (isPlaying && isInRegion) {
				const audioOffset = (timelineMs - region.startMs) / 1000;
				if (Math.abs(audio.currentTime - audioOffset) > 0.2) {
					audio.currentTime = audioOffset;
				}
				const syncedRate = getMediaSyncPlaybackRate({
					basePlaybackRate: 1,
					currentTime: audio.currentTime,
					targetTime: audioOffset,
				});
				if (Math.abs(audio.playbackRate - syncedRate) > 0.001) {
					audio.playbackRate = syncedRate;
				}
				if (audio.paused) {
					audio.play().catch(() => undefined);
				}
			} else if (!audio.paused) {
				audio.pause();
			}
		}
	}, [isPlaying, currentTime, audioRegions, mapSourceTimeToTimelineTime]);

	// Sync source-audio fallback elements with video playback
	useEffect(() => {
		if (sourceAudioFallbackPaths.length === 0) {
			lastSourceAudioSyncTimeRef.current = null;
			return;
		}
		const activeSpeedRegion = speedRegions.find(
			(region) => currentTime * 1000 >= region.startMs && currentTime * 1000 < region.endMs,
		);
		const targetPlaybackRate = activeSpeedRegion ? activeSpeedRegion.speed : 1;
		const previousTimelineTime = lastSourceAudioSyncTimeRef.current;
		const timelineJumped =
			previousTimelineTime === null || Math.abs(currentTime - previousTimelineTime) > 0.25;
		const driftThreshold = isPlaying ? 0.35 : 0.01;

		for (const audio of sourceAudioElementsRef.current.values()) {
			const audioDuration = Number.isFinite(audio.duration) ? audio.duration : null;
			const startDelaySeconds = estimateCompanionAudioStartDelaySeconds(
				duration,
				audioDuration,
			);
			const beforeAudioStart = currentTime + 0.001 < startDelaySeconds;
			const targetTime = clampMediaTimeToDuration(
				currentTime - startDelaySeconds,
				audioDuration,
			);

			if (timelineJumped || Math.abs(audio.currentTime - targetTime) > driftThreshold) {
				try {
					audio.currentTime = targetTime;
				} catch {
					/* no-op */
				}
			}
			const syncedRate = getMediaSyncPlaybackRate({
				basePlaybackRate: targetPlaybackRate,
				currentTime: audio.currentTime,
				targetTime,
			});
			if (Math.abs(audio.playbackRate - syncedRate) > 0.001) {
				audio.playbackRate = syncedRate;
			}
			const atEnd = audioDuration !== null && targetTime >= audioDuration;
			if (isPlaying && !beforeAudioStart && !atEnd) {
				audio.play().catch(() => undefined);
			} else if (!audio.paused) {
				audio.pause();
			}
		}
		lastSourceAudioSyncTimeRef.current = currentTime;
	}, [currentTime, duration, isPlaying, sourceAudioFallbackPaths, speedRegions]);
}