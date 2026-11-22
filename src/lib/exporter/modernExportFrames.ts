import type { ModernExportAttempt, ModernExportFramePlan } from "./modernExportAttemptTypes";
import { getNowMs } from "./modernExportConstants";
import type { ModernExportHooks } from "./modernExportHooks";
import type { ModernExportSession } from "./modernExportSession";

type Hooks = Pick<ModernExportHooks, "encodeRenderedFrame" | "encodeRenderedFrameNative">;

type Session = Pick<
	ModernExportSession,
	"browser" | "cancelled" | "config" | "metrics" | "progress"
>;

export async function renderExportFrames(
	session: Session,
	hooks: Hooks,
	control: ModernExportAttempt,
	plan: ModernExportFramePlan,
): Promise<void> {
	const { useNativeEncoder, totalFrames } = plan;

	const frameDuration = 1_000_000 / session.config.frameRate; // in microseconds
	let frameIndex = 0;
	session.progress.exportStartTimeMs = getNowMs();
	session.progress.lastThroughputLogTimeMs = session.progress.exportStartTimeMs;
	session.progress.lastProgressSampleTimeMs = session.progress.exportStartTimeMs;
	session.progress.lastProgressSampleFrame = 0;
	session.progress.displayedRenderFps = 0;
	const decodeLoopStartedAt = getNowMs();

	try {
		await session.browser.streamingDecoder!.decodeAll(
			session.config.frameRate,
			session.config.trimRegions,
			session.config.speedRegions,
			async (videoFrame, _exportTimestampUs, sourceTimestampMs, cursorTimestampMs) => {
				const callbackStartedAt = getNowMs();
				try {
					if (session.cancelled) {
						return;
					}

					const timestamp = frameIndex * frameDuration;
					const sourceTimestampUs = sourceTimestampMs * 1000;
					const cursorTimestampUs = cursorTimestampMs * 1000;
					const renderStartedAt = getNowMs();
					control.inRendererStage = true;
					try {
						await session.browser.renderer!.renderFrame(
							videoFrame,
							sourceTimestampUs,
							cursorTimestampUs,
							frameDuration,
							timestamp,
						);
					} finally {
						session.metrics.renderFrameTimeMs += getNowMs() - renderStartedAt;
					}
					control.inRendererStage = false;

					if (session.cancelled) {
						return;
					}

					if (useNativeEncoder) {
						control.inNativeStage = true;
						await hooks.encodeRenderedFrameNative(timestamp, frameDuration, frameIndex);
						control.inNativeStage = false;
					} else {
						await hooks.encodeRenderedFrame(timestamp, frameDuration, frameIndex);
					}
					frameIndex++;
					session.metrics.processedFrameCount = frameIndex;
					session.progress.reportProgress(frameIndex, totalFrames, "extracting");
				} finally {
					session.metrics.frameCallbackTimeMs += getNowMs() - callbackStartedAt;
				}
			},
			session.config.clipRegions,
		);
	} finally {
		session.metrics.decodeLoopTimeMs = getNowMs() - decodeLoopStartedAt;
	}
}
