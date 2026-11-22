import type { ExportBackpressureProfile } from "./exportTuning";
import { getNowMs } from "./modernExportConstants";
import { getRuntimePlatform } from "./modernExportDiagnostics";
import { ModernExportFlowControl } from "./modernExportFlowControl";
import { ModernExportMetrics } from "./modernExportMetrics";
import { ModernExportProgress } from "./modernExportProgress";
import { ModernBrowserResources } from "./modernExportResources";
import { ModernNativeResources } from "./modernNativeResources";
import type { VideoExporterConfig } from "./modernVideoExporterConfig";
import type { DecodedVideoInfo } from "./streamingDecoder";

export interface ExportRuntimeDiagnostics {
	runtimeInfoStatus?: "available" | "unavailable" | "timed-out";
	runtime?: RendererExportRuntimeInfo;
	hardwareInfoStatus?: "available" | "unavailable" | "timed-out";
	appVersion?: string;
	userAgent?: string;
	logicalProcessors?: number;
	deviceMemoryGb?: number;
	hardware?: RendererExportHardwareInfo;
}

/** Coordinates independently owned resource, queue, progress and diagnostic lifetimes. */
export class ModernExportSession {
	cancelled = false;
	backpressureProfile: ExportBackpressureProfile | null = null;
	effectiveDurationSec = 0;
	sourceVideoInfo: DecodedVideoInfo | null = null;
	readonly browser = new ModernBrowserResources();
	readonly native: ModernNativeResources;
	readonly flow: ModernExportFlowControl;
	readonly metrics: ModernExportMetrics;
	readonly progress: ModernExportProgress;
	constructor(readonly config: VideoExporterConfig) {
		this.native = new ModernNativeResources(config);
		this.flow = new ModernExportFlowControl(this, getNowMs);
		this.metrics = new ModernExportMetrics(this, getNowMs, getRuntimePlatform);
		this.progress = new ModernExportProgress(this, getNowMs);
	}
	throwIfCancelled(): void {
		if (this.cancelled) throw new Error("Export cancelled");
	}
}
