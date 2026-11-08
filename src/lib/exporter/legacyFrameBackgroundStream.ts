import { getEffectiveVideoStreamDurationSeconds } from "@/lib/mediaTiming";
import { ForwardFrameSource } from "./forwardFrameSource";
import type { LegacyFrameRendererContext } from "./legacyFrameRendererContext";

export function closeBackgroundDecodedFrame(
	context: Pick<LegacyFrameRendererContext, "backgroundDecodedFrame">,
): void {
	if (!context.backgroundDecodedFrame) {
		return;
	}

	context.backgroundDecodedFrame.close();
	context.backgroundDecodedFrame = null;
}

export async function restartBackgroundForwardFrameSource(
	context: Pick<
		LegacyFrameRendererContext,
		| "backgroundForwardFrameSourceUrl"
		| "backgroundForwardFrameSource"
		| "backgroundForwardFrameDurationSec"
		| "lastSyncedBackgroundLoopTimeSec"
	>,
): Promise<void> {
	const sourceUrl = context.backgroundForwardFrameSourceUrl;
	if (!sourceUrl) {
		return;
	}

	const nextSource = new ForwardFrameSource();
	const metadata = await nextSource.initialize(sourceUrl);
	const previousSource = context.backgroundForwardFrameSource;

	context.backgroundForwardFrameSource = nextSource;
	const effectiveDuration = getEffectiveVideoStreamDurationSeconds({
		duration: metadata?.duration,
		streamDuration: metadata?.streamDuration,
	});
	context.backgroundForwardFrameDurationSec =
		Number.isFinite(effectiveDuration) && effectiveDuration > 0 ? effectiveDuration : null;
	context.lastSyncedBackgroundLoopTimeSec = null;

	previousSource?.cancel();
	void previousSource?.destroy();
}

export async function syncBackgroundFrame(
	context: Pick<
		LegacyFrameRendererContext,
		| "backgroundForwardFrameSource"
		| "backgroundForwardFrameDurationSec"
		| "lastSyncedBackgroundLoopTimeSec"
		| "restartBackgroundForwardFrameSource"
		| "fallbackBackgroundForwardFrameSourceToMediaElement"
		| "syncBackgroundFrame"
		| "closeBackgroundDecodedFrame"
		| "backgroundDecodedFrame"
		| "drawBackgroundSourceToCanvas"
		| "syncBackgroundVideo"
	>,
	timeSeconds: number,
): Promise<void> {
	if (context.backgroundForwardFrameSource) {
		const duration = context.backgroundForwardFrameDurationSec;
		const shouldLoop = Number.isFinite(duration) && (duration ?? 0) > 0;
		let normalizedTargetTime = shouldLoop
			? ((timeSeconds % duration!) + duration!) % duration!
			: Math.max(0, timeSeconds);

		if (
			shouldLoop &&
			context.lastSyncedBackgroundLoopTimeSec !== null &&
			normalizedTargetTime + 0.001 < context.lastSyncedBackgroundLoopTimeSec
		) {
			try {
				await context.restartBackgroundForwardFrameSource();
			} catch (error) {
				console.warn(
					"[FrameRenderer] Unable to restart looping video wallpaper decoder during export:",
					error,
				);
			}
		}

		let decodedFrame: VideoFrame | null = null;
		try {
			decodedFrame =
				await context.backgroundForwardFrameSource.getFrameAtTime(normalizedTargetTime);
		} catch (error) {
			console.warn(
				"[FrameRenderer] Decoder-backed video wallpaper failed during export; falling back to media element sync:",
				error,
			);
			if (await context.fallbackBackgroundForwardFrameSourceToMediaElement()) {
				await context.syncBackgroundFrame(timeSeconds);
			}
			return;
		}
		const resolvedDecodedDuration =
			context.backgroundForwardFrameSource.getResolvedDurationSec();
		if (
			shouldLoop &&
			context.backgroundForwardFrameSource.hasReachedEndOfStream() &&
			Number.isFinite(resolvedDecodedDuration) &&
			(resolvedDecodedDuration ?? 0) > 0 &&
			normalizedTargetTime > (resolvedDecodedDuration ?? 0) + 0.001
		) {
			context.backgroundForwardFrameDurationSec = resolvedDecodedDuration ?? null;
			context.closeBackgroundDecodedFrame();
			try {
				await context.restartBackgroundForwardFrameSource();
				normalizedTargetTime =
					((timeSeconds % resolvedDecodedDuration!) + resolvedDecodedDuration!) %
					resolvedDecodedDuration!;
				const restartedFrame =
					await context.backgroundForwardFrameSource.getFrameAtTime(normalizedTargetTime);
				context.backgroundDecodedFrame = restartedFrame;
				if (restartedFrame) {
					context.lastSyncedBackgroundLoopTimeSec = normalizedTargetTime;
					context.drawBackgroundSourceToCanvas(
						restartedFrame,
						restartedFrame.displayWidth,
						restartedFrame.displayHeight,
					);
				}
				return;
			} catch (error) {
				console.warn(
					"[FrameRenderer] Unable to wrap looping video wallpaper at decoded EOF during export:",
					error,
				);
				if (await context.fallbackBackgroundForwardFrameSourceToMediaElement()) {
					await context.syncBackgroundFrame(timeSeconds);
				}
				return;
			}
		}
		context.closeBackgroundDecodedFrame();
		context.backgroundDecodedFrame = decodedFrame;
		if (decodedFrame) {
			context.lastSyncedBackgroundLoopTimeSec = normalizedTargetTime;
			context.drawBackgroundSourceToCanvas(
				decodedFrame,
				decodedFrame.displayWidth,
				decodedFrame.displayHeight,
			);
		}
		return;
	}

	await context.syncBackgroundVideo(timeSeconds);
}

export async function fallbackBackgroundForwardFrameSourceToMediaElement(
	context: Pick<
		LegacyFrameRendererContext,
		| "backgroundForwardFrameSourceUrl"
		| "backgroundForwardFrameSource"
		| "backgroundForwardFrameDurationSec"
		| "closeBackgroundDecodedFrame"
		| "lastSyncedBackgroundLoopTimeSec"
		| "loadBackgroundMediaElementSource"
	>,
): Promise<boolean> {
	const sourceUrl = context.backgroundForwardFrameSourceUrl;
	context.backgroundForwardFrameSource?.cancel();
	void context.backgroundForwardFrameSource?.destroy();
	context.backgroundForwardFrameSource = null;
	context.backgroundForwardFrameSourceUrl = null;
	context.backgroundForwardFrameDurationSec = null;
	context.closeBackgroundDecodedFrame();
	context.lastSyncedBackgroundLoopTimeSec = null;

	return sourceUrl ? context.loadBackgroundMediaElementSource(sourceUrl, sourceUrl) : false;
}
