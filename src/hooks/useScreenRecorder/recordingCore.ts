import { getEffectiveRecordingDurationMs } from "@/lib/mediaTiming";
import {
	BITRATE_4K,
	BITRATE_BASE,
	BITRATE_QHD,
	CHROME_MEDIA_SOURCE,
	DEFAULT_HEIGHT,
	DEFAULT_WIDTH,
	FOUR_K_PIXELS,
	HIGH_FRAME_RATE_BOOST,
	HIGH_FRAME_RATE_THRESHOLD,
	QHD_PIXELS,
	TARGET_FRAME_RATE,
	type ScreenRecorderRefs,
} from "./shared";

export function selectMimeType() {
	const preferred = [
		"video/webm;codecs=av1",
		"video/webm;codecs=h264",
		"video/webm;codecs=vp9",
		"video/webm;codecs=vp8",
		"video/webm",
	];

	return preferred.find((type) => MediaRecorder.isTypeSupported(type)) ?? "video/webm";
}

export function computeBitrate(width: number, height: number) {
	const pixels = width * height;
	const highFrameRateBoost =
		TARGET_FRAME_RATE >= HIGH_FRAME_RATE_THRESHOLD ? HIGH_FRAME_RATE_BOOST : 1;

	if (pixels >= FOUR_K_PIXELS) {
		return Math.round(BITRATE_4K * highFrameRateBoost);
	}

	if (pixels >= QHD_PIXELS) {
		return Math.round(BITRATE_QHD * highFrameRateBoost);
	}

	return Math.round(BITRATE_BASE * highFrameRateBoost);
}

export async function cleanupCapturedMedia(refs: ScreenRecorderRefs) {
	if (refs.stream.current) {
		refs.stream.current.getTracks().forEach((track) => track.stop());
		refs.stream.current = null;
	}

	if (refs.screenStream.current) {
		refs.screenStream.current.getTracks().forEach((track) => track.stop());
		refs.screenStream.current = null;
	}

	if (refs.microphoneStream.current) {
		refs.microphoneStream.current.getTracks().forEach((track) => track.stop());
		refs.microphoneStream.current = null;
	}

	if (refs.webcamStream.current) {
		refs.webcamStream.current.getTracks().forEach((track) => track.stop());
		refs.webcamStream.current = null;
	}

	if (refs.mixingContext.current) {
		await refs.mixingContext.current.close().catch(() => undefined);
		refs.mixingContext.current = null;
	}

	if (refs.micFallbackRecorder.current) {
		try {
			if (refs.micFallbackRecorder.current.state !== "inactive") {
				refs.micFallbackRecorder.current.stop();
			}
			refs.micFallbackRecorder.current.stream?.getTracks().forEach((track) => track.stop());
		} catch {
			// ignore cleanup failures
		}
		refs.micFallbackRecorder.current = null;
		refs.micFallbackChunks.current = [];
	}
}

export function resetRecordingClock(refs: ScreenRecorderRefs, startedAt: number) {
	refs.startTime.current = startedAt;
	refs.accumulatedPausedDurationMs.current = 0;
	refs.pauseStartedAtMs.current = null;
	refs.pauseSegmentsRef.current = [];
}

export function markRecordingPaused(refs: ScreenRecorderRefs, pausedAt: number) {
	if (refs.pauseStartedAtMs.current === null) {
		refs.pauseStartedAtMs.current = pausedAt;
	}
}

export function markRecordingResumed(refs: ScreenRecorderRefs, resumedAt: number) {
	if (refs.pauseStartedAtMs.current === null) {
		return;
	}

	const pauseStart = refs.pauseStartedAtMs.current;
	const pauseDurationMs = Math.max(0, resumedAt - pauseStart);
	refs.accumulatedPausedDurationMs.current += pauseDurationMs;
	if (pauseDurationMs > 0) {
		refs.pauseSegmentsRef.current.push({ startMs: pauseStart, endMs: resumedAt });
	}
	refs.pauseStartedAtMs.current = null;
}

export function getRecordingDurationMs(refs: ScreenRecorderRefs, endedAt: number) {
	return getEffectiveRecordingDurationMs({
		startTimeMs: refs.startTime.current,
		endTimeMs: endedAt,
		accumulatedPausedDurationMs: refs.accumulatedPausedDurationMs.current,
		pauseStartedAtMs: refs.pauseStartedAtMs.current,
	});
}

export async function preparePermissions(options: { startup?: boolean } = {}) {
	const platform = await window.electronAPI.getPlatform();
	if (platform !== "darwin") {
		return true;
	}

	const screenPermission = await window.electronAPI.getScreenRecordingPermissionStatus();
	if (!screenPermission.success || screenPermission.status !== "granted") {
		await window.electronAPI.openScreenRecordingPreferences();
		alert(
			options.startup
				? "Recordly needs Screen Recording permission before you start. System Settings has been opened. After enabling it, quit and reopen Recordly."
				: "Screen Recording permission is still missing. System Settings has been opened again. Enable it, then quit and reopen Recordly before recording.",
		);
		return false;
	}

	const accessibilityPermission = await window.electronAPI.getAccessibilityPermissionStatus();
	if (!accessibilityPermission.success) {
		return false;
	}

	if (accessibilityPermission.trusted) {
		return true;
	}

	const requestedAccessibility = await window.electronAPI.requestAccessibilityPermission();
	if (requestedAccessibility.success && requestedAccessibility.trusted) {
		return true;
	}

	await window.electronAPI.openAccessibilityPreferences();
	alert(
		options.startup
			? "Recordly also needs Accessibility permission for cursor tracking. System Settings has been opened. After enabling it, quit and reopen Recordly."
			: "Accessibility permission is still missing. System Settings has been opened again. Enable it, then quit and reopen Recordly before recording.",
	);
	return false;
}

export async function resolveBrowserCaptureSource(source: ProcessedDesktopSource) {
	if (!source?.id?.startsWith("screen:")) {
		return source;
	}

	try {
		const liveSources = await window.electronAPI.getSources({
			types: ["screen"],
			thumbnailSize: { width: 1, height: 1 },
			fetchWindowIcons: false,
		});

		const exactMatch = liveSources.find((candidate) => candidate.id === source.id);
		if (exactMatch) {
			return {
				...source,
				id: exactMatch.id,
				name: exactMatch.name ?? source.name,
				display_id: exactMatch.display_id ?? source.display_id,
			};
		}

		const displayMatch = liveSources.find(
			(candidate) => String(candidate.display_id ?? "") === String(source.display_id ?? ""),
		);
		if (displayMatch) {
			return {
				...source,
				id: displayMatch.id,
				name: displayMatch.name ?? source.name,
				display_id: displayMatch.display_id ?? source.display_id,
			};
		}
	} catch (error) {
		console.warn("Failed to resolve browser capture source:", error);
	}

	return source;
}

export function normalizeCaptureDimensions(track: MediaStreamTrack) {
	let {
		width = DEFAULT_WIDTH,
		height = DEFAULT_HEIGHT,
		frameRate = TARGET_FRAME_RATE,
	} = track.getSettings();

	return {
		width,
		height,
		frameRate,
	};
}

export { CHROME_MEDIA_SOURCE };