import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type { SourceAudioMediaInfo } from "@/components/video-editor/audio/audioTypes";
import { buildResolvedAudioPlan } from "@/lib/exporter/audioRoutingEngine";
import {
	createReadableMediaResourceFile,
	getLocalFilePath,
	resolveMediaElementSource,
} from "@/lib/exporter/localMediaSource";
import {
	enablePitchPreservingPlayback,
	getMediaSyncPlaybackRate,
	resolveCompanionAudioPreviewTiming,
} from "@/lib/mediaTiming";
import type { AudioRegion, SpeedRegion } from "../types";
import { type DecodedWavAudio, decodeWavAudioData } from "./waveform/wavDecoder";

const SOURCE_AUDIO_PREVIEW_PLAYING_SEEK_DRIFT_SECONDS = 0.18;
const SOURCE_AUDIO_PREVIEW_PAUSED_SEEK_DRIFT_SECONDS = 0.01;
const SOURCE_AUDIO_PREVIEW_PLAYBACK_RATE_EPSILON = 0.001;
const SOURCE_AUDIO_PREVIEW_REMOTE_RESOURCE_PATTERN = /^(https?:|blob:|data:)/i;

interface UseAudioPreviewSyncParams {
	audioRegions: AudioRegion[];
	previewVolume: number;
	isPlaying: boolean;
	currentTime: number;
	timelineTime: number;
	duration: number;
	effectiveSpeedRegions: SpeedRegion[];
	previewSourceAudioFallbackPaths: string[];
	sourceAudioFallbackStartDelayMsByPath: Record<string, number>;
	sourceAudioFallbackMediaInfoByPath: Record<string, SourceAudioMediaInfo>;
	isCurrentClipMuted: boolean;
	getSourceTrackPreviewGain: (audioPath: string) => number;
	onSourceFallbackLoadError: (error: unknown) => void;
}

type DecodedSourcePreviewSyncAction = "start" | "restart" | "keep" | "stop";

interface DecodedSourcePreviewSyncInput {
	isPlaying: boolean;
	beforeAudioStart: boolean;
	atEnd: boolean;
	hasBuffer: boolean;
	hasActiveSource: boolean;
	timelineJumped: boolean;
	targetTime: number;
	predictedTime: number | null;
	playbackRate: number;
	activePlaybackRate: number | null;
}

interface DecodedSourceAudioBufferEntry {
	resourceKey: string;
	buffer: AudioBuffer;
}

interface ActiveDecodedSourceAudio {
	source: AudioBufferSourceNode;
	startedAtContextTime: number;
	offsetSeconds: number;
	playbackRate: number;
}

export function getSourceAudioElementResourceKey(
	audioPath: string,
	mediaInfo?: SourceAudioMediaInfo | null,
) {
	if (!mediaInfo) {
		return `${audioPath}::unprobed`;
	}

	return [
		audioPath,
		Number.isFinite(mediaInfo.durationMs) ? Math.round(mediaInfo.durationMs) : "duration",
		Number.isFinite(mediaInfo.sampleRate) ? mediaInfo.sampleRate : "sample-rate",
		Number.isFinite(mediaInfo.channels) ? mediaInfo.channels : "channels",
		mediaInfo.hasAudioStream ? "audio" : "no-audio",
	].join("::");
}

export function isAudioResourceLoadCurrent(
	resources: ReadonlyMap<string, string>,
	audioPath: string,
	expectedResourceKey: string,
) {
	return resources.get(audioPath) === expectedResourceKey;
}

export function getSourceAudioPreviewVolume(
	trackGain: number,
	previewVolume: number,
	muted: boolean,
) {
	if (muted) {
		return 0;
	}
	return Math.max(0, Math.min(1, trackGain * previewVolume));
}

export function shouldUseDecodedWavSourcePreview(
	audioPath: string,
	mediaInfo?: SourceAudioMediaInfo | null,
) {
	if (mediaInfo?.hasAudioStream === false) {
		return false;
	}

	if (
		SOURCE_AUDIO_PREVIEW_REMOTE_RESOURCE_PATTERN.test(audioPath) &&
		!getLocalFilePath(audioPath)
	) {
		return false;
	}

	const resourcePath = getLocalFilePath(audioPath) ?? audioPath;
	return resourcePath.split(/[?#]/)[0]?.toLowerCase().endsWith(".wav") ?? false;
}

export function getDecodedSourcePreviewSyncAction({
	isPlaying,
	beforeAudioStart,
	atEnd,
	hasBuffer,
	hasActiveSource,
	timelineJumped,
	targetTime,
	predictedTime,
	playbackRate,
	activePlaybackRate,
}: DecodedSourcePreviewSyncInput): DecodedSourcePreviewSyncAction {
	if (!isPlaying || beforeAudioStart || atEnd || !hasBuffer) {
		return "stop";
	}

	if (!hasActiveSource) {
		return "start";
	}

	if (timelineJumped) {
		return "restart";
	}

	if (
		Number.isFinite(playbackRate) &&
		Number.isFinite(activePlaybackRate) &&
		Math.abs(playbackRate - (activePlaybackRate ?? 1)) >
			SOURCE_AUDIO_PREVIEW_PLAYBACK_RATE_EPSILON
	) {
		return "restart";
	}

	if (!Number.isFinite(targetTime) || !Number.isFinite(predictedTime)) {
		return "restart";
	}

	if (
		Math.abs(targetTime - (predictedTime ?? 0)) >
		SOURCE_AUDIO_PREVIEW_PLAYING_SEEK_DRIFT_SECONDS
	) {
		return "restart";
	}

	return "keep";
}

function createAudioBufferFromDecodedWav(context: AudioContext, decoded: DecodedWavAudio) {
	const frameCount = decoded.channels[0]?.length ?? 0;
	const buffer = context.createBuffer(decoded.channels.length, frameCount, decoded.sampleRate);
	for (let channelIndex = 0; channelIndex < decoded.channels.length; channelIndex++) {
		buffer.copyToChannel(new Float32Array(decoded.channels[channelIndex]), channelIndex);
	}
	return buffer;
}

function getDecodedSourcePredictedTime(
	active: ActiveDecodedSourceAudio | null,
	contextCurrentTime: number,
) {
	if (!active) {
		return null;
	}

	return (
		active.offsetSeconds +
		Math.max(0, contextCurrentTime - active.startedAtContextTime) * active.playbackRate
	);
}

export function useAudioPreviewSync({
	audioRegions,
	previewVolume,
	isPlaying,
	currentTime,
	timelineTime,
	duration,
	effectiveSpeedRegions,
	previewSourceAudioFallbackPaths,
	sourceAudioFallbackStartDelayMsByPath,
	sourceAudioFallbackMediaInfoByPath,
	isCurrentClipMuted,
	getSourceTrackPreviewGain,
	onSourceFallbackLoadError,
}: UseAudioPreviewSyncParams) {
	const resolvedPlan = useMemo(
		() =>
			buildResolvedAudioPlan({
				videoResource: null,
				sourceAudioFallbackPaths: previewSourceAudioFallbackPaths,
				audioRegions,
			}),
		[audioRegions, previewSourceAudioFallbackPaths],
	);
	const resolvedUserTracks = useMemo(
		() => resolvedPlan.tracks.filter((track) => track.kind === "user"),
		[resolvedPlan],
	);
	const resolvedSourceTracks = useMemo(
		() => resolvedPlan.tracks.filter((track) => track.kind !== "user"),
		[resolvedPlan],
	);
	const [decodedSourceAudioLoadVersion, bumpDecodedSourceAudioLoadVersion] = useReducer(
		(value: number) => value + 1,
		0,
	);

	const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
	const audioElementRevokersRef = useRef<Map<string, () => void>>(new Map());
	const audioElementResourcesRef = useRef<Map<string, string>>(new Map());
	const sourceAudioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
	const sourceAudioMediaNodesRef = useRef<Map<string, MediaElementAudioSourceNode>>(new Map());
	const sourceAudioGainNodesRef = useRef<Map<string, GainNode>>(new Map());
	const sourceAudioElementRevokersRef = useRef<Map<string, () => void>>(new Map());
	const sourceAudioElementResourcesRef = useRef<Map<string, string>>(new Map());
	const sourceAudioContextRef = useRef<AudioContext | null>(null);
	const sourceAudioMasterGainRef = useRef<GainNode | null>(null);
	const sourceAudioResumePromiseRef = useRef<Promise<void> | null>(null);
	const decodedSourceAudioBuffersRef = useRef<Map<string, DecodedSourceAudioBufferEntry>>(
		new Map(),
	);
	const decodedSourceAudioResourcesRef = useRef<Map<string, string>>(new Map());
	const decodedSourceAudioActiveNodesRef = useRef<Map<string, ActiveDecodedSourceAudio>>(
		new Map(),
	);
	const decodedSourceAudioGainNodesRef = useRef<Map<string, GainNode>>(new Map());
	const lastSourceAudioSyncTimeRef = useRef<number | null>(null);
	const isPlayingRef = useRef(isPlaying);
	const onSourceFallbackLoadErrorRef = useRef(onSourceFallbackLoadError);
	const getSourceTrackPreviewGainRef = useRef(getSourceTrackPreviewGain);
	const previewVolumeRef = useRef(previewVolume);
	const isCurrentClipMutedRef = useRef(isCurrentClipMuted);
	isPlayingRef.current = isPlaying;
	onSourceFallbackLoadErrorRef.current = onSourceFallbackLoadError;
	getSourceTrackPreviewGainRef.current = getSourceTrackPreviewGain;
	previewVolumeRef.current = previewVolume;
	isCurrentClipMutedRef.current = isCurrentClipMuted;

	const ensureSourceAudioContext = useCallback(() => {
		if (!sourceAudioContextRef.current) {
			const context = new AudioContext({ latencyHint: "interactive" });
			const masterGain = context.createGain();
			masterGain.gain.value = 1;
			masterGain.connect(context.destination);
			sourceAudioContextRef.current = context;
			sourceAudioMasterGainRef.current = masterGain;
		}
		return sourceAudioContextRef.current;
	}, []);

	const ensureSourceAudioRunning = useCallback(() => {
		const context = ensureSourceAudioContext();
		if (context.state === "running") {
			return Promise.resolve();
		}
		if (!sourceAudioResumePromiseRef.current) {
			sourceAudioResumePromiseRef.current = context
				.resume()
				.catch(() => undefined)
				.finally(() => {
					sourceAudioResumePromiseRef.current = null;
				});
		}
		return sourceAudioResumePromiseRef.current;
	}, [ensureSourceAudioContext]);

	const stopDecodedSourceAudioPreview = useCallback((audioPath: string) => {
		const active = decodedSourceAudioActiveNodesRef.current.get(audioPath);
		if (!active) {
			return;
		}

		try {
			active.source.stop();
		} catch {
			// The source may already have ended.
		}
		active.source.disconnect();
		decodedSourceAudioActiveNodesRef.current.delete(audioPath);
	}, []);

	const disconnectDecodedSourceAudioPreview = useCallback(
		(audioPath: string) => {
			stopDecodedSourceAudioPreview(audioPath);
			decodedSourceAudioBuffersRef.current.delete(audioPath);
			decodedSourceAudioResourcesRef.current.delete(audioPath);
			const gainNode = decodedSourceAudioGainNodesRef.current.get(audioPath);
			if (gainNode) {
				gainNode.disconnect();
				decodedSourceAudioGainNodesRef.current.delete(audioPath);
			}
		},
		[stopDecodedSourceAudioPreview],
	);

	const playSourceAudioPreview = useCallback(() => {
		void ensureSourceAudioRunning();
		for (const audio of sourceAudioElementsRef.current.values()) {
			if (!audio.src) continue;
			audio.play().catch(() => undefined);
		}
	}, [ensureSourceAudioRunning]);

	const startDecodedSourceAudioPreview = useCallback(
		({
			audioPath,
			buffer,
			targetTime,
			playbackRate,
			gain,
		}: {
			audioPath: string;
			buffer: AudioBuffer;
			targetTime: number;
			playbackRate: number;
			gain: number;
		}) => {
			stopDecodedSourceAudioPreview(audioPath);

			const context = ensureSourceAudioContext();
			if (targetTime >= buffer.duration) {
				return;
			}

			let gainNode = decodedSourceAudioGainNodesRef.current.get(audioPath);
			if (!gainNode) {
				gainNode = context.createGain();
				decodedSourceAudioGainNodesRef.current.set(audioPath, gainNode);
			}
			gainNode.disconnect();
			gainNode.gain.value = gain;
			gainNode.connect(sourceAudioMasterGainRef.current ?? context.destination);

			const source = context.createBufferSource();
			source.buffer = buffer;
			source.playbackRate.value =
				Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;
			source.connect(gainNode);
			const offsetSeconds = Math.max(
				0,
				Math.min(targetTime, Math.max(0, buffer.duration - 0.001)),
			);
			source.start(0, offsetSeconds);

			const active: ActiveDecodedSourceAudio = {
				source,
				startedAtContextTime: context.currentTime,
				offsetSeconds,
				playbackRate: source.playbackRate.value,
			};
			decodedSourceAudioActiveNodesRef.current.set(audioPath, active);
			source.onended = () => {
				if (decodedSourceAudioActiveNodesRef.current.get(audioPath) === active) {
					decodedSourceAudioActiveNodesRef.current.delete(audioPath);
				}
			};
		},
		[ensureSourceAudioContext, stopDecodedSourceAudioPreview],
	);

	useEffect(() => {
		const existing = audioElementsRef.current;
		const currentIds = new Set(resolvedUserTracks.map((track) => track.id));

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

		for (const track of resolvedUserTracks) {
			let audio = existing.get(track.id);
			if (!audio) {
				audio = new Audio();
				audio.preload = "auto";
				existing.set(track.id, audio);
			}

			if (audioElementResourcesRef.current.get(track.id) !== track.sourceRef.path) {
				audio.pause();
				audio.src = "";
				audioElementRevokersRef.current.get(track.id)?.();
				audioElementRevokersRef.current.delete(track.id);
				audioElementResourcesRef.current.set(track.id, track.sourceRef.path);

				void (async () => {
					const resolved = await resolveMediaElementSource(track.sourceRef.path);
					const latestAudio = existing.get(track.id);

					if (
						latestAudio !== audio ||
						!isAudioResourceLoadCurrent(
							audioElementResourcesRef.current,
							track.id,
							track.sourceRef.path,
						)
					) {
						resolved.revoke();
						return;
					}

					audioElementRevokersRef.current.set(track.id, resolved.revoke);
					latestAudio.src = resolved.src;
				})();
			}

			audio.volume = Math.max(0, Math.min(1, track.gain * previewVolume));
		}
	}, [previewVolume, resolvedUserTracks]);

	useEffect(() => {
		const existing = sourceAudioElementsRef.current;
		const currentIds = new Set(resolvedSourceTracks.map((track) => track.sourceRef.path));
		const cleanupMediaElement = (id: string, audio: HTMLAudioElement) => {
			audio.pause();
			audio.src = "";
			sourceAudioMediaNodesRef.current.get(id)?.disconnect();
			sourceAudioMediaNodesRef.current.delete(id);
			sourceAudioGainNodesRef.current.get(id)?.disconnect();
			sourceAudioGainNodesRef.current.delete(id);
			sourceAudioElementRevokersRef.current.get(id)?.();
			sourceAudioElementRevokersRef.current.delete(id);
			sourceAudioElementResourcesRef.current.delete(id);
			existing.delete(id);
		};

		for (const [id, audio] of existing) {
			if (!currentIds.has(id)) {
				cleanupMediaElement(id, audio);
			}
		}

		for (const id of Array.from(decodedSourceAudioResourcesRef.current.keys())) {
			if (!currentIds.has(id)) {
				disconnectDecodedSourceAudioPreview(id);
			}
		}

		for (const track of resolvedSourceTracks) {
			const audioPath = track.sourceRef.path;
			const mediaInfo = sourceAudioFallbackMediaInfoByPath[audioPath];
			const resourceKey = getSourceAudioElementResourceKey(audioPath, mediaInfo);
			const useDecodedWavPreview = shouldUseDecodedWavSourcePreview(audioPath, mediaInfo);

			if (useDecodedWavPreview) {
				const existingAudio = existing.get(audioPath);
				if (existingAudio) {
					cleanupMediaElement(audioPath, existingAudio);
				}

				if (decodedSourceAudioResourcesRef.current.get(audioPath) !== resourceKey) {
					stopDecodedSourceAudioPreview(audioPath);
					decodedSourceAudioBuffersRef.current.delete(audioPath);
					decodedSourceAudioResourcesRef.current.set(audioPath, resourceKey);

					void (async () => {
						try {
							const file = await createReadableMediaResourceFile(audioPath);
							const arrayBuffer = await file.arrayBuffer();
							const decoded = decodeWavAudioData(arrayBuffer);
							if (!decoded) {
								throw new Error("Failed to decode companion WAV audio");
							}

							if (
								!isAudioResourceLoadCurrent(
									decodedSourceAudioResourcesRef.current,
									audioPath,
									resourceKey,
								)
							) {
								return;
							}

							const context = ensureSourceAudioContext();
							const buffer = createAudioBufferFromDecodedWav(context, decoded);
							decodedSourceAudioBuffersRef.current.set(audioPath, {
								resourceKey,
								buffer,
							});
							bumpDecodedSourceAudioLoadVersion();
						} catch (error) {
							if (
								!isAudioResourceLoadCurrent(
									decodedSourceAudioResourcesRef.current,
									audioPath,
									resourceKey,
								)
							) {
								return;
							}

							disconnectDecodedSourceAudioPreview(audioPath);
							onSourceFallbackLoadErrorRef.current(error);
						}
					})();
				}

				continue;
			}

			disconnectDecodedSourceAudioPreview(audioPath);
			let audio = existing.get(audioPath);
			if (!audio) {
				audio = new Audio();
				audio.preload = "auto";
				audio.crossOrigin = "anonymous";
				existing.set(audioPath, audio);
			}
			audio.volume = getSourceAudioPreviewVolume(
				getSourceTrackPreviewGainRef.current(audioPath),
				previewVolumeRef.current,
				isCurrentClipMutedRef.current,
			);
			audio.dataset.sourceAudioPath = audioPath;

			// Web Audio API createMediaElementSource breaks preservesPitch on Chromium.
			// We route directly through the HTMLAudioElement to ensure pitch preservation works
			// during speed changes. Note: this limits maximum preview volume to 1.0 (100%).

			if (sourceAudioElementResourcesRef.current.get(audioPath) !== resourceKey) {
				audio.pause();
				audio.src = "";
				sourceAudioElementRevokersRef.current.get(audioPath)?.();
				sourceAudioElementRevokersRef.current.delete(audioPath);
				sourceAudioElementResourcesRef.current.set(audioPath, resourceKey);

				void (async () => {
					try {
						const resolved = await resolveMediaElementSource(audioPath);
						const latestAudio = existing.get(audioPath);

						if (
							latestAudio !== audio ||
							!isAudioResourceLoadCurrent(
								sourceAudioElementResourcesRef.current,
								audioPath,
								resourceKey,
							)
						) {
							resolved.revoke();
							return;
						}

						sourceAudioElementRevokersRef.current.set(audioPath, resolved.revoke);
						latestAudio.src = resolved.src;
						latestAudio.volume = getSourceAudioPreviewVolume(
							getSourceTrackPreviewGainRef.current(audioPath),
							previewVolumeRef.current,
							isCurrentClipMutedRef.current,
						);
						latestAudio.load();
						if (isPlayingRef.current) {
							playSourceAudioPreview();
						}
					} catch (error) {
						const latestAudio = existing.get(audioPath);
						if (
							latestAudio !== audio ||
							!isAudioResourceLoadCurrent(
								sourceAudioElementResourcesRef.current,
								audioPath,
								resourceKey,
							)
						) {
							return;
						}

						sourceAudioElementRevokersRef.current.get(audioPath)?.();
						sourceAudioElementRevokersRef.current.delete(audioPath);
						sourceAudioElementResourcesRef.current.delete(audioPath);
						latestAudio.pause();
						latestAudio.src = "";
						onSourceFallbackLoadErrorRef.current(error);
					}
				})();
			}
		}

		if (resolvedSourceTracks.length === 0) {
			lastSourceAudioSyncTimeRef.current = null;
		}
	}, [
		resolvedSourceTracks,
		playSourceAudioPreview,
		disconnectDecodedSourceAudioPreview,
		ensureSourceAudioContext,
		stopDecodedSourceAudioPreview,
		sourceAudioFallbackMediaInfoByPath,
	]);

	useEffect(() => {
		for (const track of resolvedSourceTracks) {
			const audioPath = track.sourceRef.path;
			const gain = Math.max(0, Math.min(1, getSourceTrackPreviewGain(audioPath)));
			const decodedGainNode = decodedSourceAudioGainNodesRef.current.get(audioPath);
			if (decodedGainNode) {
				decodedGainNode.gain.value = gain;
			}

			const audio = sourceAudioElementsRef.current.get(audioPath);
			if (audio) {
				audio.volume = getSourceAudioPreviewVolume(gain, previewVolume, isCurrentClipMuted);
			}
		}

		if (sourceAudioMasterGainRef.current) {
			sourceAudioMasterGainRef.current.gain.value = isCurrentClipMuted
				? 0
				: Math.max(0, Math.min(1, previewVolume));
		}
	}, [getSourceTrackPreviewGain, isCurrentClipMuted, previewVolume, resolvedSourceTracks]);

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
			for (const node of sourceAudioMediaNodesRef.current.values()) {
				node.disconnect();
			}
			for (const node of sourceAudioGainNodesRef.current.values()) {
				node.disconnect();
			}
			for (const revoke of sourceAudioElementRevokersRef.current.values()) {
				revoke();
			}
			sourceAudioElementsRef.current.clear();
			sourceAudioMediaNodesRef.current.clear();
			sourceAudioGainNodesRef.current.clear();
			sourceAudioElementRevokersRef.current.clear();
			sourceAudioElementResourcesRef.current.clear();
			for (const active of decodedSourceAudioActiveNodesRef.current.values()) {
				try {
					active.source.stop();
				} catch {
					// The source may already have ended.
				}
				active.source.disconnect();
			}
			for (const gainNode of decodedSourceAudioGainNodesRef.current.values()) {
				gainNode.disconnect();
			}
			decodedSourceAudioBuffersRef.current.clear();
			decodedSourceAudioResourcesRef.current.clear();
			decodedSourceAudioActiveNodesRef.current.clear();
			decodedSourceAudioGainNodesRef.current.clear();
			if (sourceAudioMasterGainRef.current) {
				sourceAudioMasterGainRef.current.disconnect();
				sourceAudioMasterGainRef.current = null;
			}
			const context = sourceAudioContextRef.current;
			sourceAudioContextRef.current = null;
			sourceAudioResumePromiseRef.current = null;
			if (context) {
				void context.close();
			}
			lastSourceAudioSyncTimeRef.current = null;
		};
	}, []);

	useEffect(() => {
		const currentTimeMs = timelineTime * 1000;
		const activeSpeedRegion = effectiveSpeedRegions.find(
			(region) => currentTimeMs >= region.startMs && currentTimeMs < region.endMs,
		);
		const targetPlaybackRate = activeSpeedRegion ? activeSpeedRegion.speed : 1;

		for (const track of resolvedUserTracks) {
			const audio = audioElementsRef.current.get(track.id);
			if (!audio) continue;

			const startMs = track.timelineBinding.startMs;
			const endMs = track.timelineBinding.endMs;
			const isInRegion = currentTimeMs >= startMs && currentTimeMs < endMs;

			if (isPlaying && isInRegion) {
				enablePitchPreservingPlayback(audio);
				const audioOffset = (currentTimeMs - startMs) / 1000;
				if (Math.abs(audio.currentTime - audioOffset) > 0.2) {
					audio.currentTime = audioOffset;
				}
				const syncedPlaybackRate = getMediaSyncPlaybackRate({
					basePlaybackRate: targetPlaybackRate,
					currentTime: audio.currentTime,
					targetTime: audioOffset,
				});
				if (Math.abs(audio.playbackRate - syncedPlaybackRate) > 0.001) {
					audio.playbackRate = syncedPlaybackRate;
				}
				if (audio.paused) {
					audio.play().catch(() => undefined);
				}
			} else if (!audio.paused) {
				audio.pause();
			}
		}
	}, [effectiveSpeedRegions, isPlaying, resolvedUserTracks, timelineTime]);

	useEffect(() => {
		// Re-sync when an async decoded WAV buffer finishes loading.
		void decodedSourceAudioLoadVersion;

		if (resolvedSourceTracks.length === 0) {
			lastSourceAudioSyncTimeRef.current = null;
			return;
		}

		const activeSpeedRegion = effectiveSpeedRegions.find(
			(region) => currentTime * 1000 >= region.startMs && currentTime * 1000 < region.endMs,
		);
		const targetPlaybackRate = activeSpeedRegion ? activeSpeedRegion.speed : 1;
		const previousTimelineTime = lastSourceAudioSyncTimeRef.current;
		const timelineJumped =
			previousTimelineTime === null || Math.abs(currentTime - previousTimelineTime) > 0.25;
		const driftThreshold = isPlaying
			? SOURCE_AUDIO_PREVIEW_PLAYING_SEEK_DRIFT_SECONDS
			: SOURCE_AUDIO_PREVIEW_PAUSED_SEEK_DRIFT_SECONDS;
		if (sourceAudioMasterGainRef.current) {
			sourceAudioMasterGainRef.current.gain.value = isCurrentClipMuted
				? 0
				: Math.max(0, Math.min(1, previewVolume));
		}

		for (const track of resolvedSourceTracks) {
			const sourceAudioPath = track.sourceRef.path;
			const mediaInfo = sourceAudioFallbackMediaInfoByPath[sourceAudioPath];
			const probedAudioDurationSeconds = Number.isFinite(mediaInfo?.durationMs)
				? (mediaInfo?.durationMs ?? 0) / 1000
				: null;
			const useDecodedWavPreview = shouldUseDecodedWavSourcePreview(
				sourceAudioPath,
				mediaInfo,
			);

			if (useDecodedWavPreview) {
				const bufferEntry = decodedSourceAudioBuffersRef.current.get(sourceAudioPath);
				const buffer = bufferEntry?.buffer ?? null;
				const { beforeAudioStart, targetTime, atEnd } = resolveCompanionAudioPreviewTiming({
					currentTimeSeconds: currentTime,
					timelineDurationSeconds: duration,
					audioDurationSeconds: buffer?.duration ?? null,
					probedAudioDurationSeconds,
					recordedStartDelayMs: sourceAudioFallbackStartDelayMsByPath[sourceAudioPath],
				});
				const gain = Math.max(0, Math.min(1, getSourceTrackPreviewGain(sourceAudioPath)));
				const gainNode = decodedSourceAudioGainNodesRef.current.get(sourceAudioPath);
				if (gainNode) {
					gainNode.gain.value = gain;
				}

				const active =
					decodedSourceAudioActiveNodesRef.current.get(sourceAudioPath) ?? null;
				const predictedTime = getDecodedSourcePredictedTime(
					active,
					sourceAudioContextRef.current?.currentTime ?? 0,
				);
				const action = getDecodedSourcePreviewSyncAction({
					isPlaying,
					beforeAudioStart,
					atEnd,
					hasBuffer: buffer !== null,
					hasActiveSource: active !== null,
					timelineJumped,
					targetTime,
					predictedTime,
					playbackRate: targetPlaybackRate,
					activePlaybackRate: active?.playbackRate ?? null,
				});

				if (action === "stop") {
					stopDecodedSourceAudioPreview(sourceAudioPath);
				} else if (buffer && (action === "start" || action === "restart")) {
					void ensureSourceAudioRunning();
					startDecodedSourceAudioPreview({
						audioPath: sourceAudioPath,
						buffer,
						targetTime,
						playbackRate: targetPlaybackRate,
						gain,
					});
				}

				continue;
			}

			const audio = sourceAudioElementsRef.current.get(sourceAudioPath);
			if (!audio) continue;

			audio.volume = Math.max(
				0,
				Math.min(
					1,
					getSourceTrackPreviewGain(sourceAudioPath) *
						(isCurrentClipMuted ? 0 : previewVolume),
				),
			);

			enablePitchPreservingPlayback(audio);
			const audioDuration = Number.isFinite(audio.duration) ? audio.duration : null;
			const { beforeAudioStart, targetTime, atEnd } = resolveCompanionAudioPreviewTiming({
				currentTimeSeconds: currentTime,
				timelineDurationSeconds: duration,
				audioDurationSeconds: audioDuration,
				probedAudioDurationSeconds,
				recordedStartDelayMs: sourceAudioFallbackStartDelayMsByPath[sourceAudioPath],
			});

			const shouldSeek =
				timelineJumped ||
				(!isPlaying && Math.abs(audio.currentTime - targetTime) > driftThreshold) ||
				(isPlaying && Math.abs(audio.currentTime - targetTime) > 0.9);
			if (shouldSeek) {
				try {
					audio.currentTime = targetTime;
				} catch {
					// no-op
				}
			}

			// KISS for companion source tracks: fixed playback rate avoids audible flutter/stutter
			// from continuous micro-corrections on system audio.
			const syncedPlaybackRate = targetPlaybackRate;
			if (Math.abs(audio.playbackRate - syncedPlaybackRate) > 0.001) {
				audio.playbackRate = syncedPlaybackRate;
			}

			if (isPlaying && !beforeAudioStart && !atEnd) {
				void ensureSourceAudioRunning().then(() => {
					audio.play().catch(() => undefined);
				});
			} else if (!audio.paused) {
				audio.pause();
			}
		}

		lastSourceAudioSyncTimeRef.current = currentTime;
	}, [
		currentTime,
		decodedSourceAudioLoadVersion,
		duration,
		effectiveSpeedRegions,
		getSourceTrackPreviewGain,
		isCurrentClipMuted,
		isPlaying,
		previewVolume,
		resolvedSourceTracks,
		sourceAudioFallbackStartDelayMsByPath,
		sourceAudioFallbackMediaInfoByPath,
		ensureSourceAudioRunning,
		startDecodedSourceAudioPreview,
		stopDecodedSourceAudioPreview,
	]);

	useEffect(() => {
		if (!isPlaying || resolvedSourceTracks.length === 0) {
			return;
		}
		void ensureSourceAudioRunning().then(() => {
			for (const audio of sourceAudioElementsRef.current.values()) {
				if (audio.paused) {
					audio.play().catch(() => undefined);
				}
			}
		});
	}, [isPlaying, resolvedSourceTracks.length, ensureSourceAudioRunning]);

	return { playSourceAudioPreview };
}
