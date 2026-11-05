import { AudioProcessor } from "./audioEncoder";
import type { ModernExportFlowControl } from "./modernExportFlowControl";
import type { ModernExportMetrics } from "./modernExportMetrics";
import type { ModernExportSession } from "./modernExportSession";
import { FrameRenderer as ModernFrameRenderer } from "./modernFrameRenderer";
import { VideoMuxer } from "./muxer";
import { StreamingVideoDecoder } from "./streamingDecoder";

export class ModernBrowserResources {
	streamingDecoder: StreamingVideoDecoder | null = null;
	renderer: ModernFrameRenderer | null = null;
	encoder: VideoEncoder | null = null;
	muxer: VideoMuxer | null = null;
	audioProcessor: AudioProcessor | null = null;
	videoDescription: Uint8Array | undefined;
	videoColorSpace: VideoColorSpaceInit | undefined;
	encoderError: Error | null = null;
	disposeEncoder(
		flow: Pick<ModernExportFlowControl, "resetEncoder">,
		metrics: Pick<ModernExportMetrics, "encodeBackend" | "encoderName">,
	): void {
		if (!this.encoder) {
			return;
		}

		try {
			if (this.encoder.state !== "closed") {
				this.encoder.close();
			}
		} catch (error) {
			console.warn("Error closing encoder:", error);
		}

		this.encoder = null;
		flow.resetEncoder();
		this.videoDescription = undefined;
		this.videoColorSpace = undefined;
		metrics.encodeBackend = null;
		metrics.encoderName = null;
	}
	cleanup(
		flow: Pick<ModernExportFlowControl, "resetEncoder">,
		metrics: Pick<ModernExportMetrics, "encodeBackend" | "encoderName">,
	): void {
		this.disposeEncoder(flow, metrics);

		if (this.streamingDecoder) {
			try {
				this.streamingDecoder.destroy();
			} catch (e) {
				console.warn("Error destroying streaming decoder:", e);
			}
			this.streamingDecoder = null;
		}

		if (this.renderer) {
			try {
				this.renderer.destroy();
			} catch (e) {
				console.warn("Error destroying renderer:", e);
			}
			this.renderer = null;
		}

		if (this.muxer) {
			try {
				this.muxer.destroy();
			} catch (e) {
				console.warn("Error destroying muxer:", e);
			}
		}

		this.muxer = null;
		this.audioProcessor?.cancel();
		this.audioProcessor = null;
	}
	cancel(): void {
		this.streamingDecoder?.cancel();
		this.audioProcessor?.cancel();
	}
}

export function cancel(
	session: Pick<ModernExportSession, "cancelled" | "flow" | "browser" | "native">,
): void {
	session.cancelled = true;
	session.flow.notifyEncodeCapacityAvailable();
	session.browser.cancel();
	session.native.cancel();
}

export function cleanup(
	session: Pick<
		ModernExportSession,
		| "browser"
		| "native"
		| "flow"
		| "metrics"
		| "progress"
		| "effectiveDurationSec"
		| "backpressureProfile"
	>,
): void {
	session.browser.cleanup(session.flow, session.metrics);
	session.native.cleanup();
	session.metrics.resetAttempt();
	session.effectiveDurationSec = 0;
	session.progress.reset();
	session.flow.reset();
	session.backpressureProfile = null;
	session.browser.encoderError = null;
	session.browser.videoDescription = undefined;
	session.browser.videoColorSpace = undefined;
}
